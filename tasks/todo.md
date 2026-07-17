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
- [ ] **It. 8 — RBAC global** en todos los controladores + auditoría global.
- [x] **It. 8 — Balance hídrico M36 / NRW** ✅: calculador puro `m36-balance.ts` con taxonomía IWA/AWWA completa (consumo autorizado facturado medido/no medido/autorizado no facturado; pérdidas aparentes = submedición % + no autorizado %, pérdidas reales = resto); valorización estándar (aparentes a tarifa media, reales a costo de producción); indicadores NRW %, eficiencia física, tarifa media, pérdidas en pesos; advertencias por macromedición inconsistente y acotamiento de estimaciones; `BalanceService` alimentado por VolumenProducido + consumos por tipo + timbrados, filtrable por administración; endpoint `GET /balance-hidrico` con parámetros de estimación por query. Verificado: verify-balance 15/15 + typecheck OK.
- [ ] **It. 10 — Tests + CI** (GitHub Actions).

## Notas de diseño

- El calculador es puro (sin Prisma/Nest) para poder verificarlo aislado — es código que mueve dinero.
- Tarifa específica de administración manda sobre la global del mismo servicio (dedup en `tarifasVigentesPorServicio`).
- Timbrado se crea `estado: 'Pendiente'`; el módulo CFDI (It. 2) lo pasará a `Timbrada OK` al sellar.
- Saldo vencido = suma de pendientes de recibos anteriores (arrastre), piso en 0.
