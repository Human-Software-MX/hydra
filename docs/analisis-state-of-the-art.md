# Hydra — Gap-Analysis y Roadmap "State of the Art"

> Análisis 2026-07-17. Cruza tres fuentes: inventario exhaustivo del codebase de Hydra, mejores prácticas del SWAN Forum (Smart Water Networks Forum) y benchmark competitivo de CIS de agua (AquaCIS, Open Smartflex, Oracle, SAP, Itineris, Gentrack, VertexOne).
> Objetivo: posicionar a Hydra como reemplazo de AquaCIS en organismos operadores de agua de México y LATAM.

---

## 1. Dónde está Hydra hoy

### Fortalezas reales (capitalizar en el discurso comercial)

| Fortaleza | Evidencia |
|---|---|
| Front-office de contratación muy profundo: solicitud → inspección → cotización → contrato paramétrico (tipos, cláusulas, variables, hitos) | `solicitudes`, `tipos-contratacion`, `procesos-contratacion`, `contratos` (31 módulos NestJS, ~85 modelos Prisma) |
| Padrón normalizado con claves INEGI + Aquasis, domicilios homologados | `domicilios`, `CatalogoLocalidadINEGI.aquasisPobid`, `CatalogoColoniaINEGI.aquasisBarrId` — facilita la **migración desde AquaCIS**, es el rastro directo del incumbente |
| Ciclo lectura → consumo robusto: lotes, rutas, lecturistas, incidencias, validación por rangos, consumo real/promedio/mixto/fijo | `lecturas`, `consumos`, `rutas` |
| Motor tarifario escalonado/fijo/variable con correcciones y actualizaciones | `tarifas.service.ts` (`calcularMonto`) |
| Recaudación y back-office contable: caja, ETL de pagos externos por recaudador, conciliaciones, pólizas SAP/IDOC | `pagos/etl-pagos.service.ts`, `conciliaciones`, `contabilidad` |
| Convenios de pago en parcialidades con anticipos | `convenios` |
| Portal del cliente + trámites digitales (baja, cambio de propietario) | `portal`, `pages/portal/` |
| Stack moderno sin lock-in: React + NestJS + PostgreSQL + Prisma, Docker | Argumento directo contra AquaCIS (Veolia es dueño del software **y** operador competidor) |
| Factibilidades y cuantificación de conexión para desarrolladores | `Factibilidad → Construccion → Toma` — casi ningún CIS global lo trae bien |

### Brechas críticas (bloquean cualquier licitación)

1. **No existe facturación real del consumo periódico.** `prefacturas` es una proyección read-only con `subtotal/total = 0`. El `billing-engine` actual calcula conceptos de **contratación** (alta), no el ciclo mensual consumo→tarifa→factura. Es el hueco en el centro del meter-to-cash.
2. **Timbrado CFDI 4.0 no real.** `timbrados` solo lista; `Timbrado` nace `Pendiente` sin XML, sello, UUID ni PAC. Los catálogos SAT ya integrados son solo la base.
3. **Sin generación de PDF** de recibos/facturas.
4. **Sin procesos batch/cron**: no hay facturación masiva programada, ni generación automática de órdenes por adeudo.
5. **Notificaciones stub** (email/WhatsApp solo hacen `logger.log`).
6. **RBAC sin aplicar**: `@Roles` existe pero tiene 0 usos en controladores; la protección es binaria autenticado/no.
7. **0 tests de backend, sin CI/CD**, sin auditoría global unificada.
8. **Multi-tenancy no real**: parametrizado a CEA Querétaro; sin aislamiento por tenant.

Stubs/mocks declarados: Agora (`AGORA-MOCK-*`), LDAP/Entra ID, descarga CFDI en portal, GIS (solo change-tracking, sin visor de mapas), telemetría (campos sin ingesta).

---

## 2. Marco SWAN aplicado a Hydra

El SWAN Layers Model (5 capas: activos físicos, sensado, comunicación, gestión/visualización de datos, fusión/análisis) sitúa a un CIS en las capas 4-5. **La diferencia entre un CIS legacy (AquaCIS) y uno state of the art está en la capa 5**: analítica sobre datos de consumo y facturación.

Prácticas SWAN directamente aplicables:

