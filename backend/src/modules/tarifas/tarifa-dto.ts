/**
 * Serialización de tarifas, movimientos (Kardex) y lotes de actualización.
 *
 * Funciones puras: reciben filas de Prisma (con sus `Decimal`/`Json`) y devuelven
 * los DTOs del contrato (`docs/tarifas-kardex-api.md`) con números y fechas ISO.
 * Sin dependencias de Nest/Prisma para poder verificarse de forma aislada.
 */
import { SECCION_PERIODICA, snapshotValores, valorReferencia, ValoresTarifa } from './tarifa-valores';

// ─── Filas de entrada (estructurales, compatibles con los tipos de Prisma) ────

export interface TarifaFila {
  id: string;
  codigo: string;
  nombre: string;
  tipoServicio: string;
  concepto: string | null;
  tipoCalculo: string;
  administracionId: string | null;
  claseTarifaId: string | null;
  rangoMinM3: number | null;
  rangoMaxM3: number | null;
  precioUnitario: unknown;
  cuotaFija: unknown;
  /** Ausente cuando la consulta omitió la tabla de precios (listados ligeros). */
  precios?: unknown;
  /** Columna denormalizada (`tarifas.valor_referencia`); permite listar sin cargar `precios`. */
  valorReferencia?: unknown;
  /** Catálogo de la tarifa: PERIODICA | CONTRATACION (ausente = PERIODICA). */
  seccion?: string;
  /** Variante cuando la columna TARIFA del Excel no es una clase (materiales, diámetro, plan de medidor). */
  variante?: string | null;
  /** `consumoAsignadoM3`, `cantidadIncluida` (lineal_excedente), `variable`, `subconcepto`. */
  parametros?: unknown;
  /** «No objeto de IVA» (multas, recargos): el traslado es 0. */
  ivaNoObjeto?: boolean;
  ivaPct: unknown;
  vigenciaDesde: Date;
  vigenciaHasta: Date | null;
  activo: boolean;
  version: number;
  tarifaAnteriorId: string | null;
  motivo: string | null;
  creadoPor: string | null;
  createdAt: Date;
  claseTarifa?: {
    id: string;
    codigo: string;
    nombre: string;
    categoriaId: string;
    categoria?: { id: string; codigo: string; nombre: string } | null;
  } | null;
}

export interface MovimientoFila {
  id: string;
  codigo: string;
  tarifaId: string;
  tarifaAnteriorId: string | null;
  tipo: string;
  porcentaje: unknown;
  valoresAnteriores: unknown;
  valoresNuevos: unknown;
  vigenciaDesde: Date;
  motivo: string | null;
  actualizacionId: string | null;
  usuarioId: string | null;
  usuarioEmail: string | null;
  createdAt: Date;
  tarifa: {
    nombre: string;
    version: number;
    tipoServicio: string;
    administracionId: string | null;
    seccion?: string;
    variante?: string | null;
    claseTarifa?: { nombre: string } | null;
  };
}

export interface ActualizacionFila {
  id: string;
  descripcion: string;
  fechaPublicacion: Date;
  fechaAplicacion: Date;
  fuenteOficial: string | null;
  estado: string;
  porcentaje: unknown;
  filtro: unknown;
  totalTarifas: number | null;
  aplicadoPor: string | null;
  createdAt: Date;
}

// ─── DTOs de salida ───────────────────────────────────────────────────────────

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
  /** Sólo en `GET /tarifas/:id`; en listados viaja null. */
  precios: number[] | null;
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
  /** Catálogo al que pertenece: PERIODICA (consumo) | CONTRATACION (cargos únicos). */
  seccion: string;
  variante: string | null;
  parametros: Record<string, unknown> | null;
  ivaNoObjeto: boolean;
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
  version: number;
  tarifaNombre: string;
  claseNombre: string | null;
  administracionNombre: string | null;
  tipoServicio: string;
  seccion: string;
  variante: string | null;
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

