# 11 — Diagnóstico de madurez digital SWAN y roadmap por fases

*Generado 2026-07-17. Entregable 6 del plan. Marco: "The Water Utility Digital Journey" (SWAN, Amir Cahn) — 4 etapas (Inactiva → Reactiva → Proactiva → Optimizada) evaluadas en 3 dimensiones (personas, procesos, tecnología). Evidencia: doc 01 (diagnóstico del repo), docs 02-03.*

---

## 1. Autodiagnóstico CEA/Hydra contra las 4 etapas SWAN

### 1.1 Resumen

| Dimensión | Etapa actual | Justificación en una línea |
|---|---|---|
| **Tecnología** | **Reactiva (2), entrando a 2.5** | Sistemas digitales existen pero en silos (Aquasis, SIGE, Q Order, SAP, GIS, Hydra) unidos por archivos planos; cero analítica |
| **Procesos** | **Reactiva (2)** | Ciclo comercial digitalizado pero con conciliaciones manuales, estimaciones opacas y sin gate de calidad de datos; decisiones por excepción, no por predicción |
| **Personas** | **Reactiva (2), con bolsas Inactivas** | Lecturas por contratistas con archivos posicionales; áreas que aún operan sobre SIGE; sin roles de datos/analítica en el organismo |
| **Global CEA/Hydra** | **Reactiva (etapa 2 de 4)** | Consistente con la inferencia del doc 02: la mayoría de organismos mexicanos está entre etapas 1-2; **Hydra es el vehículo para llegar a Proactiva (3)** |

### 1.2 Detalle con evidencia del repo (doc 01)

**Tecnología — Reactiva (2):**
- A favor (por encima del promedio nacional): stack moderno (React+NestJS+Prisma), ~70 modelos con normalización sólida, trazabilidad (`HistoricoContrato`, tablas `Seguimiento*`), CDC hacia GIS (`GisTrackerService`), FSM de contratación, catálogos INEGI/Aquasis sembrados, monitoreo (`LogProceso`, `ConciliacionReporte`). La CEA ya emite CFDI desde 2019 y tiene pago en línea/CoDi/app (doc 03 §2) — línea base digital real.
- En contra (lo que la ancla en Reactiva): **silos integrados por archivos planos** (AQUACIS posicional, ~22 layouts de recaudadores); **integraciones críticas en mock** (PAC, Ágora, LDAP/Entra, notificaciones, NOM-151 — doc 01 §4); **dos motores tarifarios divergentes**; fechas `String` y 27 JSONB sin schema; **cero telemetría** (solo `Medidor.tipoTelemetria` sin módulo); **cero analítica/BI/KPIs**; casi cero pruebas (3 archivos, 0 backend).
- Nada de capa 5 SWAN: sin balance hídrico, sin NRW/ILI, sin modelo de red, sin ML.

**Procesos — Reactiva (2):**
- A favor: flujo solicitud→cotización→contratación E2E digital y maduro (wizard 7 pasos); órdenes con seguimiento; convenios y caja operando; conciliaciones **existen** como proceso (`ConciliacionReporte`).
- En contra: la migración de datos depende de un framework de calidad **declarado pero no implementado** (T15 — el gate está en papel); incidentes P3009 en producción revelan proceso de release frágil (`fix-failed-migration.sql`, `fix-p3009-*`); estimación de lecturas tipo "bolsa" heredada de Aquasis sin método auditable; cobranza sin segmentación (se reacciona al adeudo, no se anticipa); reportes regulatorios (PIGOO/CONAGUA) inexistentes.

**Personas — Reactiva (2) con bolsas Inactivas:**
- A favor: existe un equipo que sostiene un sistema de esta complejidad; personal CEA usa flujos digitales a diario.
- En contra: lecturistas de contratistas externos entregan archivos planos (proceso Inactivo→Reactivo); coexistencia SIGE/Hydra implica doble cultura de sistema; no hay evidencia de roles de ingeniería de datos, calidad de datos ni analítica en la operación; el conocimiento del dominio tarifario vive parcialmente en un JSON de frontend — señal de silos de conocimiento. *(Diagnóstico de personas basado solo en lo observable en el repo; validar con la CEA.)*

### 1.3 Qué significaría cada etapa objetivo

- **Proactiva (3)**: datos unificados (pipeline canónico), KPIs automáticos, anomalías y cobranza predictiva operando, decisiones basadas en score/forecast — alcanzable con los datos actuales (docs 08-09).
- **Optimizada (4)**: AMI masivo, balance por sector en tiempo casi real, digital twin prescriptivo, mejora continua instrumentada — requiere los 80k medidores y macromedición.

---

## 2. Roadmap por fases

