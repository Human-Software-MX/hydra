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