| Práctica | Qué implica en Hydra |
|---|---|
| **MDM con VEE** (Validation, Estimation, Editing) | Extender el pipeline `Lectura → Consumo → Recibo` con estados de validación, motivo de estimación y edición trazable. Reglas: intervalos faltantes, medidor pegado, spike, consumo fuera de rango vs promedio 12 meses, lectura fuera de secuencia. Motor de reglas configurable por organismo (el tandeo distorsiona patrones). |
| **Diseño AMI-ready** | `Lectura` debe aceptar tanto lectura mensual manual como series de intervalos horarios. Identificador de canal/registro por medidor, ingesta head-end por API. Formato de interoperabilidad candidato: OGC SensorThings API. LATAM ya va ahí: SABESP desplegará 4.4M medidores inteligentes al 2029. |
| **Balance hídrico IWA/AWWA M36 + NRW** | México promedia ~40% de agua no contabilizada. Módulo de balance por distrito/DMA: consumo autorizado facturado (ya lo tiene Hydra) + volumen producido por sector → pérdidas reales vs aparentes **valorizadas en pesos**. Conecta directo con reportes PIGOO. |
| **Analítica de pérdidas aparentes** | Submedición = 5-10% del agua vendida (más con tinacos/cisternas, ubicuos en México). Ranking de medidores candidatos a reemplazo (deriva de consumo, edad, volumen acumulado) con caso de negocio automático. Detección de consumo no autorizado: consumo cero prolongado en toma activa, cruces padrón vs GIS. |
| **Notificaciones proactivas de fuga** | Diseño opt-out, multicanal, con "siguiente paso" incluido. Reducen 29-50% el volumen de fuga del lado cliente. WhatsApp es el canal dominante en México. |
| **Medidor como activo con ciclo de vida** | Clase metrológica, caudal nominal, curva de degradación — no solo catálogo. |
| **Gemelo comercial** | El CIS como fuente autoritativa de demanda real georreferenciada por DMA para modelos hidráulicos (EPANET, digital twins). La normalización INEGI de Hydra es la base; falta la capa geoespacial. |
| **Estándares** | ISO 24510/24512 (KPIs de servicio desde la perspectiva del usuario), OGC WaterML 2.0 (intercambio con CONAGUA/CEA). |

Recomendación organizacional: afiliarse a la **SWAN Americas Alliance** (webinars en español; JUMAPA Celaya ya participa — es exactamente el mercado objetivo de Hydra) y usar el **SWAN Smart Metering Playbook** (2025-2026, con Water Research Foundation) como lenguaje común con prospectos.

---

## 3. Benchmark competitivo

### AquaCIS (el incumbente)

- Desarrollado por **Grupo Agbar** (no Aqualia), comercializado vía Aqualogy; hoy en el portafolio de **Veolia** tras las adquisiciones Suez→Veolia. Desplegado en ~800 municipios, 5-7M clientes.
- En México: Aguas de Saltillo (empresa mixta con Veolia — el caso insignia comparte dueño con el software) y **CEA Querétaro** (documentos públicos de la CEA lo referencian como sistema del padrón).
- Fortalezas: ciclo comercial completo out-of-the-box, alta parametrización, GIS/telelectura/órdenes integrados, respaldo de un gigante.
- Debilidades: arquitectura origen 2009 pre-cloud (la versión "Cloud" es hosting de un monolito), sin API pública documentada, localización mexicana como adaptación (nació para España), opacidad de costos, dependencia de consultoría del proveedor, y el **conflicto estructural**: el dueño del software es también operador privado competidor.

### El rival a vigilar: Open Smartflex (Open International, Colombia)

Más peligroso que AquaCIS a mediano plazo: cloud, LATAM-nativo, holístico (CIS + MDM + MWM cuadrillas + CSS autoservicio), event-driven, IA, 45M+ usuarios finales, 18 países, reconocido por Verdantix y Gartner. Entiende tarifas sociales, subsidios y morosidad LATAM.

**Defensa de Hydra**: profundidad mexicana (CFDI, mínimo vital, PIGOO, OXXO/CoDi, tandeos) + TCO bajo + agilidad de producto.

### Qué define el "state of the art" CIS 2025-2026

Cloud-native SaaS multitenant · API-first/event-driven (eventos "service-to-cash" en vez de batch mensual) · MDM integrado con VEE · portal/app de autoservicio · omnicanalidad (WhatsApp, chatbot, call center sobre el mismo expediente) · IA aplicada (anomalías de consumo, propensity-to-pay, chatbot generativo) · low-code para nuevos productos tarifarios · app móvil de cuadrillas offline-first.

