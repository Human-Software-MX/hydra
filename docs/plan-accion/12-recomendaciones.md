# 12 — Recomendaciones técnicas para la siguiente fase

*Generado 2026-07-17. Entregable 13 del plan. Deuda técnica priorizada con esfuerzo/impacto y riesgos de proyecto con mitigación. Referencias a archivos y modelos reales del repo (`backend/prisma/schema.prisma`, líneas verificadas 2026-07-17).*

**Escalas:** Esfuerzo S (<1 semana) / M (1-3 semanas) / L (1-2 meses) / XL (>2 meses). Impacto en integridad, riesgo o desbloqueo.

---

## 1. Deuda técnica priorizada

| # | Ítem | Esfuerzo | Impacto | Fase (doc 11) |
|---|---|---|---|---|
| 1.1 | Fechas `String` → `DateTime` | M | **Crítico** — integridad temporal del dinero | F0 |
| 1.2 | JSONB → relacional (cotización y convenios primero) | L | **Crítico** — integridad contable | F0-F1 |
| 1.3 | FK real de `Tarifa` → `TipoContratacion` | S | Alto — mata joins por string en cálculo de dinero | F0 |
| 1.7 | Suite de pruebas backend (billing-engine, ETL pagos, tarifario) | L | **Crítico** — prerrequisito de todo refactor | F0-F1 |
| 1.4 | Migración `Toma` → `PuntoServicio` | M-L | Alto — un solo modelo territorial | F1 |
| 1.5 | Retiro de campos planos de `Contrato` | M | Alto — una sola verdad de personas/domicilios | F1 |
| 1.6 | Tablas de asignación vs `String[]` en `User` | S-M | Medio-alto — seguridad/integridad de permisos | F1 |
| 1.8 | Refactor de god-objects | L | Alto — velocidad y seguridad de cambio | F1 (tras 1.7) |

### 1.1 Fechas `String` → `DateTime` (M, crítico)
- **Dónde (verificado):** `Contrato.fecha`, `Contrato.fechaBaja`, `Contrato.fechaReconexionPrevista` (schema.prisma:119-126), `Pago.fecha` (:401), `Timbrado.fechaEmision/fechaVencimiento` (:359-360), `Recibo.fechaVencimiento` (:379), más `SolicitudInspeccion`.
- **Por qué primero:** son los campos temporales del **dinero** — sin tipos de fecha no hay validación en DB, ni índices temporales fiables, ni "fecha real de pago" (T02), ni features temporales para el score de impago (doc 09 §1.2). Nótese el contraste: `PagoExterno.fechaPagoReal` ya es `DateTime` (:566) — el patrón correcto ya existe en el propio schema.
- **Cómo:** migración expand-contract: columna nueva `*_dt`, backfill parseando formatos existentes (auditar variantes con query previa), doble escritura breve, swap y drop. Ensayar contra copia de producción (ver riesgo 2.1). Registros no parseables → cuarentena con reporte (es además una regla T15).

### 1.2 Reducción de JSONB — qué migrar a relacional primero y por qué (L, crítico)
De los 27 usos, **no todos son deuda** (p. ej. `Lectura.datosRaw` y `PagoExterno.datosRaw` son staging legítimo; `Solicitud.formData` es estado de formulario aceptable). Prioridad por integridad contable:
1. **`Convenio.facturas Json` (requerido, :937) y `Convenio.datosConvenio` (:939)**: un convenio reestructura deuda — las facturas que ampara determinan REP 2.0, saldos y pólizas. Como JSON no hay FK a `Recibo`/`Timbrado`, se puede referenciar una factura inexistente o doble-reestructurar la misma. → Tabla `ConvenioFactura` (convenioId, reciboId FK, montoOriginal, saldoIncluido).
2. **Conceptos de cotización** (`SolicitudState.cotizacionItems` y `conceptosCuantificacionOverride` dentro de `Solicitud.formData`): son la base económica del contrato aceptado por el cliente; hoy no son consultables ni conciliables contra `ContratoConcepto` (que sí es relacional — :197). → Tabla `CotizacionConcepto` ligada a `Solicitud`, espejo de `ContratoConcepto`.
3. Después, en orden: `Orden.datosCampo` (evidencia de campo → esquema por tipo de orden), `Contrato.variablesCapturadas` (validable contra `VariableTipoContratacion`, que ya parametriza tipos), `ActualizacionTarifaria.tarifasAfectadas`.
- **Regla general:** JSONB solo en staging y capturas de formulario; **todo lo que suma dinero o se concilia, relacional** — con schema-on-write (zod/class-validator) para el JSONB que quede.

