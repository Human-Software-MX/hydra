# Integración Hydra → SUPRA — Guía de configuración

Hydra consume la API `/v1` de SUPRA como **fuente de verdad del dominio financiero**
(pagos, convenios, saldos, pago en línea) y recibe eventos por webhook firmado.
El diseño completo está en [auditoria-integracion-hydra-supra.md](auditoria-integracion-hydra-supra.md).

## Qué cambió en Hydra (código)

| Área | Comportamiento con `SUPRA_INTEGRACION_ENABLED=true` |
|---|---|
| `POST /pagos` | El pago se registra PRIMERO en SUPRA (`POST /v1/payments`, idempotente por `hydra:pago:<id>`, con allocation al recibo si aplica). Si SUPRA lo rechaza, **no** se registra en Hydra (502). El registro local queda como espejo operativo (tipo/concepto/oficina). |
| `GET /pagos` | Lista desde SUPRA (`GET /v1/payments`), enriquecida con el espejo local por `external_ref`. |
| `POST /convenios` | Obligación consolidada `hydra.convenio` + payment plan con calendario explícito (anticipo = down payment) en SUPRA; las obligations de los recibos consolidados se cancelan en SUPRA (no se duplica la cuenta por cobrar). Espejo local para checklist/joins. |
| `GET /convenios`, `GET /convenios/:id` | Desde `GET /v1/payment_plans` (estado, parcialidades, pagado) mapeado al DTO de Hydra. |
| `POST /convenios/:id/parcialidades/aplicar` | Pago en SUPRA asignado a la primera parcialidad abierta del plan; el estado del convenio lo transiciona SUPRA. |
| `POST /convenios/:id/cancelar` | `POST /v1/payment_plans/:id/cancel` en SUPRA + espejo. |
| `GET /portal/saldos` | Obligations abiertas en SUPRA (vencido = `due_at` < hoy). |
| `POST /portal/contratos/:id/intentos-pago` | Liga de checkout alojado de SUPRA (`POST /v1/payment_links` → `/pay/<token>`) sobre la obligación abierta más antigua. SUPRA orquesta el PSP. |
| `POST /api/integraciones/supra/webhook` | Receptor de eventos de SUPRA: verifica `Supra-Signature` (HMAC-SHA256 sobre el cuerpo crudo, tolerancia 5 min), deduplica por `Supra-Event-Id` en `supra_evento_inbox` y procesa asíncrono. `payment.succeeded` materializa el espejo y dispara la **auto-reconexión** con el saldo de SUPRA como verdad. |

Kill-switch: con `SUPRA_INTEGRACION_ENABLED=false` (default) todo opera por el
camino legacy local, sin tocar SUPRA.

Nuevas tablas (migración `20260720120000_integracion_supra`, pendiente de
aplicar en el servidor): `supra_mapa` (IDs Hydra↔SUPRA), `supra_evento_inbox`,
`supra_comando_outbox` (reservada para reintentos diferidos).

## Pasos de configuración

### 1. En SUPRA — tenant y API key

```bash
# Bootstrap de la plataforma (una vez, en el host de SUPRA):
cd supra-1/backend && npx tsx scripts/engine-bootstrap.ts --platform

# Crear el tenant de CEA (con la key de plataforma):
curl -X POST $SUPRA/v1/tenants -H "Authorization: Bearer sk_live_PLATAFORMA" \
  -H "Content-Type: application/json" \
  -d '{"name":"CEA Queretaro (Hydra)","mode":"live","with_test_twin":true}'
# → guarda tenant id + api_key (se muestra UNA sola vez)
```

Scopes mínimos recomendados para la key que usará Hydra (crear una key acotada
con `POST /v1/api_keys` si la del bootstrap trae más): `customers:read`,
`customers:write`, `obligations:read`, `obligations:write`, `payments:read`,
`payments:write`, `webhook_endpoints:write`.

### 2. En SUPRA — webhook hacia Hydra

```bash
curl -X POST $SUPRA/v1/webhook_endpoints -H "Authorization: Bearer sk_..." \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<hydra-backend>/api/integraciones/supra/webhook",
       "event_types":["payment.succeeded","payment_link.completed","payment_link.canceled","payment_plan.created","payment_plan.canceled","payment_plan.defaulted","refund.succeeded"]}'
# → guarda el "secret" (whsec_..., se muestra UNA sola vez)
```