### La ventana regulatoria: Ley General de Aguas (DOF 11-dic-2025)

**Prohíbe la suspensión total del suministro por falta de pago** — obliga a garantizar un mínimo vital (referencia OMS 50-100 l/persona/día). Esto **invalida la parametrización de cobranza "adeudo → corte" de todos los sistemas legacy**, AquaCIS incluido. Reglamentos secundarios en curso (2026).

Hydra puede ser **el primer CIS diseñado nativamente para la LGA**: la restricción de flujo a mínimo vital como estado de primera clase de la toma, con orden de trabajo, dispositivo restrictor, evidencia probatoria y reversa automática al regularizar el pago. `PuntoServicio.cortable` y `CatalogoTipoCorte` ya existen como base.

---

## 4. Roadmap priorizado

### P0 — Cerrar el núcleo del meter-to-cash (sin esto no hay producto)

1. **Motor de facturación de consumo periódico**: consumos confirmados + tarifa vigente por bloques → factura/recibo con montos reales. Facturación masiva por periodo y ruta con pre-facturación revisable (la página ya existe; falta el motor).
2. **Timbrado CFDI 4.0 real**: integración PAC, XML Anexo 20, guía DPA para derechos de agua, CFDI global por periodo, complementos de pago PPD/PUE, validación RFC/CP.
3. **Generación de PDF** de recibos y facturas.
4. **Scheduler/batch** (`@nestjs/schedule` o colas BullMQ): facturación masiva, generación de órdenes por adeudo, vencimientos.
5. **Notificaciones reales**: implementar el servicio stub con proveedor de email + **WhatsApp Business API** (recibo, vencimiento, aviso de restricción — Monterrey/AYDÉ, Puebla/Fluvio, Oaxaca y Hidalgo ya educaron al usuario).
6. **Aplicar RBAC**: usar los `@Roles` ya construidos en todos los controladores; scoping consistente por `administracionIds`/`zonaIds`.
7. **Base de calidad**: CI (GitHub Actions: lint + tsc + tests), tests del motor tarifario y del futuro motor de facturación (es el código que mueve dinero), filtro global de excepciones y logging estructurado.

### P1 — Paridad de licitación

8. **Cobranza avanzada**: antigüedad de saldos, segmentación de cartera, campañas masivas de condonación de recargos con vigencia (amnistías políticas recurrentes), crítica de refacturación/ajustes con workflow.
9. **Motor de mínimo vital (LGA 2025)**: restricción de flujo como estado del servicio con trazabilidad probatoria — diferenciador regulatorio único, implementar los reglamentos secundarios en semanas.
10. **Pagos a la mexicana**: referencias únicas por recibo (línea de captura), SPEI/CoDi/DiMo, corresponsalías OXXO/retail vía agregadores, webhook de aplicación inmediata con disparo de reconexión automática.
11. **App móvil de campo** (lecturista + cuadrilla): offline-first, GPS, evidencia fotográfica — las rutas y órdenes ya existen en el modelo.
12. **Portal de autoservicio completo**: consumo histórico, pago en línea, descarga CFDI (hoy stub), reporte de fugas. API pública OpenAPI/Swagger + webhooks de eventos (lectura capturada, recibo emitido, pago aplicado) para alimentar apps ciudadanas existentes.
13. **Auditoría global unificada** (quién/qué/cuándo a nivel sistema).

### P2 — Diferenciadores México/SWAN (ganar contra el incumbente)

14. **Dashboard PIGOO**: cálculo automático y export de eficiencia física/comercial, micromedición, consumo per cápita. Nadie lo ofrece; a los directores generales les importa políticamente.
15. **Pipeline VEE auditable** sobre lecturas + cola de excepciones comerciales (anomalías: cero prolongado, spike, medidor estático, deriva descendente).
16. **Balance hídrico M36 por distrito/DMA** con pérdidas aparentes valorizadas en pesos.
17. **Analítica de submedición**: ranking de reemplazo de medidores con caso de negocio (volumen recuperable × tarifa).
18. **GIS visual**: padrón/tomas sobre mapa (la normalización INEGI ya está; falta capa geoespacial — PostGIS es el camino natural).
19. **Multi-tenancy real** para vender como SaaS a los ~2,400 organismos operadores medianos/pequeños — el segmento que Oracle/SAP no pueden costear y donde compite Open Smartflex.

