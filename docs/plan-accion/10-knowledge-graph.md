# 10 — Propuesta de Knowledge Graph del dominio agua

*Generado 2026-07-17. Entregable 10 del plan. El KG se deriva del modelo canónico Callosum (`specs/canonical/agua.yaml`, por sintetizar) siguiendo el patrón ya probado del dominio `impacto_ambiental` de SEDESU, cuya ontología vive en `/Users/luismiguel/Desktop/AI/callosum/specs/canonical/impacto_ambiental.ttl` y se usa aquí como plantilla de estilo.*

---

## 1. Por qué un Knowledge Graph (y no solo el modelo relacional)

El schema.prisma responde "¿qué datos tengo?"; el KG responde "¿qué **significan** y cómo se conectan con el mundo?": un contrato no es una fila — es un acuerdo entre una `Persona` y el `OrganismoOperador`, sobre un `PuntoServicio` ubicado en una `Manzana` INEGI dentro de un `SectorHidraulico` que se abastece de un `Acuifero` sobreexplotado, facturado bajo una `Tarifa` cuya vigencia emana de un `AcuerdoTarifario` fundamentado en el `Art. 154`, con la restricción de corte limitada por la `LGA 2025`. Esa red es lo que consumen los agentes, el RAG y las búsquedas semánticas (doc 09), y lo que hace **trazable regulatoriamente** cada decisión del sistema.

---

## 2. Patrón de estilo heredado de `impacto_ambiental.ttl`

Del .ttl de SEDESU se adoptan las convenciones (verificadas en el archivo):

1. **Prefijo propio por dominio**: `cal: <https://callosum.dev/ontology/impacto_ambiental#>` → para agua: `agua: <https://callosum.dev/ontology/agua#>`.
2. **Cabecera `owl:Ontology`** con `dcterms:title`, `owl:versionInfo`, `dcterms:conformsTo` (los estándares adoptados) y un `rdfs:comment` largo que fija **convenciones de unidades y escalas** (allá: valor natural 0–1, áreas en m², GeoJSON, ISO 8601).
3. **Una `owl:Class` por entidad canónica** con `rdfs:label`/`rdfs:comment` en español y `skos:note "clave: id"`.
4. **`owl:DatatypeProperty` por atributo**, con dominios/rangos XSD; **`owl:ObjectProperty` para las FK** (p. ej. `cal:predio_proyecto_id`).
5. **Vocabularios controlados inline**: `rdfs:comment "valores: a, b, c · explicación"` — los enums viven en la ontología, no solo en el código.
6. **Anclas normativas en los comentarios** (allá: "guía §5.1.4", "LGEEPA art. 30"; acá: "Art. 154", "LGA 2025", "NOM-127").
7. **`geo:Geometry` (GeoSPARQL)** para geometrías.
8. **Enlaces entre dominios Callosum** (allá `predio_clave_catastral` → dominio catastro; acá `punto_servicio` → catastro por clave, `pozo` → REPDA).
9. Campos para IA embebidos donde aportan (allá `dictamen_vector` guarda el embedding del razonamiento para detectar dictámenes atípicos; acá aplicaría a resolución de quejas y dictámenes de factibilidad).

Para agua, `dcterms:conformsTo` declarará: modelo canónico Callosum agua + IWA PI / IBNET / PIGOO (indicadores) + balance IWA/AWWA + WaterML2/SensorThings (series) + GWML2 (subsuelo) + EPANET (red) + CFDI 4.0/Anexo 20 (documentos fiscales) + marco INEGI (territorio).

---

## 3. Entidades del grafo

Agrupadas por los ejes que pide el modelo canónico (actores, procesos meter-to-cash, documentos, GIS, normatividad, tarifas, indicadores, eventos del kardex). Entre paréntesis, el modelo Prisma origen cuando existe.

