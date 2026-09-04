# Tarifas — Kardex, clasificación y configuración fiscal: contrato de API

Todos los endpoints viven bajo `/tarifas` (controlador `TarifasController`, `@Roles(...ROLES_ADMIN)`).
Los importes se serializan como `number` (no `Decimal`/string). Fechas ISO.

## Modelo de dominio

- **CategoriaTarifa** (`categorias_tarifa`): clasificación principal/fiscal. `ivaPct` es el IVA por defecto
  (DOMESTICA = 0, resto 16).
- **ClaseTarifa** (`clases_tarifa`): tipo de tarifa / variante (DOMÉSTICA MEDIO, DOMÉSTICO ALTO, …).
  `ivaPct` nulo = hereda el de su categoría. `ivaEfectivo = clase.ivaPct ?? categoria.ivaPct`.
  `sigeTpsId` = `tipo_punto_servicio` (tcttpsid) del SIGE. `TipoContratacion.claseTarifaId` enlaza
  cada tipo de contratación con su clase (la facturación resuelve la tarifa del contrato por
  administración + clase).
- **Tarifa** (`tarifas`): una fila por **versión**. Linaje = `codigo`
  (`${administracionId}:${tipoServicio}:${claseCodigo}`); `(codigo, version)` único;
  `tarifaAnteriorId` enlaza la versión reemplazada. Vigencia por `vigenciaDesde`/`vigenciaHasta`
  (la versión anterior se cierra 1 ms antes de la nueva). `ivaPct` es el IVA **aplicado** en esa
  versión (snapshot que consume facturación/CFDI). `tipoCalculo` ∈ escalonado | variable | fijo |
  **tabla** (`precios[m3]` acumulado 0..`rangoMaxM3`, >rango: `cuotaFija + precioUnitario × m3`) |
  **lineal** (`cuotaFija + precioUnitario × cantidad`).
- **TarifaMovimiento** (`tarifa_movimientos`): Kardex. Un renglón por versión creada con
  `valoresAnteriores`/`valoresNuevos` (snapshot `ValoresTarifa`), `tipo`
  (ALTA | CAMBIO_VALOR | AJUSTE_PORCENTUAL | AJUSTE_MASIVO | CAMBIO_FISCAL | BAJA), `porcentaje`,
  `vigenciaDesde`, `motivo`, usuario y `actualizacionId` (lote).
- **ActualizacionTarifaria**: cabecera de lote (masivo): `porcentaje`, `filtro`, `totalTarifas`,
  `estado` (`aplicada`), `fechaAplicacion` = vigencia.

Helpers puros compartidos: `backend/src/modules/tarifas/tarifa-valores.ts`
(`snapshotValores`, `aplicarPorcentaje`, `valorReferencia`, `cierreVigenciaAnterior`, `normalizarVigencia`).

## Tipos (respuesta)