### P3 — Capa 5 SWAN (narrativa state of the art)

20. **IA práctica**: detección de fugas/anomalías sobre histórico, score de propensión al pago para priorizar cartera, chatbot generativo sobre la base de conocimiento del organismo.
21. **MDM ligero AMI-ready**: ingesta de series de intervalo, integración head-end, OGC SensorThings (los organismos migrarán a telelectura por zonas, no big-bang).
22. **Gemelo comercial**: API de demanda agregada por DMA/periodo para modelos hidráulicos; alineación con la SWAN Digital Twin Readiness Guide y su herramienta de madurez.
23. **KPIs ISO 24510/24512** y reportes de transparencia (LGTAIP) generados desde el sistema.

---

## 5. Posicionamiento comercial (resumen para pitch)

1. **"El primer CIS diseñado para la Ley General de Aguas"** — mínimo vital nativo; los legacy quedaron desalineados en diciembre 2025.
2. **Cumplimiento mexicano como core, no como parche** — CFDI 4.0, PIGOO, OXXO/SPEI/CoDi, tandeos, subsidios, amnistías.
3. **Sin lock-in** — PostgreSQL, esquema documentado, API abierta; "tu sistema comercial no debería ser propiedad de tu potencial concesionario" (vs Veolia/AquaCIS).
4. **WhatsApp-first** en notificación y autoservicio.
5. **Alineado a SWAN** — VEE, balance M36, AMI-ready, digital-twin-ready; membresía en SWAN Americas Alliance como validación.
6. **Migración desde AquaCIS de bajo riesgo** — los catálogos Aquasis ya están mapeados en el modelo de datos de Hydra.

---

## 6. Fuentes principales

- SWAN Forum: [Layers Model](https://swan-forum.com/smart-water-network/) · [Smart Metering Playbook](https://swan-forum.com/publications/swan-smart-metering-playbook/) · [Digital Twin Readiness Guide](https://swan-forum.com/publications/swan-digital-twin-readiness-guide/) · [Webinar LATAM smart metering (español)](https://swan-forum.com/publications/swan-americas-webinar-unpacking-the-latam-smart-metering-experience-in-spanish/)
- NRW/MDM: [AWWA M36 / Water Audit](https://allianceforwaterefficiency.org/resource/water-audit/) · [IWA DMA Guidance 2024](https://www.leakssuitelibrary.com/wp-content/uploads/2026/01/IWA-DMA-Guidance-Notes-2024.pdf) · [Oracle Utilities MDM/VEE](https://docs.oracle.com/en/industries/energy-water/billing-cloud-service/23a/bcs-user-guides/Topics/X1_C2MOverivew_MDM_Overview.html) · [AWE — Proactive Leak Notification](https://allianceforwaterefficiency.org/wp-content/uploads/2023/03/An-Evaluation-of-AMI-Enabled-Proactive-Leak-Notification-Programs.pdf)
- AquaCIS: [iAgua — AquaCIS](https://www.iagua.es/noticias/espana/aqualogy/16/02/23/aquacis-software-gestion-comercial-y-tecnica-operadoras-agua) · [CEA Querétaro APSCO 2025 (referencia a AquaCIS)](https://www.ceaqueretaro.gob.mx/wp-content/uploads/2025/09/APSCO.pdf) · [Veolia digitalización](https://www.veolia.es/soluciones/agua/digitalizacion-procesos-agua)
- Competencia: [Open Smartflex](https://www.openintl.com/) · [Itineris UMAX](https://itineris.net/) · [Gentrack g2](https://gentrack.com/) · [Gartner Market Guide CIS](https://www.gartner.com/en/documents/5487595)
- Regulación MX: [Ley General de Aguas (DOF 11-dic-2025)](https://www.diputados.gob.mx/LeyesBiblio/pdf/LGAg.pdf) · [Guía SAT CFDI DPA](http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/GuiallenadoCFDI_DPA03012022.pdf) · [PIGOO IMTA](https://pigoo.imta.gob.mx/home) · [IMTA — Sistema comercial de organismos operadores](https://www.imta.gob.mx/biblioteca/libros_html/sistema-comercial/Libro-Sistema-Comercial.pdf)
