# Plan — Tarifas: histórico (Kardex), clasificación y configuración fiscal (2026-09-03)

Ticket: evolucionar `/app/tarifas` con histórico completo, actualizaciones porcentuales
(individual y masiva), clasificación por tipo de servicio y configuración fiscal (IVA).

## Hallazgos de la investigación
- `Tarifa` ya existe (vigenciaDesde/Hasta, ivaPct, administracionId, version sin uso) con 6 filas demo
  sembradas (`seed-catalogos.ts`). El catálogo real (Excel Feb-2026) vive solo en
  `frontend/src/data/tarifas-agua.json` (motor offline del wizard).
- Facturación (`FacturacionService.tarifasVigentesPorServicio`) resuelve por administración + vigencia,
  NO por clase tarifaria (DOMÉSTICA vs COMERCIAL). IVA por línea desde `Tarifa.ivaPct`; CFDI usa
  `objetoImp` 01/02 según ivaPct. `ActualizacionTarifaria.aplicar` solo cambia estado.
- Excel: la TASA es constante por NOMBRE de tarifa (clase) en las 5 hojas → la regla fiscal es
  propiedad de la clase/categoría, no de la fila de precio. DOMÉSTIC* (7 variantes) = 0%;
  COMERCIAL/INDUSTRIAL/BENEFICENCIA/PÚBLICO*/GANADERO/GENERAL/PODER EJECUTIVO/IAP = 16%;
  excepciones nominales: HIDRANTE 0, SANTA MARIA MAGDALENA 0, COMUNIDAD LA LIRA 0, COMUNIDAD SEBASTIANES 16.
- Ontología existente del cliente: SIGE `tipo_punto_servicio` (tcttpsid) en
  `prisma/data/catalogos-tipos-contratacion-sige.json` — coincide 1:1 con las clases del Excel.
  Hoy no se persiste en `TipoContratacion` (solo embebido en `nombre`).
- `CatalogoCategoria` es condominial (CONDOM_*), no sirve para tarifas. `AuditoriaEvento` es log HTTP
  genérico (no reconstruye valores). `HistoricoContrato` es por campo de contrato.

## Decisiones de diseño
- Dos niveles: `CategoriaTarifa` (clasificación fiscal/principal: DOMESTICA, COMERCIAL, INDUSTRIAL,
  PUBLICO, BENEFICENCIA, GANADERO, GENERAL, ESPECIAL) con `ivaPct` por defecto, y `ClaseTarifa`
  (variante comercial: DOMÉSTICA MEDIO, DOMÉSTICO ALTO, …) con `ivaPct` opcional (override) y
  `sigeTpsId` (enlace a la ontología SIGE). IVA efectivo = clase.ivaPct ?? categoria.ivaPct.
- Versionado inmutable: cada cambio crea una NUEVA fila `Tarifa` (mismo `codigo`, `version+1`,
  `vigenciaDesde` nueva) y cierra la anterior (`vigenciaHasta`). Facturación ya filtra por vigencia,
  así re-facturar un periodo pasado usa la versión vigente entonces.
- Kardex: `TarifaMovimiento` (ledger) con valores anteriores/nuevos (snapshot JSON), tipo, porcentaje,
  motivo, usuario, lote (`ActualizacionTarifaria`). `Tarifa.ivaPct` sigue siendo el valor aplicado
  (snapshot) que consume facturación; el configurador fiscal lo propaga con movimientos CAMBIO_FISCAL.
- Nuevo `tipoCalculo`: `tabla` (0..200 m³ acumulado en `precios` JSON; >200 = cuotaFija + precioUnitario×m³)
  y `lineal` (cuotaFija + precioUnitario×cantidad). Redondeo de precios: 4 decimales; importes: 2 (`redondear`).
- `TipoContratacion.claseTarifaId` enlaza contrato → clase; facturación filtra por clase de la
  contratación (fallback a tarifas sin clase).
- Migración de datos: Excel → `prisma/data/tarifas-periodicas.json` (script) → seed idempotente
  (solo crea linajes inexistentes; nunca sobrescribe versiones). Filas demo previas se conservan.

## Tareas
- [x] T1 Schema Prisma + migración SQL (categorías, clases, movimientos, columnas Tarifa incl. `valor_referencia`, FK tipos_contratacion)
- [x] T2 Script export Excel→JSON + seed idempotente (421 tarifas, 127 correcciones, 172 tipos enlazados)
- [x] T3 Backend: TarifaVersionesService (versionado, kardex, % individual, preview + masiva transaccional,
      configurador fiscal), DTOs validados, facturación por clase + tabla/lineal, CFDI traslados por tasa
- [x] T4 Frontend: página Tarifas (vigentes con filtros, actualizar, masiva con preview, kardex, fiscal, simulador)
- [x] T5 Verificación: prisma validate, typecheck back/front, jest 94, verify:* OK, build front, migración + seed
      sobre Postgres temporal (replay limpio ×2), e2e contra BD real (versionado, masiva, fiscal, time-travel,
      409 concurrente, exclusión de programadas), smoke UI en navegador
- [x] T6 Docs (motor-tarifas.md §3, tarifas-kardex-api.md) + tasks/bugs.md (2 bugs preexistentes) + commit

## Revisión (2026-09-03)
- Code review independiente (opus) → 14 hallazgos; corregidos: P2002→409, bypass `null` en DTOs, PATCH /tarifas/:id
  solo metadatos, /tarifas/calcular por admin+clase, listados sin `precios` (+ columna `valor_referencia`),
  exclusión de versiones programadas en masivos, `buscar` no heredado por el masivo, decimales/a11y/columna acciones.
- Pendientes de decisión de negocio (documentados en docs/motor-tarifas.md «Supuestos»): semántica de la fila
  «> 200 m³» (salto en 200→201), IVA 0 % doméstico como tasa 0 vs no objeto en CFDI, servicios periódicos
  adicionales en `SERVICIOS_FACTURABLES`, `TZ` del despliegue.

## Riesgos
- Replay limpio de migraciones tiene drift previo (bugs.md) → validar migración nueva sobre BD temporal.
- Frontend `lib/tarifas.ts` (JSON estático) sigue siendo la fuente del wizard: fuera de alcance migrarlo.

---

# Roadmap "State of the Art" — ejecución

Base: `docs/analisis-state-of-the-art.md`. Rama: `feat/state-of-the-art-billing`.
Se ejecuta por iteraciones autoprogramadas (/loop). Cada iteración deja código compilable y verificado.

## Iteración 1 — Motor de facturación de consumo periódico (P0 #1) ✅ COMPLETA

- [x] Calculador puro `billing-calculator.ts` (escalonado, variable, fijo, IVA por línea, multi-servicio)
- [x] `FacturacionService`: tarifas vigentes por servicio+administración, cálculo por consumo, arrastre de saldo vencido
- [x] Facturación individual y masiva por periodo (preview dry-run + ejecutar)
- [x] `FacturacionController` con RBAC aplicado (`@Roles`) — primer uso real de RBAC en el proyecto
- [x] `prefacturas` conectado al motor real (antes devolvía total=0)
- [x] Script de verificación aritmética `scripts/verify-billing.ts`
- [x] Verificar: typecheck backend (`tsc --noEmit` OK) + verify-billing (11/11 aserciones OK)
- [x] Frontend: panel "Facturación del periodo" en PreFacturacion (preview + ejecutar) — typecheck OK
- [x] Commit

