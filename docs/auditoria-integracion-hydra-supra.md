# Auditoría técnica y arquitectura objetivo — Interconexión bidireccional Hydra ↔ SUPRA

**Fecha:** 2026-07-20
**Alcance:** `C:\Development\hydra` (rama `combo/hydra`) y `C:\Development\supra-1` (rama `v2/main`, HEAD `6e3273d`).
**Método:** auditoría de solo lectura del código de ambos repositorios (modelos, controllers, services, jobs, eventos, webhooks, conectores, esquemas, migraciones, tests, configuración, auth, integraciones), contrastada contra la documentación de SUPRA. Todas las afirmaciones citan `archivo:línea`. No se modificó código.

---

## Resumen ejecutivo

**El hallazgo central invierte la premisa del proyecto:** hoy **Hydra ES el payment engine** y la fuente de verdad financiera del sistema CEA, mientras que SUPRA contiene un payment engine domain-agnostic notablemente maduro (`/v1`, tablas `engine_*`) que está **desconectado del flujo operativo real**. La única integración existente es un conector de ingesta *pull*, unidireccional (Hydra→SUPRA), manual por defecto y sin write-back. Hydra no tiene ni una línea de código que conozca a SUPRA.

Tres hechos determinan la estrategia:

1. **Hydra implementa hoy todo el dominio financiero**: motor de tarifas y facturación, CFDI 4.0, libro open-item de cartera con aplicación FIFO, aging, score de morosidad, convenios con parcialidades, dunning con campañas A/B, caja, pasarelas, conciliación de recaudadores externos y pólizas contables SAP. Es fuente de verdad persistente de facturas, recibos, pagos y convenios.
2. **Ninguna frontera de dinero real está conectada en Hydra**: la pasarela de pago, el PAC de timbrado y la notificación usan exclusivamente providers **simulados** (Conekta/OpenPay/Stripe y Finkok/SW existen solo como comentarios en `pasarela.factory.ts:18-19` y `pac.factory.ts:17-18`). No hay credenciales de PSP ni SDK de proveedor en Hydra.
3. **SUPRA ya tiene construida la maquinaria que Hydra necesitaría duplicar**: ledger de partida doble inmutable, outbox transaccional con relay multi-réplica y DLQ con replay, webhooks salientes firmados HMAC con protección anti-replay, idempotencia por tenant, payment intents/plans/links/methods, disputas, settlements, conciliación contra estados de cuenta bancarios (camt.053/MT940), routing multi-proveedor, reglas de fraude, approvals maker-checker, y conectores **reales** de Stripe, Conekta, PorCobrar, NetSuite (bidireccional), SAP y SendGrid.

**Conclusión estratégica:** existe una ventana de oportunidad única — como Hydra aún no mueve dinero real, la migración de ownership al engine de SUPRA puede hacerse **antes** de contratar PSP/PAC en Hydra, evitando el escenario más caro (migrar un money-path productivo). La recomendación es **no conectar jamás proveedores reales en Hydra**: implementar la integración comando/evento descrita en las secciones E–F y trasladar el ownership por dominios en las fases de la sección I. Hydra queda como sistema operativo, de UI y de workflow; SUPRA como Financial System of Record.

---

## A. Arquitectura actual

### A.1 Diagrama de la arquitectura actual

