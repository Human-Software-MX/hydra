# Deploy — Catálogo de documentos, filtro Doméstico/No Doméstico y entrega de archivos

**Fecha:** 2026-09-03 · **PRs incluidos en main:** #56, #57, #58 (+ este)

## Qué se despliega

1. **Filtro Doméstico / No Doméstico** (PR #57): el toggle del paso Solicitud filtra
   administraciones y tipos de contratación vía la cadena tarifaria
   (`TipoContratacion.claseTarifaId → ClaseTarifa → CategoriaTarifa`, doméstica = `DOMESTICA`).
   Sin migraciones propias.
2. **Catálogo maestro de documentos** (PR #56): tabla `catalogo_documentos` con los 24
   documentos SIGE (la migración los siembra sola) + refactor de
   `documentos_requeridos_tipo_contratacion` (FK, `aplica_uso`, `orden`).
3. **Entrega de archivos por solicitud** (PR #58): tabla `solicitud_documentos` +
   endpoints multipart; archivos en `backend/uploads/documentos-solicitud/`.
4. **Mapeo inicial tipo→documento** (este PR): script `seed:mapeo-documentos` —
   PROPUESTA pendiente de validación CEA, ver abajo.

## Pasos (en el servidor)

```bash
# 1. Código
git pull origin main

# 2. Backend: deps + migraciones + client
cd backend
npm install                      # sin deps nuevas, pero asegura lockfile
npx prisma migrate deploy        # aplica TODAS las pendientes (ver nota)
npx prisma generate

# 3. Datos: mapeo inicial tipo de contratación → documentos (idempotente)
npm run seed:mapeo-documentos

# 4. Build & restart
npm run build
# reiniciar el proceso del backend (pm2/systemd según el server)

# 5. Frontend
cd ../frontend
npm install
npm run build
# publicar dist/ según el hosting actual
```

### ⚠️ Nota sobre `migrate deploy`

Aplica **todas** las migraciones pendientes en orden. Además de las 2 nuevas
(`20260903200000_catalogo_documentos_contratacion`, `20260903220000_solicitud_documentos`)
puede haber pendientes anteriores documentadas en CLAUDE.md:
- `20260420150000_individual_no_requiere_inspeccion`
- `20260427000000_aquasis_localidades_colonias`
- las del modelo de tarifas/Kardex (PR #55), si no se han aplicado

Ver el estado exacto antes: `npx prisma migrate status`.

> La URL del `.env` local apunta a `35.188.238.30:5433`; CLAUDE.md documenta
> `35.188.238.10:5433`. Confirmar cuál es la vigente — desde fuera no respondía
> el 2026-09-03.

## Verificación post-deploy

```bash
# catálogo sembrado (24 filas)
psql "$DATABASE_URL" -c 'SELECT count(*) FROM catalogo_documentos;'

# mapeo propuesto cargado (~2600 filas: 21 reglas × tipos activos)
psql "$DATABASE_URL" -c 'SELECT count(*) FROM documentos_requeridos_tipo_contratacion;'

# API
curl -s "$API/catalogos/documentos" -H "Authorization: Bearer $TOK" | jq length         # → 24
curl -s "$API/tipos-contratacion?uso=domestico&limit=5" -H "Authorization: Bearer $TOK" | jq '.total'
curl -s "$API/catalogos-operativos/administraciones?uso=no_domestico" -H "Authorization: Bearer $TOK" | jq length
```

En la UI: nueva solicitud → paso Solicitud elegir **No Doméstico** → paso Contratación
debe listar solo tipos no domésticos, y el bloque de documentos debe ofrecer el dropdown
con los del tipo (los marcados `no_domestico` solo aparecen en esa rama). En una solicitud
**guardada**, subir un PDF debe listarlo agrupado y marcar el checklist.

## El mapeo es una PROPUESTA

Las reglas viven en `backend/scripts/seed-mapeo-documentos.ts` con comentario por regla.
SIGE no traía esta relación (su tabla era producto cartesiano). Cuando CEA valide
(TKT-20260903-00144): editar las reglas y re-ejecutar `npm run seed:mapeo-documentos`
(idempotente) o ajustar fino vía `POST /catalogos/documentos/asignacion-masiva`.
