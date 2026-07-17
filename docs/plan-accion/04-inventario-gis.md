# 04 — Inventario de servicios GIS y diseño del padrón georreferenciado

*Generado 2026-07-17. Exploración directa del ArcGIS REST de Querétaro (todas las respuestas `?f=pjson` verificadas ese día) + fuentes nacionales. Entregable 4 del plan Hydra.*

---

## 1. Inventario del ArcGIS Server del Estado de Querétaro

**Endpoint raíz:** https://mapa.queretaro.gob.mx/server/rest/services?f=pjson · **ArcGIS Server 10.8**

### 1.1 Estructura de carpetas y estado de acceso (verificado 2026-07-17)

| Carpeta | Acceso | Contenido |
|---|---|---|
| **Hosted** | ✅ Público | **123 servicios** (122 FeatureServer + 1 MapServer). *Nota: en la exploración previa (doc 03) eran 169 — el contenido Hosted es volátil; se publican/retiran servicios continuamente. Tratar el catálogo como snapshot con fecha.* |
| **DWH_SDE** | ✅ Público | 2 servicios (`Map_beneficiarios_reg` Feature/MapServer) |
| *(raíz)* | ✅ Público | `Mapa_MIL1` (MapServer, 38 capas — el mapa base estatal), `pruebasde` (Feature/MapServer de prueba) |
| **DHW** | 🔒 Error 499 "Token Required" | Desconocido — solicitar acceso |
| **DWH_publicado** | 🔒 Error 499 "Token Required" | Desconocido — solicitar acceso (presumible data warehouse publicado) |
| **INT_ARCGIS** | 🔒 Error 499 "Token Required" | Desconocido |
| **MGR_SIGEM** | 🔒 Error 499 "Token Required" | Desconocido (presumible Sistema de Información Geográfica Estatal Municipal) |
| **postgres** | 🔒 Error 499 "Token Required" | Desconocido (servicios sobre la geodatabase PostgreSQL) |
| **test** | 🔒 Error 499 "Token Required" | Desconocido |
| **Utilities** | 🔒 Error 499 "Token Required" | Típicamente Geometry/Geocode/PrintingTools de sistema — sin confirmar |

**Hallazgo relevante vs doc 03:** no solo `DWH_publicado` y `MGR_SIGEM` piden token — **7 de las 9 carpetas** están protegidas (incluida `Utilities`, donde suele vivir el GeometryServer). No se intentó vulnerar la autenticación; se documenta únicamente lo público. Ver §4 para la solicitud de accesos.

**Sistemas de coordenadas observados:** las capas Hosted "corporativas" están en **WGS84 Web Mercator (WKID 3857)**; todas las encuestas Survey123 en **WGS84 geográficas (WKID 4326)**; las capas de prueba (`Test`, `pruebasde`) en **UTM zona 14N (WKID 32614)** — la proyección métrica natural de Querétaro para análisis de distancias/áreas.

### 1.2 Servicios prioritarios para Hydra (agua / infraestructura / territorio)

Todos verificados con conteo de registros vía `query?where=1=1&returnCountOnly=true`.

#### ⭐ CARCAMOS — cárcamos de bombeo
- **URL:** https://mapa.queretaro.gob.mx/server/rest/services/Hosted/CARCAMOS/FeatureServer/0
- **Tipo/geometría:** FeatureServer · Point · WKID 3857 · **23 registros**
- **Campos:** `fid, id, nombre, municipio, operador, observa, longitud, latitud`
- **Muestra real:** "Los Molinos" (Querétaro, operador *Mpio. Querétaro*), "El Pocito" (Corregidora), "Rinconada La Capilla" (operador *"Mpio. Querétaro / CEA"*).
- **Uso en Hydra:** primera capa de **infraestructura hidráulica** pública del estado; el campo `operador` distingue cárcamos municipales vs CEA — insumo directo para el inventario de activos y el futuro Utility Network. ⚠️ Calidad: `latitud/longitud` son **strings en grados-minutos-segundos** (`20° 36' 17.555" N`), `id` siempre 0, nombres con espacios accidentales — ejemplo perfecto de por qué se necesita el pipeline de calidad (Tarea 15) también para GIS.