```text
┌────────────────────────────── HYDRA (NestJS :3001 + React :8080) ──────────────────────────────┐
│                                                                                                 │
│  OPERACIÓN                          DOMINIO FINANCIERO COMPLETO (fuente de verdad)              │
│  ├─ solicitudes/contratos           ├─ facturacion  (motor tarifas + lotes + refacturación)     │
│  ├─ tomas/medidores/lecturas        ├─ timbrados    (CFDI 4.0 real, PAC SIMULADO)               │
│  ├─ rutas/órdenes/consumos          ├─ recibos      (saldos vigente/vencido, vencimientos)      │
│  ├─ GIS/clima/indicadores           ├─ pagos        (caja + ETL 7 layouts bancarios)            │
│  └─ portal ciudadano (UI)           ├─ pasarelas    (intentos SPEI/OXXO/tarjeta, PSP SIMULADO)  │
│                                     ├─ convenios    (parcialidades, anticipos, cancelación)     │
│  Prisma → PostgreSQL «hydra»        ├─ cartera      (open-item ledger, FIFO, aging, score)      │
│  (Timbrado, Recibo, Pago,           ├─ dunning      (reglas, campañas A/B, corte/reconexión)    │
│   Convenio, DocumentoCartera,       ├─ caja         (sesiones, cortes)                          │
│   AplicacionPago, EstadoCuenta,     ├─ conciliaciones (agregada interna)                        │
│   IntentoPago, Poliza…)             └─ contabilidad (pólizas + export IDoc SAP archivo)         │
│                                                                                                 │
│  Webhooks SALIENTES propios: pago.aplicado / recibo.emitido / lectura.capturada                 │
│  (HMAC X-Hydra-Signature; ninguna suscripción apunta a SUPRA)                                   │
└───────────────────────────────▲─────────────────────────────────────────────────────────────────┘
                                │  ÚNICA INTEGRACIÓN EXISTENTE (pull, unidireccional, manual)
                                │  SUPRA → Hydra: POST /api/auth/login (JWT cuenta de servicio)
                                │  GET /api/contratos (sin paginar) · GET /api/recibos · GET /api/pagos
                                │  Hydra NUNCA llama a SUPRA. SUPRA NUNCA escribe en Hydra.
┌───────────────────────────────┴─────────────────────────────────────────────────────────────────┐
│                                SUPRA (Express :3001, monolito modular)                          │
│                                                                                                 │
│  connectors/hydra (IngestionConnector)        CORE ENGINE «/v1» (domain-agnostic, engine_*)      │
│    cursor 3 fases: contratos→recibos→pagos    ├─ customers/accounts/obligations                  │
│    Contrato→EngineCustomer                    ├─ payments/refunds/disputes/intents               │
│    Recibo→EngineObligation (hydra.recibo)     ├─ payment_plans/links/methods                     │
│    Pago(con reciboId)→EnginePayment           ├─ ledger partida doble (BigInt minor units)       │
│                                               ├─ settlements + statement reconciliation          │
│  DOMINIO LEGACY AGUA (réplica Aquacis):       ├─ outbox→relay→webhooks firmados + DLQ/replay     │
│    Contrato/Factura/Cliente/Lectura…          ├─ routing multi-PSP + fraud rules + approvals     │
│    portal ciudadano propio + SOAP Aquacis     └─ multi-tenant (RLS diseñado, no activado)        │
│                                                                                                 │
│  Conectores REALES: stripe · conekta · porcobrar · netsuite(bidi) · sap · sendgrid · bankfiles  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### A.2 Comunicación actual — inventario verificado

| # | Origen → Destino | Mecanismo | Datos | Auth | Evidencia |
|---|---|---|---|---|---|
| 1 | SUPRA → Hydra | `POST /api/auth/login` | credenciales → JWT | password en env `CONNECTOR_SECRET_HYDRA` | `supra-1\backend\src\connectors\hydra\client.ts:139-159` |
| 2 | SUPRA → Hydra | `GET /api/contratos` (sin paginación, cacheado completo en memoria) | contratos → customers | Bearer JWT | `client.ts:237-239`; `connector.ts:243-246` |
| 3 | SUPRA → Hydra | `GET /api/recibos?page&limit` | recibos → obligations | Bearer JWT | `client.ts:241-261` |
| 4 | SUPRA → Hydra | `GET /api/pagos?page&limit` | pagos (solo con `reciboId`) → payments | Bearer JWT | `client.ts:263-279`; `connector.ts:322` |
| 5 | Operador → SUPRA | `POST /v1/connector_instances/:id/sync` (manual) | dispara ingesta | API key `sk_…` | `engine\routes\connectors.ts:420-456` |
| 6 | SUPRA interno | scheduler `setInterval` + advisory lock PG; **default apagado** (`ENGINE_INGESTION_INTERVAL_MS=0`) | sync programado | n/a | `engine\services\ingestion.ts:755-835` |

**Lo que NO existe (verificado exhaustivamente):**
- Hydra → SUPRA: cero llamadas; la única coincidencia de "supra" en todo el repo Hydra es el nombre de una colonia en un seed INEGI (`hydra\backend\prisma\migrations\20260427000000_...\migration.sql:1215`).
- Webhooks en cualquier dirección entre ambos sistemas.
- Write-back SUPRA → Hydra (el conector solo implementa `pullRecords`; el cliente HTTP solo tiene GETs + login).
- Conexión directa a la BD de Hydra desde SUPRA, o viceversa.
- Referencias cruzadas en docker-compose/env (stacks independientes; ambos usan :3001, el override de Hydra lo mueve a :3009).

**Eventos y polling:** Hydra emite webhooks salientes propios (`pago.aplicado`, `recibo.emitido`, `lectura.capturada` — `hydra\backend\src\modules\webhooks\webhooks.service.ts:22`) pero sin suscriptores SUPRA. Todo lo demás en Hydra es síncrono o cron (facturación mensual, timbrado, recálculo de cartera 02:00, dunning 03:00, expiración de intentos, reintento de webhooks — master switch `HYDRA_JOBS_ENABLED`, default apagado). En SUPRA todo cambio de estado emite eventos vía outbox transaccional (`engine\lib\outbox.ts:23-42`) entregados por relay con `FOR UPDATE SKIP LOCKED` + lease (`engine\services\relay.ts:239-262`).

### A.3 Lógica de pagos: dónde vive hoy

**En Hydra (todo persistido en su BD; es fuente de verdad):**

| Capacidad | Implementación | Evidencia |
|---|---|---|
| Motor de tarifas/billing | calculadora pura escalonado/fijo/variable + precedencia admin>global | `facturacion/billing-calculator.ts` |
| Facturación masiva | lotes auditables, cancelar/reprocesar con guardas fiscales, refacturación | `facturacion.service.ts` |
| CFDI 4.0 | XML real (claves SAT), validación cuadre ±0.02; sellado vía PAC **simulado** | `timbrados/cfdi-builder.ts`, `pac.factory.ts:17-18` |
| Registro de pagos | caja (`POST /pagos`), auto-reconexión al liquidar | `pagos.service.ts:51-109` |
| Recaudación externa | parsers OXXO/Banorte/BBVA/Santander/Citibanamex/HSBC + conciliación manual | `etl-pagos.service.ts` |
| Pasarela digital | `IntentoPago` SPEI/OXXO/tarjeta, webhook público, expiración; PSP **simulado** | `pasarelas.service.ts:116-193`, `providers/simulada.provider.ts` |
| Convenios | parcialidades + anticipo, aplicar/cancelar, completado automático | `convenios.service.ts:50-84` |
| Ledger de cartera | `DocumentoCartera` open-item + `AplicacionPago` FIFO + `EstadoCuenta` materializado | `cartera.service.ts` |
| Dunning | reglas como datos, campañas con grupo control A/B y uplift, corte/restricción/convenio | `dunning.service.ts`, `uplift.ts` |
| Conciliación interna | agregada (recaudación vs facturación vs contabilidad) | `conciliaciones/` |
| Contabilidad | pólizas de cobros/facturación + export IDoc SAP (archivo) | `contabilidad/` |

**En SUPRA (engine `/v1`):** el dominio financiero canónico completo (§A.1) — pero recibiendo únicamente datos de ingesta de Hydra y del dominio legacy Aquacis; su money-path real (portal propio, `POST /api/portal/:contrato/pagar`, PSPs reales) opera sobre su réplica Aquacis, no sobre Hydra.

**Duplicación estructural — el mismo dominio está modelado TRES veces:**

| Concepto | Hydra | SUPRA legacy agua | SUPRA engine |
|---|---|---|---|
| Cliente | `Persona` + `RolPersonaContrato` | `Cliente` | `EngineCustomer` |
| Contrato | `Contrato` (cuid) | `Contrato` (Int) | (aplanado en customer+metadata) |
| Factura/recibo | `Timbrado` + `Recibo` | `Factura` | `EngineObligation` |
| Pago | `Pago` + `PagoExterno` + `AplicacionPago` | `MovimientoFinanciero` | `EnginePayment` + `EnginePaymentAllocation` |
| Convenio | `Convenio` | — | `EnginePaymentPlan` + `EnginePlanInstallment` (**sin sincronizar con Hydra**) |
| Ledger | `Poliza`/`LineaPoliza` | `LedgerAccount`/`JournalEntry`/`Posting` | `EngineLedgerAccount`/`EngineJournalEntry`/`EnginePosting` |
| Intento de pago | `IntentoPago` | `TarjetaGuardada` | `EnginePaymentIntent` + `EnginePaymentMethod` |
| Representación de dinero | `Decimal(10,2)` | `Decimal(10,2)` | `BigInt` unidad menor (centavos) |

Además el **frontend de Hydra duplica lógica financiera en el navegador**: cálculo de adeudos (`Pagos.tsx:115-122`), estado Pagada/Vencida derivado en UI (`PortalCliente.tsx:268-290`), parcialidades de convenio (`Convenios.tsx:167-173`), y un motor de tarifas completo embebido en el bundle (`lib/tarifas.ts` + `data/tarifas-agua.json`).

### A.4 Ownership ambiguo detectado

- **Convenios:** existen en Hydra (`Convenio`) y en SUPRA (`EnginePaymentPlan` + módulo `agreements` con taxonomía, ruleset versionado y maker-checker) sin puente alguno. Un convenio activo en Hydra es invisible para SUPRA y viceversa.
- **Conciliación:** Hydra concilia agregados internos y archivos de recaudadores a mano; SUPRA concilia contra estados de cuenta bancarios reales (camt.053/MT940, three-way settlement match). Nadie concilia *entre* ambos sistemas.
- **Portal ciudadano:** ambos sistemas tienen uno, con money-path propio cada uno (Hydra: `portal/` + `IntentoPago` simulado; SUPRA: `/api/portal/:contrato/pagar` con engine real).
- **Dominio agua legacy de SUPRA:** duplica el dominio operativo de Hydra (réplica Aquacis). Con Hydra como sistema operativo, esta capa es redundante en la arquitectura objetivo.

---

## B. Arquitectura objetivo

### B.1 Componentes

```text
┌───────────────────────────────────── HYDRA — Operational System ─────────────────────────────────────┐
│  UI/UX · workflows · usuarios · contratos · tomas · lecturas · consumos · órdenes · GIS · clima      │
│                                                                                                       │
│  FACTURADOR DE DOMINIO (se queda — excepción justificada §J):                                         │
│    motor de tarifas + generación de recibo/CFDI (documento fiscal)                                    │
│    → cada recibo emitido se REGISTRA en SUPRA como obligation (comando)                               │
│                                                                                                       │
│  CAPA DE INTEGRACIÓN (nueva):                                                                         │
│    ├─ SupraClient (server-to-server, sk_ key + scopes + Idempotency-Key + correlation)                │
│    ├─ Outbox de comandos (reintentos, orden, kill-switch)                                             │
│    ├─ Receptor de webhooks SUPRA (verifica Supra-Signature, inbox dedupe, procesamiento async)        │
│    └─ Read-models financieros (proyección local de saldos/estados para UI, NUNCA fuente de verdad)    │
│                                                                                                       │
│  WORKFLOWS OPERATIVOS disparados por eventos financieros:                                             │
│    corte/reconexión · restricciones · notificaciones · órdenes de trabajo · atención a clientes       │
└───────────────┬───────────────────────────────────────────────────────────────▲──────────────────────┘
                │  COMANDOS (HTTP /v1, síncronos, idempotentes)                  │  EVENTOS (webhooks
                │  customers · obligations · payments · intents ·                │  firmados, at-least-once,
                │  payment_plans · refunds · write-offs · credits                │  outbox+DLQ+replay)
┌───────────────▼───────────────────────────────────────────────────────────────┴──────────────────────┐
│                                SUPRA — Financial System of Record                                     │
│  PAYMENT ENGINE /v1 (tenant «cea-queretaro»)                                                          │
│    obligations (source of truth de cuentas por cobrar) · payments · allocations · intents             │
│    payment plans (convenios) · refunds · disputes · payment methods (tokens PSP, SAQ-A)               │
│    ledger partida doble · settlements · statement reconciliation · fees                               │
│    routing multi-PSP · fraud rules · approvals maker-checker · audit trail · eventos AsyncAPI          │
└───────┬───────────────────┬───────────────────┬──────────────────────┬───────────────────────────────┘
        ▼                   ▼                   ▼                      ▼
   PSPs reales         Banca/SPEI          Recaudadores          ERP / Contabilidad
   (Conekta, Stripe,   (bankfiles:         externos              (conector SAP:
   PorCobrar)          camt.053/MT940,     (OXXO, bancos —       pólizas/IDoc;
                       transferencias)     conector de archivo)  patrón NetSuite)
