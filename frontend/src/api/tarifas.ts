import { apiRequest } from './client';

// ── Catálogo fiscal (categorías / clases) ────────────────────────────────────

/** Snapshot de los valores de una versión de tarifa (Kardex). */
export interface ValoresTarifa {
  tipoCalculo: string;
  rangoMinM3: number | null;
  rangoMaxM3: number | null;
  cuotaFija: number | null;
  precioUnitario: number | null;
  precios: number[] | null;
  ivaPct: number;
}

export interface ClaseTarifaDto {
  id: string;
  codigo: string;
  nombre: string;
  categoriaId: string;
  categoriaCodigo: string;
  categoriaNombre: string;
  /** null = hereda el IVA de su categoría */
  ivaPct: number | null;
  ivaEfectivo: number;
  sigeTpsId: number | null;
  orden: number;
  activo: boolean;
  totalTarifasVigentes: number;
}

export interface CategoriaTarifaDto {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  ivaPct: number;
  orden: number;
  activo: boolean;
  clases: ClaseTarifaDto[];
}

// ── Tarifas (una fila por versión) ───────────────────────────────────────────

export interface TarifaVigenteDto {
  id: string;
  codigo: string;
  nombre: string;
  tipoServicio: string;
  concepto: string | null;
  tipoCalculo: string;
  administracionId: string | null;
  administracionNombre: string | null;
  claseTarifaId: string | null;
  claseCodigo: string | null;
  claseNombre: string | null;
  categoriaId: string | null;
  categoriaCodigo: string | null;
  categoriaNombre: string | null;
  rangoMinM3: number | null;
  rangoMaxM3: number | null;
  precioUnitario: number | null;
  cuotaFija: number | null;
  /** Solo en `GET /tarifas/:id`; en listados llega null. */
  precios: number[] | null;
  /** tabla: importe a 10 m³; fijo: cuotaFija; resto: precioUnitario. */
  valorReferencia: number | null;
  ivaPct: number;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
  activo: boolean;
  version: number;
  tarifaAnteriorId: string | null;
  motivo: string | null;
  creadoPor: string | null;
  createdAt: string;
}

export interface TarifaMovimientoDto {
  id: string;
  codigo: string;
  tarifaId: string;
  tarifaAnteriorId: string | null;
  tipo: string;
  porcentaje: number | null;
  valoresAnteriores: ValoresTarifa | null;
  valoresNuevos: ValoresTarifa;
  vigenciaDesde: string;
  motivo: string | null;
  actualizacionId: string | null;
  usuarioId: string | null;
  usuarioEmail: string | null;
  createdAt: string;
  /** Versión resultante del movimiento. */
  version: number;
  tarifaNombre: string;
  claseNombre: string | null;
  administracionNombre: string | null;
  tipoServicio: string;
}

export interface KardexDto {
  codigo: string;
  /** Versión vigente hoy (null si ninguna). */
  tarifaVigente: TarifaVigenteDto | null;
  /** Todas las versiones, `version` desc, `precios` null. */
  versiones: TarifaVigenteDto[];
  /** `createdAt` desc. */
  movimientos: TarifaMovimientoDto[];
}

export interface FiltroTarifas {
  administracionId?: string;
  categoriaId?: string;
  claseTarifaId?: string;
  tipoServicio?: string;
  concepto?: string;
  buscar?: string;
}

export interface ServicioTarifaDto {
  tipoServicio: string;
  concepto: string | null;
  total: number;
}

export interface MovimientosPage {
  data: TarifaMovimientoDto[];
  total: number;
  page: number;
  limit: number;
}

export interface ActualizacionTarifariaDto {
  id: string;
  descripcion: string;
  fechaPublicacion: string;
  fechaAplicacion: string;
  fuenteOficial: string | null;
  estado: string;
  porcentaje: number | null;
  filtro: FiltroTarifas | null;
  totalTarifas: number | null;
  aplicadoPor: string | null;
  createdAt: string;
  /** Solo en `GET /tarifas/actualizaciones/:id`. */
  movimientos?: TarifaMovimientoDto[];
}