#### ⭐ localidades — localidades con claves INEGI
- **URL:** https://mapa.queretaro.gob.mx/server/rest/services/Hosted/localidades/FeatureServer/0
- **Tipo/geometría:** FeatureServer · Point · WKID 3857 · **3,710 registros** (capa interna `XYlocalidades_mayo15Bien`; existe gemela `Hosted/localidades_test` MapServer)
- **Campos:** `cve_ent, nom_ent, cve_mun, nom_mun, cve_loc, nom_loc, ambito, lat_dec, lon_dec, altitud, cve_carta…`
- **Uso en Hydra:** **la capa clave para el padrón** — trae la jerarquía INEGI completa (`cve_ent`+`cve_mun`+`cve_loc`) con ámbito urbano/rural. Sirve de tabla puente para el crosswalk Aquasis `pobid` ↔ INEGI `cve_loc` (§3.3). Nótese que son 3,710 puntos vs 3,595 localidades Aquasis ya cargadas en Hydra: la conciliación de esa diferencia es un caso de prueba natural del pipeline.

#### ⭐ Limites_Municipales / LIMITES / Municipios — límites municipales (3 versiones)
- **URLs:**
  - https://mapa.queretaro.gob.mx/server/rest/services/Hosted/Limites_Municipales/FeatureServer/0 — Polygon · 18 registros · campos con `cve_edo, cve_mun, nom_mun` **más variables censales** (`pobtot00, pfemeni, pob0_4…`)
  - https://mapa.queretaro.gob.mx/server/rest/services/Hosted/LIMITES/FeatureServer/0 — Polygon · 18 · versión ligera (`nombre, nom_mun, cve_mun, no_mun`)
  - https://mapa.queretaro.gob.mx/server/rest/services/Hosted/Municipios/FeatureServer/0 — Polygon · 18 · versión con marginación (`grado_2015, grado_2020, poblacion…`); duplicada como `Hosted/lma_edo` y `Hosted/lma_edo__Orden_SEDESOQ`
- **Uso en Hydra:** polígonos para **geocodificación inversa nivel municipio** (point-in-polygon), validación de que las coordenadas GPS de cada `PuntoServicio` caen en el municipio declarado en `Domicilio`, y mapas coropléticos de cobertura/cartera. Usar `LIMITES` (ligera y con clave) como operativa.

#### ⭐ Mapa_MIL1 — mapa base estatal (38 capas)
- **URL:** https://mapa.queretaro.gob.mx/server/rest/services/Mapa_MIL1/MapServer (en la raíz, no en carpeta)
- **Tipo:** MapServer · WKID 3857 · Capas destacadas (índice → nombre · geometría):
  - `0 MUNICIPIO`, `1 ENTIDAD` (Polygon) — límites
  - `2 LAGOS` (Polygon), **`3 RIOS` (Polyline, 4,507 registros)** — hidrografía superficial
  - **`31 CEA` (Point)** — **obras/acciones de la CEA**: campos `MUNICIPIO, CVGEO, AÑO_INICI, NOMBRE DE, TIPO DE OB, DESCRIPCIB, ESTATUS` — evidencia de que el Estado ya georreferencia obra hidráulica de la CEA con clave geoestadística (`CVGEO`)
  - `32 CEI_MUNICIPIOS` (Point, 95) — obras por municipio (`OBRA, ACCIÓN, TIPO_OBRA, AÑO_INICI`)
  - Vialidades completas (capas 13–30: carreteras federales/estatales, `peaje_qro`, `plaza_cobro_qro`, `poste_de_referencia_qro`, `estructura_qro`, avenidas, boulevares…), `16 FERROCARRIL`, equipamiento (hospitales, escuelas, mercados, oficinas)
