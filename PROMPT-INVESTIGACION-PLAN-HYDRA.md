# Proyecto: HYDRA — Plataforma Inteligente Comercial y Operativa para Organismos de Agua (CEA Querétaro)

## Contexto

Hydra es hoy un sistema comercial "contract-to-cash" para la CEA Querétaro (solicitud → contratación → toma → lectura → facturación → cobranza), construido con React + NestJS + Prisma + PostgreSQL. Convive con Aquasis/AQUACIS (lecturas por archivos planos posicionales), SIGE (sistema anterior), Q Order (órdenes), SAP (contabilidad vía IDOC), scripts GIS en Python y ~22 formatos de recaudadores externos (OXXO, bancos).

El objetivo del proyecto es evolucionar Hydra hacia **el mejor sistema para organismos operadores de agua**, siguiendo el mismo enfoque que usamos en Catastro (Katastik) y SEDESU:

- **El desarrollo NO comienza por escribir más features**, sino por la comprensión profunda del dominio, la construcción de un **modelo canónico/ontología del sector agua**, y pipelines de ingeniería de datos con normalización, linaje y calidad declarativa.
- El conocimiento del dominio es el activo principal de una plataforma "AI Native".
- La base de mejores prácticas del sector es **SWAN (Smart Water Networks Forum)** — modelo de 5 capas, framework de madurez digital, Digital Twin Readiness Guide — complementada con IWA, AWWA, ISO 24510/24512/55001, IBNET (Banco Mundial) y PIGOO (IMTA) a nivel nacional.

### Estado actual del repo (hallazgos verificados que el plan debe atender)

- ~70 modelos Prisma en 10 dominios con `Contrato` como hub; 33 módulos NestJS; 32 páginas frontend.
- **Dos motores tarifarios que pueden divergir**: JSON estático en frontend (`tarifas-agua.json`, `tarifas-contratacion.json`, solo Feb-2026) vs modelo `Tarifa` en DB; además `Tarifa` se une a `TipoContratacion` por string sin FK.
- **Fechas como String** en Contrato/Pago/Recibo/Timbrado; **27 usos de JSONB** sin schema-on-write (formData, variablesCapturadas, facturas de convenio…).
- **Coexistencia legacy**: `Toma` vs `PuntoServicio`; campos planos de persona/dirección en `Contrato` vs modelo normalizado `Persona`/`Domicilio`.
- **Integraciones críticas en mock/stub**: timbrado CFDI (sin PAC), Ágora (tickets), LDAP/Entra ID, notificaciones (email/WhatsApp), firma digital NOM-151.
- **Casi cero pruebas** (3 archivos de test en todo el repo; ninguno en backend) pese a lógica crítica de facturación/tarifas/ETL.
- **Framework de calidad de datos (Tarea 15) declarado prerrequisito de migración pero no implementado**; historial de migraciones fallidas P3009 en producción.
- **Ausencias funcionales** vs un sistema completo: telemetría/AMI, balance hídrico y agua no facturada (NRW) por sector, modelado de red hidráulica, cobranza coactiva/segmentación de cartera, analítica/BI/KPIs, reportes regulatorios.

---

# Objetivo General

Realizar una investigación exhaustiva del dominio de gestión comercial y operativa de agua potable, y generar todos los artefactos necesarios para diseñar la evolución de Hydra hacia una plataforma moderna basada en datos e IA.

No limitarse a los requerimientos actuales de la CEA; investigar las mejores prácticas nacionales e internacionales y proponer mejoras, aunque no hayan sido solicitadas.

---

# Prioridad Máxima

## Modelo Canónico + Ontología del Dominio Agua

Todo el proyecto debe partir de un modelo canónico del dominio (como LADM lo fue para catastro). Antes de escribir cualquier código nuevo, identificar y modelar completamente:

### Actores