### 1.3 FK de `Tarifa` (S, alto)
- **Dónde:** `Tarifa.tipoContratacionCodigo String?` (:1508) — join por string + vigencia contra `TipoContratacion`.
- **Cómo:** agregar `tipoContratacionId` FK, backfill por código, mantener el código como columna denormalizada de lectura, y validar huérfanos antes del NOT NULL (`ConciliacionReporte.tarifasVencidas` sugiere que ya se detectan inconsistencias). Es prerrequisito barato del motor tarifario único (T14) — hacerlo de inmediato.

### 1.4 Migración `Toma` → `PuntoServicio` (M-L, alto)
- **Dónde:** `Toma` (:86) y `Contrato.tomaId`+`Contrato.puntoServicioId` coexisten (:105-106).
- **Cómo:** script idempotente que crea/vincula `PuntoServicio` por cada `Toma` activa (ubicación → `Domicilio`, tipo → `tipoSuministroId`), **con gate T15 verde** (reglas de unicidad territorial); UI y services dejan de escribir `tomaId`; `Toma` queda read-only legacy y se retira en F2. No borrar datos: marcar deprecado.

### 1.5 Retiro de campos planos de `Contrato` (M, alto)
- **Dónde:** `nombre`, `rfc`, `razonSocial`, `regimenFiscal`, `direccion`, `contacto` en `Contrato` (:111-117) vs modelo normalizado `Persona`/`RolPersonaContrato`/`Domicilio` (que ya existe y el wizard ya usa).
- **Cómo:** backfill de contratos viejos hacia `Persona`+`RolPersonaContrato` (dedupe por RFC con reglas T15), doble lectura con preferencia al normalizado, congelar escritura de los planos, retirarlos del API. El dato fiscal del CFDI debe salir de `Persona` (rol FISCAL) — hoy el timbrado leería un campo plano posiblemente desactualizado.

### 1.6 Tabla de asignaciones vs `String[]` en `User` (S-M, medio-alto)
- **Dónde:** `User.administracionIds`, `zonaIds`, `contratoIds String[]` (:437-439) — sin FK, sin cascada, sin auditoría; un id huérfano otorga (o niega) acceso silenciosamente.
- **Cómo:** tabla `UserAsignacion` (userId, tipoAmbito enum, ambitoId, FK polimórfica-validada o tablas separadas), con `HistoricoContrato`-style de cambios de permiso. Necesario antes de Entra ID (doc 08 §6): los grupos AD mapean a asignaciones, no a arrays.

### 1.7 Suite de pruebas backend — qué probar primero (L, crítico)
Hoy: 3 archivos de test en el repo, **0 en backend**. Orden por riesgo económico:
1. **`billing-engine.service.ts` (384 líneas):** golden tests — matriz de casos (clase × bloques × cargo fijo × 10% alcantarillado × 12% saneamiento × IVA por uso × correcciones) con importes esperados fijados con la CEA; property-based para monotonicidad (más m³ nunca factura menos dentro de un bloque). Es la red de seguridad del strangler paso 3 (doc 08 §5.2).
2. **`etl-pagos.service.ts`:** fixtures reales anonimizados por recaudador (los ~22 layouts); casos de duplicado (mismo archivo re-subido — `archivoNombre`/hash), referencia ambigua, monto sin recibo abierto; idempotencia del re-proceso.
3. **`tarifas.service.ts` / motor tarifario:** selección de tarifa por vigencia (fronteras exactas `vigenciaDesde/Hasta`), versión correcta ante `ActualizacionTarifaria`, equivalencia con el JSON del frontend **antes** de borrarlo (test de paridad que documenta la unificación).
4. Después: `contratos.service.ts` (FSM de estados), conciliaciones.
- Infra: Jest ya viene con NestJS; DB efímera con Testcontainers; CI que bloquea merge. **Ningún refactor de 1.8 arranca sin esto.**

### 1.8 Refactor de god-objects (L, alto — solo tras 1.7)
- **Dónde:** `contratos.service.ts` (1,514 líneas), páginas frontend de 60-95 KB (`AtencionClientes` 95 KB aún sobre `DataContext` mock).
- **Cómo (backend):** extraer por costura natural, en este orden: (a) facturación/billing-engine a módulo `facturacion` (ya es clase aparte — mover es barato), (b) ciclo de vida/FSM a `procesos-contratacion` (módulo ya existe), (c) queries de consulta a un read-model service. Sin big-bang: una extracción por PR con la suite verde.
- **Cómo (frontend):** terminar la migración `DataContext`→TanStack Query (patrón ya establecido en el repo), partir páginas por pestaña/ruta. No reescribir el wizard: funciona.

---

