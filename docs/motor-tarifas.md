# Motor de Tarifas — Agua Periódica y Cotización

Hay dos motores de tarifas independientes: uno para cobro periódico (mensual), otro para cotización de conexión (cargo único al contratar).

---

## 1. Motor de Agua Periódica

**Archivos:** `src/lib/tarifas.ts` + `src/data/tarifas-agua.json`

**JSON generado** con `frontend/scripts/build-tarifas-json.cjs` desde el CSV del escritorio.

**Estructura JSON:**
```json
{ "[admin]": { "[tarifa]": { "precios": [], "precioBase200": 0, "precioM3Adicional": 0, "tasa": 0.16 } } }
```

### Reglas de cálculo (`calcularCargoPeriodo`)

```
consumo/unidad = m3Total / unidades  (fracción > 0.50 → sube, ≤ 0.50 → baja)

Si ≤ 200 m³/unidad:
  agua = precios[consumo] × unidades          (lookup de tabla)

Si > 200 m³/unidad:
  agua = (consumo × precioM3Adicional) × unidades + precioBase200  (fórmula)

Alcantarillado = 10% del importe agua (si aplica check)
Saneamiento    = 12% del importe agua (si aplica check)
Recargo        = saldoVencido acumulado × 0.01470 (1.470%/mes, desde mes 2)
```

### Parámetros que determinan el cálculo
- Administración (13 admins en CSV)
- Tipo de tarifa (hasta 12 tipos por admin)
- M³ total y unidades servidas
- Periodo inicio/fin (número de meses)
- Checks `aplicaAgua`, `aplicaAlcantarillado`, `aplicaSaneamiento`

**Resolución nombre→catálogo:** `resolveAdministracion()` y `resolveTipoTarifa()` en `tarifas.ts`.

---

## 2. Motor de Tarifas de Cotización (cargo único)

### Archivos

| Archivo | Propósito |
|---------|-----------|
| `frontend/scripts/build-cotizacion-json.cjs` | Script generador del JSON desde CSVs |
| `frontend/src/data/tarifas-contratacion.json` | JSON con tarifas precalculadas |
| `frontend/src/lib/cotizacion-tarifas.ts` | Funciones de cálculo |

### Fuentes CSV (escritorio)

| CSV | Datos |
|-----|-------|
| `Tarifas_contratacion.xlsx - TARIFAS POR VARIABLES longitud..csv` | Agua y drenaje por material+longitud |
| `Tarifas_contratacion.xlsx - TARIFAS POR VARIABLES diametro.csv` | Instalación medidor y medidor por diámetro |
| `Tarifas_contratacion.xlsx - TARIFAS POR CONCEPTO FIJO.csv` | Agua periódica (no usada en cotización) |
| `Tarifas_varios.xlsx - TARIFAS POR CONCEPTO FIJO.csv` | Conceptos varios: inspección, carta factibilidad, reconexión... |

### Estructura JSON (`tarifas-contratacion.json`)

```json
{
  "[ADMIN]": {
    "longitud": {
      "agua":   { "[CLAVE_MAT]": { "precioBase": 0, "precioProporcional": 0, "tasa": 0.16 } },
      "drenaje": { ... }
    },
    "medidor": {
      "instalacion":  { "[diametroKey]": { "precio": 0, "tasa": 0.16 } },
      "medidorTipos": { "[tipo_diam_plan]": { "precio": 0, "tasa": 0.16 } }
    }
  }
}
```

13 admins | agua: 10 combos | drenaje: 9 combos | instalación: 4 grupos | medidorTipos: 5 opciones

### Fórmula agua y drenaje

```
excedente  = max(0, metros - 6)   // primeros 6m incluidos en precioBase
precioNeto = precioBase + excedente × precioProporcional
IVA        = precioNeto × tasa (0.16)
```

### Clave de tarifa de longitud

Formato: `{resolveMatCalle(matCalle)}-{resolveMatBanqueta(matBanqueta)}`

Ejemplo: calle `concreto_hidraulico` + banqueta `concreto_hidraulico` → `CONCRETO-CONCRETO`

