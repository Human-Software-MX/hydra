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
