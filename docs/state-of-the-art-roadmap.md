# Hydra — Roadmap State-of-the-Art (Gap Analysis)

> Generado 2026-07-17 a partir de: inventario del código actual, frameworks SWAN Forum / IWA-AWWA,
> y análisis competitivo (AquaCIS, Open Smartflex, Oracle CC&B, SAP IS-U, Minsait, Aquasis/TDS).
> Objetivo: posicionar Hydra como el CIS de agua de referencia para organismos operadores de México y LATAM.

---

## 1. Hallazgos estratégicos clave

1. **El incumbente directo en CEA Querétaro es Aquasis (TDS, mexicano)** — no AquaCIS. Los catálogos
   de Hydra ya son Aquasis-compatibles (`aquasisPobid`, `aquasisBarrId`), lo que facilita la migración.
2. **AquaCIS es de Agbar/Aqualogy → Veolia** (no de Aqualia/FCC). En México solo opera dentro del grupo
   Veolia (Aguas de Saltillo, Aguascalientes). Su perfil: parametrizable pero pre-cloud, sin IA embebida,
   sin APIs abiertas documentadas, y con conflicto de interés estructural (es el sistema de un
   operador-competidor). Argumento de venta: **vendor neutral mexicano**.
3. **El rival a vencer en LATAM es Open Smartflex** (Open International): CIS + MDM + MWM + portal en
   una plataforma low-code con IA embebida (V8), +42M usuarios finales, fuerte narrativa de agua no
   contabilizada (NRW).
4. **No existe CIS open-source serio para agua** — hueco de mercado entre los regionales básicos
   (iMexSoft, Aquasis) y los enterprise (Oracle/SAP/Open) para organismos de 10k–300k tomas.
5. **Ventajas ya construidas en Hydra que nadie trae de fábrica**:
   - CFDI 4.0 nativo con abstracción PAC (claves SAT 83101501/83101509, exento IVA doméstico).
   - Motor de mínimo vital conforme a Ley General de Aguas (DOF dic-2025) — restricción de flujo en
     vez de corte, con máquina de estados y evidencia probatoria. Los estados armonizan sus leyes en
     2026: **todo organismo mexicano lo va a necesitar**.
6. **La migración de datos ES el producto** en este mercado: ESSAP compró salir de COBOL; los organismos
   compran el proyecto de migración, no features.

---

## 2. Estado actual de Hydra (resumen del inventario)

**Dominios ricos:** contratación (wizard 7 pasos, tipos con variables dinámicas, factibilidades),
facturación periódica + billing engine, timbrado CFDI 4.0, tarifas (con correcciones/ajustes),
lecturas/rutas/medidores, órdenes de trabajo genéricas, restricciones/mínimo vital, convenios,
pagos + ETL de recaudadores externos, caja, contabilidad (pólizas estilo SAP), batch scheduler,
notificaciones multicanal, catálogos INEGI/Aquasis, RBAC con scoping territorial.

**Dominios delgados o ausentes:** cartera vencida/cobranza (no hay aging ni dunning), portal de
autoservicio con pago en línea, pasarelas de pago en tiempo real (SPEI/OXXO/tarjeta), PQR maduro
(sin SLA/colas), telemetría AMI/MDM, balance hídrico NRW, GIS real (solo cola de sincronización),
mobile workforce offline, reportería regulatoria/BI, multi-tenancy real, detección ML de anomalías.

---

## 3. Matriz de brechas priorizada

Leyenda: ✅ existe · 🟡 parcial · ❌ ausente | P0 = must-have para licitar, P1 = competitivo, P2 = diferenciador futuro