- **Uso en Hydra:** mapa base institucional de contexto para todos los visores; la capa 31 (CEA) es referencia directa del patrón "activo georreferenciado + CVGEO + estatus" que el padrón debe seguir.

#### Vialidades (red vial editable, Polyline, WKID 3857)
`Avenidas`, `Boulevares`, `Calzadas`, `Caminos`, `Circuitos`, `Glorietas`, `ProlongacionAvenidas`, `maniobra_prohibida_qro` — cada una en `https://mapa.queretaro.gob.mx/server/rest/services/Hosted/{nombre}/FeatureServer/0`.
**Uso en Hydra:** geocodificación por nombre de calle (match contra `Domicilio.calle`), ruteo de lecturistas/cuadrillas y validación de direcciones.

#### Trámites y atención ciudadana (patrón de referencia)
- **PTLEQ** — https://mapa.queretaro.gob.mx/server/rest/services/Hosted/PTLEQ/FeatureServer/0 · Point · **32,939 registros**. Campos: `folio, creacion, finalizada, fase_actua, estatus, municipio, dependenci, tema, subtema, tramite, ciudadano, capturista, ejecutor…` — **trámites estatales georreferenciados con ciclo de vida completo**. Es el modelo conceptual exacto de lo que deben ser las órdenes de trabajo de Hydra en mapa.
- **tramites** — `Hosted/tramites/FeatureServer/0` · Point · 37 registros (folio, dependencia, tema, CURP, contacto).
- **BD_MyP** — `Hosted/BD_MyP/FeatureServer/0` · Point · 3,749 — atención ciudadana multicanal georreferenciada.
- **ATENCIONES**, **centrollamadas**, **EyR_mapa** — puntos de atención/eventos.

#### ⭐ Encuestas Survey123 (~70 servicios: patrón replicable de campo)
- **URLs patrón:** `Hosted/survey123_{uuid}`, `Hosted/survey123_{uuid}_form|_results|_fieldworker|_stakeholder` y `Hosted/service_{uuid}` — todos FeatureServer · Point · **WKID 4326**.
- Estructura verificada (ej. `survey123_7d0a75482bc14d29883e5c8a1bfd6aa3/FeatureServer/0`): `objectid, globalid, created_user, created_date, last_edited_user, last_edited_date` + campos del formulario (folio, capturista, escalas 1–10, respuestas codificadas).
- **Uso en Hydra:** el Estado ya opera **levantamiento en campo con Survey123 a escala** (vistas separadas para fieldworker/stakeholder, auditoría automática de quién/cuándo). Es el patrón a replicar (o consumir directamente, si la CEA tiene licencia ArcGIS) para: censo/actualización de padrón en campo, evidencias de órdenes de instalación/corte, e inspecciones de factibilidad.

#### Otras capas públicas (contexto social/equipamiento, uso menor)
`ESCUELAS`, `BIBLIOTECAS`, `Centros`, `SDE_CENTROS_VERIFICACION_EDO`, `LADRILLERAS`, `IQM_ATENCION_MUJERES`, `SEDEA_BSAC_2022`/`SEDEA_BSPC_2022` (beneficiarios agro), `SEJUVE_ACCIONES_2022/2023`, `DISTRITO_LOCAL` y `distritos_federales` (Polygon electoral), `Geolocalizaciones_municipios` (19 cabeceras), `contorno`/`contorno1` (Polygon estatal), `TOLIMAN_*` (ordenamiento ecológico/urbano, Polygon), `mateci_actualizado`, `plaza_cobro_qro`, `poste_de_referencia_qro`, `Test` (cabeceras municipales, WKID 32614). Todas en `Hosted/{nombre}/FeatureServer/0`.