### 3.1 Actores
| Entidad | Origen | Notas |
|---|---|---|
| `agua:Persona` | `Persona` | física/moral; roles vía relación, no subclases |
| `agua:OrganismoOperador` | — (CEA; catálogo) | también JAPAM y vecinos, para benchmark |
| `agua:UnidadOrganizacional` | `Administracion`, `Zona`, `Distrito`, `Oficina` | jerarquía `agua:parteDe` |
| `agua:Lecturista` / `agua:Contratista` | `Lecturista`, `Contratista` | cuadrillas |
| `agua:RecaudadorExterno` | catálogo desde `PagoExterno.recaudador` | OXXO, bancos, canales |
| `agua:Regulador` | catálogo | CONAGUA, IMTA, Salud, SAT, Consejo Directivo |

### 3.2 Objetos de servicio y territorio (GIS)
| Entidad | Origen | Notas |
|---|---|---|
| `agua:PuntoServicio` | `PuntoServicio` | jerarquía padre-hijo (`agua:derivaDe`, con `reparticion_consumo`); `geo:Geometry` |
| `agua:Toma` | `Toma` | legado; se declara `owl:equivalentClass`-transición hacia PuntoServicio |
| `agua:Medidor` | `Medidor`, `MedidorBodega` | marca/modelo/calibre/telemetría; historial de instalación |
| `agua:Domicilio` | `Domicilio` + catálogos INEGI | claves municipio–localidad–AGEB–manzana; pobid/barrid Aquasis |
| `agua:SectorHidraulico` | `SectorHidraulico` | DMA; nodo del balance hídrico |
| `agua:Ruta` | `Ruta` | recorrido de lectura |
| `agua:FuenteAbastecimiento` | — (SINA/REPDA) | pozos, Acueducto II/III; enlace GWML2 |
| `agua:Acuifero` | — (CONAGUA) | p. ej. Valle de Querétaro 2201, sobreexplotado |
| `agua:ElementoRed` | — (futuro Utility Network) | tubería, válvula, tanque, cárcamo (capa CARCAMOS) |

### 3.3 Procesos meter-to-cash
| Entidad | Origen |
|---|---|
| `agua:Solicitud` → `agua:Factibilidad` → `agua:Cotizacion` → `agua:Contrato` → `agua:ProcesoContratacion` | `Solicitud`, `Factibilidad`, `Construccion`, `Contrato`, `ProcesoContratacion`/`HitoContratacion` |
| `agua:LoteLecturas` → `agua:Lectura` → `agua:Consumo` | `LoteLecturas`, `Lectura`, `Consumo` (con `agua:Incidencia` de `CatalogoIncidencia`) |
| `agua:Facturacion` → `agua:Timbrado` → `agua:Recibo` | `Timbrado`, `Recibo` |
| `agua:Pago` / `agua:PagoExterno` → `agua:Conciliacion` → `agua:Poliza` | `Pago`, `PagoExterno`, `ConciliacionReporte`, `Poliza`/`LineaPoliza`/`ReglaContable` |
| `agua:Convenio`, `agua:Anticipo`, `agua:SesionCaja` | `Convenio`, `Anticipo`, `SesionCaja` |
| `agua:Orden` (corte/restricción/reconexión/instalación/inspección) | `Orden`, `CatalogoTipoCorte` (su campo `impacto`: suspensión_total / restricción_parcial / solo_registro conecta directo con la regla LGA de mínimo vital) |
| `agua:Tramite`, `agua:QuejaAclaracion` | `Tramite`, `QuejaAclaracion` |

### 3.4 Documentos
`agua:Documento` (de `Documento`) con subclases/tipos: contrato firmado (snapshot `textoContratoSnapshot` + cláusulas versionadas `ClausulaContractual`), dictamen de factibilidad, cotización (PDF en `uploads/cotizaciones/`), CFDI 4.0 (ingreso/global), complemento REP, archivo plano AQUACIS (ida/vuelta), layout de recaudador, IDOC SAP, constancia NOM-151, evidencia de campo (foto `Lectura.urlFoto`, `Orden.datosCampo`).