Secuencia: **fundación de datos → consolidación comercial → inteligencia → red y digital twin.** Cada fase tiene criterios de salida verificables; ninguna fase posterior arranca en serio sin cerrar los criterios de la anterior (en particular, F0 es gate duro de F1 por la lección P3009). Alineado con las Tareas 01-15 del repo y con la secuencia strangler del doc 08 §5.2.

### Fase 0 — Fundación de datos (pipeline + canónico + calidad T15)

**Objetivo:** que exista una sola verdad de datos con calidad medida, sin tocar la operación.

| Trabajo | Tareas repo relacionadas |
|---|---|
| Dominio Callosum `agua`: perfiles de fuentes (aquasis, sige, hydra, recaudadores, sap_idoc, inegi, arcgis) + `specs/canonical/agua.yaml` + mapeos round-trip | — (nuevo; insumo de T15) |
| Pipeline staging append-only → canónico → kardex v1 (backfill histórico desde Hydra/SIGE/Aquasis) | T01 (lecturas), T02 (ETL pagos), T09 (monitoreo) |
| **Materializar T15**: reglas C1-C6/P1-P5/D1-D5/CC1-CC6 como expectativas declarativas con severidad FAIL/WARN y gate de publicación | **T15 (el gate)** |
| Higiene de esquema que desbloquea lo demás: fechas String→DateTime, FK de `Tarifa`→`TipoContratacion` (doc 12 §1.1, §1.3) | T14 (motor tarifario) |
| Proceso de release endurecido: migraciones ensayadas contra copia de prod (anti-P3009) | — |

**Criterios de salida F0:**
1. Round-trip ingest/export Hydra↔canónico y Aquasis↔canónico sin pérdida (diff = 0 en campos mapeados).
2. Gate T15 ejecutándose en cada sync con reporte FAIL/WARN; **0 FAILs abiertos** sobre el padrón activo.
3. Kardex reproduce los saldos actuales: conciliación kardex vs `Recibo.saldoVigente/saldoVencido` con diferencia explicada al 100%.
4. Linaje consultable: cualquier registro canónico navega a su `run_id`/archivo fuente.
5. Cero fechas `String` en modelos de dinero (`Pago`, `Recibo`, `Timbrado`, `Contrato`).

### Fase 1 — Consolidación comercial (motor tarifario único, timbrado real, última milla)

**Objetivo:** cerrar el ciclo comercial de producción: facturar, timbrar, cobrar y contabilizar sin mocks ni dobles verdades.

| Trabajo | Tareas repo relacionadas |
|---|---|
| **Motor tarifario único** en DB con vigencias, FK real y API de cálculo trazable; retiro de `tarifas-agua.json`/`tarifas-contratacion.json`; simulador sobre la misma API | **T14** |
| **Timbrado CFDI real**: PAC contratado, CFDI ingreso + global + REP 2.0; extracción de `billing-engine` fuera de `contratos.service.ts` | T08 (caja/convenios) |
| Última milla restante: Entra ID (OIDC), SendGrid/Twilio, Ágora real, firma NOM-151 en portal (secuencia doc 08 §6) | PRD_2; T06 (personas/trámites), T07 (atención + `GET /contratos/:id/contexto-atencion`) |
| ETL de recaudación completo: 22 layouts en perfiles Callosum, conciliación tripartita, eventos PAGO al kardex | **T02**, T04 (SAP/IDOC validado contra layouts reales) |
| Migraciones legacy **con gate T15 verde**: Toma→PuntoServicio, campos planos de Contrato→Persona/Domicilio | T11 (PS y cortes), T12 (domicilios INEGI), T06 |
| Suite de pruebas backend sobre lo crítico: billing-engine, ETL pagos, motor tarifario (doc 12 §1.7) | transversal |
| Reglas de corte conforme LGA 2025: restricción (no corte total) en domésticas, vía `CatalogoTipoCorte.impacto` | T03 (órdenes), T11 |

**Criterios de salida F1:**
1. **Una sola fuente tarifaria**: 0 referencias a los JSON estáticos; re-facturación de 3 periodos históricos coincide con lo emitido (o difiere con causa documentada).
2. Timbrado real en producción: ≥1 ciclo completo de facturación masiva timbrada con PAC (incluye global y ≥1 REP de convenio), tasa de error PAC <0.5% con reproceso automático.
3. ≥90% de pagos externos auto-conciliados; conciliación recaudación↔facturación↔pólizas cerrada mensualmente.
4. 0 mocks en camino crítico (PAC, notificaciones, auth); Ágora según disponibilidad CEA.
5. 100% de contratos activos con `PuntoServicio` y `Domicilio` INEGI (adiós `Toma` y campos planos en flujo nuevo).
6. Cobertura de pruebas: billing-engine, motor tarifario y ETL pagos con suites verdes en CI (meta ≥80% en esos módulos).

### Fase 2 — Inteligencia (KPIs, anomalías, cobranza predictiva)

**Objetivo:** pasar a Proactiva (3): decidir con datos.