- Usuarios/titulares (persona física/moral, propietario, persona fiscal, contacto)
- Organismo operador (CEA), administraciones, zonas, distritos, oficinas
- Lecturistas, contratistas, cuadrillas
- Recaudadores externos (bancos, OXXO, canales digitales)
- Reguladores: CONAGUA, IMTA, Secretaría de Salud (NOM-127), SAT, Consejo Directivo (tarifas)
- Municipios, Estado, Federación; JAPAM y otros organismos vecinos

### Procesos (ciclo comercial "meter-to-cash" + ciclo técnico)

- Factibilidad → solicitud → inspección → cuantificación → cotización → contratación → construcción/instalación de toma y medidor → alta
- Lectura (manual, archivo plano, AMR/AMI) → validación de lote → estimación → consumo → facturación → timbrado CFDI → distribución de recibo
- Pago (caja, portal, recaudador externo, CoDi) → conciliación → aplicación → contabilización (póliza/IDOC)
- Cobranza: rezago, convenios, parcialidades, restricción/limitación de servicio (mínimo vital), reconexión
- Órdenes de trabajo: corte, reconexión, instalación, revisión, inspección
- Atención al cliente: quejas, aclaraciones, trámites (cambio de nombre, subrogación, bajas)
- Operación de red: producción, macromedición, sectores hidráulicos, balance hídrico, fugas

### Documentos

- Contrato (plantillas, cláusulas versionadas, snapshot), solicitud, cotización, dictamen de factibilidad
- Recibo/CFDI 4.0, complemento de pago (REP), CFDI global
- Archivos planos AQUACIS (ida/vuelta), layouts de recaudadores, IDOCs SAP
- Órdenes de trabajo, evidencias de campo (fotos, GPS), convenios, constancias

### Conceptos del dominio

- Toma, punto de servicio (jerarquía padre-hijo, repartición de consumo), medidor (marca/modelo/calibre/telemetría)
- Tarifa (clase de usuario × bloques de consumo, cargo fijo, 10% alcantarillado, 12% saneamiento, IVA por uso), vigencias, ajustes, correcciones
- Consumo, estimación, incidencia de lectura, "bolsa de estimación"
- Balance hídrico IWA/AWWA: agua producida, consumo autorizado (facturado/no facturado), pérdidas aparentes y reales, NRW, ILI
- Sector hidráulico / DMA, presión, acuífero (Valle de Querétaro 2201 sobreexplotado), fuentes (Acueducto II/III)
- Cartera: saldo, antigüedad, rezago, convenio, saldo a favor, anticipo

### Objetos GIS

- Padrón georreferenciado (toma/punto de servicio con claves INEGI: municipio–localidad–AGEB–manzana)
- Red hidráulica: tuberías, válvulas, tanques, cárcamos, pozos, sectores de presión (alinear a ArcGIS Utility Network / Water Utility Network Foundation de Esri)
- Capas estatales (mapa.queretaro.gob.mx), SINA/SIGACUA (cuencas, acuíferos), REPDA (concesiones)

### Indicadores

- PIGOO/IMTA: eficiencia física, comercial (recaudado/facturado), global, micromedición, dotación, empleados por mil tomas
- IWA PI / IBNET / AWWA M36: NRW, ILI, periodo medio de cobranza, % cartera vencida, % lecturas reales vs estimadas, quejas por mil usuarios, tasa corte/reconexión
- Data confidence grading (calificación de confianza del dato) al estilo AWWA

El modelo canónico debe poder evolucionar hacia un **Knowledge Graph** y alimentar el motor de KPIs.

---

# Callosum: dominio `agua`

Callosum (`~/Desktop/AI/callosum`) es nuestro motor de modelo canónico: perfiles de fuentes YAML → síntesis de modelo canónico (adoptando estándares internacionales cuando existen) → mapeos bidireccionales → ETL contra store DuckDB. Ya tiene dominios `catastro` (basado en ISO 19152 LADM), `erp`, `pos` e `impacto_ambiental` (proyecto SEDESU, con ontología .ttl).

Para Hydra:

1. Crear el dominio **`agua`** (o `agua_comercial`) siguiendo el workflow de onboarding de dominios:
   - `specs/sources/agua/aquasis.yaml` — layouts posicionales de lecturas (0001M08L20, Lectores.dat, Observac.dat) y catálogos (pobid/barrid)
   - `specs/sources/agua/sige.yaml` — sistema anterior (tabla puente SigeHydra, catálogos ACTIPOL)
   - `specs/sources/agua/hydra.yaml` — el schema.prisma actual como fuente
   - `specs/sources/agua/recaudadores.yaml` — los ~22 layouts de pagos externos
   - `specs/sources/agua/sap_idoc.yaml` — layouts contables
   - `specs/sources/agua/inegi_marco.yaml`, `conagua_sina.yaml`, `pigoo.yaml` — fuentes de contexto e indicadores
   - `specs/sources/agua/arcgis_queretaro.yaml` — capas públicas (Hosted: CARCAMOS, límites, localidades)
2. Sintetizar el **modelo canónico `specs/canonical/agua.yaml`**, adoptando como columna vertebral los estándares del sector en lugar de inventar: SWAN layers para la arquitectura, IWA PI/IBNET para indicadores, balance hídrico IWA/AWWA, WaterML 2.0 / OGC SensorThings para series de tiempo de lecturas/telemetría, GWML2 para pozos/acuíferos, EPANET (.INP) para red, DLMS/COSEM y OMS/wM-Bus para AMI.
3. Declarar mapeos bidireccionales Hydra↔canónico y Aquasis↔canónico; validar con round-trip ingest/export.
4. Documentar la investigación de mercado en `research/agua-market.md` con citas.
5. Evaluar y proponer mejoras a Callosum que estos casos exijan (p. ej. soporte de series de tiempo, layouts posicionales de ancho fijo como formato de fuente, geometrías). Lección conocida: al subir la versión del modelo canónico hay que migrar el esquema del store DuckDB o el ingest falla con BinderException.

---

# Pipeline de datos (enfoque Catastro/Katastik)

Diseñar para Hydra el mismo patrón de ingeniería de datos probado en Katastik:

```
Fuentes (Aquasis, SIGE, recaudadores, SAP, GIS, INEGI, telemetría)
      │  conectores con contrato uniforme (descriptor, explorar, sync, frescura)
      ▼
staging append-only (JSONB crudo, nunca se borra; run_id, hash de contenido)
      │  normalización → modelo canónico
      ▼
canónico (personas, contratos, puntos de servicio, lecturas, pagos — idempotente)
      │  construcción de eventos
      ▼
kardex/ledger de eventos comerciales append-only (CARGO/PAGO/AJUSTE/ESTIMACIÓN/CONVENIO por contrato)
      │
      ▼
derivados (read models, KPIs, balance hídrico, cartera — recalculables)
```

Con: registro de fuentes y credenciales por referencia, `sync_runs` + watermarks incrementales, tabla de linaje input/output, **expectativas de calidad declarativas** (estilo dbt tests: unicidad, % nulos, conteos vs control, integridad referencial, frescura) con severidad FAIL/WARN y **gate de publicación** — esto materializa la Tarea 15 (reglas de calidad C1-C6/P1-P5/D1-D5/CC1-CC6) como prerrequisito real de la migración desde Aquasis/SIGE. Incluir enmascaramiento PII y conciliaciones periódicas (padrón vs GIS, recaudación vs facturación, facturación vs contabilidad).

---

# Investigación del dominio

## 1. SWAN — Smart Water Networks Forum (base del proyecto)

- Modelo de 5 capas (física / sensado y control / comunicaciones / gestión y visualización —donde vive Hydra hoy— / fusión y análisis —hacia donde debe evolucionar) y su evolución al framework circular "Smart Water Journey".
- Framework de madurez digital de 4 etapas (Inactiva → Reactiva → Proactiva → Optimizada) en personas/procesos/tecnología: **autodiagnóstico de la CEA y roadmap de Hydra**.
- Digital Twin Readiness Guide (2022), Digital Twin Values Guide (2024), Maturity Assessment Tool (2025), Interoperable Utility Group (estructuras de datos de activos consistentes) y AI Community (casos LLM/agentic en utilities).

