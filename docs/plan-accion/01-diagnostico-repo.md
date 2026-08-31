# 01 — Diagnóstico del sistema Hydra (estado actual del repo)

*Generado 2026-07-17 a partir del análisis exhaustivo del repositorio. Entregable base del plan de acción (ver `PROMPT-INVESTIGACION-PLAN-HYDRA.md`).*

**Stack confirmado:** React 18 + Vite + TypeScript + Shadcn/UI (frontend) · NestJS + Prisma + PostgreSQL (backend) · Auth JWT + LDAP/Entra ID · TanStack Query. Despliegue Docker/EasyPanel (GCP).

---

## 1. Modelo de Datos

Fuente: `backend/prisma/schema.prisma` (~1,847 líneas, ~70 modelos) y `docs/mer-hydra.md` (10 dominios). El modelo `Contrato` es el hub central.

### 1.1 Dominios y entidades principales

| Dominio | Modelos clave | Notas |
|---|---|---|
| **Territorial operativo** | `Administracion`, `Zona`, `Distrito`, `SectorHidraulico`, `Oficina`, `Ruta` | Jerarquía Administración→Zona→Distrito→Ruta. `onDelete: Restrict` en catálogos. |
| **Ciclo de obra** | `Factibilidad`, `Construccion`, `Toma` | `Toma` coexiste con `PuntoServicio` (deuda de migración). |
| **Contrato (núcleo)** | `Contrato`, `CostoContrato`, `ContratoConcepto`, `HistoricoContrato` | `Contrato` ~50 campos, 9 FKs, `variablesCapturadas Json?`. |
| **Solicitud → Contrato** | `Solicitud`, `SolicitudInspeccion`, `ProcesoContratacion`, `HitoContratacion`, `PlantillaContrato` | `Solicitud.formData Json` guarda todo el estado. FSM en `ProcesoContratacion`. |
| **Tipos de contratación** | `TipoContratacion`, `TipoVariable`, `VariableTipoContratacion`, `ConceptoCobro`, `ClausulaContractual`, `DocumentoRequeridoTipoContratacion` | Parametrización rica: fórmulas, cláusulas versionadas, docs por tipo. |
| **Motor tarifario** | `Tarifa`, `CorreccionTarifaria`, `AjusteTarifario`, `ActualizacionTarifaria` | `Tarifa` **sin FK** a `TipoContratacion` (join por string + vigencia). |
| **Medición / Facturación** | `LoteLecturas`, `Lectura`, `Consumo`, `Timbrado`, `Recibo`, `Pago`, `PagoExterno`, `Convenio`, `Anticipo`, `SesionCaja` | Cadena Lote→Lectura→Consumo→Timbrado→Recibo→Pago. |
| **Personas / Domicilios** | `Persona`, `RolPersonaContrato`, `DomicilioPersona`, `Domicilio` | Roles flexibles persona↔contrato. |
| **Catálogos INEGI/Aquasis** | `CatalogoEstadoINEGI`, `CatalogoMunicipioINEGI`, `CatalogoLocalidadINEGI` (`aquasisPobid`), `CatalogoColoniaINEGI` (`aquasisBarrId`) | 3,595 localidades + 3,815 colonias, 18 municipios QRO. |
| **Punto de servicio / Cortes** | `PuntoServicio` + catálogos de corte/suministro/zona facturación | Jerarquía padre-hijo con `reparticionConsumo`, GPS. |
| **Medidores** | `Medidor`, `MedidorBodega` + catálogos marca/modelo/calibre | 1:1 con `Contrato`; campo `tipoTelemetria` sin módulo. |
| **Operaciones** | `Orden`, `SeguimientoOrden`, `QuejaAclaracion`, `Tramite`, `Documento` | Órdenes con seguimiento; trámites presencial/digital/híbrido. |
| **Contabilidad SAP** | `ReglaContable`, `Poliza`, `LineaPoliza` | Pólizas parametrizables. |
| **GIS / Monitoreo** | `LogSincronizacion`, `CambioGIS`, `LogProceso`, `ConciliacionReporte` | CDC de cambios + conciliaciones. |
| **Integración / Auth** | `User`, `SigeHydra`, `AgoraTicket` | `User.administracionIds/zonaIds` como `String[]`. |
| **Lecturistas** | `Contratista`, `Lecturista`, `CatalogoIncidencia`, `MensajeLecturista` | Cuadrillas por contratista. |