| # | Capacidad | Estado | Prioridad | Notas |
|---|-----------|--------|-----------|-------|
| 1 | Cartera vencida: aging, segmentación de deuda, dunning multicanal | ✅ | **P0** | **Implementado** (`backend/src/modules/cartera/` + `frontend/src/pages/Cartera.tsx`): libro de partida abierta, aplicación FIFO de pagos, EstadoCuenta con aging/score, reglas de dunning configurables, campañas, crons. Diseño: `docs/design/cartera-cobranza.md`. |
| 2 | Portal/app autoservicio con pago en línea, historial de consumo, descarga CFDI | ✅ | **P0** | **Implementado**: tab "Pagar en línea" en el portal (SPEI/OXXO/tarjeta con referencia copiable, simulación demo), saldos corregidos, intentos con estado. Descarga CFDI sigue stub (bucket pendiente). |
| 3 | Pagos digitales MX con conciliación automática: tarjeta, SPEI, línea de captura OXXO, domiciliación | ✅ | **P0** | **Implementado** (`backend/src/modules/pasarelas/`): abstracción provider (patrón PAC), provider simulado, webhook idempotente que crea el Pago y lo aplica a cartera. Provider real (Conekta/Openpay) = solo implementar la interface. Domiciliación pendiente. |
| 4 | Pre-facturación con validación de anomalías ("bill precision"): VEE de lecturas, flags de medidor parado/invertido/consumo cero, estimación reglada auditada | ✅ | **P0** | **Implementado** (`backend/src/modules/vee/`): pipeline de reglas + cola de excepciones con aceptar/descartar/corregir. |
| 5 | Rendimiento y reproceso del batch masivo (re-facturación como flujo formal) | ✅ | **P0** | **Implementado**: `LoteFacturacion` auditable, cancelar/reprocesar lote con guardas (CFDI sellado y pagos bloquean), refacturación individual, UI en Cartera→Lotes. |
| 6 | Herramientas + metodología de migración desde Aquasis/legados | ✅ | **P0** | **Implementado** (`backend/src/modules/migracion/`): analizar/validar/importar XLSX-CSV con dry-run, upsert idempotente, reporte de conciliación de padrón. Layouts ajustables al export real de Aquasis. |
| 7 | PQR/CRM maduro: SLA, colas, tipificación, omnicanal, encuestas | 🟡 | **P1** | `QuejaAclaracion` es la semilla. AquaCIS CRM presume −70% tiempo de atención. |
| 8 | Mobile workforce offline-first (lecturistas + cuadrillas): foto-evidencia, GPS, cierre transaccional | 🟡 | **P1** | Smartflex gana contratos con su MWM. Ya existen órdenes y rutas como base. |
| 9 | MDM ligero / ingesta AMI: lecturas de intervalo separadas de la lectura de facturación | ✅ | **P1** | **Implementado** (`backend/src/modules/mdm/`): `LecturaIntervalo` con ingesta bulk idempotente (JWT o X-API-KEY para colectores IoT), series con agregación hora/día. Adaptadores de protocolo (DLMS/OMS) pendientes. |
| 10 | Alertas proactivas de fuga lado-cliente (flujo continuo nocturno ≥ N horas) | ✅ | **P1** | **Implementado**: detección de flujo nocturno continuo con cron + notificación email/WhatsApp (anti-spam 3 días) + `GET /mdm/alertas`. |
| 11 | Balance hídrico IWA/AWWA (M36) por sector/DMA + KPIs (ILI, pérdidas aparentes) | ✅ | **P1** | **Implementado** (`backend/src/modules/balance/`, `m36-balance.ts`): balance M36 con pérdidas valorizadas. |
| 12 | Detección ML de anomalías de consumo (fraude, submedición) → cola de inspección → orden de campo | ❌ | **P1** | Cierra el ciclo con #8. Diferenciador vs. AquaCIS. |
| 13 | Motor de tarifas low-code (bloques, estacional, subsidios, simulador de impacto sobre el padrón real) | 🟡 | **P1** | **Simulador de impacto implementado** (`POST /tarifas/simular-impacto`: delta global, p50/p90/max, top 20 impactados sobre consumos reales). Configuración low-code de estructuras tarifarias pendiente. |
| 14 | Panel KPIs IWA (Alegre 3ª ed.) con confidence grading: eficiencia física, comercial, cobranza, micromedición | ✅ | **P1** | **Implementado** (`backend/src/modules/indicadores/`): PIGOO automático con export CSV; cartera vencida ya con cálculo FIFO corregido. |
| 15 | Multi-tenancy real (SaaS multi-organismo) | ❌ | **P2** | Hoy: organismo único con multi-administración. Necesario para la tesis "implantación en semanas, 10k–300k tomas". |
| 16 | API-first pública + webhooks (pagos, lecturas, cambios de estado) con modelo de datos estilo SWAN Interoperable Utility Group | 🟡 | **P2** | Permite venta modular "solo facturación primero" — la cuña de entrada 2025-2026. |
| 17 | Soporte explícito de tandeo: calendarios de suministro por sector, facturación diferenciada para servicio intermitente | 🟡 | **P2** | **Calendarios implementados** (`CalendarioSuministro` + CRUD + `estaEnSuministro()` helper). Facturación diferenciada pendiente. |
| 18 | GIS real (geometrías de red) / integración digital twin (SWAN capas 4→5) | ❌ | **P2** | Mantener datos georreferenciados con IDs estables; el twin se conecta después. |
| 19 | Audit-log unificado e inmutable (accesos + cambios) | 🟡 | **P2** | Hoy hay históricos por dominio; falta unificación. Relevante para transparencia/INAI. |
| 20 | Agentes IA de atención al cliente | ❌ | **P2** | Smartflex V8 ya lo embebe. Apalancable sobre #7. |