#### DWH_SDE (público pero limitado)
- `DWH_SDE/Map_beneficiarios_reg` (Feature+MapServer): tabla `W_BENEFICIARIOS_REG` **sin geometría** (apoyos por CURP/municipio/localidad); la operación `query` devuelve error. Valor para Hydra: nulo directo, pero **demuestra que el Estado publica vistas de su data warehouse vía SDE** — el mismo mecanismo serviría para publicar el padrón de Hydra.

---

## 2. Fuentes nacionales descargables

| Fuente | URL | Formato | Uso concreto en Hydra |
|---|---|---|---|
| **CONAGUA SINA** (53 módulos) | https://sina.conagua.gob.mx/sina/index.php · v3: https://sinav30.conagua.gob.mx:8080/ | CSV, **SHP, KML, GeoJSON** por módulo | Capas de contexto hídrico: **acuíferos** (límites y condición — el 2201 sobreexplotado), **cuencas**, **plantas potabilizadoras y PTAR**, presas, **cobertura de agua potable/alcantarillado por municipio** (para benchmark de cobertura CEA vs censo), usos del agua. Montar como capas WMS/GeoJSON estáticas de referencia. |
| **SIGACUA** (SIG de acuíferos y cuencas) | https://www.gob.mx/conagua/acciones-y-programas/sistema-de-informacion-geografica-de-acuiferos-y-cuencas-sigacua-55161 | Visor + servicios ArcGIS de CONAGUA | Delimitación oficial de los 653 acuíferos; para recortar el polígono del **acuífero Valle de Querétaro (2201)** y los 12 acuíferos del estado como capa de contexto del balance hídrico. |
| **Disponibilidad de acuíferos (NOM-011)** | Ficha DR_2201: https://sigagis.conagua.gob.mx/gas1/Edos_Acuiferos_18/queretaro/DR_2201.pdf · portal: https://sigagis.conagua.gob.mx/gas1/sections/Disponibilidad_Acuiferos.html · DOF 09-11-2023: https://www.dof.gob.mx/nota_detalle.php?codigo=5708074&fecha=09/11/2023 | PDF (ficha por acuífero) + DOF | Números oficiales de recarga/extracción/**déficit del acuífero 2201** — el dato de contexto para el módulo de balance hídrico y el discurso de NRW ("cada m³ perdido sale de un acuífero sobreexplotado"). |
| **REPDA** (concesiones) | https://app.conagua.gob.mx/consultarepda.aspx · descarga: https://www.gob.mx/conagua/acciones-y-programas/consulta-la-base-de-datos-del-repda · histórico: https://historico.datos.gob.mx/busca/organization/conagua | Consulta web + CSV/XLSX descargable con coordenadas | Validar los **títulos de concesión de los pozos de la CEA** (volumen concesionado por aprovechamiento) y detectar grandes usuarios con pozo propio dentro del área de servicio (autoabastecidos = no clientes, o candidatos a saneamiento). |
| **INEGI Marco Geoestadístico** | https://www.inegi.org.mx/programas/mg/ | SHP (entidad, municipio, localidad, **AGEB, manzana**), descarga por estado | **La geometría base del padrón georreferenciado**: polígonos de AGEB y manzana con `CVEGEO` para asignar claves por point-in-polygon a cada PuntoServicio (§3.2). Cargar el corte de Querétaro (22) en PostGIS. |
| **INEGI AGEEML** (catálogo único de claves) | https://www.inegi.org.mx/app/ageeml/ | Consulta + descarga TXT/XLS/DBF con georreferencia | Catálogo oficial ent–mun–localidad con claves y coordenadas; fuente para poblar/validar `CatalogoLocalidadINEGI` con la **clave real `cve_loc`** (hoy la tabla solo trae `aquasisPobid`) y mantener el crosswalk Aquasis↔INEGI. |
| **INEGI Censo 2020 por AGEB/manzana** | https://www.inegi.org.mx/programas/ccpv/2020/ · descriptor: https://www.inegi.org.mx/app/scitel/doc/descriptor/fd_agebmza_urbana_cpv2020.pdf | CSV por entidad (Principales resultados por AGEB y manzana urbana) | Variables `VPH_AGUADV/VPH_AGUAFV` (viviendas con/sin agua entubada), drenaje, población por manzana → **mapa de cobertura real vs padrón**, detección de zonas con viviendas sin toma registrada (posibles clandestinas o rezago de cobertura) y focalización de **tarifa social** por marginación. |
| *(complemento)* **SEPOMEX/colonias** | catálogo CP de SEPOMEX (no existe catálogo INEGI de colonias) | TXT/XLS | Validación de colonia+CP de `Domicilio`; Hydra ya opera colonias Aquasis (`barrid`, 3,815 registros) — SEPOMEX sirve de verificación externa, no de sustituto. |