```ts
interface ValoresTarifa {
  tipoCalculo: string; rangoMinM3: number | null; rangoMaxM3: number | null;
  cuotaFija: number | null; precioUnitario: number | null; precios: number[] | null; ivaPct: number;
}

interface CategoriaTarifaDto {
  id: string; codigo: string; nombre: string; descripcion: string | null; ivaPct: number;
  orden: number; activo: boolean; clases: ClaseTarifaDto[];
}

interface ClaseTarifaDto {
  id: string; codigo: string; nombre: string; categoriaId: string; categoriaCodigo: string;
  categoriaNombre: string; ivaPct: number | null; ivaEfectivo: number; sigeTpsId: number | null;
  orden: number; activo: boolean; totalTarifasVigentes: number;
}

interface TarifaVigenteDto {
  id: string; codigo: string; nombre: string; tipoServicio: string; concepto: string | null;
  tipoCalculo: string; administracionId: string | null; administracionNombre: string | null;
  claseTarifaId: string | null; claseCodigo: string | null; claseNombre: string | null;
  categoriaId: string | null; categoriaCodigo: string | null; categoriaNombre: string | null;
  rangoMinM3: number | null; rangoMaxM3: number | null;
  precioUnitario: number | null; cuotaFija: number | null;
  precios: number[] | null;          // SOLO en GET /tarifas/:id; en listados viene null
  valorReferencia: number | null;    // tabla: importe a 10 m³; fijo: cuotaFija; resto: precioUnitario.
                                     // Denormalizado en `tarifas.valor_referencia` (se escribe al crear cada versión) para listar sin cargar `precios`.
  ivaPct: number; vigenciaDesde: string; vigenciaHasta: string | null; activo: boolean; version: number;
  tarifaAnteriorId: string | null; motivo: string | null; creadoPor: string | null; createdAt: string;
  seccion: 'PERIODICA' | 'CONTRATACION';   // catálogo al que pertenece
  variante: string | null;                 // materiales calle-banqueta, diámetro/plan de medidor… (cuando no es una clase)
  parametros: Record<string, unknown> | null; // consumoAsignadoM3, cantidadIncluida (lineal_excedente), variable, subconcepto
  ivaNoObjeto: boolean;                    // «No objeto de IVA» (multas, recargos); ivaPct = 0
}

interface TarifaMovimientoDto {
  id: string; codigo: string; tarifaId: string; tarifaAnteriorId: string | null; tipo: string;
  porcentaje: number | null; valoresAnteriores: ValoresTarifa | null; valoresNuevos: ValoresTarifa;
  vigenciaDesde: string; motivo: string | null; actualizacionId: string | null;
  usuarioId: string | null; usuarioEmail: string | null; createdAt: string;
  version: number;                   // versión resultante
  tarifaNombre: string; claseNombre: string | null; administracionNombre: string | null; tipoServicio: string;
}

interface KardexDto {
  codigo: string;
  tarifaVigente: TarifaVigenteDto | null;   // versión vigente hoy (o null si ninguna)
  versiones: TarifaVigenteDto[];            // todas, version desc, precios: null
  movimientos: TarifaMovimientoDto[];       // createdAt desc
}

interface ActualizacionTarifariaDto {
  id: string; descripcion: string; fechaPublicacion: string; fechaAplicacion: string;
  fuenteOficial: string | null; estado: string; porcentaje: number | null;
  filtro: FiltroTarifas | null; totalTarifas: number | null; aplicadoPor: string | null; createdAt: string;
  movimientos?: TarifaMovimientoDto[];      // solo en GET /tarifas/actualizaciones/:id
}

interface FiltroTarifas {
  administracionId?: string; categoriaId?: string; claseTarifaId?: string;
  tipoServicio?: string; concepto?: string; buscar?: string;
  seccion?: 'PERIODICA' | 'CONTRATACION'; variante?: string;
}

interface PreviewMasivaDto { filtro: FiltroTarifas; porcentaje: number; vigenciaDesde?: string /* YYYY-MM-DD */ }
interface AplicarMasivaDto extends PreviewMasivaDto { motivo: string; fuenteOficial?: string }
interface PreviewMasivaResult {
  total: number; porcentaje: number; vigenciaDesde: string;
  excluidosProgramados: number;      // linajes con una versión programada a futuro (no se tocan)
  excluidos: Array<{ codigo: string; nombre: string; vigenciaDesdeProgramada: string | null }>;
  tarifas: Array<{
    id: string; codigo: string; nombre: string; administracionNombre: string | null; claseNombre: string | null;
    categoriaNombre: string | null; tipoServicio: string; tipoCalculo: string; ivaPct: number;
    seccion: string; variante: string | null; ivaNoObjeto: boolean;
    actual: { cuotaFija: number | null; precioUnitario: number | null; valorReferencia: number | null };
    nuevo:  { cuotaFija: number | null; precioUnitario: number | null; valorReferencia: number | null };
  }>;
}

interface ActualizarTarifaDto {
  porcentaje?: number;               // modo porcentaje (excluyente con cuotaFija/precioUnitario/precios)
  cuotaFija?: number; precioUnitario?: number; precios?: number[];   // modo valores directos
  ivaPct?: number;                   // cambio fiscal (puede ir solo → tipo CAMBIO_FISCAL)
  vigenciaDesde?: string;            // YYYY-MM-DD, default hoy; debe ser ≥ vigenciaDesde de la versión actual
  motivo: string;                    // obligatorio (≥ 3 caracteres)
}
```

## Endpoints

