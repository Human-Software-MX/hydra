# Bug Log

Bugs spotted outside the task at hand. Self-contained entries; another agent with zero session context should be able to pick any of these up. Format: Where / What / How it fails / Status / Date.

---

## Path traversal in cotización PDF handlers

- **Where**: `backend/src/modules/solicitudes/solicitudes.controller.ts` (cotizacion-pdf GET/POST handlers)
- **What**: The PDF download/upload path is built from the request without normalizing/
## AjustesFacturacion usa prefacturas demo aun en modo API

- **Where**: `frontend/src/pages/AjustesFacturacion.tsx:119` (vs. `frontend/src/pages/PreFacturacion.tsx:31`)
- **What**: La página de ajustes siempre lista las prefacturas demo del DataContext, pero los ajustes se POSTean al backend real. PreFacturacion.tsx sí alterna con `useApi ? apiPreFacturas : contextPreFacturas`.
- **How it fails**: Con backend vivo, el usuario "ajusta" una fila que no es la prefactura real; el kardex persiste contra datos que no existen en la BD de prefacturas. Requiere decisión de producto/backend (endpoint real de prefacturas para esta vista).
- **Status:** pending
- **Date:** 2026-08-11

## Kardex de ajustes se cruza entre prefacturas del mismo contrato+periodo

- **Where**: `frontend/src/pages/AjustesFacturacion.tsx:156-163`
- **What**: El kardex en modo API se liga por la llave `contratoId|periodo` (el modelo `AjusteTarifario` no tiene preFacturaId). Dos prefacturas del mismo contrato y periodo mostrarían cada una los ajustes de la otra.
- **How it fails**: Hoy el demo garantiza una prefactura por (contrato, periodo), pero con datos reales (refacturación, notas de crédito) la llave colisiona y el badge/kardex muestran ajustes ajenos. Fix probable: agregar referencia a prefactura en `AjusteTarifario` (migración) cuando prefacturación sea real.
- **Status:** pending
- **Date:** 2026-08-11

## Lectura↔Contrato↔Medidor linkage débil (bloquea rollover/FK limpios) [B2]

- **Where**: `backend/src/modules/lecturas/lecturas.service.ts` (`cargarLote`, `resolverContrato`, `calcularConsumo`), `backend/prisma/schema.prisma` (Lectura)
- **What**: Históricamente `Lectura.contratoId` guardaba el NÚMERO de contrato del archivo plano (`linea.substring(14,22)`), no el `Contrato.id` (cuid). No hay `Lectura.medidorId`, así que los dígitos del medidor (para la guarda de rollover en 10^dígitos) solo se alcanzan vía `Contrato.medidor`, y solo si el contrato se resuelve.
- **Cómo se abordó en B2**: (1) Se agregó la FK real `Lectura.contrato_id -> contratos.id` en el schema + migración (NO aplicada). (2) La ingesta ahora resuelve el contrato real por `ceaNumContrato` / `numeroContrato` antes de insertar (respeta la FK); si no resuelve, el renglón se rechaza con motivo "Contrato no encontrado" en vez de crear un huérfano. (3) `calcularConsumo` toma `digitos` de `Contrato.medidor.digitos`; si falta, cae a `DIGITOS_DEFAULT = 5` y anota `digitosMedidor` en `datosRaw`.
- **Caveat / riesgo residual**:
  - La resolución `ceaNumContrato`/`numeroContrato` es heurística; si el layout del archivo plano usa otra clave, resolverá mal o rechazará renglones legítimos. Falta confirmar contra un archivo real de CEA.
  - Las filas `lecturas` existentes en prod (con número crudo) son ORFANAS respecto de la nueva FK: la migración fallará ruidosamente (a propósito) hasta que Fernando haga backfill/limpieza (ver comentario en `20260811160000_batch_b_data_integrity/migration.sql`).
  - La guarda de rollover con default de 5 dígitos puede subestimar/sobreestimar en medidores de otro tamaño cuando el medidor no está enlazado. Lo correcto (H1) es añadir `Lectura.medidorId` y capturar dígitos por lectura.