### 1.2 Fortalezas

- Normalización sólida en catálogos; personas con roles; domicilios INEGI jerárquicos.
- Trazabilidad: `HistoricoContrato` (campo/valorAnterior/valorNuevo/motivo/usuario), tablas `Seguimiento*`.
- Vigencias en `Tarifa` y `CatalogoSat`; snapshots contractuales.
- Indexación cuidada en tablas de alto volumen.

### 1.3 Debilidades / riesgos del modelo

1. **Fechas como `String`** en `Contrato`, `Pago`, `Recibo`, `Timbrado`, `SolicitudInspeccion` — impide validación temporal en DB y complica "fecha real de pago" (T02).
2. **JSONB excesivo (27 usos)**: `formData`, `variablesCapturadas`, `Convenio.facturas/datosConvenio`, `Orden.datosCampo`, `Lectura.datosRaw`… sin schema-on-write ni FKs; los conceptos de cotización y facturas de convenio deberían ser relacionales por integridad contable.
3. **Motor tarifario unido por string** (`Tarifa.tipoContratacionCodigo` sin FK).
4. **Legacy conviviendo**: campos planos en `Contrato` (`nombre/rfc/direccion`) vs `Persona`/`Domicilio`; `Toma` vs `PuntoServicio`; ~15 campos "backward compat" en `SolicitudInspeccion`.
5. **`User` con arrays escalares** en vez de tablas de asignación.

---

## 2. Módulos y madurez

**Backend (33 módulos NestJS, ~10,730 líneas de services):**

- Muy maduros: `contratos` (1,514 líneas + `billing-engine` 384), `solicitudes`, `tipos-contratacion`, `puntos-servicio`, `domicilios`, `procesos-contratacion`, `pagos/etl-pagos`, `tarifas`.
- Funcionales: `contabilidad`, `lecturas`, `portal`, `ordenes`, `tramites`, `convenios`, `conciliaciones`, `gis`.
- **Stubs/mock**: `notificaciones` (logs, `mock:true`), `agora` (`AGORA-MOCK-*`), `medidores`, `consumos`, `timbrados`, `prefacturas` (devuelven `[]`), `ldap.strategy` (cae a DB auth).

**Frontend (32 páginas):** flujo estrella solicitud→cotización→wizard 7 pasos muy maduro; `AtencionClientes` (95 KB) aún migrando de `DataContext` mock a API real; `Consumos`, `Contabilidad`, `Simulador`, `Tomas` son stubs.

---

## 3. Requerimientos y tareas (resumen)

- **PRD_1 (2026-02-23)**: 48 reqs — lecturas/archivos planos Aquasis, ETL recaudación, órdenes único (vs Q Order), SAP parametrizable, GIS diferencial, modelo personas/contratos/PS, portal, caja/convenios, monitoreo. Origen de Tareas 01-09.
- **PRD_2 (2026-02-26)**: portal de trámites digitales + atención interna; reconexión automática, candados, convenios parametrizables, firma NOM-151, integración Ágora, LDAP/Microsoft.
- **PRD 2026-04-06**: 33 reqs — trazabilidad E2E, roles persona, estados operativos independientes, PS como entidad, domicilios INEGI, motor tarifario con fórmulas/vigencias, reglas de calidad pre-migración. Origen de Tareas 10-15.
- **Tareas 01-15**: 01 lecturas archivos planos · 02 ETL pagos · 03 órdenes · 04 SAP/IDOC · 05 GIS CDC · 06 personas/trámites · 07 atención (falta `GET /contratos/:id/contexto-atencion`) · 08 caja/convenios · 09 monitoreo · 10 FSM contratación E2E · 11 PS y cortes · 12 domicilios INEGI · 13 tipos parametrizados · 14 motor tarifario · **15 reglas de calidad y migración (gate — NO implementado)**.

