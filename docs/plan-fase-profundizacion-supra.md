# Fase de profundización — Hydra sobre SUPRA (cartera, recaudadores, caja, refunds)

**Fecha:** 2026-07-20. Basado en dos auditorías de código de esta fecha: mapa completo de
lectores/escritores financieros de Hydra y contratos verificados de SUPRA. Complementa a
[auditoria-integracion-hydra-supra.md](auditoria-integracion-hydra-supra.md) y
[integracion-supra-setup.md](integracion-supra-setup.md).

> **Estado de implementación (2026-07-20, mismo día):**
> **Hecho en código** — W1 (dual-write en `pagos-externos.conciliar`, matching por
> `numeroContrato`/`ceaNumContrato`, gate 410 de pasarelas), W2 (proyección de cartera desde
> obligations/allocations de SUPRA + triggers de eventos `obligation.*`), W3
> (`adeudoContrato`/`verificarReversas`, `getEstadoOperativo`/`getContextoAtencion` de contratos,
> `getEstadoOperativo` del portal y `calcularSaldoVencido` re-fuenteados a SUPRA), W5 (migración
> `20260720140000_pago_sesion_caja` + corte por sesión/cajero acotado), W6 (`POST
> /pagos/:id/devolucion` con manejo 201/202 + handlers `refund.succeeded`/`obligation.reopened`),
> W7 (conector de SUPRA: paginación server-side, `updatedSince`, pagos sin recibo → auto-FIFO,
> update de customers; eventos catalogados; `?customer=` en `GET /v1/payments`; suite de SUPRA
> 1092 tests en verde) y los params `updatedSince` en la API de Hydra.
> **Hecho también (segunda pasada, mismo día)** — W4: export de líneas a la statement
> reconciliation de SUPRA en el upload (idempotente por `PagoExterno.id`), match determinista
> línea↔payment al conciliar, y endpoints de operador (`GET /pagos-externos/conciliacion-supra/
> excepciones`, `POST .../excepciones/:id/resolver`, `POST .../:recaudador/reconciliar`); y el
> **job de conciliación espejo↔SUPRA** (`GET /integraciones/supra/conciliacion?muestra=` + cron
> 04:00 gated por `HYDRA_JOBS_ENABLED`) — el detector de divergencia del criterio de salida.
> **Pendiente (deliberado)** — W8 (retiro físico del módulo `pasarelas` — hoy gated 410, se retira
> cuando el portal opere contra SUPRA real), `restricciones.candidatos` e `indicadores.pigoo`
> sobre proyección (siguen sobre espejo local, consistente por eventos), montar suite de tests en
> el backend de Hydra (no existe ninguna — decisión de proyecto), y las 2 semanas de paralelo del
> comparador antes del cutover (operación, no código).

---

## 0. Hallazgos que definen el diseño

1. **SUPRA no tiene endpoints de agregación** (ni aging, ni sumas por periodo; `GET /v1/obligations`
   solo filtra por `status`/`customer`, `GET /v1/ledger/balances` es un total por path). Por tanto el
   aging/buckets/score de Hydra **debe seguir siendo una proyección local** — pero alimentada desde
   SUPRA, no desde las tablas locales.
2. **Cartera es el único dueño del read-model**: `recalcularContratoTx` (`cartera.service.ts:111-302`)
   es el único escritor de `DocumentoCartera`/`AplicacionPago`/`EstadoCuenta`. Cambiar la fuente de ese
   único método re-fuentea TODO el downstream (dunning, propensión, aging, listados, candidatos de
   restricción) sin tocarlo. El dunning no lee `Pago`/`Recibo` directamente (salvo `medirUplift`).
3. **Hydra tiene TRES implementaciones FIFO paralelas** del mismo cálculo de adeudo:
   cartera (`recalcularContratoTx`), `restricciones.adeudoFifo` y `facturacion.calcularSaldoVencido`.
   La profundización las reduce a una proyección + consultas a SUPRA.