| Trabajo | Tareas repo relacionadas |
|---|---|
| **Motor de KPIs** sobre kardex/derivados: PIGOO (IP.14 eficiencia comercial…), IWA PI, % lecturas reales vs estimadas, antigüedad de cartera, con data grading AWWA; salida a reportes PIGOO/CONAGUA | T09 (monitoreo se eleva a KPIs) |
| IA fase 1 (doc 09): anomalías de consumo (reglas+estadístico), estimación de lecturas auditable, sugerencia de contrato en bandeja ETL | T01, T02 |
| IA fase 2: score de riesgo de impago + segmentación de cartera y campañas de cobranza (piloto A/B); forecasting de facturación/recaudación | T08 |
| Agentes/LLM: asistente 360° interno (T07), RAG normativo, clasificación de quejas | **T07**, T06 |
| Knowledge Graph KG-0/KG-1 (doc 10): ontología + normatividad + proyección del canónico | — |
| Vista espacial DT-1: consumo/cartera/anomalías por sector y zona de facturación | T05 (GIS) |

**Criterios de salida F2:**
1. Tablero de KPIs en producción calculado 100% automático desde el kardex; reporte PIGOO anual generado por el sistema.
2. Anomalías: ≥40% de precisión verificada en campo; proceso queja↔anomalía integrado.
3. Piloto de cobranza predictiva con uplift medido vs control; eficiencia comercial (recaudado/facturado) con mejora atribuible.
4. Asistente 360° usado por atención a clientes (adopción ≥50% de operadores); RAG con set dorado ≥90% de respuestas correctas con cita.
5. KG respondiendo las consultas de agentes en producción (no demo).

### Fase 3 — Red y digital twin (MDM 80k medidores, balance por sector, EPANET)

**Objetivo:** entrar a capa 5 SWAN plena y ruta a Optimizada (4).

| Trabajo | Tareas repo relacionadas |
|---|---|
| **Capa MDM agnóstica de protocolo** (DLMS/COSEM, OMS/wM-Bus, LoRaWAN/NB-IoT) para los 80k medidores; lecturas AMI al mismo canónico/kardex; exposición OGC SensorThings | T01 (mismo modelo de lectura, nuevo conector) |
| Macromedición por fuente/sector (requiere datos CEA) → **balance hídrico IWA/AWWA por sector** con NRW/ILI y bandas Banco Mundial | T05 |
| **Export EPANET .INP**: padrón + consumos como demandas nodales (hito DT-2, doc 09 §3) | — |
| Analítica AMI: flujo mínimo nocturno, tamper, fuga intradomiciliaria en horas (no meses) | — |
| Red en modelo Esri Utility Network; simulación de cierres de válvula → contratos afectados → notificaciones | T03, T05 |
| Cobranza coactiva completa: campañas masivas, PAE, segmentación madura | T08 |

**Criterios de salida F3:**
1. ≥95% de medidores AMI reportando al MDM con frescura < 24h.
2. Balance hídrico mensual por sector publicado con data grading; NRW/ILI comparables IBNET.
3. Archivo .INP que corre en EPANET 2.2 con demandas reales; usado por el área técnica en ≥1 proyecto de sectorización.
4. ≥1 ciclo prescriptivo cerrado (recomendación → acción en campo → efecto medido) — definición SWAN de etapa Optimizada en marcha.

---

## 3. Dimensión personas (transversal a todas las fases)

El framework SWAN es explícito: la tecnología no avanza etapas sin personas y procesos. Mínimos por fase:
- **F0:** designar dueño de datos (data steward) por dominio (padrón, lecturas, recaudación); capacitar al equipo en el pipeline/canónico.
- **F1:** operadores de facturación/cobranza entrenados en el motor único y el flujo PAC; jurídico valida reglas LGA.
- **F2:** rol de analista de datos comerciales en la CEA (los KPIs necesitan dueño de negocio, no solo cálculo); gestores de cobranza operando con score.
- **F3:** equipo de operación de red consumiendo el balance/twin; gobernanza de datos formal (comité, catálogo, políticas PII).

**Riesgo estructural nacional (doc 03 §5):** rotación política trienal y dependencia de proveedor son el patrón de fracaso documentado. Mitigación: el conocimiento vive en artefactos versionados (canónico, ontología, perfiles de fuentes, definiciones de KPIs) y no en personas ni en un proveedor — es precisamente el diseño Callosum.

---

## 4. Mapa fase → etapa SWAN

```
Hoy:      Reactiva (2)          — silos, mocks, sin analítica
F0-F1:    Reactiva consolidada  — una verdad de datos, ciclo comercial cerrado en producción
F2:       Proactiva (3)         — KPIs automáticos, predicción de impago, anomalías, agentes
F3:       Proactiva plena → umbral de Optimizada (4) — AMI, balance por sector, twin prescriptivo
```