/** Ajuste manual a la facturación de un contrato/periodo. Los montos llegan como Decimal serializado. */
export interface AjusteTarifarioDto {
  id: string;
  contratoId: string;
  periodo: string;
  tipo: string;
  concepto: string;
  montoOriginal: string | number;
  montoAjustado: string | number;
  motivo: string;
  aprobadoPor: string | null;
  createdAt: string;
}

export interface CalculoMonto {
  consumoM3: number;
  subtotal: number;
  iva: number;
  total: number;
  desglose: { rango: string; m3: number; precio: number; subtotal: number }[];
}

// ── DTOs de escritura ────────────────────────────────────────────────────────

export interface ActualizarTarifaDto {
  /** Modo porcentaje (excluyente con cuotaFija/precioUnitario/precios). */
  porcentaje?: number;
  cuotaFija?: number;
  precioUnitario?: number;
  precios?: number[];
  /** Cambio fiscal; puede ir solo → movimiento CAMBIO_FISCAL. */
  ivaPct?: number;
  /** YYYY-MM-DD; default hoy. */
  vigenciaDesde?: string;
  motivo: string;
}

export interface PreviewMasivaDto {
  filtro: FiltroTarifas;
  porcentaje: number;
  /** YYYY-MM-DD */
  vigenciaDesde?: string;
}

export interface AplicarMasivaDto extends PreviewMasivaDto {
  motivo: string;
  fuenteOficial?: string;
}

export interface PreviewMasivaTarifa {
  id: string;
  codigo: string;
  nombre: string;
  administracionNombre: string | null;
  claseNombre: string | null;
  categoriaNombre: string | null;
  tipoServicio: string;
  tipoCalculo: string;
  ivaPct: number;
  actual: { cuotaFija: number | null; precioUnitario: number | null; valorReferencia: number | null };
  nuevo: { cuotaFija: number | null; precioUnitario: number | null; valorReferencia: number | null };
}

export interface PreviewMasivaExcluido {
  codigo: string;
  nombre: string;
  vigenciaDesdeProgramada: string;
}

export interface PreviewMasivaResult {
  total: number;
  porcentaje: number;
  vigenciaDesde: string;
  tarifas: PreviewMasivaTarifa[];
  /** Tarifas con una versión programada a futuro: el lote no las toca. */
  excluidosProgramados?: number;
  excluidos?: PreviewMasivaExcluido[];
}

export interface UpdateCategoriaTarifaDto {
  nombre?: string;
  descripcion?: string;
  ivaPct?: number;
  activo?: boolean;
  /** YYYY-MM-DD; vigencia de las versiones creadas por el cambio fiscal. */
  vigenciaDesde?: string;
  motivo?: string;
}