### 3.5 Normatividad y tarifas
| Entidad | Contenido |
|---|---|
| `agua:Normativa` | LGA 2025 (DOF 11-dic-2025), LAN, ley estatal (Art. 154), NOM-127/179/001-CONAGUA/011/001-SEMARNAT, Anexo 20 SAT, guías MAPAS — con `dcterms:issued`, vigencia y jerarquía; unidad = artículo/fracción (chunk natural del RAG) |
| `agua:AcuerdoTarifario` | Acuerdo de Precios anual del Consejo Directivo; `agua:fundamentadoEn` Art. 154 |
| `agua:Tarifa` | `Tarifa` + `CorreccionTarifaria`/`AjusteTarifario`/`ActualizacionTarifaria`: clase de usuario × bloque m³, cargo fijo, 10% alcantarillado, 12% saneamiento, IVA por uso, vigencias/versiones |
| `agua:ClaseUsuario` | las 11 clases CEA (Doméstica de Apoyo…Pecuaria) |

### 3.6 Indicadores y eventos
| Entidad | Contenido |
|---|---|
| `agua:Indicador` | definición versionada (PIGOO IP.14, IWA Op23, NRW, ILI…), fórmula, fuente, `agua:definidoPor` → organismo (IMTA/IWA/IBNET) |
| `agua:MedicionIndicador` | valor del indicador en periodo × ámbito (organismo/zona/sector) + **data confidence grading** AWWA |
| `agua:EventoKardex` | evento del ledger: `valores: cargo, pago, ajuste, estimacion, convenio, restriccion, reconexion, corte` — cada uno con `agua:afectaContrato`, monto, periodo, `agua:generadoPor` (proceso origen) y `agua:respaldadoPor` (documento) |
| `agua:BalanceHidrico` | nodo agregado por sector×periodo: suministrado, autorizado facturado/no facturado, pérdidas aparentes/reales (estructura IWA) |

---

## 4. Relaciones clave (object properties)

```
Persona          —tieneRol→            RolContrato —en→ Contrato        (PROPIETARIO|FISCAL|CONTACTO, de RolPersonaContrato)
Contrato         —sirveA→              PuntoServicio —ubicadoEn→ Domicilio —dentroDe→ Manzana/AGEB/Localidad/Municipio
PuntoServicio    —derivaDe→            PuntoServicio (padre-hijo, reparticionConsumo)
PuntoServicio    —perteneceA→          SectorHidraulico —abastecidoPor→ FuenteAbastecimiento —extraeDe→ Acuifero
Contrato         —medidoPor→           Medidor
Lectura          —tomadaPor→ Lecturista · —registra→ Consumo · —tieneIncidencia→ Incidencia
Consumo          —facturadoEn→         Timbrado —amparadoPor→ Recibo(CFDI)
Pago/PagoExterno —aplicaA→             Recibo|Convenio · —recaudadoPor→ RecaudadorExterno · —contabilizadoEn→ Poliza
Convenio         —reestructura→        EventoKardex(cargo) · —documentadoPor→ REP
Orden            —ejecutaSobre→        PuntoServicio · —motivadaPor→ EventoKardex|QuejaAclaracion
Tarifa           —aplicaA→             ClaseUsuario · —vigenteEn→ Periodo · —autorizadaPor→ AcuerdoTarifario —fundamentadoEn→ Normativa
EventoKardex     —afectaContrato→      Contrato · —calculadoCon→ Tarifa(version) · —respaldadoPor→ Documento
Indicador        —definidoPor→         Regulador · MedicionIndicador —mideA→ Organismo|Zona|Sector
Normativa        —restringe|habilita→  TipoOrden|Tarifa|Tramite   (p. ej. LGA restringe corte_total en clase doméstica)
Documento        —selladoPor→          ConstanciaNOM151
```

---

## 5. Reglas (axiomas y validaciones sobre el grafo)

Expresables como SHACL shapes / reglas SPARQL sobre el grafo (y espejo de las reglas de calidad T15):