## 2. Riesgos del proyecto y mitigaciones

| Riesgo | Evidencia | Probabilidad × impacto | Mitigación |
|---|---|---|---|
| **2.1 Migraciones fallidas en producción (historial P3009)** | `fix-failed-migration.sql`, `fix-p3009-*` en `backend/scripts/`; migraciones pendientes de aplicar anotadas en `.claude/CLAUDE.md` | Media × Alto | (a) Toda migración se ensaya contra copia reciente de prod (dump anonimizado) en CI; (b) patrón expand-contract, nunca cambios destructivos en un paso; (c) `prisma migrate deploy` con ventana y plan de rollback escrito; (d) gate T15 valida datos **antes** de migrar esquema dependiente de ellos; (e) drenar la cola de migraciones pendientes (individual_no_requiere_inspeccion, aquasis_localidades_colonias) antes de apilar nuevas |
| **2.2 Decisión Q Order abierta** | Tarea 03: "Hydra como fuente única con API" sin resolución; `Orden.externalRef` como gancho | Media × Medio | Diseñar el módulo `ordenes` con API completa asumiendo fuente única (el caso deseado), manteniendo `externalRef` + un conector de sincronización como plan B; forzar la decisión con la CEA como hito de F1 — cada mes sin decidir encarece cortes/reconexiones automáticos (PRD_2) |
| **2.3 Acceso a datos y sistemas de la CEA** | Lista "Información a solicitar a la CEA" del PROMPT (token GIS `DWH_publicado`/`MGR_SIGEM`, muestras AQUACIS y de 22 recaudadores, IDOCs, padrón, macromedición, plan de 80k medidores); Ágora/Entra dependen de terceros | Alta × Alto | (a) Formalizar la solicitud como anexo contractual con fechas; (b) desarrollar contra los mocks/fixtures existentes (`AGORA-MOCK-*`, layouts en `Requerimientos/`) manteniendo interfaces estables; (c) priorizar en F0 lo que no depende de la CEA (canónico, pipeline, deuda 1.1-1.3); (d) escalar como riesgo de cronograma en cada corte si no llega |
| **2.4 Timbrado: riesgo fiscal de go-live** | `timbrados` stub sin PAC (doc 01 §4-5) | Media × Alto | Selección de PAC en F1 temprana con criterio de volumen masivo; sandbox SAT; parallel-run contra el proceso CFDI vivo de la CEA (factura desde 2019 — hay referencia de comparación) |
| **2.5 Divergencia tarifaria mientras convivan dos motores** | `frontend/src/data/tarifas-agua.json` (solo Feb-2026) vs `Tarifa` en DB | Alta × Alto | Test de paridad (1.7.3) inmediato; congelar cambios al JSON; toda actualización tarifaria nueva entra **solo** por DB (`ActualizacionTarifaria`); retiro del JSON como criterio de salida F1 |
| **2.6 Cambio regulatorio LGA 2025 mal implementado** | Reglas de corte deben ser restricción, no corte total, en domésticas (doc 03 §1) | Baja × Alto | Modelarlo en datos, no en código: `CatalogoTipoCorte.impacto` ya distingue suspensión/restricción; regla R1 del KG (doc 10 §5) como validación; revisión jurídica CEA de la matriz clase×acción |
| **2.7 Dependencia de persona/proveedor único** | Patrón de fracaso nacional documentado (doc 03 §5); conocimiento tarifario en JSON de frontend | Media × Alto | Todo el conocimiento de dominio en artefactos versionados (canónico, ontología, perfiles, definiciones KPI, este plan); pares en cada pieza crítica; documentación como entregable de cada fase |

---

## 3. Reglas de trabajo para la siguiente fase (resumen ejecutivo)

1. **Nada de features nuevas sobre esquema podrido:** 1.1-1.3 y 1.7 van antes que cualquier funcionalidad nueva de F1.
2. **T15 es un gate, no un documento:** ninguna migración de datos legacy (1.4, 1.5, Aquasis/SIGE) corre sin el framework de calidad ejecutándose.
3. **Expand-contract siempre**; toda migración ensayada contra copia de prod (anti-P3009).
4. **El dinero se prueba:** billing-engine, tarifas y ETL de pagos no se tocan sin suite verde.
5. **Una sola fuente de verdad por concepto:** tarifas en DB, personas en `Persona`, territorio en `PuntoServicio`+`Domicilio`, saldos en el kardex.
6. **Los mocks mantienen su interfaz:** cerrar última milla (PAC, Ágora, Entra, notificaciones, NOM-151) es sustituir implementación, no rediseñar contratos — y los mocks se quedan como fixtures de prueba.