## 2. Ciclo comercial y trámites

- Mapear el flujo completo E2E con tiempos, causas de rechazo y observaciones comunes (factibilidad → contratación → alta → facturación → cobranza → baja).
- Trámites: altas, bajas, cambios de nombre, subrogaciones, individualizaciones; qué documentos y firmas exige cada uno (firma digital NOM-151).
- Referencia conceptual: libro IMTA "Sistema comercial de organismos de agua potable" (4 subsistemas: comercialización, padrón, medición, facturación y cobranza).

## 3. Marco regulatorio (no asumir, verificar)

- **Nueva Ley General de Aguas (DOF 11-dic-2025)** y reforma a la Ley de Aguas Nacionales: mínimo vital y prohibición de suspensión total del servicio doméstico → las reglas de corte de Hydra deben modelarse como restricción, no corte total.
- Ley estatal de agua de Querétaro (Art. 154: tarifas por Consejo Directivo), Acuerdo de Precios anual.
- NOM-127-SSA1-2021 (calidad), NOM-179-SSA1-2020 (vigilancia), NOM-001-CONAGUA-2011 (hermeticidad), NOM-011-CONAGUA-2015 (disponibilidad), NOM-001-SEMARNAT-2021 (descargas).
- CFDI 4.0: Anexo 20, CFDI global (RFC genérico), complemento de recepción de pagos REP 2.0 para convenios/parcialidades; el recibo CEA es CFDI desde 2019. Investigar PACs y estrategia de timbrado masivo (hoy stub).

## 4. Medición, pérdidas y balance hídrico

- Metodología de auditoría AWWA M36 / balance IWA con data grading; AWWA Free Water Audit Software como referencia de UX.
- NRW, ILI y bandas del Banco Mundial; balance por sector hidráulico/DMA.
- AMI/AMR: DLMS/COSEM, OMS/wM-Bus, LoRaWAN/NB-IoT; los 80 mil medidores nuevos de la CEA exigen una capa MDM agnóstica de protocolo. Analítica típica: flujo mínimo nocturno, medidor parado, tamper, fuga intradomiciliaria.

## 5. Tarifas

- Estructura mexicana: clase de usuario (11 clases CEA) × bloques crecientes m³ + cargo fijo + 10% alcantarillado + 12% saneamiento + IVA solo no doméstico.
- Consolidar **un único motor tarifario en DB** con vigencias/versiones (unificar el JSON estático del frontend con el modelo Tarifa + FK real), con simulador y trazabilidad de cada cálculo.
- Comparar con estructuras del tarifario IBNET (190 países) y esquemas de tarifa social/subsidios cruzados.

---

# Investigación GIS

## Servicios del Estado de Querétaro

Explorar completamente https://mapa.queretaro.gob.mx/server/rest/services (ArcGIS Server 10.8):

- Carpeta `Hosted` pública: 169 FeatureServer, incluyendo **CARCAMOS**, límites municipales, localidades, vialidades, y encuestas Survey123 (patrón de levantamiento en campo replicable para padrón y órdenes).
- `DWH_publicado` y `MGR_SIGEM` requieren token: **solicitar acceso a la CEA/Estado**, no vulnerar autenticación; documentar solo recursos públicos.
- Catalogar cada servicio: URL, tipo, capas, sistema de coordenadas, posibles usos.

## Fuentes nacionales