4. **Dos escritores de `Pago` siguen creando dinero local sin SUPRA** (violan el invariante
   "ningún pago local que SUPRA desconozca"):
   - `pagos-externos.service.ts:100` (`conciliar` de recaudadores) — **el hueco más grave**;
   - `pasarelas.service.ts:167` (`confirmarWebhook` de la pasarela simulada) — camino obsoleto con SUPRA.
5. **La conciliación de recaudadores encaja en SUPRA hoy**: `POST /v1/statement_sources/:id/import`
   acepta `lines[]` JSON (montos string en centavos, `external_id` idempotente); el matching L2 casa
   por `reference == external_ref` (`hydra:pago:<id>`), L3/L4 por heurística/agrupación; excepciones
   con cola y resolución (`write_off|corrected|matched_late|rejected`). No hay parser de layouts
   mexicanos en SUPRA — la transformación se hace en Hydra (o, a futuro, un conector `bank_statement`).
6. **SPEI de cobro existe en SUPRA**: `POST /v1/connector_instances/:id/transfers` emite CLABE +
   referencia por obligación (inbound, confirmado por webhook + poll-as-truth) — mapeo natural para el
   método SPEI del portal (hoy todo va por payment link).
7. **Refunds**: `POST /v1/payments/:id/refunds` con maker-checker por umbral
   (`limits.approvals.refund_threshold_minor` vía `PATCH /v1/tenants/:id`; al superarlo → 202 +
   approval request que otra key aprueba). El refund nace `succeeded` y emite `refund.succeeded` +
   `obligation.reopened`.
8. **Eventos**: SUPRA emite `obligation.settled`/`obligation.partially_settled`/`obligation.written_off`
   pero NO están en su catálogo AsyncAPI (evaden el contract test por construirse como variable) — sí
   llegan por webhook. No hay evento `installment.*`: la parcialidad pagada se observa como
   `payment.succeeded` + `obligation.settled` (la obligation de la parcialidad referencia `plan` en su
   `obligation.created`).
9. **`GET /v1/payments` no filtra por customer** — Hydra hoy pagina y filtra en cliente. Afecta a
   `medirUplift` y `portal.getPagos`; se resuelve leyendo el espejo local (proyección) o pidiendo el
   filtro a SUPRA.
10. **Bugs locales confirmados que la migración debe arreglar de paso**: corte de caja suma pagos de
    todos los usuarios y no acota por cierre (no existe vínculo pago↔sesión en el modelo); resolución
    de contrato del ETL por `id contains contratoRaw` (substring sobre cuid — inservible con datos
    reales); `Anticipo` es un modelo sin escritores (muerto); `indicadores.recibosPagados` subcuenta
    liquidaciones FIFO.

---

## 1. Decisión de arquitectura de la fase

**La proyección local se queda; la fuente cambia.** `DocumentoCartera`/`AplicacionPago`/`EstadoCuenta`
sobreviven como caché de consulta (los joins por zona/administración, el score de morosidad, la
categoría y las banderas `restringido`/`bloqueadoJuridico`/`cortable` son dominio Hydra que SUPRA no
modela), pero se construyen desde obligations/payments/allocations de SUPRA:

```text
SUPRA (verdad)                          HYDRA (proyección + operación)
obligations{amount_due/settled_minor,   DocumentoCartera  (por obligation con
            due_at, external_ref,   ──►                    external_ref hydra:recibo:*)
            status}                     AplicacionPago    (desde payment.allocations)
payments{amount, received_at,       ──► EstadoCuenta      (buckets, score, categoría,
         allocations[]}                                    enConvenio, restringido)
payment_plans{status}               ──► bandera enConvenio
        │ eventos                              ▲
        ▼                                      │
payment.succeeded / obligation.settled / .partially_settled / .canceled /
.written_off / payment_plan.*  ──► recálculo incremental por contrato
                                   + cron nocturno = REPROYECCIÓN de reconciliación
```