export interface UpdateClaseTarifaDto {
  nombre?: string;
  /** null = hereda el IVA de la categoría. */
  ivaPct?: number | null;
  categoriaId?: string;
  activo?: boolean;
  vigenciaDesde?: string;
  motivo?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// ── Lecturas ─────────────────────────────────────────────────────────────────

export function fetchTarifasVigentes(
  filtro?: FiltroTarifas & { fecha?: string },
): Promise<TarifaVigenteDto[]>;
/** @deprecated pasar un {@link FiltroTarifas} */
export function fetchTarifasVigentes(tipoServicio?: string, fecha?: string): Promise<TarifaVigenteDto[]>;
export function fetchTarifasVigentes(
  arg?: string | (FiltroTarifas & { fecha?: string }),
  fecha?: string,
): Promise<TarifaVigenteDto[]> {
  const filtro: FiltroTarifas & { fecha?: string } =
    typeof arg === 'string' || arg === undefined ? { tipoServicio: arg, fecha } : arg;
  return apiRequest<TarifaVigenteDto[]>(
    `/tarifas/vigentes${toQuery({
      tipoServicio: filtro.tipoServicio,
      administracionId: filtro.administracionId,
      categoriaId: filtro.categoriaId,
      claseTarifaId: filtro.claseTarifaId,
      concepto: filtro.concepto,
      buscar: filtro.buscar,
      fecha: filtro.fecha,
    })}`,
  );
}

export const fetchServiciosTarifa = () =>
  apiRequest<ServicioTarifaDto[]>('/tarifas/servicios');

export const fetchMovimientosTarifa = (params?: {
  codigo?: string;
  actualizacionId?: string;
  tipo?: string;
  page?: number;
  limit?: number;
}) => apiRequest<MovimientosPage>(`/tarifas/movimientos${toQuery({ ...params })}`);

export const fetchCategoriasTarifa = () =>
  apiRequest<CategoriaTarifaDto[]>('/tarifas/catalogo/categorias');

export const fetchTarifaDetalle = (id: string) =>
  apiRequest<TarifaVigenteDto>(`/tarifas/${id}`);

export const fetchKardexTarifa = (id: string) =>
  apiRequest<KardexDto>(`/tarifas/${id}/kardex`);

export const fetchActualizaciones = (estado?: string) =>
  apiRequest<ActualizacionTarifariaDto[]>(`/tarifas/actualizaciones/lista${toQuery({ estado })}`);

export const fetchActualizacionDetalle = (id: string) =>
  apiRequest<ActualizacionTarifariaDto>(`/tarifas/actualizaciones/${id}`);

/**
 * Cálculo por consumo. Sin `administracionId`/`claseTarifaId` el backend suma todas las
 * administraciones y clases del servicio, así que el simulador siempre los envía.
 */
export const calcularMonto = (
  tipoServicio: string,
  consumoM3: number,
  opts: { administracionId?: string; claseTarifaId?: string } = {},
) =>
  apiRequest<CalculoMonto>(
    `/tarifas/calcular${toQuery({
      tipoServicio,
      consumoM3,
      administracionId: opts.administracionId,
      claseTarifaId: opts.claseTarifaId,
    })}`,
  );

export const fetchAjustesTarifarios = (contratoId?: string) =>
  apiRequest<AjusteTarifarioDto[]>(
    `/tarifas/ajustes/lista${contratoId ? `?contratoId=${encodeURIComponent(contratoId)}` : ''}`
  );

// ── Escrituras ───────────────────────────────────────────────────────────────

export const updateCategoriaTarifa = (id: string, dto: UpdateCategoriaTarifaDto) =>
  apiRequest<CategoriaTarifaDto>(`/tarifas/catalogo/categorias/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });

export const updateClaseTarifa = (id: string, dto: UpdateClaseTarifaDto) =>
  apiRequest<ClaseTarifaDto>(`/tarifas/catalogo/clases/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });

export const actualizarTarifa = (id: string, dto: ActualizarTarifaDto) =>
  apiRequest<{ tarifa: TarifaVigenteDto; movimiento: TarifaMovimientoDto }>(
    `/tarifas/${id}/actualizar`,
    { method: 'POST', body: JSON.stringify(dto) },
  );

export const previewActualizacionMasiva = (dto: PreviewMasivaDto) =>
  apiRequest<PreviewMasivaResult>('/tarifas/actualizaciones/preview', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const aplicarActualizacionMasiva = (dto: AplicarMasivaDto) =>
  apiRequest<ActualizacionTarifariaDto>('/tarifas/actualizaciones/aplicar', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const crearAjusteTarifario = (dto: {
  contratoId: string;
  periodo: string;
  tipo: string;
  concepto: string;
  montoOriginal: number;
  montoAjustado: number;
  motivo: string;
  aprobadoPor?: string;
}) =>
  apiRequest<AjusteTarifarioDto>('/tarifas/ajustes', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const crearActualizacion = (dto: {
  descripcion: string;
  fechaPublicacion: string;
  fechaAplicacion: string;
  fuenteOficial?: string;
}) =>
  apiRequest<ActualizacionTarifariaDto>('/tarifas/actualizaciones', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const aplicarActualizacion = (id: string) =>
  apiRequest<ActualizacionTarifariaDto>(`/tarifas/actualizaciones/${id}/aplicar`, {
    method: 'POST',
    body: JSON.stringify({ aplicadoPor: 'SISTEMA' }),
  });