- INEGI: Marco Geoestadístico (AGEB/manzana), AGEEML, Censo 2020 (cobertura de agua entubada por manzana — para mapas de cobertura y tarifas sociales). Nota: no existe catálogo INEGI de colonias; usar SEPOMEX/catálogos municipales (ya hay catálogos Aquasis pobid/barrid en Hydra).
- CONAGUA: SINA (53 módulos, descarga CSV/SHP/KML/GeoJSON), SIGACUA, REPDA, fichas de disponibilidad de acuíferos (DR_2201 Valle de Querétaro).
- Diseñar el padrón georreferenciado y la integración con el modelo Esri ArcGIS Utility Network para agua.

---

# Benchmark Internacional

Documentar arquitectura, datos, IA y qué ideas copiar de:

- **CIS**: Oracle Utilities CC&B (vista 360° meter-to-cash, cobranza por reglas), SAP IS-U/S4 Utilities (integración transaccional comercial-financiera sin conciliaciones manuales).
- **Plataformas de datos**: Xylem Vue powered by GoAigua/Idrica (unificación de silos CIS+SCADA+GIS+AMI — el mejor referente arquitectónico), TaKaDu (gestión de "eventos" con ciclo de vida), Qatium (UX simple para no modeladores), Autodesk Water/Innovyze, Bentley OpenFlows WaterSight (digital twin operativo).
- **Casos**: Valencia/Global Omnium (NRW −40%), Anglian Water (ISO 55001 + digital twin), DC Water (Pipe Sleuth, deep learning en CCTV), Singapur PUB (localización de fugas <1 km).
- **Organizaciones**: SWAN, IWA (Water Loss SG, PI System), AWWA, ISO TC 224, EPA/AWIA, EurEau, EBC, IBNET, ADERASA, principios de gobernanza del agua OCDE (principio 5: datos comparables).

# Benchmark Nacional

- **SADM Monterrey** (Xylem Vue/GoAigua, −17% pérdidas, doble certificación AquaRating — la vara nacional), SACMEX (Idrica desde 2020, "Agua en tu colonia"), Aguas de Saltillo (empresa mixta Veolia, eficiencia comercial), SIAPA (SIAPAMÁTICO), CESPT Tijuana (reporte de fugas georreferenciado con foto en app).
- Mercado de sistemas comerciales MX: Aquasis (TDS), Agua Soluciones, iMexSoft, Acrux, GFDSISCOM — y el patrón de fracaso documentado (padrón desactualizado, micromedición baja, rotación trienal, dependencia de un proveedor).
- PIGOO/IMTA y ANEAS (capacitación/certificación); AquaRating (BID) como estándar de evaluación de organismos.

---

# Motor de KPIs e Inteligencia

Diseñar (no implementar aún):

1. **Motor de KPIs nativo y auditable** con definiciones estándar (PIGOO + IBNET + IWA PI + balance AWWA/IWA con data grading), calculado automáticamente desde el kardex de eventos: eficiencia comercial, periodo medio de cobranza, antigüedad de cartera, % micromedición, % lecturas reales vs estimadas, NRW por sector. Salida directa a reportes PIGOO/CONAGUA.
2. **IA con los datos que ya existen** (sin sensores nuevos): detección de anomalías de consumo (fuga intradomiciliaria, medidor parado, submedición, toma clandestina), score de riesgo de impago para priorizar cobranza, forecasting de facturación/recaudación/demanda, estimación de lecturas faltantes, sugerencia de contrato en la bandeja de conciliación del ETL de pagos.
3. **Agentes/LLM**: asistente de atención al cliente con contexto 360° del contrato, copiloto del analista comercial sobre el Knowledge Graph, clasificación automática de quejas; RAG sobre normatividad (leyes, NOMs, MAPAS, acuerdos tarifarios).
4. **Ruta a digital twin** siguiendo la SWAN Digital Twin Readiness Guide: por fases, empezando por analítica descriptiva → predictiva → prescriptiva; export EPANET del padrón/consumos como demandas.

---

# Knowledge Graph