export interface ClaseTarifaDto {
  id: string;
  codigo: string;
  nombre: string;
  categoriaId: string;
  categoriaCodigo: string;
  categoriaNombre: string;
  ivaPct: number | null;
  ivaEfectivo: number;
  sigeTpsId: number | null;
  orden: number;
  activo: boolean;
  totalTarifasVigentes: number;
}

export interface FiltroTarifas {
  administracionId?: string;
  categoriaId?: string;
  claseTarifaId?: string;
  tipoServicio?: string;
  concepto?: string;
  buscar?: string;
  /** PERIODICA | CONTRATACION; ausente = ambos catálogos. */
  seccion?: string;
  variante?: string;
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
  movimientos?: TarifaMovimientoDto[];
}

/**
 * Cotización de un cargo único de contratación (`GET /tarifas/contratacion/cotizar`):
 * la tarifa vigente resuelta más el importe calculado para la cantidad pedida.
 */
export interface CotizacionContratacionDto {
  tarifa: TarifaVigenteDto;
  /** Unidades cotizadas (metros de toma/descarga, piezas…); 0 = sólo la cuota base. */
  cantidad: number;
  importe: number;
  ivaPct: number;
  iva: number;
  total: number;
  ivaNoObjeto: boolean;
}

export interface KardexDto {
  codigo: string;
  tarifaVigente: TarifaVigenteDto | null;
  versiones: TarifaVigenteDto[];
  movimientos: TarifaMovimientoDto[];
}

// ─── Mapeo ────────────────────────────────────────────────────────────────────

const aNumero = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Índice id → nombre de administración (Tarifa no tiene relación Prisma con Administracion). */
export function mapaAdministraciones(admins: Array<{ id: string; nombre: string }>): Map<string, string> {
  return new Map(admins.map((a) => [a.id, a.nombre]));
}

export function toTarifaDto(
  t: TarifaFila,
  opts: { administracionNombre?: string | null; incluirPrecios?: boolean } = {},
): TarifaVigenteDto {
  const valores = snapshotValores(t);
  const categoria = t.claseTarifa?.categoria ?? null;
  return {
    id: t.id,
    codigo: t.codigo,
    nombre: t.nombre,
    tipoServicio: t.tipoServicio,
    concepto: t.concepto,
    tipoCalculo: t.tipoCalculo,
    administracionId: t.administracionId,
    administracionNombre: opts.administracionNombre ?? null,
    claseTarifaId: t.claseTarifaId,
    claseCodigo: t.claseTarifa?.codigo ?? null,
    claseNombre: t.claseTarifa?.nombre ?? null,
    categoriaId: categoria?.id ?? t.claseTarifa?.categoriaId ?? null,
    categoriaCodigo: categoria?.codigo ?? null,
    categoriaNombre: categoria?.nombre ?? null,
    rangoMinM3: t.rangoMinM3,
    rangoMaxM3: t.rangoMaxM3,
    precioUnitario: valores.precioUnitario,
    cuotaFija: valores.cuotaFija,
    precios: opts.incluirPrecios ? valores.precios : null,
    // Si la consulta omitió `precios`, una tabla no tiene valor de referencia
    // calculable: se devuelve null en vez del precio del m³ excedente, que
    // significa otra cosa y falsearía la comparación en los listados.
    valorReferencia:
      t.valorReferencia !== undefined && t.valorReferencia !== null
        ? Number(t.valorReferencia)
        : t.precios === undefined && t.tipoCalculo === 'tabla'
          ? null
          : valorReferencia(valores),
    ivaPct: valores.ivaPct,
    vigenciaDesde: t.vigenciaDesde.toISOString(),
    vigenciaHasta: t.vigenciaHasta ? t.vigenciaHasta.toISOString() : null,
    activo: t.activo,
    version: t.version,
    tarifaAnteriorId: t.tarifaAnteriorId,
    motivo: t.motivo,
    creadoPor: t.creadoPor,
    createdAt: t.createdAt.toISOString(),
    seccion: t.seccion ?? SECCION_PERIODICA,
    variante: t.variante ?? null,
    parametros: (t.parametros as Record<string, unknown> | null) ?? null,
    ivaNoObjeto: t.ivaNoObjeto ?? false,
  };
}