Nota: SUPRA rechaza URLs privadas (SSRF guard) — en desarrollo local usar un
túnel (p. ej. `cloudflared`/`ngrok`) o la IP pública del backend.

### 3. En SUPRA — ingesta Hydra→SUPRA (datos operativos)

El conector `hydra` de SUPRA (pull de contratos/recibos/pagos) sigue siendo la
vía para poblar customers/obligations históricos. Instalarlo y correr un sync
completo ANTES de habilitar la integración (`POST /v1/connector_instances` +
`POST /v1/connector_instances/:id/sync`) con una cuenta de servicio de solo
lectura de Hydra en `CONNECTOR_SECRET_HYDRA`.

### 4. En Hydra — variables de entorno

```env
SUPRA_INTEGRACION_ENABLED=true
SUPRA_BASE_URL=https://supra.humansoftware.mx
SUPRA_PUBLIC_URL=https://supra.humansoftware.mx    # base de las ligas /pay/<token>
SUPRA_API_KEY=sk_live_...
SUPRA_WEBHOOK_SECRET=whsec_...
```

### 5. En Hydra — migración

```bash
cd backend && npx prisma migrate deploy   # aplica 20260720120000_integracion_supra
```

## Semántica de consistencia

- **Idempotencia**: toda escritura a SUPRA lleva `Idempotency-Key` determinista
  (`hydra:pago:<id>`, `hydra:recibo:<id>`, `hydra:convenio:<id>[:plan]`) — el
  reintento nunca duplica dinero.
- **Mapeo de IDs**: `supra_mapa` + `external_ref` (`hydra:<entidad>:<id>`), la
  misma convención que usa el conector de ingesta de SUPRA, así los registros
  ingeridos y los creados por comando convergen en el mismo recurso.
- **Eventos**: entrega at-least-once → inbox con `UNIQUE(event_id)`; handlers
  conmutativos; 5 fallos → cuarentena (no bloquea el resto).
- **SUPRA caído**: lecturas financieras fallan explícitamente (no se sirven
  datos locales desactualizados como si fueran verdad) y las escrituras
  regresan 502 sin registrar nada local — nunca hay pago en Hydra que SUPRA
  desconozca.

## Outbox de comandos (facturación, cancelaciones, incobrables)

Las operaciones donde SUPRA no debe estar en el camino crítico usan
`supra_comando_outbox` + worker (`SupraOutboxService`, cron cada minuto):

| Operación en Hydra | Comando encolado |
|---|---|
| Emisión de recibo (individual o lote) | `obligation.create` → `POST /v1/obligations` (idempotente por `hydra:recibo:<id>`) |
| Cancelación/reproceso de lote, refacturación | `obligation.cancel` → `POST /v1/obligations/:id/cancel` (409 con abonos = constancia, sin reintento) |
| Marcar incobrable (autorizado) | `obligation.write_off` → `POST /v1/obligations/:id/write_off` |

Reintentos con backoff exponencial (30 s → 1 h, máx 10); errores de contrato
(4xx no-retryables) van a estado `muerto` para revisión. SUPRA caído **nunca**
detiene la facturación.

## Estado final del código (2026-07-20)

Todos los pendientes anteriores quedaron implementados: cartera/aging/dunning
proyectan desde SUPRA (eventos + `recalcularContratoDesdeSupra`), los pagos de
recaudadores son SUPRA-first y sus archivos se verifican en la statement
reconciliation, el módulo `pasarelas` fue **eliminado** (el portal opera solo
con checkout de SUPRA; SPEI nativo opcional con `SUPRA_SPEI_INSTANCE_ID`),
refunds disponibles en `POST /pagos/:id/devolucion` (maker-checker), el
conector de ingesta de SUPRA quedó corregido (repo supra-1, suite 1092 tests),
y el backend de Hydra estrenó suite de tests (`npm test`, vitest).

Variables adicionales:

```env
# Opcional: instancia bank_transfer de SUPRA para SPEI nativo del portal
# (sin ella, SPEI usa la liga de checkout /pay/<token>)
SUPRA_SPEI_INSTANCE_ID=
# Cron de conciliación espejo↔SUPRA (default 04:00, requiere HYDRA_JOBS_ENABLED)
JOB_CONCILIACION_SUPRA_CRON=0 4 * * *
```

Nota: con `SUPRA_INTEGRACION_ENABLED=false`, caja/facturación/cartera operan
en modo legacy local, pero el **pago en línea del portal ya no existe sin
SUPRA** (503) — la pasarela simulada fue retirada.