El espejo local de `Pago` se conserva como proyección de eventos (ya existe
`onPaymentSucceeded`): mantiene funcionando sin cambios a caja, contabilidad (método de pago,
que SUPRA no modela), uplift y forecast.

---

## 2. Workstreams

### W1 — Cerrar los escritores de dinero fuera de SUPRA (CRÍTICO, primero)
- **`pagos-externos.conciliar`** (`pagos-externos.service.ts:94-121`): aplicar el mismo patrón
  SUPRA-first de `pagos.service.crear` — `recordPayment` (Idempotency-Key `hydra:pago:<id>`,
  allocation al recibo si se identificó) ANTES del espejo local; si SUPRA rechaza, el `PagoExterno`
  queda `pendiente_conciliar` con el error visible al operador.
- **Matching de contrato del ETL**: sustituir `id: { contains: contratoRaw }`
  (`pagos-externos.service.ts:46-50`) por búsqueda en `numeroContrato`/`ceaNumContrato` normalizados.
- **`pasarelas.confirmarWebhook`**: con `SUPRA_INTEGRACION_ENABLED=true`, el endpoint
  `POST /pasarelas/webhook` responde 410 (patrón `LEGACY_PAGOS_WRITE_ENABLED` de SUPRA) — el pago en
  línea ya corre por checkout de SUPRA; el módulo queda solo para el camino legacy.
- **Aceptación**: grep de `prisma.pago.create` = solo caminos con dual-write o gate legacy;
  conciliación diaria pagos↔payments en 0.

### W2 — Cartera como proyección de SUPRA
- **`recalcularContratoTx`**: nueva rama `supra.enabled` que construye los documentos desde
  `listObligations(customer)` (todas las páginas, todos los estados) filtrando
  `external_ref hydra:recibo:*` y `hydra:convenio:*`, y las aplicaciones desde
  `GET /v1/payments/:id` (allocations con fecha) de los payments del espejo. Mapeos:
  `montoOriginal = amount_due_minor/100`, `saldo = (due−settled)/100`,
  `diasVencido = hoy − due_at`, `estado settled→pagado / canceled→(excluir) /
  written_off→incobrable / plan activo→en_convenio`.
- **Trigger por eventos**: `SupraEventosService` marca "contrato sucio" en `payment.succeeded`,
  `obligation.settled/partially_settled/canceled/written_off` y `payment_plan.*` → recálculo
  incremental (reutiliza `aplicarPago`/`recalcularContrato`). Añadir estos tipos al switch del
  procesador (hoy varios caen al default informativo).
- **Cron 02:00** pasa de "recalcular desde tablas locales" a "reproyectar desde SUPRA" (misma
  paginación por contrato) — es a la vez la reconciliación diaria del read-model.
- **Propensión**: depende de la fecha de liquidación por documento (allocations con fecha del
  payment). Se cubre con `AplicacionPago` proyectado desde allocations + `received_at` del payment.
- **Aceptación**: aging SUPRA-derived == aging legacy sobre el mismo dataset durante 2 semanas en
  paralelo (job comparador con reporte de diferencias = 0); dunning dry-run idéntico en ambos modos.

### W3 — Re-fuentear las consultas puntuales de saldo (elimina los FIFO paralelos)
| Consulta | Hoy | Cambio |
|---|---|---|
| `restricciones.adeudoContrato` + `verificarReversas` | `adeudoFifo(Recibo,Pago)` | `listOpenObligations(customer)` — plantilla ya escrita en `portal.getSaldos` |
| `restricciones.candidatos` | scan global Recibo+Pago | leer `EstadoCuenta` proyectado (ya materializa `docsVencidos`/`saldoVencido`) |
| `contratos.getEstadoOperativo` / `getContextoAtencion` | `Σ timbrado − Σ pago` | `getBalance(customer).receivable_balance` (patrón de `verificarAutoReconexion`) |
| `portal.getEstadoOperativo` / `getPagos` | ídem / Pago local | `getBalance` / espejo local (proyección, ya completo por eventos) |
| `facturacion.calcularSaldoVencido` (arrastre impreso en recibo) | Recibo+Pago | Σ obligations abiertas vencidas del customer |
| `indicadores.pigoo` + forecast | Pago/Recibo/adeudoFifo | recaudado/forecast desde espejo-proyección; `carteraVencida` desde `EstadoCuenta`; `recibosPagados` desde obligations settled (corrige el subconteo) |
| `conciliaciones.RECAUDACION_VS_FACTURACION` | Σ pagos vs Σ timbrados locales | redefinir como **espejo local vs SUPRA** (conteo+suma por `external_ref`) — la conciliación que de verdad protege la integración |

