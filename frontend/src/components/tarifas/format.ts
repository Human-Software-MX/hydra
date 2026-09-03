import type { ValoresTarifa } from '@/api/tarifas';

/** Importe en pesos. Los precios unitarios usan `max: 4` porque el motor guarda 4 decimales. */
export function fmtMXN(n: number | null | undefined, opts: { max?: number } = {}): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: opts.max ?? 2,
  }).format(Number(n));
}

/**
 * Precio unitario / cuota fija: hasta 4 decimales, que es la precisión con la que el motor
 * factura (`aplicarPorcentaje` redondea a 4). Los importes agregados usan {@link fmtMXN}.
 */
export function fmtPrecio(n: number | null | undefined): string {
  return fmtMXN(n, { max: 4 });
}

export function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const texto = Number.isInteger(v) ? String(v) : v.toFixed(decimals);
  return `${v > 0 ? '+' : ''}${texto} %`;
}

/** dd/mm/yyyy a partir de un ISO o YYYY-MM-DD. */
export function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = soloFecha ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtFechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

/** YYYY-MM-DD de hoy, para los inputs de vigencia. */
export function hoyISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Mismo redondeo que `aplicarPorcentaje` en el backend (4 decimales). */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Aplica un porcentaje con la misma aritmética que el backend. */
export function aplicarPct(valor: number | null | undefined, porcentaje: number): number | null {
  if (valor == null || !Number.isFinite(Number(valor))) return null;
  return round4(Number(valor) * (1 + porcentaje / 100));
}

/**
 * Valor de referencia de un snapshot del Kardex: tabla → importe a 10 m³,
 * fijo → cuota fija, resto → precio unitario (misma regla que `valorReferencia` del backend).
 */
export function valorReferenciaDe(v: ValoresTarifa | null | undefined): number | null {
  if (!v) return null;
  if (v.tipoCalculo === 'tabla') {
    if (!v.precios?.length) return null;
    return v.precios[Math.min(10, v.precios.length - 1)] ?? null;
  }
  if (v.tipoCalculo === 'fijo') return v.cuotaFija;
  return v.precioUnitario;
}

/** Δ% entre dos importes; null cuando no se puede calcular. */
export function deltaPct(actual: number | null | undefined, nuevo: number | null | undefined): number | null {
  if (actual == null || nuevo == null || Number(actual) === 0) return null;
  return ((Number(nuevo) - Number(actual)) / Number(actual)) * 100;
}

export const IVA_LABEL = (ivaPct: number) => (ivaPct === 0 ? 'Exenta 0%' : `IVA ${ivaPct}%`);

const MOVIMIENTO_LABEL: Record<string, string> = {
  ALTA: 'Alta',
  CAMBIO_VALOR: 'Cambio de valor',
  AJUSTE_PORCENTUAL: 'Ajuste porcentual',
  AJUSTE_MASIVO: 'Ajuste masivo',
  CAMBIO_FISCAL: 'Cambio fiscal',
  BAJA: 'Baja',
};

/** Tipos de `TarifaMovimiento` del Kardex, en el orden en que se muestran en los filtros. */
export const TIPOS_MOVIMIENTO = Object.keys(MOVIMIENTO_LABEL);

export const etiquetaMovimiento = (tipo: string) => MOVIMIENTO_LABEL[tipo] ?? tipo;

export type EstadoVersion = 'Vigente' | 'Histórica' | 'Programada' | 'Anulada';

/**
 * Vigente hoy, programada a futuro, histórica o **anulada**: al versionar con la misma
 * vigencia, el backend cierra la versión anterior 1 ms antes de su propio inicio, así que
 * `vigenciaHasta < vigenciaDesde` significa que nunca estuvo vigente.
 */
export function estadoVersion(vigenciaDesde: string, vigenciaHasta: string | null): EstadoVersion {
  const ahora = Date.now();
  const desde = new Date(vigenciaDesde).getTime();
  const hasta = vigenciaHasta ? new Date(vigenciaHasta).getTime() : null;
  if (hasta != null && hasta < desde) return 'Anulada';
  if (desde > ahora) return 'Programada';
  if (hasta != null && hasta < ahora) return 'Histórica';
  return 'Vigente';
}