---

## 3. Diseño del padrón georreferenciado de Hydra

### 3.1 Punto de partida (modelo actual — verificado en `backend/prisma/schema.prisma` y `docs/mer-hydra.md`)

- **`PuntoServicio`**: `gpsLat/gpsLng Decimal(10,7)` opcionales, `domicilioId` FK opcional, jerarquía padre–hijo, `zonaFacturacionId`, `codigoRecorridoId`. **Sin claves INEGI propias.**
- **`Domicilio`**: `gpsLat/gpsLng`, `validadoINEGI Boolean`, FKs a `CatalogoEstadoINEGI` (`claveINEGI` ✔), `CatalogoMunicipioINEGI` (`claveINEGI` ✔), `CatalogoLocalidadINEGI` y `CatalogoColoniaINEGI`.
- ⚠️ **Brecha central:** `CatalogoLocalidadINEGI` y `CatalogoColoniaINEGI` se llaman "INEGI" pero **su clave única es Aquasis** (`aquasisPobid`, `aquasisBarrId`); no almacenan `cve_loc` INEGI. No existe modelo de **AGEB ni manzana**. No hay PostGIS ni tipo geometry: las coordenadas son pares Decimal.
- `Toma` (legacy) no tiene georreferencia; la coexistencia `Toma`/`PuntoServicio` ya está marcada como deuda en el doc 01.

### 3.2 Diseño objetivo: claves INEGI por punto de servicio

**Regla de oro:** la georreferencia vive en el **PuntoServicio** (el objeto físico); el `Domicilio` conserva la dirección administrativa. La clave de manzana INEGI es la concatenación estándar:

```
CVEGEO manzana = cve_ent(2) + cve_mun(3) + cve_loc(4) + cve_ageb(4) + cve_mza(3)   → 16 caracteres
ej. 22 + 014 + 0001 + 123A + 005
```

Cambios de modelo propuestos (compatibles con el actual, sin big-bang):

1. **Nuevas tablas** `CatalogoAgebINEGI` (`cvegeoAgeb UK`, `localidadId FK`, geometría) y `CatalogoManzanaINEGI` (`cvegeoMza UK`, `agebId FK`, geometría, variables censales cacheadas: `vphAguaDV`, `pobtot`).
2. **En `CatalogoLocalidadINEGI`**: agregar `cveLocInegi String?` + `cveMun`/`cveEnt` desnormalizadas → materializa el **crosswalk Aquasis pobid ↔ INEGI cve_loc** (§3.3).
3. **En `PuntoServicio`**: agregar `cvegeoManzana String?`, `metodoGeorref` (`GPS_CAMPO | GEOCODIFICACION_INVERSA | HEREDADO_DOMICILIO | MANUAL`), `precisionGps Decimal?` (metros), `fechaGeorref`, `validadoGis Boolean`. La clave INEGI **se deriva, no se captura**: es resultado del cruce espacial, con trazabilidad de método.
4. **PostGIS**: habilitar la extensión en la base `hydra` (o en un esquema `gis` separado), columna generada `geom geometry(Point,4326)` sobre `gps_lat/gps_lng` + índice GiST. Prisma no modela geometry nativamente → tratarla como columna no mapeada gestionada por migración SQL y consultada vía `$queryRaw` (o vista `padron_geo`). **Convención: almacenar EPSG:4326; reproyectar a 32614 (UTM 14N) solo para cálculos métricos.**