### W4 — Recaudadores externos vía statement reconciliation de SUPRA
Arquitectura destino (complementa, no sustituye, el dual-write de W1):
1. Una `statement_source` por recaudador (`kind: "psp_report"`, tolerancias por config).
2. Al subir el archivo, Hydra sigue parseando con `etl-pagos.service` (los parsers posicionales
   mexicanos son valiosos y SUPRA no los tiene) → además del staging `PagoExterno`, exporta las
   líneas a SUPRA: `POST /v1/statement_sources/:id/import` con
   `{external_id: "<recaudador>-<archivo>-<n>", kind: "payment", amount: <centavos>,
   currency: "MXN", value_date, reference: <referencia del banco>, counterparty_ref}`.
3. Tras conciliar (crear el Pago vía W1), correr `POST /v1/statement_sources/:id/reconcile`:
   las líneas casan por L2 (`reference/external_ref`) o L3/L4; las excepciones
   (`GET /v1/reconciliation_exceptions`) se muestran en la pestaña de recaudación de Hydra con
   resolución manual (`:id/resolve`, `POST /v1/reconciliation_matches`).
4. Futuro opcional: mover los parsers a un conector `bank_statement` de SUPRA por layout
   (contrato `parseStatement`) y subir el archivo crudo con `{file, format}`.
- **Aceptación**: un archivo OXXO de prueba termina con 100% de líneas `matched` o excepción
  gestionable; cero pagos "solo locales".

### W5 — Caja
- Corregir el corte (`caja.service.ts:19-68`): acotar por `[apertura, cierre]` y por cajero. Requiere
  vínculo pago↔sesión: añadir `sesionCajaId`/`usuarioId` opcionales a `Pago` (espejo) y pasarlos desde
  el controller; además viajar `caja_sesion_id` en `metadata`... **nota de contrato**: `POST /v1/payments`
  de SUPRA NO acepta metadata — el método/cajero viven solo en el espejo local (razón adicional para
  conservarlo) o en el `external_ref`. Pedir `metadata` en payments a SUPRA es deseable pero no bloqueante.
- Retirar el modelo `Anticipo` (sin escritores) o implementarlo — decisión de producto; propuesta:
  retirarlo del corte y marcar deprecado.
- **Aceptación**: dos sesiones simultáneas de cajeros distintos cuadran de forma independiente
  contra los payments de SUPRA del rango.

### W6 — Refunds (nueva capacidad)
- Endpoint Hydra `POST /pagos/:id/devolucion` (roles ADMIN) → `POST /v1/payments/:supraId/refunds`
  con `external_ref hydra:refund:<uuid>`; manejar 202 (approval pendiente → mostrar en UI) y 201.
- Configurar `refund_threshold_minor` en el tenant (maker-checker de SUPRA); el aprobador usa una
  API key distinta (o el panel de SUPRA).
- Procesar eventos `refund.succeeded` (espejo: Pago negativo o tabla propia) y `obligation.reopened`
  (el recibo vuelve a abierto en la proyección → puede re-disparar dunning).
- **Aceptación**: refund bajo umbral fluye directo; sobre umbral queda pendiente y se aprueba con
  la segunda key; la proyección refleja la reapertura.