A partir del modelo canónico, proponer un Knowledge Graph que modele entidades, relaciones, reglas, procesos, documentos, actores, GIS, normatividad, tarifas, indicadores y eventos — para RAG, agentes, búsquedas semánticas y recomendaciones (mismo enfoque que SEDESU/impacto_ambiental, que ya tiene ontología .ttl en Callosum).

---

# Arquitectura propuesta

Diseñar la arquitectura conceptual que integre: modelo canónico (Callosum) · pipeline staging→canónico→kardex→derivados · motor de KPIs · GIS/padrón georreferenciado · motor tarifario único · facturación/timbrado CFDI · ETL de recaudación · integración SAP · MDM/telemetría · portal y notificaciones · IA/agentes/RAG · Knowledge Graph. Posicionar cada pieza en las capas SWAN y definir la secuencia de migración desde el Hydra actual (sin big-bang: strangler sobre los módulos existentes).

---

# Entregables

1. Modelo canónico del dominio agua (Callosum `specs/canonical/agua.yaml` + perfiles de fuentes) y ontología.
2. Documento de investigación técnica del dominio (ciclo comercial, medición, pérdidas, tarifas).
3. Benchmark internacional y nacional.
4. Inventario de servicios GIS públicos (Querétaro + SINA/INEGI) y diseño del padrón georreferenciado.
5. Marco regulatorio aplicado (nueva Ley General de Aguas/mínimo vital, NOMs, CFDI 4.0/REP, Art. 154).
6. Diagnóstico de madurez digital SWAN de la CEA y roadmap por etapas.
7. Diseño del pipeline de datos (conectores, staging, canónico, kardex, calidad declarativa, linaje) que materializa la Tarea 15 como gate de migración.
8. Diseño del motor de KPIs (PIGOO/IBNET/IWA/AWWA) y del balance hídrico por sector.
9. Diseño del motor tarifario único con vigencias (unificación de los dos motores actuales).
10. Propuesta de Knowledge Graph.
11. Arquitectura conceptual del sistema y plan de cierre de "última milla" (PAC de timbrado, Ágora, LDAP/Entra, notificaciones, firma NOM-151).
12. Diseño preliminar del modelo de IA (anomalías, cobranza predictiva, forecasting, agentes).
13. Recomendaciones técnicas para la siguiente fase (incluye deuda técnica: fechas String, JSONB, Toma→PuntoServicio, pruebas de backend, FK de tarifas).
14. Un primer demo conceptual que muestre la dirección del proyecto.

## Información a solicitar a la CEA

- Acceso con token a las capas `DWH_publicado`/`MGR_SIGEM` de mapa.queretaro.gob.mx y a la base GIS actual.
- Muestras reales completas: archivos AQUACIS de lecturas (ida/vuelta), archivos de los ~22 recaudadores, IDOCs SAP recientes, padrón actual (extracto), tarifario y Acuerdo de Precios vigente.
- Datos de producción/macromedición por fuente y sector (para balance hídrico) y plan de los 80 mil medidores nuevos (marca, protocolo, telemetría).
- Reportes PIGOO históricos de la CEA (si participa) y estados de indicadores actuales.

---

# Consideraciones

- No asumir información sin evidencia; citar todas las fuentes; priorizar documentación oficial (DOF, CONAGUA, SWAN, IWA) sobre fuentes secundarias.
- Diferenciar claramente hechos, inferencias y recomendaciones.
- Cuando existan múltiples metodologías o estándares, compararlos y justificar el más adecuado.
- Pensar simultáneamente como arquitecto de software, ingeniero de datos, especialista GIS y consultor comercial de agua.
- Si durante la investigación se identifican tecnologías o capacidades que mejoren significativamente el proyecto, incluirlas aunque no hayan sido solicitadas.
- El objetivo final no es documentar el dominio: es sentar las bases para construir la plataforma comercial y operativa de agua más completa y moderna posible, y que el patrón (Callosum + pipeline canónico + KPIs + IA) sea replicable a otros organismos operadores del país (mercado: 2,356 organismos, la mayoría con sistemas precarios).