- **Status:** partial — FK + resolución + rollover implementados; falta `Lectura.medidorId` (H1) y validar la clave de resolución contra layout real.
- **Date:** 2026-08-11

## BOM UTF-8 en migración `add_sige_hydra` rompe `prisma migrate deploy` en BD limpia

- **Where**: `backend/prisma/migrations/20260302000000_add_sige_hydra/migration.sql:1`
- **What**: El archivo empieza con un BOM UTF-8 (bytes `EF BB BF`) antes de `-- CreateTable`. Postgres no acepta ese carácter invisible al inicio de la sentencia y aborta. Es el ÚNICO `migration.sql` del repo con BOM (verificado sobre todos los archivos de `prisma/migrations/`).
- **How it fails**: En cualquier BD desde cero, `npx prisma migrate deploy` (o `migrate dev`) falla con `Error: P3018 ... Database error code: 42601 ... ERROR: syntax error at or near "﻿" Position: 1`, y deja la migración marcada como fallida, lo que bloquea todas las migraciones posteriores. Reproducido el 2026-08-11 al levantar el stack local contra `hydradb`.
- **Workaround usado** (no persistido en el repo): `prisma migrate resolve --rolled-back 20260302000000_add_sige_hydra`, aplicar una copia sin BOM (`tail -c +4 migration.sql > /tmp/nobom.sql; prisma db execute --file /tmp/nobom.sql`), y luego `prisma migrate resolve --applied 20260302000000_add_sige_hydra`.
- **Fix propuesto + RIESGO**: quitar el BOM del archivo (`tail -c +4` in-place). CUIDADO: editar un `migration.sql` ya aplicado cambia su checksum, y en las BDs donde esa migración YA corrió (p.ej. el servidor 35.188.238.30) el siguiente `migrate deploy` protestará por checksum mismatch. Hay que coordinar el cambio con un `migrate resolve` en esos entornos, o dejar el archivo como está y documentar el workaround.
- **Status:** pending
- **Date:** 2026-08-11

## GIS phantom tracking on rollback (CambioGIS fuera de la transacción)

- **Where**: `backend/src/prisma/gis-tracking.extension.ts`
- **What**: El query-extension `gis-tracking` escribe la fila `CambioGIS` con el cliente BASE (sin extender), por lo que la escritura de tracking queda FUERA de la transacción interactiva de la mutación (esto es intencional para evitar recursión del hook). Consecuencia: si una mutación de un modelo rastreado (Contrato/Medidor/Zona/Distrito/Toma/Ruta) corre dentro de un `$transaction(...)` que LUEGO hace rollback, el `CambioGIS` ya se commiteó de forma independiente y queda una fila fantasma que referencia un cambio que nunca ocurrió.
- **How it fails**: El feed de deltas GIS emite un delta espurio (insert/update/delete) para una entidad cuyo cambio se revirtió. Baja severidad: el feed es un stream tolerante a reconciliación y el consumidor puede re-leer el estado real. No se reproduce en mutaciones sueltas (auto-commit), solo dentro de transacciones interactivas que abortan.
- **Fix propuesto**: patrón outbox — escribir el `CambioGIS` en la MISMA transacción que la mutación (tabla outbox) y despacharlo a `registrarCambio`/feed tras el commit. Requiere un dispatcher post-commit; se evitó en Batch B por ser fuera de alcance (LOW). Mitigación aplicada ahora: comentario de limitación en el extension + el error de tracking se traga con `logger.warn` (ya existía).
- **Status:** deferred (needs outbox pattern)
- **Date:** 2026-08-11

## Folio de póliza (`generarNumeroPoliza`) tiene carrera de concurrencia [C2]