```

Regla operativa: **Hydra no ejecuta pagos, no conoce proveedores, no mantiene el estado financiero principal.** Muestra proyecciones locales (read-models) alimentadas por eventos, y todo lo que muestre debe poder regenerarse desde SUPRA.

### B.2 Flujo de pago (portal ciudadano y caja)

```text
Ciudadano (portal Hydra)                  Cajero (caja Hydra)
      │ pagar en línea                          │ cobra en ventanilla
      ▼                                         ▼
Hydra backend ── POST /v1/payment_intents ──┐   Hydra backend ── POST /v1/payments ──┐
  (o payment_links para checkout externo)  │     (Record External Payment,          │
      │                                     │      allocations a obligations,        │
      │ confirm → SUPRA orquesta PSP        │      Idempotency-Key = pago hydra)     │
      ▼                                     ▼                                        ▼
                            SUPRA: intent → provider attempt → captura → EnginePayment
                                   ledger posting · allocation · settlement esperado
                                             │ outbox
                                             ▼
                      webhook firmado → Hydra inbox → read-model actualizado
                                             │
                                             ▼
                      obligación liquidada → Hydra dispara workflow de RECONEXIÓN
                                             portal/caja muestran «pagado»
```

### B.3 Flujo de facturación

```text
Lecturas → Consumos → Motor de tarifas Hydra → Recibo + CFDI (Hydra emite y timbra)
                                                     │ comando idempotente
                                                     ▼
                          POST /v1/obligations  (external_ref: hydra:recibo:<id>,
                                                 type: hydra.recibo, due date, monto minor units)
                                                     │
                     refacturación / cancelación de lote → POST /v1/obligations/:id/cancel
                     incobrable autorizado             → POST /v1/obligations/:id/write_off
                                                     │ eventos
                                                     ▼
                          obligation.created / .canceled / .written_off → Hydra read-model
```

### B.4 Flujo de convenios

```text
Operador Hydra (UI) ── simula ──► POST /api/… simulate (SUPRA agreements: ruleset versionado, puro)
                    ── propone ─► proposal (escenario congelado)
                    ── aprueba ─► approve (maker-checker: aprobador ≠ proponente)
                    ── activa ──► POST /v1/obligations/:id/payment_plan → EnginePaymentPlan
                                            │
                          SUPRA gestiona: parcialidades, vencimientos, grace_days,
                          default_after_missed, pagos aplicados, completado, cancelación
                                            │ eventos payment_plan.*
                                            ▼
        Hydra: muestra convenio, marca EstadoCuenta.enConvenio (read-model), excluye de corte
```

### B.5 Flujo de eventos (SUPRA → Hydra)

```text
Cambio de estado en SUPRA (misma transacción) → engine_events_outbox (secuencia total)
   → relay (SKIP LOCKED + lease, backoff jitter, máx 10 intentos, luego DLQ + replay manual)
   → POST https://hydra/api/integraciones/supra/webhook
        headers: Supra-Signature (t=…,v1=HMAC-SHA256) · Supra-Event-Id
   → Hydra: verifica firma+tolerancia 5 min → inserta en SupraEventoInbox (UNIQUE event_id)
   → procesador async: actualiza read-model, dispara workflows, marca procesado
   → recuperación: si Hydra estuvo caído, el relay reintenta; huecos se detectan por `sequence`
     y se rellenan con GET /v1/events (log replayable)