Combos disponibles:
`LOSA-CANTERA`, `CONCRETO-CONCRETO`, `CONCRETO-ASFALTO`, `CONCRETO-ADOCRETO`,
`CONCRETO-EMPEDRADO`, `LOSA-ADOQUIN`, `CONCRETO-TERRACERIA`, `TERRACERÍA-TERRACERÍA`,
`TERRACERÍA-EMPEDRADO`, `ADOQUIN-ADOQUIN`

### Grupos de instalación de medidor

| Diámetro toma | Clave JSON | Precio neto |
|---------------|-----------|-------------|
| `1/2"`, `3/4"`, `1"` | `1/2-3/4-1` | $984.11 |
| `2"` | `2` | $2,426.91 |
| `3"` | `3` | $2,730.27 |
| `4"` | `4` | $2,932.51 |

### API pública (`cotizacion-tarifas.ts`)

```ts
calcularDerechosAgua(adminNombre, matCalle, matBanqueta, metros) → { precioNeto, tasa, iva, total }
calcularDerechosDrenaje(...)   → mismo shape
calcularInstalacionMedidor(adminNombre, diametroToma) → { precioNeto, tasa, iva, total }
resolveMatCalle(mat)           → normaliza clave inspección → nombre CSV
resolveMatBanqueta(mat)        → ídem
resolveAdminContratacion(nombre) → normaliza nombre admin → clave catálogo
```

### Conceptos calculados en `calcularCotizacionDesdeCuantificacion` (Solicitudes.tsx)

1. Derechos conexión red de agua (si `mlToma > 0`)
2. Derechos conexión red de drenaje (si `mlDescarga > 0`)
3. Instalación de medidor (por `diametroToma`)
4. Medidor pieza física (por `tipoMedidor` + `planPagoMedidor`)

Los campos de material y metros vienen de `CuantificacionData` con fallback a `SolicitudInspeccion`.

---

## 3. Catálogo en base de datos: versionado, Kardex y clasificación fiscal (2026-09)

Fuente de verdad para facturación y para la pantalla `/app/tarifas`. Contrato de API completo en
`docs/tarifas-kardex-api.md`.

### Modelo

| Tabla | Rol |
|-------|-----|
| `categorias_tarifa` | Clasificación principal/fiscal: DOMESTICA (IVA 0 %), COMERCIAL, INDUSTRIAL, PUBLICO, BENEFICENCIA, GANADERO, GENERAL (16 %). |
| `clases_tarifa` | Tipo de tarifa / variante comercial (DOMÉSTICA MEDIO, DOMÉSTICO ALTO, PÚBLICO OFICIAL, …). `iva_pct` nulo = hereda de la categoría; `sige_tps_id` = `tipo_punto_servicio` del SIGE. |
| `tarifas` | Una fila por **versión** de precio. Linaje = `codigo` (`EXP-01:agua:DOM_MEDIO`); `(codigo, version)` único; `tarifa_anterior_id` enlaza versiones; vigencia por `vigencia_desde`/`vigencia_hasta`; `iva_pct` = IVA aplicado en esa versión. |
| `tarifa_movimientos` | Kardex: valores anteriores/nuevos (snapshot), tipo (ALTA, CAMBIO_VALOR, AJUSTE_PORCENTUAL, AJUSTE_MASIVO, CAMBIO_FISCAL), %, vigencia, motivo, usuario, lote. |
| `actualizaciones_tarifarias` | Cabecera de lote masivo (porcentaje, filtro, total de tarifas). |
| `tipos_contratacion.clase_tarifa_id` | Qué clase factura cada tipo de contratación → la facturación resuelve la tarifa por administración + clase. |

### Tipos de cálculo

- `tabla`: `precios[m3]` = importe acumulado para 0..200 m³ (hoja «AGUA POTABLE PERIODICAS M3»); para
  > 200 m³: `cuotaFija + precioUnitario × m3` (fila «> 200»). Los m³ fraccionarios se redondean: fracción > 0.5 sube.
- `lineal`: `cuotaFija + precioUnitario × cantidad` (hojas FIJAS y POR CONCEPTO FIJO).
- `escalonado` / `variable` / `fijo`: sin cambios (motor previo).

### Supuestos y decisiones pendientes de confirmar con el dueño del tarifario