- **Where**: `backend/src/modules/contabilidad/contabilidad.service.ts:254` (`generarNumeroPoliza`), llamado por `generarPolizaCobros`/`generarPolizaFacturacion`.
- **What**: El folio se calcula como `SELECT max(numero) + 1` en JS (`findFirst orderBy numero desc`, `parseInt(...) + 1`). No hay lock ni secuencia de BD ni `@@unique` sobre `Poliza.numero`. Dos generaciones de póliza concurrentes leen el mismo max y emiten el MISMO folio.
- **How it fails**: Dos cierres simultáneos (p.ej. póliza de cobros + póliza de facturación disparadas a la vez, o dos operadores) producen dos pólizas con el mismo `numero`. Como no hay unique, ambas persisten: folios duplicados en contabilidad → conflicto al exportar a SAP/IDOC. Segundo defecto menor: `orderBy numero desc` es sobre una columna String; es lexicográfico, correcto sólo mientras todos los folios tengan la misma longitud (7 dígitos desde 1584000; se rompería al pasar de 9999999 a 10000000).
- **Documentado por**: `contabilidad.service.spec.ts` — el test "DOCUMENTA la carrera" prueba que dos llamadas concurrentes con el mismo max devuelven el mismo folio (comportamiento actual, no deseado).
- **Fix propuesto (fuera de alcance C2, requiere migración + decisión de Fernando)**: mover el folio a una secuencia de Postgres (`CREATE SEQUENCE poliza_numero_seq`) o columna `@default(autoincrement())`, y/o `@@unique` sobre `Poliza.numero` como red de seguridad. Un `@@unique` solo NO basta (haría fallar la segunda póliza en vez de reintentar); lo correcto es la secuencia. No se aplicó aquí porque cambia el esquema y el rango base (1584000) parece heredado de SIGE — hay que confirmar la semántica del folio antes de tocarlo.
- **Status:** deferred (needs sequence/migration + product confirmation)
- **Date:** 2026-08-11

## Deriva (drift) preexistente entre `prisma/migrations` y `schema.prisma` [C1]

- **Where**: `backend/prisma/migrations/*` vs `backend/prisma/schema.prisma`; detectado por el step "Prisma migrate drift check (advisory)" de `.github/workflows/ci.yml`.
- **What**: Reproducido el 2026-08-11 con `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --shadow-database-url ... --exit-code` (Postgres local desechable, BOM de `add_sige_hydra` removido en copia temporal). El replay de TODAS las migraciones NO reconstruye exactamente el `schema.prisma` actual: hay diferencias de nombres de índice/FK por truncamiento a 63 chars (`..._k` vs `..._key`, `..._i` vs `..._idx`), FKs añadidas sólo en el schema (`contrato_conceptos.contrato_id`, `contrato_conceptos.concepto_cobro_id`) y removidas en migraciones (`correcciones_tarifarias.tarifa_id`), y un cambio de FK en `catalogo_colonias_inegi.localidad_id`.
- **How it fails**: No es un bug de runtime; es deuda de historial de migraciones. Un `prisma migrate deploy` en una BD limpia produciría un esquema ligeramente distinto al que Prisma Client espera (nombres de constraint), y `prisma migrate dev` querría generar una migración de "reparación". Por eso el step de CI es ADVISORY (`continue-on-error: true`): marcar drift preexistente como hard-fail dejaría el pipeline en rojo desde el día uno, sin poder distinguir drift nuevo del heredado.
- **Fix propuesto (Fernando)**: generar una migración de reconciliación (`prisma migrate dev --name reconcile_schema_drift` en un entorno controlado) que alinee los nombres/FKs, revisarla, y una vez limpio el drift, promover el step de CI a hard-fail (quitar `continue-on-error`). Coordinar con el BOM de `add_sige_hydra` (ver entrada arriba) que también bloquea el replay limpio.
- **Status:** deferred (needs reconciliation migration; CI step is advisory meanwhile)
- **Date:** 2026-08-11

## Dashboard interno dispara 403 en módulos fuera del grupo del rol (RBAC) [RBAC-1]