```

### B.6 Integraciones externas

Toda integración de dinero/finanzas pasa por SUPRA: PSPs (Conekta/Stripe/PorCobrar vía routing), SPEI/banca (bank_transfer + bankfiles), recaudadores externos (nuevo conector de archivos que absorbe los parsers ETL de Hydra), ERP/SAP (patrón ErpConnector como NetSuite; sustituye el export IDoc por archivo de Hydra). Hydra conserva únicamente integraciones **no financieras** (SMN/CONAGUA, INEGI, GIS, notificaciones operativas). El PAC de CFDI queda del lado del facturador (Hydra) — ver excepción en §J.

---

## C. Ownership Matrix

| Entidad / Proceso | Owner actual | Owner objetivo | Source of truth objetivo | Migración |
|---|---|---|---|---|
| Payments (registro/estado) | Hydra (`Pago`) | **SUPRA** (`EnginePayment`) | SUPRA | Sí — comando Record Payment + backfill |
| Payment intents (SPEI/OXXO/tarjeta) | Hydra (`IntentoPago`, simulado) | **SUPRA** (`EnginePaymentIntent`) | SUPRA | Sí — sustituir módulo `pasarelas` |
| Payment attempts / provider responses | Hydra (simulado) | **SUPRA** (`EngineProviderAttempt`) | SUPRA | Sí (nada real que migrar) |
| Payment methods / tokens | Inexistente real (maquetas portal) | **SUPRA** (`EnginePaymentMethod`, SAQ-A) | SUPRA | No (crear en SUPRA) |
| Payment providers / gateways / PSP | Hydra factory simulada | **SUPRA** (connectors + routing) | SUPRA | Sí — eliminar factory de Hydra |
| Invoice como cuenta por cobrar | Hydra (`Recibo`+saldos) | **SUPRA** (`EngineObligation`) | SUPRA | Sí — comando + backfill |
| Invoice como documento fiscal (CFDI) | Hydra (`Timbrado`) | **Hydra** (excepción justificada §J) | Hydra | No |
| Cálculo tarifario / generación de recibo | Hydra | **Hydra** (dominio agua) | Hydra | No |
| Payment agreements / convenios | Hydra (`Convenio`) + SUPRA (sin puente) | **SUPRA** (`EnginePaymentPlan` + agreements) | SUPRA | Sí — migrar activos + congelar Hydra |
| Installments / schedules | Hydra (campos en `Convenio`) | **SUPRA** (`EnginePlanInstallment`) | SUPRA | Sí |
| Refunds / reversals | Inexistente en Hydra | **SUPRA** (`EngineRefund`) | SUPRA | No (gap que SUPRA cierra) |
| Chargebacks / disputas | Inexistente en Hydra | **SUPRA** (`EngineDispute`) | SUPRA | No |
| Saldos / aging / estado de cuenta | Hydra (`DocumentoCartera`, `EstadoCuenta`) | **SUPRA** (obligations+allocations+balance) | SUPRA | Sí — Hydra pasa a read-model |
| Aplicación de pagos (FIFO) | Hydra (`AplicacionPago`) | **SUPRA** (`EnginePaymentAllocation`) | SUPRA | Sí |
| Write-off / incobrables | Hydra | **SUPRA** (`write_off` + approvals) | SUPRA | Sí |
| Reconciliation bancaria | Parcial en Hydra (ETL manual) | **SUPRA** (statement reconciliation) | SUPRA | Sí — parsers ETL → conector |
| Settlements / fees | Inexistente en Hydra | **SUPRA** | SUPRA | No |
| Financial ledger | 3 implementaciones | **SUPRA** (`EngineLedger*`) | SUPRA | Consolidar |
| Financial audit trail | Disperso (`LogProceso`) | **SUPRA** (`EngineAuditLog` + events) | SUPRA | Sí |
| Payment events / orquestación / state machines | Hydra (implícitas en services) | **SUPRA** (outbox + catálogo AsyncAPI) | SUPRA | Sí |
| Dunning: hechos financieros (mora, buckets) | Hydra | **SUPRA** (derivado de obligations) | SUPRA | Sí |
| Dunning: acciones operativas (corte, aviso, campañas) | Hydra | **Hydra** (workflow sobre eventos SUPRA) | Hydra | Refactor de fuente de datos |
| Corte / reconexión / restricciones | Hydra | **Hydra** | Hydra | Cambia el trigger (evento SUPRA) |
| Caja: sesión/corte (operativo) | Hydra | **Hydra** (registro del pago → SUPRA) | Mixto | Refactor |
| Contabilidad / pólizas / ERP | Hydra (IDoc archivo) | **SUPRA** (ErpConnector) | SUPRA | Sí |
| Contratos, tomas, lecturas, consumos | Hydra | **Hydra** | Hydra | No |
| Personas / usuarios / roles | Hydra | **Hydra** (espejo `EngineCustomer` vía comando) | Hydra (identidad) / SUPRA (rol financiero) | Sí — sync |
| UI / UX / portal ciudadano (presentación) | Hydra (+portal SUPRA duplicado) | **Hydra** | Hydra | Retirar portal SUPRA para CEA |
| Dominio legacy agua dentro de SUPRA | SUPRA | **Eliminar/congelar** (duplicado de Hydra) | — | Deprecar |
| Notificaciones operativas | Hydra | **Hydra** | Hydra | No |

---

## D. Gap Analysis

### Critical

| # | Gap | Evidencia | Impacto |
|---|---|---|---|
| C1 | **Sin write-back SUPRA→Hydra**: un pago cobrado por SUPRA no regresa; divergencia de saldos garantizada | `connectors\hydra\connector.ts:130,210` (solo `pullRecords`) | El objetivo bidireccional no existe; bloquea todo |
| C2 | **Hydra no emite comandos a SUPRA**: cero integración saliente | búsqueda "supra" en Hydra: 1 falso positivo | Ídem |
| C3 | **Pérdida silenciosa de recibos en sync incremental**: el filtro usa `fechaVencimiento` como si fuera fecha de creación; un recibo nuevo con vencimiento anterior al watermark nunca se ingesta | `connectors\hydra\client.ts:254-260` | Datos financieros incompletos en SUPRA hoy |
| C4 | **Pagos sin `reciboId` omitidos silenciosamente** (anticipos, convenios): subregistro de cobranza en SUPRA | `connector.ts:322` | Ídem |
| C5 | **Convenios sin sincronizar**: `Convenio` (Hydra) y `EnginePaymentPlan` (SUPRA) viven en universos separados | §A.4 | Dunning/cobranza inconsistentes entre sistemas |
| C6 | **Doble money-path ciudadano**: dos portales con motores de pago distintos (Hydra simulado / SUPRA real) | `hydra portal/` vs `supra routes/portalPayments.ts` | Riesgo de doble cobro y confusión al activar PSP real |

### High

| # | Gap | Evidencia |
|---|---|---|
| H1 | `GET /contratos` de Hydra sin paginación; el conector cachea el padrón completo en memoria | `hydra contratos.controller.ts:43-46`; `connector.ts:133-134` |
| H2 | Paginación offset (`skip/take` + `orderBy createdAt desc`) inestable bajo inserciones → omisiones/duplicados | `recibos.controller.ts:45-47` |
| H3 | Drift de customers no reconciliado: cambios de nombre/email en Hydra no actualizan `EngineCustomer` | `ingestion.ts:174-175` |
| H4 | RLS de SUPRA diseñado (policies + FORCE) pero **inerte por defecto** (app conecta como superuser; falta `ENGINE_RLS_ENFORCE` + rol NOBYPASSRLS) | migraciones `20260706150000`, `20260709230000`; `engine\lib\db.ts:162` |
| H5 | Ingesta sin DLQ por registro: un registro «veneno» bloquea el avance del watermark indefinidamente | `ingestion.ts:654-660,681` |
| H6 | Webhook de pasarela de Hydra público y en modo simulado acepta cualquier payload (`verificarFirmaWebhook()` → `true`) | `simulada.provider.ts:76-81` |
| H7 | Conekta: firma nativa (RSA) NO verificada, solo HMAC opcional; múltiples `VERIFY(conekta)` sin validar contra el vendor | `conekta\connector.ts:401-448,134-136` |
| H8 | PorCobrar: webhook sin firma (limitación del vendor); mitigado con poll-as-truth pero exposición residual | `porcobrar\connector.ts:398-409` |
| H9 | Credenciales SOAP CEA embebidas en el bundle del frontend de Hydra (`VITE_CEA_API_USERNAME/PASSWORD`) y deuda consultada desde el navegador | `frontend\src\api\cea.ts:10-11` |
| H10 | Lógica financiera duplicada en el frontend de Hydra (adeudos, estados, parcialidades, motor de tarifas en bundle) | §A.3 |

### Medium

| # | Gap | Evidencia |
|---|---|---|
| M1 | `GET /timbrados` de Hydra sin guard JWT | `timbrados.controller.ts:31-76` |
| M2 | Corte de caja suma pagos de todos los usuarios (no filtra por sesión/cajero) | `caja.service.ts:24-30` |
| M3 | `Convenio.anticipoPagado` y modelo `Anticipo` sin flujo de escritura (feature incompleta) | grep en `convenios/`, `caja.service.ts:44` |
| M4 | `PagoExterno.contratoId` resuelto con `id: { contains: contratoRaw }` — matching débil contra CUIDs | `pagos-externos.service.ts:47` |
| M5 | Auth SUPRA→Hydra con contraseña de usuario (JWT humano), sin scopes ni rotación; expiración a mitad de run falla la corrida | `client.ts:228-231`; `types.ts:148-158` |
| M6 | Rate limiting y métricas de SUPRA in-memory por réplica por defecto (opt-in Postgres) | `lib\rateLimitStore.ts:5-8`, `lib\metrics.ts` |
| M7 | `Pago.fecha` en Hydra es `String`, no `DateTime` — parseo frágil en integraciones | `hydra schema.prisma:426` |
| M8 | Cancelación fiscal CFDI ante el SAT fuera de alcance en Hydra | `facturacion.service.ts:396-399` |
| M9 | Sin histogramas en SUPRA → SLO de latencia p99 no medible (declarado aspiracional) | `observability\SLO.md` |
| M10 | `docs/connectors/README.md` de SUPRA muy por detrás del código (dice «payment: no implementation ships yet» con Stripe/Conekta reales) | `docs\connectors\README.md:50-55` |

### Low

| # | Gap |
|---|---|
| L1 | DTOs de Hydra serializan decimales como string con `Number()` disperso en el frontend — frágil ante cambios de serialización |
| L2 | Pantallas demo muertas en Hydra (Contabilidad 100% demo, AjustesFacturacion, kanban de PreFacturación con botones `disabled`, tabla de TimbradoPage con `Math.random`) |
| L3 | 3 sitios del frontend construyen la base URL a mano en vez de usar `client.ts` (`timbrado.ts:26-45`, `notificaciones.ts:38-54`, `portal.ts:172-197`) |
| L4 | `API.md` de SUPRA desactualizado (seed con secreto ficticio, `/api/pagos` documentado como activo cuando responde 410, superficies enteras sin documentar) |
| L5 | Alertas `page` de SUPRA sin receptor real (PagerDuty comentado); purga de historial git con credenciales sin ejecutar |

---

## E. API Contract — Hydra → SUPRA (comandos)

### E.1 Principios transversales (aplican a todo comando)

- **Transporte:** HTTPS server-to-server, **solo desde el backend de Hydra** (NestJS). El frontend jamás habla con SUPRA.
- **Autenticación:** API key de tenant `sk_live_…`/`sk_test_…` (header `Authorization: Bearer`), hasheada en SUPRA (`EngineApiKey.keyHash`), con **scopes mínimos**: `customers:write/read`, `obligations:write/read`, `payments:write/read`, `adjustments:write`, `webhook_endpoints:write`, `events:read`. Sin `platform:admin` ni `connectors:manage` en la key de Hydra. Rotación vía `POST /v1/api_keys/:id/rotate` (ya existe).
- **Tenant:** un tenant SUPRA dedicado (`cea-queretaro`); ambiente sandbox/live coherente con la key (SUPRA lo valida: `engine\middleware\auth.ts:49-55`).
- **Idempotencia:** header `Idempotency-Key` en todo POST, **derivada determinísticamente del identificador Hydra** (p. ej. `hydra:pago:<cuid>` para Record Payment, `hydra:recibo:<cuid>` para Create Obligation). SUPRA ya implementa replay verbatim y `409 idempotency_key_reused` (`engine\middleware\idempotency.ts:70-96`). Regla: reintentar un comando fallido usa SIEMPRE la misma key.
- **Correlation:** propagar `x-request-id` de Hydra (SUPRA ya lo acepta/propaga, `middleware\requestLog.ts:27-31`) y `traceparent` W3C cuando OTel esté activo. Adicionalmente, todo recurso creado lleva `metadata.correlation_id` y `metadata.hydra_user_id` para trazabilidad de negocio.
- **Errores:** contrato de error del engine (código + mensaje). Clasificación en Hydra: `400/404/409/422` → no reintentar (error de programa o duplicado benigno); `401/403` → alertar (credencial); `429` → backoff con `Retry-After`; `5xx`/timeout → reintento con backoff exponencial + jitter, máx 5 intentos, luego a la cola de comandos pendientes con alerta.
- **Timeouts:** 10 s por intento (igual que el estándar del conector SUPRA); deadline total 60 s por comando; después, encolar.
- **Síncrono/asíncrono:** los comandos son síncronos (SUPRA responde el recurso creado); los **efectos** (captura PSP, liquidación de obligación, completado de plan) llegan por eventos (§F). Hydra nunca hace polling como mecanismo primario; el polling (`GET /v1/payment_intents/:id`) es solo verificación puntual (3DS pendiente en UI) y reconciliación.

### E.2 Catálogo de comandos (endpoints existentes en SUPRA, verificados)

| Comando de negocio | Método y URL | Scope | Cuándo lo emite Hydra | Eventos que genera |
|---|---|---|---|---|
| Sync Customer | `POST /v1/customers` | customers:write | alta de contrato / cambio de titular (upsert por `external_ref`) | `customer.created` |
| Create Account | `POST /v1/accounts` | accounts:write | alta de contrato (cuenta por contrato) | `account.created` |
| Register Invoice (receivable) | `POST /v1/obligations` | obligations:write | al emitir recibo/timbrado (por lote o individual) | `obligation.created` |
| Cancel Invoice | `POST /v1/obligations/:id/cancel` | obligations:write | cancelación/reproceso de lote, refacturación | `obligation.canceled` |
| Write-off (incobrable) | `POST /v1/obligations/:id/write_off` | adjustments:write | marcar incobrable autorizado | `obligation.written_off` |
| Record Payment | `POST /v1/payments` | payments:write | pago de caja, pago de recaudador externo conciliado | `payment.recorded`, `obligation.paid` (si liquida) |
| Get Payment | `GET /v1/payments/:id` | payments:read | verificación/reconciliación | — |
| Create Payment Intent | `POST /v1/payment_intents` | payments:write | ciudadano paga en línea (SPEI/OXXO/tarjeta) | `payment_intent.created` |
| Execute/Confirm Payment | `POST /v1/payment_intents/:id/confirm` | payments:write | confirmación de checkout | `payment_intent.succeeded/failed`, `payment.recorded` |
| Cancel Payment | `POST /v1/payment_intents/:id/cancel` | payments:write | ciudadano cancela / expiración operativa | `payment_intent.canceled` |
| Create Payment Link | `POST /v1/payment_links` | payments:write | enviar liga de cobro (dunning, atención) | `payment_link.created/paid` |
| Create Payment Agreement | `POST /v1/obligations/:id/payment_plan` | obligations:write | activar convenio aprobado | `payment_plan.created` |
| Get / Cancel Agreement | `GET /v1/payment_plans/:id` · `POST /v1/payment_plans/:id/cancel` | obligations:read/write | consulta y cancelación de convenio | `payment_plan.canceled` |
| Request Refund | `POST /v1/payments/:id/refunds` | payments:write | devolución autorizada | `refund.created/succeeded` |
| Apply Credit (saldo a favor) | `POST /v1/customers/:id/apply_credit` | payments:write | aplicar saldo a favor a un adeudo | `payment.recorded` (crédito) |
| Get Balance | `GET /v1/customers/:id/balance` | customers:read | verificación puntual / reconciliación de read-model | — |
| Simulate Agreement | `POST /api/admin/agreements/simulate` (+ proposals/approve/activate) | roles admin SUPRA | flujo maker-checker de convenios | `approval.*`, `payment_plan.created` |

> Nota: los nombres genéricos del requerimiento («Create Payment», «Register Payment», etc.) se materializan en este contrato real. No se necesita diseñar una API nueva del lado SUPRA: **la superficie `/v1` existente cubre todos los comandos**; el trabajo es del lado Hydra (cliente, outbox de comandos, mapeo de IDs).

### E.3 Contratos detallados de los comandos críticos

#### Record Payment (caja / recaudación externa) — `POST /v1/payments`

```jsonc
// Request  (Idempotency-Key: hydra:pago:<cuid-del-Pago-en-Hydra>)
{
  "customer_id": "cus_…",              // resuelto vía mapeo hydra:contrato:<id>
  "amount_minor": 152050,              // BigInt minor units — NUNCA Decimal
  "currency": "MXN",
  "method": "cash | transfer | external_collector",
  "received_at": "2026-07-20T17:03:00Z",
  "external_ref": "hydra:pago:<cuid>",
  "allocations": [                     // aplicación explícita a obligations
    { "obligation_id": "obl_…", "amount_minor": 152050 }
  ],
  "metadata": { "hydra_user_id": "…", "caja_sesion_id": "…", "recaudador": "OXXO",
                "correlation_id": "…" }
}
// Response 201: EnginePayment { id: "pay_…", status, allocations[], … }
// Validaciones SUPRA: Σ allocations ≤ amount, obligación abierta, moneda coherente,
//   no sobre-liquidar (guard «nothing to allocate», ingestion.ts:545-551 análogo en payments)
// Errores: 409 idempotency_key_reused (reintento con body distinto — bug de Hydra),
//   422 allocation inválida, 404 obligation/customer inexistente (→ ver §G orden de sync)
```

#### Register Invoice — `POST /v1/obligations`

```jsonc
// Idempotency-Key: hydra:recibo:<cuid>
{
  "customer_id": "cus_…",
  "type": "hydra.recibo",              // opaco para el engine; taxonomía en agreements
  "amount_minor": 84300,
  "currency": "MXN",
  "due_at": "2026-08-09T00:00:00Z",
  "external_ref": "hydra:recibo:<cuid>",
  "metadata": { "timbrado_uuid": "…", "periodo": "2026-07", "contrato": "hydra:contrato:<id>",
                "lote_id": "…" }
}
```

#### Create Payment Intent (portal) — `POST /v1/payment_intents`

```jsonc
// Idempotency-Key: hydra:intento:<uuid-generado-por-Hydra>
{
  "obligation_id": "obl_…",
  "amount_minor": 84300,
  "currency": "MXN",
  "payment_method_types": ["spei", "oxxo", "card"],
  "metadata": { "canal": "portal", "contrato": "hydra:contrato:<id>", "correlation_id": "…" }
}
// SUPRA orquesta el PSP vía routing (priority/success_rate/cost) y devuelve las
// instrucciones (CLABE+referencia SPEI, línea de captura OXXO, URL de checkout).
// El resultado final llega por evento payment_intent.succeeded/failed — Hydra NO pollea.
```

### E.4 Cambios requeridos en la API de Hydra (para la transición y el conector)

Mientras exista el conector de ingesta (fases 0–2), Hydra debe corregir su API de lectura:

| Cambio | Endpoint | Motivo |
|---|---|---|
| Paginación por cursor (`?after=<cuid>&limit=`) | `GET /contratos` | H1 — hoy sin paginar |
| Filtro `?updatedSince=` basado en `updatedAt` real | `GET /recibos`, `GET /pagos`, `GET /contratos` | C3 — el incremental por `fechaVencimiento` pierde registros |
| Orden estable ascendente por `createdAt,id` | `GET /recibos`, `GET /pagos` | H2 — offset inestable |
| Cuenta de servicio dedicada (no usuario humano) con rol de solo lectura | `POST /auth/login` | M5 |
| Receptor de webhooks SUPRA (nuevo módulo) | `POST /api/integraciones/supra/webhook` | §F |

---

## F. Event Contract — SUPRA → Hydra (eventos)

### F.1 Mecanismo (ya existente en SUPRA — no hay que construirlo)

- **Emisión:** outbox transaccional (`engine\lib\outbox.ts`) — el evento se inserta en la MISMA transacción que el cambio de estado; envelope CloudEvents-like `{id: "evt_…", type, created, tenant_id, data}` con `sequence BigInt` de orden total (`schema.prisma:643`).
- **Entrega:** relay multi-réplica (`FOR UPDATE SKIP LOCKED` + lease), backoff exponencial con jitter (base 30 s, cap 6 h), **máx 10 intentos → DLQ** (`status='dead'`) con inspección y replay (`GET /v1/outbox/dead`, `POST /v1/outbox/:id/replay`).
- **Seguridad:** HMAC-SHA256 estilo Stripe en header `Supra-Signature: t=<unix>,v1=<hex>`, verificación timing-safe con tolerancia de 5 min (anti-replay); `Supra-Event-Id` para dedupe; secreto `whsec_…` cifrado AES-256-GCM at-rest con `ENGINE_DATA_KEY`; rotación vía `POST /v1/webhook_endpoints/:id/rotate_secret`; SSRF guard re-validado antes de cada POST.
- **Registro:** Hydra se suscribe con `POST /v1/webhook_endpoints` (url + tipos de evento). Contrato formal navegable en `GET /v1/asyncapi.json` (AsyncAPI 3.0, generado del catálogo `engine\events\catalog.ts` con contract test anti-drift en CI).
- **Versionamiento:** semver por payload en el catálogo; campo opcional = minor, breaking = major con 90 días de deprecación (`catalog.ts:5-8`). Hydra debe tolerar campos desconocidos (parseo laxo).

### F.2 Eventos que Hydra consume, payload y efecto

| Evento | Payload clave | Efecto en Hydra |
|---|---|---|
| `payment.recorded` | payment_id, customer_id, amount_minor, allocations[], external_ref, method | actualizar read-model de pagos; refrescar saldo del contrato |
| `payment_intent.succeeded` | intent_id, payment_id, obligation_id | portal muestra pagado; cerrar `IntentoPago` espejo |
| `payment_intent.failed` / `.canceled` | intent_id, reason | portal muestra fallo; permitir reintento |
| `obligation.paid` | obligation_id, external_ref (`hydra:recibo:<id>`) | marcar recibo liquidado; **si contrato «Cortado» y saldo 0 → workflow de RECONEXIÓN** (hoy en `pagos.service.ts:51-109`, se re-dispara desde aquí) |
| `obligation.canceled` / `.written_off` | obligation_id, external_ref | reflejar cancelación/incobrable en read-model |
| `payment_plan.created` / `.updated` | plan_id, installments[], obligation_id | mostrar convenio; `EstadoCuenta.enConvenio=true`; excluir de corte |
| `payment_plan.installment_paid` | plan_id, installment_id, payment_id | progreso del convenio en UI |
| `payment_plan.completed` | plan_id | convenio completado; workflow de reconexión si aplica |
| `payment_plan.defaulted` / `.canceled` | plan_id, missed_count | reactivar dunning operativo; notificar |
| `refund.succeeded` / `.failed` | refund_id, payment_id, amount_minor | reflejar devolución; ajustar read-model |
| `dispute.opened` / `.resolved` | dispute_id, payment_id, outcome | alerta operativa; bloquear reconexión si aplica |
| `settlement.received` / `.reconciled` | settlement_id, totals | tablero de recaudación/conciliación |
| `reconciliation.completed` / `exception.opened` | run_id, matched/unmatched | tablero de conciliación; cola de excepciones para operador |
| `customer.created` / `.updated` | customer_id, external_ref | confirmar mapeo de IDs |

(Los nombres finales se toman del catálogo real `engine\events\catalog.ts` — ~40 tipos ya registrados; los listados aquí existen en el catálogo o son extensiones menores del mismo.)

### F.3 Recepción confiable en Hydra (nuevo módulo `integraciones/supra`)

1. **Endpoint** `POST /api/integraciones/supra/webhook` — público (sin JWT de usuario) pero verificando `Supra-Signature` (HMAC + tolerancia) ANTES de tocar la BD. Responder `2xx` rápido (< 5 s): solo validar + persistir.
2. **Inbox idempotente:** tabla `SupraEventoInbox` con `UNIQUE(eventId)`; duplicados (entrega at-least-once) se descartan con 200.
3. **Procesamiento asíncrono:** worker procesa el inbox en orden de `sequence`; los handlers son idempotentes (upsert de read-model). Estado por fila: `pendiente → procesado | error(+intentos)`; errores repetidos van a cuarentena con alerta (nunca bloquean el resto).
4. **Eventos fuera de orden:** el `sequence` global de SUPRA permite detectarlo; los handlers se diseñan conmutativos (upsert por id de recurso + comparación de `created`); si un evento referencia un recurso aún no visto, se re-encola con backoff corto.
5. **Hydra caído:** el relay de SUPRA reintenta hasta 10 veces (≈ horas con backoff); si el evento muere en DLQ, el job de reconciliación nocturno de Hydra detecta huecos de `sequence` y los rellena con `GET /v1/events?after=` (log replayable) — **consistencia eventual garantizada por dos caminos independientes**.
6. **Notificación perdida / duplicada / proveedor tardío:** cubiertos por (2), (4) y el principio poll-as-truth de SUPRA (los webhooks de PSP son hints; SUPRA solo mueve dinero tras verificar contra el proveedor).

---

## G. Data Model Changes

### G.1 Hydra (nuevas tablas / cambios)

| Cambio | Detalle |
|---|---|
| **`SupraMapa`** (nueva) | mapeo bidireccional de IDs: `(entidad, hydraId)` UNIQUE ↔ `supraId`; entidades: contrato→customer/account, recibo→obligation, pago→payment, convenio→payment_plan, intento→payment_intent. Alternativa: columnas `supraId` en cada modelo — se prefiere tabla dedicada para no tocar 6 modelos y facilitar el borrado post-migración. |
| **`SupraComandoOutbox`** (nueva) | comandos salientes con reintento: `id, tipo, payloadJson, idempotencyKey UNIQUE, estado(pendiente|enviado|error|muerto), intentos, proximoIntento, respuestaJson, correlationId`. Garantiza que un fallo de red tras commit local no pierda el comando (mismo patrón outbox que SUPRA). |
| **`SupraEventoInbox`** (nueva) | `eventId UNIQUE, tipo, sequence BigInt, payloadJson, estado(pendiente|procesado|error|cuarentena), intentos, recibidoEn, procesadoEn`. |
| `Pago.supraPaymentId?`, `Recibo.supraObligationId?` (opcional, denormalización de lectura) | acelera joins de UI sin consultar `SupraMapa`; nullable durante transición. |
| `Pago.fecha` → `DateTime` | M7 — migración con parseo y columna legacy temporal. |
| `Recibo`/`Pago`/`Contrato`: exponer `updatedAt` en API con filtro `updatedSince` | requisito E.4 (no cambia schema: `updatedAt` ya existe en Prisma). |
| Read-models (fase final) | `DocumentoCartera`, `AplicacionPago`, `EstadoCuenta` pasan a ser **proyecciones** alimentadas por eventos SUPRA (mismas tablas, nueva fuente de escritura); `IntentoPago` y `Convenio` se congelan (solo lectura histórica) una vez migrados. |

### G.2 SUPRA (cambios mínimos — la estructura ya existe)

| Cambio | Detalle |
|---|---|
| Tenant `cea-queretaro` + API key con scopes de §E.1 | `POST /v1/tenants` (bootstrap ya implementado) |
| Taxonomía `hydra.recibo` en agreements | `PUT /api/admin/agreements/taxonomy` (config, no schema) |
| Webhook endpoint hacia Hydra | `POST /v1/webhook_endpoints` (config) |
| Conector «recaudadores-mx» (nuevo código, no schema) | absorbe los parsers ETL de Hydra (OXXO/Banorte/BBVA/Santander/Citibanamex/HSBC) como `BankStatementConnector`/`IngestionConnector` de archivos, reutilizando el patrón `bankfiles` |
| Fix del conector Hydra | usar `updatedSince` + cursor (E.4), incluir pagos sin `reciboId` como pagos on-account, reconciliar drift de customers (H3) |
| Dominio legacy agua | **congelar**: no borrar tablas aún; detener el portal SUPRA para el caso CEA cuando el portal Hydra opere contra el engine (evita el doble money-path C6) |
| Activar RLS | `ENGINE_RLS_ENFORCE=true` + rol `supra_app` NOBYPASSRLS (runbook existente) — prerrequisito de producción multi-tenant |

### G.3 Identificadores canónicos y backfill

- **Canónico financiero:** IDs de SUPRA (`cus_/obl_/pay_/plan_…`). **Canónico operativo:** cuids de Hydra. Puente: `external_ref = hydra:<entidad>:<id>` en SUPRA (convención ya usada por el conector: `connector.ts:252,293,333`) + `SupraMapa` en Hydra.
- **Backfill inicial** (una vez corregido el conector): full sync contratos→recibos→pagos (la idempotencia de doble capa de la ingesta — `EngineConnectorReference` + `externalRef`, `ingestion.ts:473-493` — hace el re-run seguro), después poblar `SupraMapa` desde los `external_ref` (`GET /v1/customers|obligations|payments` paginado).
- **Convenios activos:** script de migración dedicado: por cada `Convenio` Activo en Hydra → obligación consolidada + `POST /v1/obligations/:id/payment_plan` con el calendario restante; parcialidades ya pagadas se registran como pagos históricos con `external_ref` propio. Verificación uno a uno (monto restante Hydra == monto restante SUPRA) antes de congelar escrituras en Hydra.

---

## H. Migration Strategy

**Principios:** expand–contract; un dominio a la vez; doble-escritura con sombra antes de cada cutover; feature flags con kill-switch por dominio (patrón ya probado en SUPRA: `LEGACY_PAGOS_WRITE_ENABLED` → 410); reconciliación automática diaria entre sistemas durante TODA la transición; nunca borrar datos de Hydra hasta N ciclos de facturación verificados.

**Cómo se garantiza cada invariante:**

| Invariante | Mecanismo |
|---|---|
| No perder pagos | outbox de comandos en Hydra (commit local + envío garantizado con reintentos); idempotency keys deterministas; job de reconciliación diaria `Pagos(Hydra) vs Payments(SUPRA)` por `external_ref` con alerta en diferencia ≠ 0 |
| No duplicar pagos | `Idempotency-Key = hydra:pago:<id>` (replay verbatim en SUPRA); `@@unique(tenantId, externalRef)`-equivalente en payments; el inbox de Hydra deduplica eventos |
| No perder facturas | backfill idempotente + comando por recibo emitido; conteo diario recibos vs obligations por periodo |
| No romper convenios | migración por script con verificación 1:1 de saldos restantes; doble lectura (UI muestra ambos y alerta divergencia) durante 1 ciclo antes de congelar Hydra |
| No perder estado financiero | Hydra nunca borra: sus tablas pasan a read-model/histórico; export NDJSON de SUPRA (`GET /v1/tenants/:id/export`) como respaldo verificable |
| No interrumpir operación | cada fase tiene kill-switch que regresa la escritura al camino anterior; la UI de Hydra no cambia de URL ni de flujo para el operador |

**Ventaja decisiva:** como el money-path real de Hydra no existe (PSP/PAC simulados), las fases 1–3 no migran dinero en vuelo — migran *registro* de datos. El único dinero real hoy entra por caja y archivos de recaudadores, cuyo cutover es el paso mejor protegido (doble-escritura + conciliación).

---

## I. Implementation Plan

### Fase 0 — Corregir la integración existente (1 sprint)
- **Objetivo:** que la ingesta actual deje de perder datos; base para el backfill.
- **Cambios:** Hydra: paginación cursor en `GET /contratos`, filtro `updatedSince` + orden estable en `/recibos`, `/pagos`, `/contratos` (`contratos.controller.ts`, `recibos.controller.ts:45-47`, `pagos.controller.ts`); cuenta de servicio de solo lectura. SUPRA: `client.ts` usa `updatedSince`; incluir pagos sin `reciboId` (on-account); reconciliar drift de customers (`ingestion.ts:174-175`); cuarentena por registro en ingesta (H5).
- **Tests:** integración conector contra Hydra real (hoy solo hay mocks — `hydra-connector.test.ts:22-29`); test de no-pérdida con recibo retro-fechado.
- **Riesgos:** bajo. **Aceptación:** full sync + 3 syncs incrementales sin diferencias contra conteos SQL directos. **Dependencias:** ninguna.

### Fase 1 — Fundación bidireccional (1–2 sprints)
- **Objetivo:** Hydra puede hablar con SUPRA y escucharlo.
- **Cambios:** Hydra: módulo `integraciones/supra` (SupraClient con sk_ key/scopes/idempotency/correlation; `SupraComandoOutbox` + worker; `SupraEventoInbox` + endpoint webhook con verificación de firma + worker; `SupraMapa`); config por env con kill-switch global `SUPRA_INTEGRACION_ENABLED`. SUPRA: tenant `cea-queretaro`, API key, webhook endpoint hacia Hydra, taxonomía `hydra.recibo`.
- **DB:** 3 tablas nuevas en Hydra (G.1). **Tests:** firma inválida rechazada, dedupe de eventos, replay de comando idempotente, caída simulada de cada lado.
- **Riesgos:** medio (infra nueva). **Aceptación:** evento de prueba SUPRA→Hydra procesado exactamente una vez; comando con red intermitente entregado exactamente una vez. **Dependencias:** Fase 0.

### Fase 2 — Obligations: recibos como cuentas por cobrar en SUPRA (1–2 sprints)
- **Objetivo:** todo recibo emitido existe en SUPRA en tiempo real; SUPRA se vuelve la fuente de saldos.
- **Cambios:** `facturacion.service.ts` encola `Register Invoice` al emitir (y `cancel`/`write_off` en cancelación de lote, refacturación e incobrables); backfill histórico; job nocturno de conciliación recibos↔obligations.
- **Riesgos:** volumen (lotes masivos) → comandos en batch con rate control. **Aceptación:** 100% de recibos de un periodo completo con obligation espejo; saldos por contrato Hydra == `GET /v1/customers/:id/balance` (muestra aleatoria diaria ≥ 500 contratos, diferencia 0). **Dependencias:** Fase 1.

### Fase 3 — Payments: SUPRA como registro de verdad de cobranza (2 sprints)
- **Objetivo:** todo pago (caja + recaudadores) se registra en SUPRA; Hydra conserva espejo local.
- **Cambios:** `pagos.service.ts` y `pagos-externos.service.ts` → doble-escritura (local + `Record Payment` vía outbox); allocations explícitas (sustituyen al FIFO implícito local); la auto-reconexión pasa a dispararse por `obligation.paid` (con fallback local mientras dure la fase); conciliación diaria pagos↔payments.
- **Modo sombra 2–4 semanas:** SUPRA registra pero Hydra sigue siendo la verdad; el reporte de diferencias debe ser 0 sostenido antes del cutover de verdad (a partir de ahí, el saldo que muestra la UI proviene del read-model alimentado por SUPRA).
- **Riesgos:** el más alto del plan (dinero real de caja). Kill-switch por origen (caja / externo). **Aceptación:** 2 semanas con conciliación en 0; corte de caja cuadra contra settlements/payments de SUPRA. **Dependencias:** Fase 2.

### Fase 4 — Portal y pagos digitales: retirar la pasarela simulada (1–2 sprints)
- **Objetivo:** el pago en línea del ciudadano corre por payment intents de SUPRA con PSP real.
- **Cambios:** `portal.service.ts:101-120` crea intents vía SupraClient (deja de usar `PasarelasService`); frontend `PagarEnLinea.tsx` consume las instrucciones devueltas (CLABE/OXXO/URL) — misma UI; módulo `pasarelas` de Hydra queda tras flag y luego se retira; **el portal ciudadano de SUPRA se desactiva para CEA** (cierra C6). Requiere credenciales reales de PSP en SUPRA (Conekta: resolver los `VERIFY(conekta)` H7 contra sandbox del vendor).
- **Riesgos:** dependencia externa (contrato PSP). **Aceptación:** pago E2E sandbox y luego real (SPEI + OXXO + tarjeta) reflejado en Hydra vía evento en < 1 min; webhook público simulado de Hydra (H6) eliminado. **Dependencias:** Fase 3, credenciales PSP.

### Fase 5 — Convenios a SUPRA (1–2 sprints)
- **Objetivo:** los convenios viven exclusivamente en SUPRA (crear, parcialidades, vencimientos, default, completar, cancelar).
- **Cambios:** UI de `Convenios.tsx` opera contra el flujo agreements (simulate→proposal→approve→activate, maker-checker) vía backend Hydra; migración de convenios activos (G.3); `convenios.service.ts` congelado a lectura; dunning excluye por evento `payment_plan.*`; se elimina el cálculo de parcialidades del frontend (`Convenios.tsx:167-173`).
- **Riesgos:** fidelidad de calendarios migrados. **Aceptación:** verificación 1:1 de saldos restantes de todos los convenios activos; un ciclo completo de parcialidad (pago → evento → UI) sin intervención. **Dependencias:** Fases 3–4.

### Fase 6 — Cartera como read-model + conciliación bancaria en SUPRA (2 sprints)
- **Objetivo:** aging/saldos/estado de cuenta derivados de SUPRA; conciliación de recaudadores y banca en SUPRA.
- **Cambios:** `cartera.service.ts` deja de recalcular desde `Pago`/`Recibo` locales y proyecta desde eventos/consultas SUPRA (mismas tablas `EstadoCuenta`/`DocumentoCartera` como caché de UI); dunning **operativo** (avisos, cortes, campañas A/B) permanece en Hydra pero lee hechos financieros del read-model; parsers ETL migran a conector «recaudadores-mx» en SUPRA (statement reconciliation sustituye la conciliación manual registro a registro); se retira la lógica financiera del frontend (H10, L2).
- **Riesgos:** paridad del aging. **Aceptación:** aging SUPRA-derived == aging legacy durante 1 mes en paralelo; excepciones de conciliación gestionadas en la cola de SUPRA. **Dependencias:** Fases 3, 5.

### Fase 7 — Contabilidad/ERP y limpieza (1–2 sprints)
- **Objetivo:** eliminar duplicaciones restantes y cerrar la arquitectura objetivo.
- **Cambios:** pólizas/IDoc SAP desde SUPRA (ErpConnector patrón NetSuite, o export desde el ledger del engine); retirar módulo `pasarelas`, providers simulados y `conciliaciones` agregada de Hydra; congelar dominio legacy agua de SUPRA; endurecer pendientes operativos de SUPRA (RLS enforce H4, `RATE_LIMIT_STORE=postgres` M6, receptor de alertas L5); fix de hallazgos menores de Hydra (M1 guard en `/timbrados`, M2 corte por sesión, M4 matching de `PagoExterno`).
- **Aceptación:** ninguna escritura financiera ocurre fuera de SUPRA (verificado por auditoría de código + monitoreo); documentación de ambos sistemas actualizada. **Dependencias:** todas las anteriores.

---

## J. Final Recommendation

**1. Qué debe quedarse en Hydra:** UI/UX completa (incluido el portal ciudadano como *presentación*), gestión de usuarios, contratos/tomas/lecturas/consumos/órdenes, GIS/clima/indicadores, workflows operativos (corte, reconexión, restricciones, atención, notificaciones operativas), la **ejecución operativa** del dunning (campañas, avisos, órdenes) sobre hechos financieros de SUPRA, la operación de caja (sesiones/cortes como proceso), y el **facturador de dominio**: motor de tarifas + emisión de recibo + timbrado CFDI.

   *Excepción justificada (única):* la generación del documento fiscal (CFDI/PAC) permanece en Hydra porque (a) es inseparable del cálculo tarifario de agua, que es dominio operativo puro; (b) el PAC no es un proveedor de pagos sino un servicio fiscal del documento; (c) el gate de pureza del engine de SUPRA prohíbe explícitamente conocimiento de dominio (`check-engine-purity.mjs`). La **cuenta por cobrar** que ese documento origina sí es de SUPRA (obligation). Si más adelante se quiere centralizar el timbrado, el conector PorCobrar de SUPRA ya maneja CFDI y sería la vía — decisión diferible que no bloquea nada.

**2. Qué debe vivir exclusivamente en SUPRA:** todo el catálogo de ownership de §C — payments, intents, attempts, statuses, methods/tokens, providers/gateways, obligations (invoices como receivable), payment plans/convenios, installments/schedules, refunds, chargebacks/disputes, retries, reconciliation, settlements, provider webhooks/responses, ledger, audit trail financiero, eventos y orquestación de pagos, e integraciones con PSPs/banca/ERP.

**3. Qué debe migrarse de Hydra a SUPRA:** el registro de pagos (caja y recaudadores), los intentos de pago del portal, los convenios activos, la aplicación de pagos/saldos/aging (a read-model), los write-offs, la conciliación de recaudadores (parsers ETL → conector) y la generación contable/ERP. Orden y mecánica en §I.

**4. Qué debe eliminarse por duplicación:** en Hydra — módulo `pasarelas` con sus providers simulados, PAC simulado sustituible cuando se contrate PAC real, cálculo de saldos/FIFO local (queda como proyección), lógica financiera del frontend (adeudos, estados, parcialidades, motor de tarifas en bundle para *display* de saldos), pantallas demo muertas, y el webhook público de pasarela. En SUPRA — el dominio legacy agua (réplica Aquacis: `Contrato`/`Factura`/`Cliente`/portal propio) se congela y depreca para el caso CEA, porque duplica el dominio operativo de Hydra; y el ledger legacy (`LedgerAccount`/`JournalEntry`/`Posting` no-engine).

**5. Qué contratos de integración deben implementarse:** los comandos de §E (que mapean 1:1 a la superficie `/v1` ya existente de SUPRA — el trabajo es el cliente/outbox del lado Hydra) y los eventos de §F (webhook endpoint + inbox idempotente en Hydra; el pipeline outbox→relay→firma→DLQ de SUPRA ya existe). Más los arreglos del conector de ingesta (E.4) que siguen siendo necesarios durante la transición.

**6. Riesgos arquitectónicos:**
   - *Doble money-path ciudadano* (C6) si se activan PSPs reales antes de unificar portales — mitigar desactivando el portal SUPRA para CEA en la Fase 4.
   - *Divergencia de saldos* durante la transición — mitigada con doble-escritura en sombra + conciliación diaria automatizada con alerta (§H).
   - *Conekta no verificado end-to-end* (`VERIFY(conekta)`, firma nativa RSA sin verificar) — bloquear la Fase 4 hasta validar contra sandbox del vendor.
   - *RLS de SUPRA inerte* — si SUPRA servirá a más de un organismo, activar `ENGINE_RLS_ENFORCE` antes de datos productivos de CEA.
   - *Acoplamiento temporal* — si SUPRA cae, Hydra sigue operando con read-models (lectura) y outbox de comandos (escritura diferida); definir SLO explícito de «frescura» aceptable del saldo mostrado.
   - *Sobre-ingeniería para un solo cliente* — riesgo que el propio blueprint de SUPRA admite (§11); el plan lo contiene al reutilizar superficie existente en vez de construir nueva.
   - *Operar dinero 24/7* — SUPRA tiene los pendientes operativos documentados (alerting sin receptor, drill de restore no ejecutado, rotación/purga de secretos en historial git) que deben cerrarse antes del cutover de la Fase 3.

**7. Estrategia recomendada:** ejecutar las Fases 0–7 en ese orden (≈ 10–14 sprints), con tres reglas inquebrantables: (i) **ningún proveedor real de pagos se conecta a Hydra, nunca** — el esfuerzo de integrar PSP/PAC se invierte solo en SUPRA; (ii) **cada fase tiene kill-switch y conciliación automatizada en 0 como criterio de salida**; (iii) **Hydra no borra datos financieros históricos** hasta que SUPRA acumule N ciclos verificados. La ventana actual (money-path simulado) es el mejor momento posible para esta transición: cuanto antes se ejecute la Fase 1, más barato será todo lo demás.

---

## Apéndice: contradicciones documentación ↔ código detectadas

| Afirmación documental | Realidad | Evidencia |
|---|---|---|
| SUPRA `docs/connectors/README.md:53`: categoría payment «no implementation ships yet»; solo 3 categorías | Stripe/Conekta/sandboxpay reales; 7 categorías de conector | `engine\connectors\stripe\connector.ts:118`; `core\types.ts:55-63` |
| SUPRA `README.md` raíz describe Demo Center (`/demo/*`) | inexistente en `v2/main` (vive en `feature/refactor`) | `src\App.tsx:47-52` |
| `API.md` documenta `POST /api/pagos` como money-path activo | responde **410 Gone** por defecto (gate `LEGACY_PAGOS_WRITE_ENABLED`) | `routes\pagos.ts:47-51` |
| `API.md:582` documenta seed con secreto compartido | el código exige `requireRole("admin")`; el esquema de secreto fue eliminado | `index.ts:309` |
| `deprecations.ts` header: «NOT YET MOUNTED» | sí está montada | `engine\index.ts:88` |
| Audit addendum: «`/v1/tenants` pendiente (T-19)», «sin SDKs (T-36)» | ambos existen | `engine\routes\tenants.ts`; `sdk\typescript\` |
| `AGENT_CONTEXT.md:308`: 30 migraciones / 41 modelos Engine | 37 migraciones / 45 modelos (doc subestima) | `prisma\migrations`, `schema.prisma` |
| CLAUDE.md de Hydra no menciona los ~30 módulos financieros añadidos (pagos, cartera, dunning, timbrados…) | existen y son el grueso del backend | `backend\src\modules\` |

Patrón general: la documentación de SUPRA **subestima** su código (está por detrás, no infla); ninguna afirmación de capacidad de seguridad o dinero resultó falsa hacia arriba. Los huecos reales de SUPRA son operativos, no de construcción.