### W7 — Lado SUPRA (repo `supra-1`) — cambios pequeños y de alto valor
1. Conector de ingesta (Fase 0 del plan original, ubicaciones confirmadas):
   (a) `getContratos` paginado + `updatedSince` (`client.ts:237-239`, `connector.ts:133-134`);
   (b) `since` server-side por `updatedAt` en recibos/pagos (`client.ts:241-279`) — requiere exponer
   `updatedSince` en `GET /contratos|/recibos|/pagos` de Hydra (cambio trivial en los controllers);
   (c) quitar `if (!p.reciboId) continue;` (`connector.ts:322`) — el payment sin obligación entra
   como pago a cuenta;
   (d) actualizar customers ya mapeados en `applyCustomer` (`ingestion.ts:174-175`).
2. Registrar en el catálogo AsyncAPI los eventos ya emitidos `obligation.settled`,
   `obligation.partially_settled`, `obligation.written_off` (hoy evaden el contract test).
3. Deseable no bloqueante: filtro `?customer=` en `GET /v1/payments`; `metadata` en
   `POST /v1/payments`; endpoint de agregación de obligations (evitaría reproyecciones costosas).
4. Portal SPEI "nativo": instalar conector `bank_transfer` (o `spei-sim` en sandbox) y usar
   `POST /v1/connector_instances/:id/transfers` para emitir CLABE+referencia por obligación como
   alternativa al payment link cuando el método sea SPEI.

### W8 — Retiro del módulo `pasarelas`
Cuando W1-W4 estén estables: eliminar providers simulados, factory, webhook público (`H6` del gap
analysis) y el cron de expiración; `IntentoPago` queda como histórico + espejo de payment links.
El frontend de portal ya no necesita cambios (consume el mismo DTO).

---

## 3. Orden recomendado y dependencias

```text
W1 (escritores)  ──►  W4 (recaudadores/conciliación)
W7.1-.2 (conector+catálogo, en paralelo desde ya)
W2 (proyección cartera)  ──►  W3 (consultas puntuales)  ──►  W8 (retiro pasarelas)
W5 (caja) y W6 (refunds): independientes, tras W1
```

Estimación gruesa: W1+W7 un sprint; W2 (con las 2 semanas de paralelo) 2-3 sprints; W3-W6 1-2
sprints combinados; W8 medio sprint. Total ≈ 4-6 sprints.

## 4. Riesgos principales

| Riesgo | Mitigación |
|---|---|
| Divergencia aging legacy vs proyección SUPRA (redondeos centavos↔pesos, arrastre) | comparador automático en paralelo 2 semanas; regla: minor units → pesos SOLO en el borde de presentación |
| Reproyección costosa sin endpoints de agregación en SUPRA | recálculo incremental por eventos como camino primario; cron = reconciliación; pedir agregación a SUPRA (W7.3) |
| Propensión pierde señal si faltan allocations históricas | backfill de `AplicacionPago` desde `GET /v1/payments/:id` (allocations) antes del cutover |
| Pagos de recaudadores duplicados (archivo re-subido + reintento) | `external_id` idempotente en statement lines + Idempotency-Key `hydra:pago:<id>` en recordPayment |
| `payment_plan` de convenios: parcialidades como obligations tipo distinto en la proyección | filtrar por `external_ref` con prefijo y `metadata.plan`; probar con convenio real antes del paralelo |

## 5. Criterio de salida de la fase

1. Ningún `prisma.pago.create` fuera de caminos dual-write/gate legacy (verificable por grep + test).
2. Un solo cálculo de adeudo (la proyección); `adeudoFifo` y `calcularSaldoVencido` re-fuenteados.
3. Conciliación diaria espejo↔SUPRA y statement reconciliation de recaudadores en 0 excepciones
   no gestionadas.
4. Dunning y restricciones operando 1 mes sobre la proyección SUPRA sin falsos positivos de corte.
5. Refunds operables con maker-checker.
6. Módulo `pasarelas` retirado.