---

## 4. Integraciones — estado real

| Sistema | Estado | Evidencia |
|---|---|---|
| AQUACIS/Aquasis lecturas | Diseñado (T01); layouts posicionales `0001M08L20`, `Lectores.dat`, `Observac.dat` | `Requerimientos/Documentos/.../Interfase con Sistema de Lecturas/` |
| SIGE | Puente `SigeHydra` funcional; catálogos sembrados | `backend/scripts/import-sige-hydra.ts` |
| Q Order | Decisión abierta; Hydra como fuente única con API | Tarea 03 |
| SAP | Módulo real de pólizas; export IDOC sin validar contra layouts | Tarea 04; IDOCs en Requerimientos |
| GIS | CDC + delta diferencial implementado (`GisTrackerService`) | `gis-tracker.service.ts` |
| INEGI/SEPOMEX | Pipeline de import documentado | `scripts/import-inegi-catalog.ts` |
| SAT/CFDI | Catálogos listos; **timbrado stub, sin PAC** | `catalogo-sat-seed-data.ts` |
| Ágora | **Mock** (`AGORA-MOCK-*`) | `agora.service.ts` |
| LDAP/Entra | **Stub** | `ldap.strategy.ts` |
| Notificaciones | **Stub** (SendGrid/Twilio TODO) | `notificaciones.service.ts` |
| Firma NOM-151 | Solo diseño en PRD_2 | `CatalogoTramite.tipoFirma` |

Scripts `fix-failed-migration.sql` / `fix-p3009-*` revelan incidentes de migración P3009 previos en producción.

---

## 5. Brechas funcionales vs sistema comercial de agua completo

- **Telemetría/AMI**: solo el campo `tipoTelemetria`; sin ingesta, curvas de carga ni anomalías.
- **Agua No Facturada (NRW)**: `SectorHidraulico` existe pero sin balance producción vs facturación, ILI ni detección de fugas.
- **Red hidráulica**: solo CDC del padrón hacia GIS externo; sin modelado de red.
- **Cobranza coactiva**: convenios/adeudos existen; falta segmentación de morosos, campañas, cortes masivos, PAE.
- **Analítica/BI**: sin data warehouse, KPIs de eficiencia ni reportes regulatorios (PIGOO/CONAGUA).
- **Timbrado CFDI real**: bloqueante fiscal para go-live.

## 6. Deudas técnicas prioritarias

1. Cobertura de pruebas casi nula (3 archivos test, 0 en backend) con lógica crítica de facturación/tarifas/ETL.
2. **Dos motores de tarifa divergentes**: JSON estático frontend (`tarifas-agua.json`, `tarifas-contratacion.json`, solo Feb-2026) vs modelo `Tarifa` en DB.
3. Framework de calidad T15 sin materializar (prerrequisito de migración).
4. God-objects: `contratos.service.ts` (1,514 líneas); páginas de 60-95 KB.
5. Migraciones de datos legacy pendientes (Toma→PS, direccion→Domicilio, contrato plano→Persona).

## 7. Oportunidades de mayor impacto

- Un único motor tarifario en DB con vigencias.
- Materializar T15 como gate real (→ pipeline de calidad declarativa, ver doc 05).
- Cerrar "última milla": PAC, Ágora, LDAP/Entra, SendGrid/Twilio.
- Suite de pruebas backend (facturación, ETL pagos, tarifas).
- Roadmap a telemetría, balance hídrico/NRW por sector y cobranza coactiva.