### 3.3 Estrategia de geocodificación (dos direcciones)

**A. Geocodificación inversa (GPS → claves INEGI) — la vía principal, masiva y gratuita:**
1. Cargar Marco Geoestadístico de Querétaro (SHP → PostGIS: municipios, localidades urbanas, AGEB, manzanas).
2. Spatial join por lotes: `ST_Contains(manzana.geom, punto.geom)` → asigna `cvegeoManzana` (y por prefijo: AGEB, localidad, municipio) a todo PuntoServicio con GPS. Sin servicios externos, reproducible, auditable.
3. **Reglas de calidad** (entran al framework de la Tarea 15): (C-GIS1) el punto cae en el municipio declarado en `Domicilio.municipioINEGIId` — si no, `FAIL`; (C-GIS2) puntos fuera de toda manzana urbana → asignar solo localidad/municipio y marcar `ambito=rural`; (C-GIS3) `precisionGps > 30 m` → `WARN`; (C-GIS4) puntos duplicados exactos en tomas distintas → revisión.
4. Puntos **sin GPS**: heredar coordenada del `Domicilio` si existe (`metodoGeorref=HEREDADO_DOMICILIO`); si tampoco, pasar a la vía B.

**B. Geocodificación directa (dirección → coordenada) — para el rezago sin GPS:**
- Match determinista contra capas públicas: localidad (capa `Hosted/localidades`, que trae `cve_loc`) + calle (capas de vialidades `Hosted/Avenidas…`) + colonia Aquasis→CP.
- Complemento: geocodificador del Estado si existe en las carpetas con token (`Utilities` suele contener GeocodeServer — confirmar al recibir acceso, §4); alternativas: servicio de geocodificación INEGI/DENUE o Nominatim (con cuidado de términos de uso).
- Lo que no resuelva el match automático va a **levantamiento en campo estilo Survey123** (§1.2): brigada con app captura GPS + foto del predio + medidor; ese flujo conviene modelarlo como tipo de orden de trabajo en Hydra.

**Crosswalk Aquasis ↔ INEGI:** tabla puente `pobid → cve_loc` construida por match nombre-normalizado + municipio + distancia al punto de `Hosted/localidades` (3,710 pts INEGI vs 3,595 localidades Aquasis cargadas); las no matcheadas se resuelven manualmente una sola vez. Ídem `barrid` (colonia) → CP SEPOMEX. Este crosswalk es un artefacto del dominio `agua` de Callosum (mapeo fuente↔canónico), no un script suelto.

### 3.4 Alineación futura al modelo Esri ArcGIS Utility Network (agua)