export function toMovimientoDto(m: MovimientoFila, administracionNombre?: string | null): TarifaMovimientoDto {
  return {
    id: m.id,
    codigo: m.codigo,
    tarifaId: m.tarifaId,
    tarifaAnteriorId: m.tarifaAnteriorId,
    tipo: m.tipo,
    porcentaje: aNumero(m.porcentaje),
    valoresAnteriores: (m.valoresAnteriores as ValoresTarifa | null) ?? null,
    valoresNuevos: m.valoresNuevos as ValoresTarifa,
    vigenciaDesde: m.vigenciaDesde.toISOString(),
    motivo: m.motivo,
    actualizacionId: m.actualizacionId,
    usuarioId: m.usuarioId,
    usuarioEmail: m.usuarioEmail,
    createdAt: m.createdAt.toISOString(),
    version: m.tarifa.version,
    tarifaNombre: m.tarifa.nombre,
    claseNombre: m.tarifa.claseTarifa?.nombre ?? null,
    administracionNombre: administracionNombre ?? null,
    tipoServicio: m.tarifa.tipoServicio,
    seccion: m.tarifa.seccion ?? SECCION_PERIODICA,
    variante: m.tarifa.variante ?? null,
  };
}

export function toActualizacionDto(
  a: ActualizacionFila,
  movimientos?: TarifaMovimientoDto[],
): ActualizacionTarifariaDto {
  return {
    id: a.id,
    descripcion: a.descripcion,
    fechaPublicacion: a.fechaPublicacion.toISOString(),
    fechaAplicacion: a.fechaAplicacion.toISOString(),
    fuenteOficial: a.fuenteOficial,
    estado: a.estado,
    porcentaje: aNumero(a.porcentaje),
    filtro: (a.filtro as FiltroTarifas | null) ?? null,
    totalTarifas: a.totalTarifas,
    aplicadoPor: a.aplicadoPor,
    createdAt: a.createdAt.toISOString(),
    ...(movimientos ? { movimientos } : {}),
  };
}

export function toCategoriaDto(
  c: {
    id: string;
    codigo: string;
    nombre: string;
    descripcion: string | null;
    ivaPct: unknown;
    orden: number;
    activo: boolean;
    clases?: Array<Parameters<typeof toClaseDto>[0]>;
  },
  totalesPorClase: Map<string, number> = new Map(),
): CategoriaTarifaDto {
  const ivaPct = aNumero(c.ivaPct) ?? 0;
  return {
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
    descripcion: c.descripcion,
    ivaPct,
    orden: c.orden,
    activo: c.activo,
    clases: (c.clases ?? []).map((cl) =>
      toClaseDto(
        { ...cl, categoria: cl.categoria ?? { id: c.id, codigo: c.codigo, nombre: c.nombre, ivaPct: c.ivaPct } },
        totalesPorClase.get(cl.id) ?? 0,
      ),
    ),
  };
}

export function toClaseDto(
  cl: {
    id: string;
    codigo: string;
    nombre: string;
    categoriaId: string;
    ivaPct: unknown;
    sigeTpsId: number | null;
    orden: number;
    activo: boolean;
    categoria?: { id: string; codigo: string; nombre: string; ivaPct: unknown } | null;
  },
  totalTarifasVigentes = 0,
): ClaseTarifaDto {
  const ivaClase = aNumero(cl.ivaPct);
  const ivaCategoria = aNumero(cl.categoria?.ivaPct) ?? 0;
  return {
    id: cl.id,
    codigo: cl.codigo,
    nombre: cl.nombre,
    categoriaId: cl.categoriaId,
    categoriaCodigo: cl.categoria?.codigo ?? '',
    categoriaNombre: cl.categoria?.nombre ?? '',
    ivaPct: ivaClase,
    ivaEfectivo: ivaClase ?? ivaCategoria,
    sigeTpsId: cl.sigeTpsId,
    orden: cl.orden,
    activo: cl.activo,
    totalTarifasVigentes,
  };
}