| Método | Ruta | Body / query | Respuesta |
|---|---|---|---|
| GET | `/tarifas/vigentes` | `?tipoServicio&administracionId&categoriaId&claseTarifaId&concepto&buscar&fecha` (todos opcionales; `fecha` default hoy) | `TarifaVigenteDto[]` (precios null) |
| GET | `/tarifas/servicios` | — | `{ tipoServicio: string; concepto: string | null; seccion: string; total: number }[]` (distintos entre vigentes) |
| GET | `/tarifas/contratacion/cotizar` | `?administracionId&tipoServicio&claseTarifaId?&variante?&cantidad` | `{ tarifa: TarifaVigenteDto; cantidad; importe; ivaPct; iva; total; ivaNoObjeto }` (tarifa de contratación vigente; 404 si no hay) |
| GET | `/tarifas/movimientos` | `?codigo&actualizacionId&tipo&page=1&limit=50` | `{ data: TarifaMovimientoDto[]; total; page; limit }` |
| GET | `/tarifas/catalogo/categorias` | — | `CategoriaTarifaDto[]` (con `clases`, orden asc) |
| PATCH | `/tarifas/catalogo/categorias/:id` | `{ nombre?, descripcion?, ivaPct?, activo?, vigenciaDesde?, motivo? }` | `CategoriaTarifaDto`. Si cambia `ivaPct` → nueva versión (CAMBIO_FISCAL) en cada tarifa vigente de las clases **sin override**. |
| PATCH | `/tarifas/catalogo/clases/:id` | `{ nombre?, ivaPct?: number \| null, categoriaId?, activo?, vigenciaDesde?, motivo? }` | `ClaseTarifaDto`. Si cambia el IVA efectivo → nueva versión (CAMBIO_FISCAL) en cada tarifa vigente de la clase. |
| GET | `/tarifas/:id` | — | `TarifaVigenteDto` con `precios` |
| GET | `/tarifas/:id/kardex` | — | `KardexDto` |
| POST | `/tarifas/:id/actualizar` | `ActualizarTarifaDto` | `{ tarifa: TarifaVigenteDto; movimiento: TarifaMovimientoDto }` |
| POST | `/tarifas/actualizaciones/preview` | `PreviewMasivaDto` | `PreviewMasivaResult` (no escribe) |
| POST | `/tarifas/actualizaciones/aplicar` | `AplicarMasivaDto` | `ActualizacionTarifariaDto & { excluidosProgramados: number }` (estado `aplicada`; `excluidosProgramados` solo en la respuesta) |
| GET | `/tarifas/actualizaciones/lista` | `?estado` (existente) | `ActualizacionTarifariaDto[]` |
| GET | `/tarifas/actualizaciones/:id` | — | `ActualizacionTarifariaDto` con `movimientos` |

Endpoints existentes (`GET /tarifas`, `/tarifas/calcular`, `POST /tarifas`, `PATCH /tarifas/:id`,
correcciones, ajustes, `POST /tarifas/actualizaciones`, `POST /tarifas/actualizaciones/:id/aplicar`,
`simular-impacto`) se conservan con estos cambios:

- `PATCH /tarifas/:id` acepta SOLO metadatos (`nombre`, `activo`, `vigenciaHasta`); cualquier campo de
  valor o IVA responde 400. Los cambios de valor/IVA van por `/actualizar` para no perder histórico.
- `POST /tarifas` valida con `CreateTarifaDto`; `codigo` duplicado → 409.
- `GET /tarifas/calcular?tipoServicio&consumoM3&fecha&administracionId&claseTarifaId`: los dos últimos
  son opcionales y aplican la misma preferencia por especificidad que facturación; `tipoServicio` es
  case-insensitive. Sin ellos se suman todas las tarifas vigentes del servicio (comportamiento previo).
- Todas las queries/bodies nuevos se validan con `forbidNonWhitelisted`: parámetros desconocidos → 400.
- Versionado concurrente del mismo linaje (violación de `(codigo, version)`) → 409, no 500.

## Reglas de versionado

1. Solo se puede actualizar la **última versión** del linaje (409 si no lo es).
2. `vigenciaDesde` nueva ≥ `vigenciaDesde` de la versión actual (400 si es anterior). Si es igual, la
   versión actual queda cerrada antes de su propio inicio (anulada el mismo día) pero se conserva.
3. Transacción: cerrar anterior (`vigenciaHasta = nueva − 1 ms`) → crear nueva (`version + 1`,
   `tarifaAnteriorId`) → crear movimiento → re-apuntar `correcciones_tarifarias` activas a la nueva versión.
4. Porcentaje: `aplicarPorcentaje` (4 decimales en precios; el IVA no se toca).
5. Masivo: una `ActualizacionTarifaria` + una versión y un movimiento por tarifa afectada, todo en una
   transacción; `filtro` y `totalTarifas` en la cabecera. El preview usa exactamente la misma selección.
6. Usuario: `req.user.userId ?? req.user.sub` y `req.user.email` → `usuarioId`, `usuarioEmail`, `creadoPor`, `aplicadoPor`.

## Facturación

- `FacturacionService.tarifasVigentesPorServicio(fecha, administracionId, claseTarifaId?)`: filtra
  `claseTarifaId ∈ {clase del contrato, null}` y por servicio prefiere la combinación más específica:
  (admin, clase) > (admin, sin clase) > (global, clase) > (global, sin clase).
- La clase del contrato = `contrato.tipoContratacion.claseTarifaId`.
- `billing-calculator.calcularServicio` soporta `tabla` (m³ redondeados: fracción > 0.5 sube), `lineal` y
  `lineal_excedente` (`cantidadIncluida`). La facturación periódica filtra `seccion = PERIODICA`.
- El configurador fiscal (categoría/clase) no propaga a `seccion = CONTRATACION` ni a tarifas `ivaNoObjeto`.
- CFDI: el traslado a nivel comprobante usa como `Base` la suma de importes gravados y una `TasaOCuota`
  por tasa distinta presente (antes: `Base = subtotal`, tasa fija 0.16).