1. **R1 — Mínimo vital (LGA 2025):** una `Orden` con impacto `suspension_total` sobre un contrato cuya `ClaseUsuario` es doméstica → **violación**; solo `restriccion_parcial` es válida. (La normativa es un nodo: la regla cita `agua:LGA2025_art_X` — trazabilidad regulatoria directa.)
2. **R2 — Todo cargo tiene tarifa:** todo `EventoKardex` tipo `cargo` de consumo debe tener `calculadoCon` → una `Tarifa` vigente en el periodo (mata la divergencia de los dos motores).
3. **R3 — Cadena fiscal completa:** todo `Recibo` pagado con parcialidades (PPD) requiere `Pago —documentadoPor→ REP`; recibos a público en general deben colgar de un CFDI global del periodo.
4. **R4 — Unicidad territorial:** todo `PuntoServicio` activo tiene exactamente un `Domicilio` con clave INEGI completa y coordenadas dentro del municipio declarado.
5. **R5 — Continuidad del medidor:** las lecturas de un medidor son monotónicas salvo evento de cambio/reset documentado (`Orden` de sustitución).
6. **R6 — Conciliación:** Σ pagos aplicados por periodo = Σ recaudación reportada por recaudador = Σ pólizas del periodo (las tres patas de `ConciliacionReporte`).
7. **R7 — Vigencia normativa:** ninguna regla puede citar una `Normativa` derogada a la fecha del evento (versionado normativo).

---

## 6. Extracto de la ontología objetivo (`specs/canonical/agua.ttl`, estilo impacto_ambiental.ttl)

```turtle
@prefix agua: <https://callosum.dev/ontology/agua#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .

<https://callosum.dev/ontology/agua> a owl:Ontology ;
    dcterms:title "Ontología canónica: agua (comercial y operativa)"@es ;
    owl:versionInfo "0.1.0" ;
    dcterms:conformsTo "IWA PI (3.ª ed.) + balance hídrico IWA/AWWA M36 + PIGOO/IMTA + IBNET + CFDI 4.0 Anexo 20/REP 2.0 + Art. 154 ley estatal Qro + LGA DOF 11-dic-2025 + Marco Geoestadístico INEGI + WaterML 2.0/OGC SensorThings + GWML2 + EPANET 2.2"@es ;
    rdfs:comment "Cerebro canónico del ciclo comercial meter-to-cash y su contexto operativo. Convenciones: volúmenes en m³; importes en MXN a 2 decimales; periodos YYYY-MM; fechas ISO 8601; geometrías GeoJSON (EPSG:4326); indicadores con calificación de confianza AWWA (1–10). El kardex es append-only: los saldos son derivados, nunca hechos."@es .

### Clase punto_servicio
agua:PuntoServicio a owl:Class ; rdfs:label "Punto de servicio"@es ;
    rdfs:comment "Lugar físico donde se presta el servicio; sucesor canónico de la toma. Soporta jerarquía padre-hijo con repartición de consumo (individualizaciones)."@es ;
    skos:note "clave: id"@es .
agua:punto_servicio_id a owl:DatatypeProperty ; rdfs:domain agua:PuntoServicio ; rdfs:range xsd:string ; rdfs:label "id"@es ; rdfs:comment "requerido"@es .
agua:punto_servicio_padre_id a owl:ObjectProperty ; rdfs:domain agua:PuntoServicio ; rdfs:range agua:PuntoServicio ; rdfs:label "padre_id"@es ; rdfs:comment "Derivación padre-hijo; el consumo del padre se reparte por reparticion_consumo"@es .
agua:punto_servicio_sector_id a owl:ObjectProperty ; rdfs:domain agua:PuntoServicio ; rdfs:range agua:SectorHidraulico ; rdfs:label "sector_id"@es ; rdfs:comment "Sector/DMA para balance hídrico"@es .
agua:punto_servicio_cortable a owl:DatatypeProperty ; rdfs:domain agua:PuntoServicio ; rdfs:range xsd:boolean ; rdfs:label "cortable"@es ; rdfs:comment "Si es doméstico, el impacto máximo permitido es restriccion_parcial (LGA 2025, mínimo vital — regla R1)"@es .
agua:punto_servicio_geometria a owl:DatatypeProperty ; rdfs:domain agua:PuntoServicio ; rdfs:range geo:Geometry ; rdfs:label "geometria"@es ; rdfs:comment "Punto GeoJSON; debe caer dentro de la manzana INEGI declarada (regla R4)"@es .

### Clase evento_kardex
agua:EventoKardex a owl:Class ; rdfs:label "Evento del kardex comercial"@es ;
    rdfs:comment "Asiento append-only del ledger por contrato. Fuente única de verdad de cartera, saldos y KPIs."@es ;
    skos:note "clave: id"@es .
agua:evento_kardex_tipo a owl:DatatypeProperty ; rdfs:domain agua:EventoKardex ; rdfs:range xsd:string ; rdfs:label "tipo"@es ;
    rdfs:comment "valores: cargo, pago, ajuste, estimacion, convenio, restriccion, reconexion, corte · corte solo válido en clases no domésticas (regla R1)"@es .
agua:evento_kardex_contrato_id a owl:ObjectProperty ; rdfs:domain agua:EventoKardex ; rdfs:range agua:Contrato ; rdfs:label "contrato_id"@es ; rdfs:comment "requerido"@es .
agua:evento_kardex_tarifa_version a owl:ObjectProperty ; rdfs:domain agua:EventoKardex ; rdfs:range agua:Tarifa ; rdfs:label "tarifa_version"@es ; rdfs:comment "Tarifa y versión exacta con que se calculó el cargo (regla R2, trazabilidad Art. 154)"@es .

### Clase indicador
agua:Indicador a owl:Class ; rdfs:label "Indicador de desempeño"@es ;
    rdfs:comment "Definición versionada de KPI con fórmula y fuente estándar."@es ; skos:note "clave: codigo"@es .
agua:indicador_marco a owl:DatatypeProperty ; rdfs:domain agua:Indicador ; rdfs:range xsd:string ; rdfs:label "marco"@es ;
    rdfs:comment "valores: pigoo, ibnet, iwa_pi, awwa_m36, propio · p. ej. PIGOO IP.14 eficiencia comercial = recaudado/facturado"@es .
```