## Próximas iteraciones (pendientes)

- [x] **It. 2 — CFDI 4.0** ✅: constructor XML CFDI 4.0 puro (Emisor/Receptor/Conceptos/Impuestos, clave 83101509, MTQ/E48, público general), abstracción PAC (adapter) con proveedor simulado + factory por env, `TimbradoService` (timbrar individual + masivo por periodo, reconciliación de importes, descarga XML), columnas fiscales en `Timbrado` + migración, RBAC en endpoints, panel frontend en TimbradoPage. Verificado: verify-cfdi 13/13 + typecheck OK.
- [x] **It. 3 — Recibo imprimible + notificaciones reales** ✅: arquitectura de canales (EmailChannel/WhatsAppChannel) con adapters consola (default) + HTTP gateway por env; factory; `NotificacionesService` real con bitácora `NotificacionLog` (+migración) y plantillas (recibo emitido, aviso vencimiento, folio trámite); `NotificacionesController` (prueba, notificar recibo/vencimiento, logs) con RBAC; generador de recibo imprimible HTML server-side (`recibo-html.ts`) + endpoint `/recibos/:id/html`; frontend: api/notificaciones.ts + botones "Descargar/Imprimir" y "Notificar" en Recibos. Verificado: verify-recibo-html 7/7 + typecheck OK.
- [x] **It. 4 — Scheduler/batch** ✅: `@nestjs/schedule` + `BatchModule`; jobs cron configurables por env con master switch `HYDRA_JOBS_ENABLED` (default off): facturación mensual del periodo anterior (día 1 02:00), timbrado masivo (día 1 04:00), avisos de vencimiento diarios (09:00, N días de anticipación, dedup 7 días vía NotificacionLog, omite pagados); bitácora en `LogProceso` (tipo batch, Iniciado→Completado/Error, duración/registros/errores); `BatchController` para disparo manual + consulta de ejecuciones (RBAC); envs documentadas en `.env.example`. Typecheck OK.
- [x] **It. 5 — Mínimo vital (LGA 2025)** ✅: modelo `RestriccionServicio` (+migración) con ciclo candidato→programada→aplicada→revertida/cancelada; candidatos con exclusiones duras (convenio activo, bloqueo jurídico, `PuntoServicio.cortable=false`); programar crea Orden de trabajo + **aviso previo obligatorio** al usuario (email/WhatsApp, tipo `aviso_restriccion`); aplicar registra dispositivo restrictor + evidencia probatoria; reversa automática diaria (cron `JOB_REVERSAS_CRON`) al liquidar adeudo o firmar convenio; litros mínimos garantizados (default 100 l/p/d OMS). RBAC en todos los endpoints. Typecheck OK.
- [x] **It. 6 — Indicadores PIGOO** ✅: `IndicadoresModule` con cálculo automático por periodo (padrón, micromedición %, volumen facturado vs producido → eficiencia física, facturado vs recaudado → eficiencia comercial, eficiencia global, cartera vencida real, usuarios con adeudo, rezago %, restricciones/convenios/quejas); modelo `VolumenProducido` (+migración) para capturar macromedición (upsert manual por NULL-safe); serie histórica (máx 24 periodos, cruce de año verificado) y **export CSV** para reporte PIGOO/CONAGUA. RBAC. Typecheck OK.
- [x] **It. 7 — Pipeline VEE** ✅: motor de reglas puro (`vee-rules.ts`: lectura_negativa, fuera_rango_zona, spike, caida_drastica/submedición, consumo_cero_prolongado, estimaciones_encadenadas; umbrales por env); cola de excepciones `ExcepcionLectura` (+migración, unique lectura+regla = idempotente); `VeeService`: análisis por periodo con historial de 12 periodos, resolución aceptar/descartar/**corregir** (Editing con valor original preservado en `datosRaw.veeOriginal`, estado "Corregida", guard de consumo negativo); resumen por regla/severidad; RBAC. Verificado: verify-vee 11/11 + typecheck OK.
- [x] **It. 8 — Balance hídrico M36 / NRW** ✅: calculador puro `m36-balance.ts` con taxonomía IWA/AWWA completa (consumo autorizado facturado medido/no medido/autorizado no facturado; pérdidas aparentes = submedición % + no autorizado %, pérdidas reales = resto); valorización estándar (aparentes a tarifa media, reales a costo de producción); indicadores NRW %, eficiencia física, tarifa media, pérdidas en pesos; advertencias por macromedición inconsistente y acotamiento de estimaciones; `BalanceService` alimentado por VolumenProducido + consumos por tipo + timbrados, filtrable por administración; endpoint `GET /balance-hidrico` con parámetros de estimación por query. Verificado: verify-balance 15/15 + typecheck OK.
- [x] **It. 9 — CI + guards** ✅: workflow `.github/workflows/ci.yml` (backend: typecheck + `npm run verify` con los 5 suites de motores; frontend: typecheck + vitest + build); scripts npm `verify:*` en backend; `JwtAuthGuard` añadido a los 4 controladores que estaban sin autenticación (consumos, medidores, rutas, prefacturas). Verificado: 5/5 suites TODO OK, frontend 9/9 tests.

## Ola 2 — SWAN Proactiva (2026-07-18)

Brechas cerradas contra las best practices SWAN/IWA/AWWA (docs/plan-accion/02 y 11,
Fase 2 "Inteligencia"). SWAN publicó su estrategia 2026-2030 ("de la ambición digital
a la implementación práctica") y el Smart Metering Playbook global — ambas líneas
respaldan estas piezas.

- [x] **ILI/UARL + bandas Banco Mundial + data grading AWWA** (balance hídrico)
  - `calcularILI` puro en `m36-balance.ts`: UARL = (18·Lm + 0.8·Nc + 25·Lp)·P (IWA
    Water Loss Task Force), banda A-D países en desarrollo, advertencias cuando la
    fórmula pierde validez (<3,000 tomas, <20 tomas/km, presión <25 m.c.a.)
  - Data grading simplificado estilo AWWA Free Water Audit Software: grado 1-10 por
    componente (macromedición, micromedición, pérdidas aparentes, datos de red),
    puntaje ponderado 0-100, nivel I-V y recomendaciones accionables
  - `GET /balance-hidrico` acepta `longitudRedKm`, `numeroTomas`, `presionMediaM`,
    `longitudAcometidasKm`, `gradoMacromedicion`; días del periodo derivados del mes
  - Verificado: verify-balance 28/28
- [x] **Score de propensión al pago + segmentación predictiva** (cobranza)
  - `propension-pago.ts` puro: modelo de puntos transparente (no caja negra) sobre el
    libro de partida abierta — puntualidad histórica, retraso promedio, tendencia
    (últimos 6 vs previos), mora vigente, convenios activos/cancelados/completados
  - 5 segmentos con acción recomendada: PAGADOR_CONFIABLE → recordatorio digital …
    RIESGO_CRITICO → restricción LGA/jurídico
  - `PropensionService` batcheado (sin N+1): `GET /cartera/segmentacion` (resumen por
    segmento + top contratos) y `GET /cartera/contratos/:id/propension` (desglose de
    factores por contrato)
  - Verificado: verify-propension 19/19
- [x] **Ranking de reemplazo de medidores** (Smart Metering Playbook / AWWA M6)
  - `reemplazo-scorer.ts` puro: excepciones VEE caida_drastica (submedición) y
    consumo_cero_prolongado (medidor parado), % lecturas estimadas, edad vs vida útil
    (10 años), ingreso en riesgo por tamaño de consumo → score 0-100 + razones
  - `GET /medidores/ranking-reemplazo` con ventana de 12 periodos, filtros por
    zona/administración/prioridad y resumen critica/alta/media/baja
  - Verificado: verify-reemplazo 14/14
- [x] Cadena `npm run verify` ampliada a 7 suites (CI las corre todas)

## Ola 3 — Cierre de brechas del análisis P0-P3 (2026-07-18)

Todo lo implementable en código del roadmap docs/analisis-state-of-the-art.md
que seguía abierto (sin credenciales externas ni datos de la CEA):

- [x] **RBAC granular (P0.6)**: 13 controladores de dinero/estado contractual
  (caja, pagos, pagos-externos, recibos, prefacturas, conciliaciones,
  contabilidad, convenios, contratos, solicitudes, ordenes, lecturas,
  medidores) con `RolesGuard` + `@Roles` por endpoint: GET → 4 roles,
  mutación diaria → SUPER_ADMIN/ADMIN/OPERADOR, destructivas → SUPER_ADMIN/ADMIN
- [x] **Auditoría global unificada (P1.13)**: `AuditoriaEvento` (+migración
  `20260718000000_auditoria_webhooks`) + `AuditoriaInterceptor` global
  (APP_INTERCEPTOR): registra POST/PATCH/PUT/DELETE con usuario JWT, ruta,
  entidad, status, duración, ip y body sanitizado (redacta password/token/CSD,
  trunca a 2k); asíncrono, jamás bloquea la respuesta. `GET /auditoria` (ADMIN)
- [x] **Webhooks de eventos (P1.12)**: `WebhookSuscripcion`/`WebhookEntrega`,
  firma HMAC-SHA256 (`X-Hydra-Signature`), reintentos cron (máx 5), CRUD +
  probar + entregas en `/webhooks/*`. Emisión fire-and-forget conectada a:
  pago aplicado (cartera), recibo emitido (facturación), lectura capturada
  (lotes). Un webhook caído jamás afecta el flujo de negocio
- [x] **Forecasting facturación/recaudación/consumo (P3.20, SWAN F2)**:
  `forecast.ts` puro — Holt-Winters aditivo estacionalidad 12 (≥24 meses,
  inicialización destendida verificada contra señal exacta), naive estacional
  (≥13), promedio móvil (<13); MAPE in-sample; huecos rellenados con
  advertencia. `GET /indicadores/forecast?metrica=facturado|recaudado|consumo`.
  Verificado: verify-forecast 16/16
- [x] **Gemelo comercial (P3.22)**: `GET /gemelo-comercial/demanda` y
  `/demanda/serie` — demanda agregada por zona/administración en m³/día y L/s
  con tomas y dotación por toma; la interfaz comercial→modelo hidráulico
  (EPANET/WaterGEMS) de la SWAN Digital Twin Readiness Guide
- [x] **Caso de negocio en ranking de medidores (P2.17 completo)**:
  `calcularCasoNegocio` — volumen recuperable anual × tarifa media (pérdida
  aparente M36): parado 50%, caída drástica 25%, degradación 0.5%/año tras
  vida útil (factor máximo, no suma); ingreso recuperable por medidor y por
  prioridad en el resumen. Verificado: verify-reemplazo 20/20
- [x] Cadena `npm run verify` ampliada a 8 suites

**Fuera de alcance de código puro (requieren infraestructura/decisión CEA):**
multi-tenancy SaaS (P2.19), GIS visual PostGIS (P2.18), app móvil de campo
(P1.11), chatbot RAG (P3.20c), PAC real (credenciales), gateway WhatsApp
(cuenta Business API), OGC SensorThings (P3.21b).

**Acción humana pendiente**: aplicar migración `20260718000000_auditoria_webhooks`
en el servidor (`npx prisma migrate deploy`).

## Ola 4 — GIS visual + clima operativo con herramientas gratuitas (2026-07-18)

Cerrada la brecha P2.18 (GIS visual) y agregada inteligencia meteorológica,
todo con servicios/librerías 100% gratuitos sobre la infraestructura actual:

- [x] **GIS visual sin costo** (P2.18)
  - Backend: `GET /gis/padron.geojson` — padrón como FeatureCollection desde
    `PuntoServicio.gpsLat/gpsLng` (fallback `Domicilio.gpsLat/gpsLng`, ya
    existían en el modelo — sin migración) con propiedades para tematizar:
    estado del servicio y cartera (categoría/saldo vencido/días mora)
  - `GET /gis/zonas/centroides` — centroide del padrón por zona (insumo del
    mapa y del clima por zona)
  - Frontend: página **Mapa operativo** (`/app/mapa`) con **Leaflet +
    react-leaflet** (MIT) y teselas de **OpenStreetMap** (gratuitas): capas
    cartera/estado, popups por contrato, leyenda, panel de riesgos climáticos
  - **Upgrade opcional a PostGIS** (cuando se necesiten consultas espaciales
    server-side: buffers, sectores, "contratos afectados por cierre de
    válvula"): cambiar imagen Docker `postgres` → `postgis/postgis`,
    `CREATE EXTENSION postgis`, columna `geography(Point)` + índice GIST.
    Para pintar y tematizar el padrón NO hace falta — el modelo actual basta
- [x] **Clima operativo — anticipar incidencias** (SWAN Proactiva)
  - Proveedores gratuitos: **Open-Meteo** (default, sin API key, 16 días) y
    **SMN/CONAGUA** (web service oficial `method=1` por municipio, gzip;
    `CLIMA_PROVIDER=smn` con caída controlada a Open-Meteo si falla)
  - Motor de reglas puro `clima-riesgos.ts`: lluvia fuerte (≥30mm) /
    torrencial (≥70mm) → protocolo de tormenta y desazolve; ola de calor
    (≥34°C ≥3 días consecutivos) → tandeo preventivo y pipas; helada (≤0°C) →
    proteger medidores y cuadrilla de fugas; viento (≥60 km/h rachas) →
    plantas de emergencia en pozos; estiaje (horizonte ≥14 días seco) →
    balance por fuente y reparación acelerada de fugas. Umbrales por parámetro
  - `GET /clima/pronostico` (coordenada o sede) y `GET /clima/riesgos`
    (por zona usando centroides del padrón); cache 1h para no golpear
    servicios gratuitos
  - Verificado: verify-clima 16/16 (consecutividad de ola de calor, no dobles
    conteos de lluvia, umbrales custom, datos nulos sin falsos positivos)
- [x] Cadena `npm run verify` ampliada a 9 suites

**Fuentes CONAGUA/nacionales adicionales documentadas para fases futuras:**
- SMN web services (pronóstico municipio/hora): https://smn.conagua.gob.mx/es/web-service-api
- Monitor de Sequía de México (quincenal, shapefiles/CSV): https://smn.conagua.gob.mx/es/climatologia/monitor-de-sequia/monitor-de-sequia-en-mexico
- SINA — Sistema Nacional de Información del Agua (presas, acuíferos, cuencas): https://sinav30.conagua.gob.mx
- CLICOM/climatología histórica (estaciones): para calibrar umbrales locales

## Ola 5 — Sequía, uplift A/B, portal, PostGIS espacial y multi-tenancy (2026-07-19)

- [x] **Monitor de Sequía CONAGUA** (`RegistroSequia` + migración)
  - Ingesta idempotente del corte quincenal MSM: JSON o CSV simple
    (`cve_inegi,municipio,estado,categoria`) vía `POST /clima/sequia/ingesta`,
    o CSV remoto (`CLIMA_SEQUIA_URL`) vía `/ingesta-remota`
  - `escalarPorSequia` (puro): la sequía estructural escala el estiaje del
    pronóstico — D1 sube a alta, D3+ a crítica; D2+ sin estiaje pronosticado
    agrega la alerta igualmente. `GET /clima/sequia` (resumen, distribución,
    municipios D2+); `GET /clima/riesgos` ahora incluye contexto de sequía
  - Verificado: verify-clima 24/24
- [x] **Uplift A/B en campañas de cobranza** (`grupoControlPct` + `esControl`)
  - Asignación determinística por hash FNV-1a campaña+contrato (reproducible,
    auditable); el grupo control se registra como acción `control` omitida y
    NO se gestiona
  - `GET /cartera/campanas/:id/uplift?ventanaDias=`: tasa de pago y
    recuperación tratamiento vs control, uplift en pp, ingreso incremental
    estimado, advertencias por muestras chicas — el efecto causal de la
    campaña, no la propensión natural. Verificado: verify-propension 33/33
- [x] **Portal ciudadano completo** (delegado a subagente)
  - Descarga CFDI XML real (antes stub `_stub: true`): valida propiedad del
    timbrado antes de entregar; frontend con fetch+blob (no window.open)
  - Gráfica de consumo 12 periodos (recharts) con estimados vs reales
  - Reporte de fugas → `QuejaAclaracion` (categoría Fuga, canal Portal,
    prioridad Alta) con folio de confirmación y "Mis reportes" con estado
- [x] **Consultas espaciales PostGIS con fallback JS** (P2.18 fase 2)
  - `GET /gis/afectados?lat&lng&radioM` y `POST /gis/consulta-espacial`
    (polígono GeoJSON): PostGIS (`ST_DistanceSphere`/`ST_Contains`) cuando la
    extensión existe (sondeo cacheado), fallback haversine/ray-casting en JS
    cuando no — funciona en ambos mundos
  - `POST /gis/cierres-valvula`: contratos afectados por radio o polígono +
    aviso de interrupción opcional por email/WhatsApp (`aviso_interrupcion`)
  - docker-compose → `postgis/postgis:15-3.4-alpine`; migración habilita la
    extensión con DO/EXCEPTION (no falla en servidores sin PostGIS)
  - Verificado: verify-espacial 15/15
- [x] **Multi-tenancy SaaS fase 1** (P2.19, tenant-per-database)
  - Modelo `Organismo` (registro con slug, dbUrl, config) en la base default
  - `TenancyMiddleware`: resuelve `X-Organismo` (o subdominio con
    `HYDRA_TENANCY_SUBDOMAIN=true`), cache 60s, 404 organismo inexistente,
    503 sin base configurada; ejecuta el request en AsyncLocalStorage
  - `PrismaService` proxy multi-cliente: cada acceso delega al PrismaClient
    del tenant activo (lazy, cacheado) — CERO cambios en los ~40 servicios;
    sin contexto se comporta idéntico a antes (verificado con smoke test
    runtime). CRUD `/organismos` (SUPER_ADMIN) + `GET /organismos/actual`
  - **Limitaciones fase 1**: cron jobs corren solo en la base default;
    secreto JWT compartido; migraciones se aplican por tenant
- [x] Cadena `npm run verify` ampliada a 10 suites

## Ola 6 — Alertamiento meteorológico oficial multi-fuente (2026-07-19)

Objetivo: pasar del riesgo *derivado del pronóstico* (olas 4-5) al alertamiento
con **avisos oficiales**, usando solo servicios gratuitos y sin API key.
Fuentes evaluadas y elegidas (ver `docs/servicios-meteorologicos-gratuitos.md`):

- [x] Motor puro `alertas-oficiales.ts`: `evaluarCiclones` (NHC/NOAA, distancia
      haversine a la sede + categoría), `evaluarCrecidaRio` (GloFAS caudal
      pronosticado vs p90 histórico) y `parsearCap`/`capAAlertas` (avisos CAP
      1.2 de protección civil / SMN)
- [x] Providers: `nhc.provider.ts` (CurrentStorms.json), `flood.provider.ts`
      (Open-Meteo Flood API), `cap.provider.ts` (URLs configurables
      `CLIMA_CAP_URLS`)
- [x] `AlertasClimaService` + `GET /clima/alertas` (agregado multi-fuente con
      cache y tolerancia a fallas por fuente) + difusión con dedup
      (`AlertaClimaticaEmitida`) a personal operativo vía email/WhatsApp
      (`POST /clima/alertas/difundir` + cron `JOB_ALERTAS_CLIMA_CRON`)
- [x] Frontend: sección "Alertas oficiales" en Mapa (junto a riesgos climáticos)
- [x] Migración `ola6_alertas_meteorologicas` (tabla de emisiones para dedup)
- [x] verify-clima ampliado (ciclones, crecida, CAP) + tsc + builds

## Pendiente para futuras sesiones (P1/P2/P3 restantes)

- [ ] RBAC granular (`@Roles`) en controladores legacy restantes + auditoría global unificada
- [ ] Pagos a la mexicana: referencias de pago/línea de captura, webhook SPEI/OXXO, aplicación automática
- [ ] Portal: pago en línea, descarga CFDI real en portal (endpoint XML ya existe — falta el wire), consumo histórico con gráficas
- [ ] App móvil de lecturista/cuadrilla (offline-first, GPS, foto)
- [ ] GIS visual (PostGIS + mapa de padrón/tomas)
- [ ] Multi-tenancy real para SaaS multi-organismo
- [x] IA: score de propensión al pago, ranking de reemplazo de medidores → hecho en Ola 2 (2026-07-18)
- [ ] IA siguiente nivel: forecasting de facturación/recaudación, uplift A/B de campañas de cobranza (medir contra grupo control)
- [ ] Adapter PAC real (Finkok/SW) cuando haya credenciales — implementar la interfaz `PacProvider`
- [ ] Gateway real de WhatsApp/email — solo configurar `NOTIF_*_URL`

## Revisión final de la sesión (2026-07-17)

9 iteraciones ejecutadas sobre `feat/state-of-the-art-billing` (9 commits, sin push).
El ciclo meter-to-cash quedó completo end-to-end: consumo → factura (tarifa escalonada
multi-servicio) → CFDI 4.0 timbrado → recibo imprimible → notificación → batch mensual →
cobranza con mínimo vital LGA. Capa analítica SWAN: VEE, PIGOO, balance M36.
Todos los motores de dinero/fiscal/reglas tienen verificación aritmética ejecutable
(`npm run verify`, 5 suites) y CI en GitHub Actions.

**Acciones humanas pendientes**: aplicar 5 migraciones nuevas en el servidor
(`npx prisma migrate deploy`), contratar PAC y configurar `PAC_PROVIDER` + CSD,
configurar gateway de WhatsApp Business API, decidir push/PR de la rama.

## Notas de diseño

- El calculador es puro (sin Prisma/Nest) para poder verificarlo aislado — es código que mueve dinero.
- Tarifa específica de administración manda sobre la global del mismo servicio (dedup en `tarifasVigentesPorServicio`).
- Timbrado se crea `estado: 'Pendiente'`; el módulo CFDI (It. 2) lo pasará a `Timbrada OK` al sellar.
- Saldo vencido = suma de pendientes de recibos anteriores (arrastre), piso en 0.

---

# Quick Wins — 30-day list (from Hydra Displacement Audit, 2026-08-11)

Source: https://claude.ai/code/artifact/eeaf8ede-3a3c-4586-9b86-1aa2f8c0e429 (§07)
Mode: executed by autonomous loop, batch by batch. Review-workflow gate after each batch.
NOTE: Live credential rotation (server/Coolify/Easypanel side) is EXPLICITLY DEFERRED by Fernando — code-side hardening only.

## Batch A — Security perimeter (active-incident items first)

- [x] A1. Code-side secret hygiene: replace real-looking values in `.env.example` with placeholders; delete both `|| 'change-me-in-production'` fallbacks (`auth.module.ts`, `jwt.strategy.ts`) so missing `JWT_SECRET` fails at boot. (Live rotation of DB/JWT/API/CEA credentials: SKIPPED — pending Fernando.)
      - Secret resolution centralizada en `auth/jwt-secret.ts` (`getJwtSecret()`): lanza si `JWT_SECRET` falta o sigue en `CHANGE_ME`.
      - NO se rechaza el literal `change-me-in-production` (forzaría una rotación que está diferida); sólo se eliminó como fallback.
- [x] A2. Fail-closed authz: register `JwtAuthGuard` as global `APP_GUARD` with `@Public()` decorator escape hatch; activate `RolesGuard`; verify the six unguarded controllers (`prefacturas`, `timbrados`, `consumos`, `medidores`, `rutas`, +1) now 401 without a token.
      - Cadena global en `app.module.ts`: Throttler → JwtAuth → Internal → Roles.
      - Verificado en caliente: `prefacturas|timbrados|consumos|medidores|rutas|contratos` → 401 sin token. El "+1" era `app.controller.ts` (`/health`, ahora `@Public()` a propósito).
      - EXTRA (no pedido explícitamente, pero exigido por "un token CLIENTE no debe alcanzar rutas internas"): `InternalGuard` se registró como guard global. Antes, un token de portal entraba a TODA la API interna. Escape: `@AllowPortal()`.
- [x] A3. Remove `npx prisma db seed` from `start:prod`; Dockerfile: add `USER node` + `HEALTHCHECK`.
      - `docker-compose.yml` conserva el seed en el servicio `api-migrate` (bootstrap de la BD local desechable, no es arranque de producción).
      - CORREGIDO en GATE A: quitar el seed dejaba producción sin usuarios ni catálogos. Ahora `start:prod` siembra `dist/prisma/seed-catalogos` (sólo datos de referencia).
- [x] A4. Remove `secure: false` from `vite.config.ts` proxy (no TLS-verification-disabled proxying to government hosts).
- [x] A5. helmet + `@nestjs/throttler` with strict limit on `POST /auth/login`.
      - Global 120/min por IP; `POST /auth/login` 5/min (verificado: intentos 1-5 → 401, 6-8 → 429). `/health` con `@SkipThrottle()`.
      - CORREGIDO en GATE A: sin `trust proxy` el cubo era compartido por toda la organización. Límites vigentes: `default` 300/min por usuario-o-IP, `login` 5/min por IP+email, `default` 30/min por IP en el handler de login.
- [x] GATE A: review workflow over the diff (security lens + correctness), then report to Fernando.
      - Review 2026-08-11: 20 hallazgos revisados → **2 causas raíz confirmadas, 18 refutados**. Ambas corregidas en el working tree:
        1. (crítico) Throttler llaveado con `req.ip` sin `trust proxy`: detrás del reverse proxy TODOS los clientes caían en un solo cubo — el límite de 5/min de `/auth/login` era un bloqueo de login para toda la organización (verificado en vivo: distintos `X-Forwarded-For` compartían el mismo 429). Fix: `trust proxy = 1` en `main.ts` (1 salto exacto, no `true`, para que el cliente no pueda falsear XFF) + `AppThrottlerGuard` (`modules/auth/app-throttler.guard.ts`) que llavea por usuario (`sub` del JWT **verificado**, no decodificado) y cae a IP real; `login` es un throttler nombrado con llave `IP+email` (5/min) y el cubo `default` acota el barrido de emails (30/min por IP en ese handler). Global subido a 300/min porque una oficina entera puede salir por una sola IP NAT.
        2. (alto) A3 quitó el seed de `start:prod` pero usuarios y catálogos vivían SÓLO en `prisma/seed.ts`: un despliegue nuevo quedaba sin usuarios y con catálogos vacíos, y el README seguía mandando `npx prisma db seed` (recreando `demo123`). Fix: split del seed en `prisma/seed-catalogos.ts` (datos de referencia, idempotente, seguro en producción — se ejecuta en cada arranque desde `start:prod`) y `prisma/seed.ts` (fixtures + usuarios demo, lanza si `NODE_ENV=production`); primer administrador con `scripts/bootstrap-admin.ts` (`npm run bootstrap:admin`, lee `ADMIN_EMAIL`/`ADMIN_PASSWORD`, rechaza placeholder y no pisa cuentas existentes). README y docker-compose actualizados.
      - Para el gate: los roles internos NO están segmentados entre sí. Ninguna ruta interna declara `@Roles(...)`, así que un LECTURISTA alcanza `/pagos`, `/contabilidad`, etc. El frontend sí filtra por rol; la API no. Fuera del alcance de A2, candidato a Batch C.

## Batch B — Data integrity & ingestion

- [x] B1. Idempotency: persist `LoteLecturas.archivoHash` (SHA-256, reject duplicate re-upload); migrations for `@@unique([contratoId, periodo])` on `Lectura` and `Consumo`.
      - Controller computa SHA-256 del buffer; `cargarLote` rechaza con `409 ConflictException` si (periodo + hash) ya existe. Migración `20260811160000_batch_b_data_integrity` (NO aplicada) crea los `@@unique` con PRE-CHECK de duplicados documentado.
- [x] B2. `Lectura.contratoId` → real FK to `Contrato`; rollover guard using `Medidor.digitos` (wrap at 10^digitos) + negative clamp replacing bare subtraction in `lecturas.service.ts`.
      - FK `lecturas.contrato_id -> contratos.id` en schema + migración (con ORPHAN PRE-CHECK, NO aplicada). Ingesta resuelve el contrato real (número→cuid) antes de insertar. `calcularConsumo` aplica guarda de rollover en 10^dígitos y marca negativos implausibles (no persiste negativos). CAVEAT de enlace Lectura↔Medidor registrado en `tasks/bugs.md` (falta `Lectura.medidorId` / H1).
- [x] B3. Fix `safeEvalArithmetic`: `catch { return 0 }` → throw + log; unit tests.
      - Lanza error descriptivo (incluye la expresión) + `Logger.error`. Ambos llamadores (preview endpoint y transacción de timbrado) ya propagan el error → no facturan cero. 10 tests Jest passing (`billing-engine.safe-eval.spec.ts`).
- [x] B4. Wire `conMonitoreo` at its six call sites (EtlPagos, generarPoliza*, cargarLote, GIS export) so `LogProceso`/Monitoreo dashboard stops being empty.
      - Cableado en 5 sitios: `cargarLote` (VALIDACION_LECTURAS), `PagosExternosService.uploadArchivo` (ETL_PAGOS), `generarPolizaCobros` (POLIZA_COBROS), `generarPolizaFacturacion` (POLIZA_FACTURACION), `GisService.iniciarSync` (GIS_EXPORT). (El "IDOC" vive dentro de generarPoliza*, mismo sitio.)
- [x] B5. Wire `GisTrackerService.registrarCambio` via Prisma `$extends` hook on the six tracked models.
      - `$use` fue ELIMINADO en Prisma 6.19 → se usó `$extends` (query extension). `PrismaModule` inyecta el cliente extendido; el hook llama `registrarCambio` en create/update/delete/upsert de los 6 modelos, resiliente (fire-and-forget, errores tragados). Assessment de reuse de sentinel-maps pendiente para GATE B (no bloqueante para esta pieza).
- [x] B6. Upload UI for `POST /lecturas/lotes/upload` in `Lecturas.tsx` (drag-drop + per-row validation report).
      - `api/lecturas.ts::uploadLote` (FormData) + tarjeta drag-drop/picker en la pestaña Captura; muestra totalRegistros/válidos/con error + tabla de motivos; el 409 duplicado se surface con toast dedicado (`UploadLoteError.duplicado`).
- [x] GATE B: review workflow (data-integrity lens, migration SQL adversarial check), then report.

## Batch C — Correctness net & contract

- [x] C1. CI skeleton: `tsc --noEmit` both sides, ESLint, `prisma migrate diff` drift check.
      - `.github/workflows/ci.yml` (node 20, cache npm): job `backend` (npm ci → prisma generate → tsc --noEmit → npm run lint → jest → prisma validate → drift check) y job `frontend` (npm ci → tsc --noEmit → npm run lint → build). YAML validado (ruby YAML.load).
      - ESLint backend estaba SIN configurar: instalado eslint 9 + typescript-eslint 8 + `eslint.config.mjs` (flat, recommended, ruido relajado). `npm run lint` backend/frontend = 0 errores (warnings tolerados). Se arreglaron 2 errores reales (`prefer-const` en tarifas, `no-require-imports` → warn).
      - Drift check: `prisma migrate diff --from-migrations --to-schema-datamodel --shadow-database-url --exit-code` (verificado que `--from-migrations` EXIGE shadow DB en prisma 6.19). CI levanta Postgres 16 como servicio (sin secretos). Es ADVISORY (`continue-on-error`): el repo tiene drift preexistente de nombres de índice/FK + un BOM en `add_sige_hydra` que rompe el replay (se strippea en copia temporal). Ver `tasks/bugs.md`.
- [x] C2. Backend tests: `calcularMonto` tiered blocks, `safeEvalArithmetic`, folio generators; authz e2e (CLIENTE token rejected on internal routes).
      - `tarifas.service.spec.ts` (10): tramo único, cero, fronteras exactas del escalonado (9/10/11 m3), multi-tramo abierto, cuota fija, mezcla fija+escalonado, sin-tarifa. Montos exactos.
      - `contabilidad.service.spec.ts` (4): `generarNumeroPoliza` seed 1584000, max+1, orderBy, y un test que DOCUMENTA la carrera de concurrencia (folio duplicado). Race registrada en `tasks/bugs.md` (fix = secuencia Postgres, fuera de alcance).
      - `authz-guards.spec.ts` (15): se eligió UNIT de guards (no e2e supertest) porque `JwtStrategy.validate` consulta prisma → e2e exigiría BD viva. Cubre JwtAuthGuard(@Public), InternalGuard(sin-user/CLIENTE→403, @AllowPortal→ok, interno→ok, @Public), PortalGuard(CLIENTE ok / interno 403), RolesGuard(@Roles match/no-match). Total suite: 39/39 verde (13 previos + 26 nuevos).
- [x] C3. `@nestjs/swagger` on auth + contratos (the two modules with real DTOs) — establish the pattern.
      - `@nestjs/swagger` 8 instalado; DocumentBuilder + bearer en `main.ts`, `/api/docs` (+ `/api/docs-json`), gated: sólo si `NODE_ENV!=production` o `ENABLE_SWAGGER=true`.
      - Rutas de Swagger se registran en el adaptador Express POR FUERA del pipeline de guards Nest → NO requieren `@Public()` (verificado en caliente: `/api/docs`=200 anónimo, `/api/contratos`=401 sin token, `/api/health`=200).
      - Anotados `auth` (LoginDto @ApiProperty, controller @ApiTags/@ApiOperation/@ApiBearerAuth) y `contratos` (controller @ApiTags/@ApiBearerAuth + @ApiOperation; CreateContrato/UpdateContrato/nested DTOs @ApiProperty/@ApiPropertyOptional). Booteado contra Postgres LOCAL desechable (nunca el remoto): docs-json OK, bearer scheme presente.
- [x] C4. Portal accessibility: `htmlFor`/`id` pairing on trámite wizards.
      - 3 wizards de trámite (`TramiteCambioPropietario`, `TramiteBajaTemporal`, `TramiteBajaDefinitiva`). Se introdujo un componente `Field` con contexto (`useId`) que cablea `htmlFor`/`id` entre `Label` y el control automáticamente, + `aria-invalid` y `aria-describedby` al error. 45 bloques de campo envueltos (18+14+13). Grupos de radio/checkbox no se tocan (ya asocian por `<label>` que envuelve al input). tsc + build + lint frontend verde.
- [x] GATE C: review workflow + final summary report to Fernando.

## Review log

### GATE A (complete) — 2026-08-11
Review workflow: 27 agents (3 lenses → adversarial verify). 24 raw findings → 18 refuted, 6 confirmed collapsing to 2 root causes, both fixed & verified live:
- Throttler keyed on `req.ip` with Express `trust proxy` off → org-wide login lockout behind the reverse proxy. Fixed: `trust proxy: 1` + custom `AppThrottlerGuard` (login keyed ip+email, authed routes keyed on verified user id).
- `start:prod` seed removal → fresh deploys had no users/catalogs. Fixed: seed split (idempotent `seed-catalogos` on boot; demo fixtures dev-only + prod-guarded; `bootstrap:admin` one-shot).
Out-of-scope but logged: internal roles not segmented (`@Roles()` unused) → Batch C candidate.

### GATE B (PARTIAL — rate-limited, resumes after 5:40pm reset) — 2026-08-11
Review workflow hit the session usage limit mid-Verify: 7/18 agents done, 11 verify agents blocked. Of the 3 findings fully verified, ALL were rejected as non-defects (migration is atomic via Prisma's per-file transaction; conMonitoreo + GIS-tracking concerns are pre-existing, not diff-introduced). The 11 unverified findings were triaged by hand (direct code reads):
- [FIXED] `resolverContrato` OR-match ambiguity (lecturas.service.ts): `findFirst` over `OR[ceaNumContrato, numeroContrato]` could attach readings to the wrong contract. Now: exact CEA match first, integer fallback only if unambiguous, else reject the row. tsc clean.
- [OPEN — design, Fernando] Lectura→Contrato FK is `ON DELETE CASCADE`: matches the schema's prevailing convention (8 sibling relations cascade) BUT reading history is audit/financial data. Decide Cascade vs Restrict before applying the migration.
- [OPEN — operational] No override path for a corrected re-upload of an already-loaded period: the `@@unique([contratoId,periodo])` refuses it per-row (fails safe — no double-bill) but there's no "delete lote + reload" or explicit override flow for operators.
- [OPEN — low] SHA-256 hash is over raw bytes, so a trailing-newline/encoding change makes a re-upload false-distinct and bypasses the 409; the `@@unique` backstops it per-row so no double-count. Optional: normalize before hashing.
- [PENDING RE-RUN] remaining unverified findings (calcularConsumo 5-digit default mis-bill, keyboard-accessible dropzone, safeEvalArithmetic throw aborting a batch run, migration index-vs-FK ordering) — re-run the GATE B verify pass after the reset to close them.
NOTE: migrations remain NOT applied (deploy decision + orphan-row backfill pending). Sentinel GIS reuse assessment saved at scratchpad/audit/sentinel-gis-reuse.md for H2.6.

### GATE C (COMPLETE) — 2026-08-11
Batch C implementado en el working tree (NO commit, NO BD remota tocada). Review workflow: 3 lentes (ci-config, test-quality, swagger-a11y-rbac) → verificación adversarial (10 agentes). **2 hallazgos confirmados (ambos CI-config, menores), 4 refutados.** Los refutados eran tradeoffs documentados/intencionales (eslint sin type-checking, drift advisory, test que documenta la carrera de folios, Swagger fail-open — refutado porque el Dockerfile fija `NODE_ENV=production`). Ambos confirmados corregidos a mano en `ci.yml`:
1. [FIXED] El job `frontend` no corría tests (el backend sí). Agregado paso `Unit tests (Vitest)` (`npm run test`). Verificado: vitest 9/9 verde.
2. [FIXED] `push` + `pull_request` sin filtro → doble corrida de CI en ramas del mismo repo con PR abierto. `push` restringido a `[main]`.
Verificación final:
- backend: `tsc --noEmit` ✓, `nest build` ✓, `jest` 39/39 ✓, `lint` 0 errores ✓, `prisma validate` ✓.
- frontend: `tsc --noEmit` ✓, `vite build` ✓, `eslint .` 0 errores ✓, `vitest` 9/9 ✓.
- `ci.yml` YAML válido (ruby YAML.load).

Entregables/decisiones abiertas para Fernando: `tasks/rbac-proposal.md` (matriz rol→módulo; los roles `CAJERO`/`CONTABILIDAD` del audit NO existen en el enum `UserRole`; `@Roles` sin cablear hasta aprobación). Migraciones Batch B siguen SIN aplicar (decisión de deploy + backfill de huérfanos). Deferrals en `tasks/bugs.md`: carrera de folios (secuencia Postgres), drift preexistente schema↔migraciones, outbox para GIS tracking. Decisión pendiente de Batch B: FK `Lectura→Contrato` Cascade vs Restrict.

--- FIN DEL LOOP: Batches A, B, C completos y con gate cerrado. Todos los cambios en working tree, sin commit. ---
- CI YAML válido (ruby YAML.load); steps referencian scripts reales (`npm run lint`, `npm run build`, `npx jest`, `npx tsc --noEmit`, `prisma generate/validate/migrate diff`).
- Swagger reachable verificado en caliente contra Postgres LOCAL desechable (puerto 55433, creado y a dropear; remoto NUNCA tocado): `/api/docs`=200 anónimo, `/api/docs-json` con bearer scheme, `/api/contratos`=401 sin token, `/api/health`=200.
- Drift check reproducido localmente: hay drift preexistente (nombres índice/FK) → CI step ADVISORY.
Entregables nuevos: `.github/workflows/ci.yml`, `backend/eslint.config.mjs`, 3 specs nuevos, Swagger en main/auth/contratos, `Field` a11y en 3 wizards, `tasks/rbac-proposal.md`.
Deferidos/logueados en `tasks/bugs.md`: carrera de folio de póliza (C2), drift preexistente migraciones↔schema (C1). RBAC de roles internos: propuesta en `tasks/rbac-proposal.md` (NO implementado, requiere aprobación).
Riesgos para el review: (1) migraciones siguen SIN aplicar; (2) drift check advisory podría enmascarar drift nuevo hasta reconciliar; (3) `@Roles` sigue sin cablear (cualquier rol interno alcanza toda la API interna) — decisión pendiente de Fernando.

### GATE B (CLOSED) — 2026-08-11 — 8 confirmed findings fixed
Verified: `backend tsc --noEmit` ✓, `backend npm run build` ✓ (exit 0), `frontend tsc --noEmit` ✓, `npx jest` 13/13 pass (10 B3 + 3 nuevos preview), `prisma validate` ✓ sin drift. Migración probada en Postgres 17 LOCAL desechable (creado y dropeado; prod NUNCA tocada): datos limpios → COMMIT de los 4 DDL; huérfano y duplicado → RAISE descriptivo + ROLLBACK total (0 índices parciales).
- [FIXED — CRITICAL] Migración `20260811160000_batch_b_data_integrity` ahora ATÓMICA (BEGIN…COMMIT explícito, Prisma 6.8.2 no envuelve) + guardas DO $$ EJECUTABLES (huérfanos en lecturas, duplicados en lecturas y consumos) que ABORTAN antes de cualquier DDL. Elimina el brick P3009 por aplicación parcial (índices commiteados + FK abortada). Header y remediación humana conservados.
- [FIXED — HIGH] Re-upload corregido: flag explícito `reemplazar` (service→controller→api→checkbox en Lecturas.tsx). En `true`, borra+reinserta por (contrato, periodo) atómicamente por renglón dentro de `$transaction`, cuenta `totalReemplazadas`, registra en LogProceso. En `false` (default) sigue rechazando pero con mensaje accionable ("reenvíe con la opción Reemplazar"), no un "duplicado" ciego.
- [FIXED — MEDIUM] `conMonitoreo`: los `logProceso.update` de cierre (éxito y error) van en su propio try/catch que solo hace `logger.warn`; un fallo de bookkeeping ya no convierte una op de negocio commiteada en un 500 (riesgo de póliza duplicada) ni enmascara el error de negocio original. Firma pública intacta.
- [FIXED — MEDIUM] `safeEvalArithmetic` callers: pre-validación de tarifas ANTES de abrir la `$transaction` de alta (`billingEngine.calcular` es solo-lectura) → `UnprocessableEntityException` descriptiva, sin trabajo parcial ni cargo cero; endpoint `preview-facturacion` mapea el error a 4xx con el mensaje ofensivo (antes 500 enmascarado). Spec B3 sigue verde + nuevo `contratos.controller.preview.spec.ts`.
- [FIXED — LOW] GIS tracking phantom-on-rollback: documentada la limitación (escritura fuera de la transacción interactiva) en `gis-tracking.extension.ts` + entrada en `tasks/bugs.md` para el fix outbox. El error de tracking ya se traga con `logger.warn`.
- [FIXED — LOW] Dropzone de carga accesible (`Lecturas.tsx`): `role="button"`, `tabIndex=0`, `aria-label`, `onKeyDown` (Enter/Espacio → abre input); `<input type=file>` con `aria-label` + `accept=".txt,.csv,text/plain"`.
NOTE: migración sigue SIN aplicar a ninguna BD (decisión de deploy + backfill de huérfanos pendiente para Fernando).

### DEFERRED ITEMS — applied 2026-08-11 (per "check risks and run all")
- [APPLIED] Batch B migration `20260811160000_batch_b_data_integrity` deployed to the LOCAL db (127.0.0.1:5432/hydradb). Risk check first: 0 orphan lecturas, 0 dup lecturas, 0 dup consumos, 0 lecturas / 3 consumos / 2 contratos. FK + 3 indexes verified present. NOTE: this is the LOCAL dev db, NOT the production server (35.188.238.10:5433) — run `prisma migrate deploy` there too; the self-guarding DO-blocks will protect real data.
- [BLOCKED] CI workflow `.github/workflows/ci.yml` — gh OAuth token lacks `workflow` scope; add via GitHub web UI or a token with workflow scope.
- [NEEDS SERVER ACCESS] Live credential rotation — fresh secrets generated in scratchpad; must be set on the server (Coolify/Easypanel) + DB, then redeploy. Not safe to do blind from here.

### RBAC — segmentación de roles internos IMPLEMENTADA — 2026-08-11
Aplicada la matriz de `tasks/rbac-proposal.md`. Antes: ningún controlador interno declaraba `@Roles`, así que cualquier rol interno (incl. LECTURISTA) alcanzaba `/pagos`, `/contabilidad`, `/tarifas`, etc. Ahora cada rol solo llega a su grupo de módulos.
- Constantes de grupo en `auth/roles.decorator.ts` (ROLES_ADMIN/INTERNAL/OPERACION/SERVICIOS/CAMPO/ATENCION/QUEJAS); todas incluyen SUPER_ADMIN+ADMIN (sin bypass en el guard → Swagger fiel). Roles inexistentes (CAJERO/CONTABILIDAD) mapeados a roles reales; sin migraciones ni enum inventado.
- 24 controladores con `@Roles` (22 a nivel de controlador + splits método en contratos PATCH, tipos-contratacion GET, ordenes PATCH estado, tramites writes, quejas DELETE).
- Dejados authenticated-only a propósito (transversal): `catalogos-operativos`, `puntos-servicio/catalogos`, `catalogos-contratacion`, `domicilios`, `personas`, `gis`. `sige-hydra`(@Public+ApiToken) y `portal`(@AllowPortal) intactos.
- Tests: `authz-guards.spec.ts` extendido con un bloque que usa Reflector REAL contra los controladores reales (LECTURISTA denegado en /contabilidad y /pagos, permitido en /lecturas y /rutas; OPERADOR denegado en /tarifas; ATENCION permitido en /pagos y denegado en /tarifas; ADMIN/SUPER_ADMIN permitidos en todos).
Verificación: `tsc --noEmit` ✓ · `JWT_SECRET=test-secret-ci jest --ci` 47/47 ✓ · `npm run build` ✓ · `npm run lint` 0 errores (5 warnings preexistentes ajenos).
Riesgo #1 para el review (logueado en bugs.md): `Dashboard.tsx` agrega listas de módulos restringidos para todos los roles → 403 cosméticos (KPI=0, no rompe; react-query v5 no lanza). Recomendación: gatear las queries del dashboard por rol en el frontend. Writes de catálogos maestros transversales siguen abiertos a cualquier interno → endurecer a ADMIN en pasada futura.

---

# Redesign sidebar (estilo Hermes) — 2026-08-31

- [x] Sidebar claro (blanco) con border-r, logo CEA adaptado
- [x] Ítems del grupo General sueltos arriba (estilo INICIO/INTELIGENCIA)
- [x] Grupos colapsables (header uppercase + chevron; azul al expandir)
- [x] Ítem activo: píldora azul suave redondeada, texto/icono azul + chevron
- [x] Estado de grupos persistido en localStorage + auto-abrir grupo de ruta activa
- [x] Bloque inferior: nombre + rol, Soporte, Configuración, Cerrar sesión
- [x] tsc --noEmit OK
- [x] Verificación con agente verificador vs referencia: ronda 1 APROBADO con 6 menores; fixes aplicados (tooltips en truncados, matching por segmento, jerarquía header/ítem, aria-controls, icono Simulador → FlaskConical); ronda 2 APROBADO sin regresiones

## Review

- Rediseño en `frontend/src/components/AppLayout.tsx` (solo el `<aside>`; topbar y main sin cambios).
- `routes.ts`: único cambio propio = icono de Simulador (FileSearch → FlaskConical) para no duplicar con Pre-Facturación.
- Grupos dinámicos desde `groupRoutesBySection`; "General" se renderiza como ítems sueltos (STANDALONE_GROUPS).
- Estado abierto/cerrado en localStorage clave `hydra.sidebar.openGroups`.
- Pendiente decidido: botones Soporte/Configuración del bloque inferior sin acción (igual que antes; no hay destino definido).