Referencia: **Water Distribution Utility Network Foundation** (Esri Solutions — asset package para redes de distribución sobre ArcGIS Utility Network; https://solutions.arcgis.com/utilities/water/help/water-utility-network-foundation/).

- Correspondencia conceptual mínima que Hydra debe respetar desde hoy para no cerrar la puerta:

| Concepto Hydra | Utility Network (dominio Water) |
|---|---|
| `PuntoServicio` | **Water Device / Service Connection** (asset group *Service Connection*, asset type *Customer Point*) |
| `Medidor` instalado | Water Device, asset group *Meter* (customer meter) |
| `Toma` (ramal físico) | Water Line, asset group *Service Lateral* |
| Cárcamo / pozo / tanque (futuro inventario) | Water Assembly / Facility (Pump Station, Well, Tank) |
| Sector hidráulico / DMA | **Subnetwork** del tier *Distribution* (zona de presión/distrito de medición) |
| Red primaria/secundaria | Water Line, asset groups *Main* / *Distribution* |

- **Decisión recomendada:** NO adoptar el esquema UN dentro de Hydra ahora (exige ArcGIS Enterprise + geodatabase corporativa y congela el modelo). En su lugar: (a) mantener el modelo canónico propio (Callosum `agua`) con **IDs estables y globales** (`globalid` UUID por activo, nunca reciclar códigos), (b) declarar el mapeo Hydra↔UN como un mapeo más del canónico, (c) exponer el padrón como **FeatureServer/GeoJSON** con campos alineados a los asset groups UN, de modo que cuando la CEA monte Utility Network la carga sea un ETL directo. El prerrequisito real del UN no es software: es que **cada toma tenga XY y clave estable** — exactamente lo que construye §3.2.

### 3.5 Capas externas a montar como contexto (visor del padrón)

| Capa | Fuente | Modo de integración |
|---|---|---|
| Manzanas + AGEB con % agua entubada (Censo 2020) | INEGI MG + CPV2020 | PostGIS local (base del padrón) |
| Límites municipales | `Hosted/LIMITES` (o INEGI MG) | PostGIS local + validación C-GIS1 |
| Localidades con claves | `Hosted/localidades` | PostGIS local (crosswalk) |
| **Cárcamos** | `Hosted/CARCAMOS` | Consumo REST directo (23 pts) + copia normalizada en inventario de activos |
| Acuíferos (2201 y vecinos) y cuencas | SINA/SIGACUA (SHP) | Capa estática GeoJSON |
| Concesiones REPDA con coordenada | REPDA CSV | Capa estática, filtrada al área CEA |
| Ríos, lagos, obra CEA (capa 31), vialidades | `Mapa_MIL1` MapServer | Servicio de teselas/dynamic layer de fondo |
| Plantas potabilizadoras/PTAR | SINA | Capa estática |
| Capas CEA internas (red, sectores, tanques) | 🔒 pendiente de acceso (§4) | Al obtener token/base GIS |

---

## 4. Accesos a solicitar (CEA / Estado de Querétaro)

1. **Token / usuario de ArcGIS Server** para las carpetas protegidas de https://mapa.queretaro.gob.mx/server/rest/services — en orden de prioridad: **`DWH_publicado`**, **`MGR_SIGEM`**, `DHW`, `INT_ARCGIS`, `postgres`, `Utilities` (confirmar si hay GeocodeServer/GeometryServer estatal reutilizable), `test`. Pedir además el **inventario de servicios** de cada carpeta para dimensionar qué existe antes de integrarlo.
2. **Base GIS actual de la CEA**: geodatabase (SDE/PostGIS/shapefiles) de red de distribución (tuberías, válvulas, tanques, pozos, cárcamos propios), sectores hidráulicos/zonas de presión, y el padrón georreferenciado que exista hoy (los "scripts GIS en Python" mencionados en el contexto del proyecto sugieren que hay algo). Incluir diccionario de datos y sistema de coordenadas de origen.
3. **Cuenta/licenciamiento ArcGIS de la CEA** (si existe ArcGIS Online/Enterprise): para evaluar reutilizar Survey123 en levantamientos de padrón y publicar el padrón Hydra como servicio propio.
4. Extracto del **padrón actual con coordenadas** (Aquasis) y del plan de instalación de los **80 mil medidores** (si el proveedor captura GPS en la instalación, es la vía más barata de georreferenciar masivamente).
5. Contacto del área que administra `mapa.queretaro.gob.mx` (¿CIEQ/Secretaría?) para acordar publicación de capas de Hydra y acceso de lectura permanente.

---

*Método: exploración directa con `curl` sobre el REST API (`?f=pjson`) el 2026-07-17: listado raíz + 9 carpetas + metadatos `/layers` de los 128 servicios públicos + conteos `returnCountOnly` y muestras `query` de las capas prioritarias. No se intentó acceder a recursos protegidos por token. URLs nacionales verificadas por código de respuesta HTTP el mismo día.*