- **Where**: `frontend/src/pages/Dashboard.tsx` (visible a SUPER_ADMIN/ADMIN/OPERADOR/LECTURISTA/ATENCION_CLIENTES) vs los `@Roles` cableados el 2026-08-11.
- **What**: El Dashboard agrega listas de varios dominios sin gating por rol: `fetchProcesos` (`/procesos-contratacion` → ROLES_SERVICIOS), `fetchLecturas` (`/lecturas` → ROLES_CAMPO), `fetchPagos` (`/pagos` → ROLES_ATENCION), `fetchPreFacturas` (`/prefacturas` → ROLES_ADMIN), `fetchTimbrados` (`/timbrados` → ROLES_ADMIN), `fetchContratos` (`/contratos` GET, abierto). Tras la segmentación RBAC, cada rol recibe **403** en los endpoints fuera de su grupo (p.ej. LECTURISTA → 403 en /procesos, /pagos, /prefacturas, /timbrados; ATENCION → 403 en /lecturas; OPERADOR → 403 en /pagos, /prefacturas, /timbrados).
- **How it fails**: NO rompe la página. Cada llamada está en su propio `useQuery` con fallback `= []`; TanStack Query v5 no lanza por defecto (`throwOnError` false), así que el KPI derivado cae a 0 y la vista renderiza. Efecto: KPIs incompletos + ruido de red/consola (403) para roles no-admin. Es degradación cosmética, no un brick.
- **Por qué se dejó así**: la alternativa (abrir los GET de pagos/prefacturas/timbrados a todos los internos) anularía el objetivo del RBAC (un LECTURISTA podría `curl` la lista completa de pagos). Se priorizó el bloqueo correcto y se documenta el flanco del dashboard.
- **Fix propuesto (frontend, fuera del alcance backend de esta pasada)**: gatear cada `useQuery` del Dashboard por rol/permiso (`enabled: useApi && routesForRole(role).includes(...)` o `usePermissions`), o mover los KPIs a un endpoint `/dashboard/resumen` único con `@Roles(...ROLES_INTERNAL)` que el backend arme según el rol del token. Mientras tanto, verificar que ningún widget rompe (confirmado: no rompe).
- **Status:** deferred (frontend role-gating pendiente)
- **Date:** 2026-08-11

## Writes de catálogos maestros transversales siguen abiertos a cualquier interno [RBAC-2]

- **Where**: `catalogos-operativos.controller.ts`, `puntos-servicio/catalogos.controller.ts`, `tipos-contratacion/catalogos-contratacion.controller.ts`, `domicilios.controller.ts`, `personas.controller.ts`.
- **What**: Estos controladores se dejaron **authenticated-only** (sin `@Roles`) porque sus GET son catálogos/lookups transversales que consumen varias pantallas de distintos roles (restringirlos rompería la UI). Pero también exponen `POST/PATCH/DELETE` de datos maestros (marcas/modelos/calibres de medidor, formas de pago, tipos de variable, conceptos de cobro, cláusulas, tipos de corte, domicilios, personas/roles) que, sin `@Roles`, cualquier usuario interno (incl. LECTURISTA) puede invocar.
- **How it fails**: No es un fallo de runtime; es una superficie de escritura sin segmentar. Un LECTURISTA con token válido podría crear/editar catálogos maestros vía API.
- **Fix propuesto**: split método-a-método — dejar los GET abiertos y poner `@Roles(...ROLES_ADMIN)` (o el grupo dueño) en cada write. No se hizo en esta pasada por el riesgo de romper flujos que crean catálogos inline (p.ej. alta de medidor que crea una marca) sin verificar cada uno; err hacia menos restricción. Requiere revisar consumidores reales antes de endurecer.
- **Status:** deferred (endurecimiento de writes pendiente, bajo riesgo)
- **Date:** 2026-08-11

## PuntosServicio: coordenadas (y otros campos) se envían con nombres que el backend ignora

- **Where**: `frontend/src/api/puntos-servicio.ts:66-93` (`CreatePuntoServicioDto`) y `frontend/src/pages/PuntosServicio.tsx:404-405` vs `backend/src/modules/puntos-servicio/puntos-servicio.controller.ts:39-59`
- **What**: El formulario de Puntos de Servicio envía `coordenadaLat`/`coordenadaLon` (además de `administracion`, `libreta`, `claveCatastral`, `folioExpediente`, `sectorHidraulicoId`, `calibreId`, etc.), pero el backend solo reconoce `gpsLat`/`gpsLng` y el subconjunto de campos del modelo `PuntoServicio`. No hay validación que rechace los desconocidos.
- **How it fails**: El usuario captura latitud/longitud en el alta/edición de un punto de servicio → la petición responde 201/200 pero `puntos_servicio.gps_lat/gps_lng` quedan en NULL; el punto nunca aparece en `/gis/padron.geojson`. Fix probable: renombrar en el DTO frontend a `gpsLat`/`gpsLng` (y revisar el resto de campos huérfanos contra el schema Prisma).
- **Status:** pending
- **Date:** 2026-09-02
## Tarifas demo sembradas con `tipoServicio` en mayúsculas nunca las usa facturación