- **Fila «> 200 m³» (hojas AGUA POTABLE y AGUA TRATADA):** se interpreta igual que el motor previo del
  wizard (`frontend/src/lib/tarifas.ts`): `cuotaFija + precioUnitario × m3` sobre TODO el consumo, donde
  `cuotaFija` = PRECIO BASE de esa fila (coincide con `precios[0]`) y `precioUnitario` = M3 ADICIONAL. Con los
  datos de feb-2026 esto produce un salto en 200→201 m³ (a la baja en 50 de 153 tablas, p. ej. BENEFICENCIA QRO
  8,738.50 → 8,691.44; al alza en el resto). La lectura alternativa «excedente» sería
  `precios[200] + precioUnitario × (m3 − 200)`. Hasta confirmar, se conserva la lectura del motor previo.
- **IVA 0 % doméstico en CFDI:** `timbrado.service.ts` (preexistente) mapea `ivaPct = 0` a `ObjetoImp = 01`
  (no objeto). Si el criterio fiscal es «tasa 0 %» (LIVA 2-A, agua para uso doméstico), debe mapearse a
  `ObjetoImp = 02` con `TasaOCuota = 0.000000`; el `cfdi-builder` ya lo soporta. Decisión del responsable fiscal.
- **Servicios periódicos adicionales:** `SERVICIOS_FACTURABLES` sigue siendo `agua | saneamiento | alcantarillado`.
  Los conceptos del Excel (`cargo_medidor`, `*_periodico`, pipas, materiales) se siembran como tarifas
  consultables/actualizables pero NO entran en la facturación automática hasta decidir cuáles son periódicos.
- **Zona horaria:** las vigencias se normalizan a medianoche local del servidor y la versión anterior se cierra
  1 ms antes; el despliegue debe fijar `TZ=America/Mexico_City` para que la frontera coincida con el periodo.
- **Contratos sin clase:** un contrato cuyo tipo de contratación no tiene `claseTarifaId` solo ve tarifas sin
  clase (comportamiento previo). El seed enlaza los 172 tipos SIGE; revisar el log «sin resolver» tras cada carga.

### Reglas de versionado

1. Nunca se hace UPDATE de valores sobre una versión: `POST /tarifas/:id/actualizar` (individual, % o valores)
   o `POST /tarifas/actualizaciones/aplicar` (masiva, con `preview` previo) crean una versión nueva.
2. La versión anterior se cierra con `vigencia_hasta = nueva vigencia − 1 ms`; facturar un periodo pasado
   sigue tomando la versión vigente entonces.
3. Porcentajes: precios a 4 decimales (`redondear4`); importes facturados a 2 (`redondear`). El IVA nunca
   se ajusta por porcentaje; se cambia desde el configurador fiscal (categoría/clase) y genera versiones
   `CAMBIO_FISCAL` en las tarifas vigentes afectadas.

### Carga inicial y actualización de datos

```bash
cd backend
npm run export:tarifas-periodicas-json -- "../docs/Tarifas_periodicas.xlsx"   # → prisma/data/tarifas-periodicas.json
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-catalogos.ts   # seedTarifasPeriodicas (idempotente)
```

El seed solo da de alta linajes (`codigo`) inexistentes y catálogos que falten: nunca reescribe versiones ni
pisa el IVA editado desde la UI. Para publicar una nueva tabla oficial se usa la actualización masiva (o una
migración de datos explícita), no el re-seed.

## Tareas pendientes

- [x] Incrementales automáticos (% o directo) sobre tarifas existentes → `POST /tarifas/:id/actualizar`
- [x] Modificaciones masivas por administración/categoría/clase/servicio desde UI → actualización masiva con preview
- [x] Vigencias históricas → versionado por fila + Kardex (`tarifa_movimientos`)
- [x] Backend: tablas con vigencias en lugar de JSON estático (facturación resuelve por administración + clase)
- [ ] Migrar el motor offline del wizard (`frontend/src/lib/tarifas.ts` + `tarifas-agua.json`) a `GET /tarifas/vigentes`
- [ ] Alcantarillado/saneamiento periódicos como % del agua (hoy solo en el motor offline; la BD tiene filas demo)
- [ ] Vincular `Contrato` directamente a una clase cuando difiera de su tipo de contratación (trámite «Cambio de tarifa»)