---

## 4. Secuencia recomendada (olas)

**Ola 1 — Cerrar el ciclo comercial (P0):**
cartera/cobranza (#1) → pagos digitales + conciliación (#3) → portal con pago en línea (#2) →
VEE/bill-precision (#4) → reproceso batch (#5). Con esto Hydra iguala el alcance que compran los
organismos al reemplazar un legado.

**Ola 2 — Experiencia y campo (P1):**
PQR/CRM (#7) → mobile workforce (#8) → tarifas low-code + simulador de impacto (#13) → panel KPIs (#14).

**Ola 3 — Datos y diferenciación (P1/P2):**
MDM/series temporales (#9) → alertas de fuga (#10) → balance IWA (#11) → ML anomalías (#12).

**Ola 4 — Plataforma (P2):**
multi-tenancy (#15) → API pública/webhooks (#16) → tandeo (#17) → GIS/twin (#18).

**Regla transversal:** todo dato nuevo nace georreferenciado, con series temporales accesibles y IDs
estables ("digital-twin-ready", SWAN Digital Twin Readiness Guide).

---

## 5. Posicionamiento de producto

- **Contra Aquasis/regionales:** profundidad enterprise (VEE, cartera, batch robusto, CFDI real) a costo regional.
- **Contra AquaCIS/Veolia:** vendor neutral mexicano, cloud-native, compliance MX de serie (CFDI 4.0 + mínimo vital), APIs abiertas.
- **Contra Open Smartflex:** time-to-value (implantación en semanas para 10k–300k tomas), precio, y localización mexicana de fábrica que Open resuelve por proyecto.
- **Mensaje central:** "El único CIS que nace con la Ley General de Aguas 2025 y el SAT dentro."

---

## 6. Referencias

- SWAN 5-Layer Model / Digital Twin Readiness Guide — swan-forum.com
- IWA/AWWA Water Audit (manual M36 4ª ed.), ILI — awwa.org, leakssuitelibrary.com
- IWA Performance Indicators for Water Supply Services (Alegre et al., 3ª ed.)
- Ley General de Aguas (DOF 11-dic-2025) — diputados.gob.mx/LeyesBiblio/pdf/LGAg.pdf
- IMTA — Sistema comercial de organismos operadores
- Open Smartflex — openintl.com · Oracle CC&B — oracle.com/utilities · AquaCIS — veolia.es / iagua.es
- Casos: ESSAP (Paraguay), Interagua Guayaquil, Aguas de Saltillo, Agua de Puebla, SEDAPAL