- **Where**: `backend/prisma/seed-catalogos.ts:382-393` (`seedTarifas`, `tipoServicio: 'AGUA' | 'SANEAMIENTO' | 'ALCANTARILLADO'`) vs `backend/src/modules/facturacion/facturacion.service.ts:16` (`SERVICIOS_FACTURABLES = ['agua', 'saneamiento', 'alcantarillado']`).
- **What**: El seed demo escribe los servicios en MAYÚSCULAS y la resolución de tarifas de facturación filtra por minúsculas. Las 6 tarifas demo (TAR01–TAR06) jamás se seleccionan al facturar un consumo; solo `GET /tarifas/vigentes?tipoServicio=AGUA` y `/tarifas/calcular` las ven.
- **How it fails**: En una BD que solo tiene el seed demo, `FacturacionService.calcularParaConsumo` lanza "No hay tarifas vigentes para el periodo …" aunque `/tarifas` liste tarifas activas. Con el catálogo real (Excel, `tipoServicio: 'agua'`) la facturación sí funciona; el seed demo debería normalizarse a minúsculas o eliminarse.
- **Status:** pending
- **Date:** 2026-09-03

## Scripts npm con `--compiler-options {\"module\":\"CommonJS\"}` fallan bajo Git Bash

- **Where**: `backend/package.json` scripts `seed:catalogos`, `bootstrap:admin`, `import-sige-hydra`, `export:tarifas-periodicas-json`, etc.
- **What**: El JSON inline pierde las comillas cuando npm ejecuta el script desde Git Bash en Windows (`SyntaxError: Expected property name or '}' in JSON at position 1` de ts-node). Desde PowerShell/cmd funciona.
- **How it fails**: `npm run seed:catalogos` termina en error inmediato en Git Bash. Workaround: `npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-catalogos.ts`. Fix sugerido: mover la opción a un `tsconfig.seed.json` (`ts-node -P`) o usar `TS_NODE_COMPILER_OPTIONS` como ya hace `seed:demo-aquacis`.
- **Status:** pending
- **Date:** 2026-09-03

## Desajuste de claves de material de calle entre catálogos
- **Where**: `frontend/src/components/solicitudes/CuantificacionModal.tsx:73` vs `frontend/src/components/contratacion/steps/PasoVariables.tsx:20`
- **What**: La misma etiqueta "Concreto hidráulico" tiene clave `concreto_hidraulico` en CuantificacionModal y `concreto` en el catálogo de variables (PasoVariables). Son dos catálogos paralelos para el mismo dominio.
- **How it fails**: Si una inspección captura `MATERIAL_CALLE = 'concreto'` (clave de PasoVariables) y ese valor llega a CuantificacionModal vía `vc.MATERIAL_CALLE`, el select cae al placeholder y el input read-only muestra la clave cruda en vez de la etiqueta. Preexistente al cambio a SearchableSelect (el Select original se comportaba igual).
- Status: pending, 2026-09-03

## Valor legado de DIAMETRO_TOMA en seed-catalogos
- **Where**: `backend/prisma/seed-catalogos.ts:657`
- **What**: `valoresPosibles` de la variable DIAMETRO_TOMA siembra `'1-1/2"'` mientras la migración estándar y el formulario usan `'1.5"'`. En la cotización de instalación de medidor ambos caen al grupo 1/2-3/4-1, pero el valor es inconsistente entre catálogos.
- **How it fails**: una BD sembrada desde cero ofrece `1-1/2"` en el dropdown de la variable; el resto del sistema espera `1.5"`. Sin impacto de cálculo hoy (fallback), pero divergencia de datos.
- Status: pending, 2026-09-03