*(La ontología completa se genera desde `specs/canonical/agua.yaml` con el mismo generador usado para impacto_ambiental; el .ttl no se mantiene a mano.)*

---

## 7. Usos del grafo

1. **RAG con grounding estructural:** el retrieval normativo (doc 09 §2.2) ancla cada chunk a nodos `agua:Normativa`; el agente responde con la cadena `Tarifa → AcuerdoTarifario → Art. 154` en vez de solo texto similar — cita verificable.
2. **Agentes:** el contexto 360° del asistente de atención es una consulta de vecindario del nodo `Contrato` (2-3 saltos), no 15 endpoints; las herramientas del agente son consultas tipadas al grafo.
3. **Búsquedas semánticas:** "contratos comerciales con convenio roto en zonas abastecidas por el acuífero 2201" — imposible en SQL sin joins ad-hoc; un patrón de grafo directo. Embeddings sobre nodos (como `dictamen_vector` en SEDESU) para similitud de quejas/dictámenes.
4. **Recomendaciones:** siguiente mejor acción de cobranza (segmento del score × historial de convenios × restricciones normativas del nodo), trámite sugerido según estado del vecindario del contrato.
5. **Trazabilidad regulatoria:** cada peso facturado navega hasta el acuerdo y artículo que lo autoriza; cada restricción de servicio, hasta la LGA. Auditoría del Consejo/ASF como consulta, no como proyecto.
6. **Calidad de datos como grafo:** las reglas R1-R7 detectan inconsistencias que las FK no ven (geometría fuera de manzana, cadena fiscal incompleta) y alimentan el gate T15.

---

## 8. Implementación por fases

| Fase | Alcance | Tecnología sugerida |
|---|---|---|
| KG-0 | Ontología `agua.ttl` generada del canónico + carga de normatividad y tarifas (nodos pocos y de alto valor) | RDF/Turtle + validación SHACL; consultas en memoria (oxigraph/rdflib) |
| KG-1 | Proyección del canónico completo (contratos, PS, personas, eventos kardex) con sync incremental desde el pipeline | Grafo de propiedades (PostgreSQL+AGE o Neo4j) proyectado desde el store canónico — el RDF queda como capa semántica/validación |
| KG-2 | Embeddings de nodos + índice vectorial unificado con el RAG; herramientas de agente sobre el grafo | pgvector junto al store; API GraphQL/consulta tipada para agentes |

El grafo **nunca es fuente de verdad**: es una proyección materializada del canónico + kardex, reconstruible por completo — coherente con el principio de derivados recalculables del pipeline (doc 08 §4.2).
