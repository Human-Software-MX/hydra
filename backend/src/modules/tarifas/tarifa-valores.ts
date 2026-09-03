/**
 * Helpers puros del versionado de tarifas (Kardex).
 *
 * Sin dependencias de Prisma/NestJS para poder usarse desde el seed
 * (`prisma/tarifas-periodicas-import.ts`) y desde `TarifasService`, y para
 * verificarse de forma aislada (tarifas.service.spec.ts).
 */

/** Tipos de movimiento del Kardex de tarifas. */
export const TIPOS_MOVIMIENTO = {
  ALTA: 'ALTA',
  CAMBIO_VALOR: 'CAMBIO_VALOR',
  AJUSTE_PORCENTUAL: 'AJUSTE_PORCENTUAL',
  AJUSTE_MASIVO: 'AJUSTE_MASIVO',
  CAMBIO_FISCAL: 'CAMBIO_FISCAL',
  BAJA: 'BAJA',
} as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[keyof typeof TIPOS_MOVIMIENTO];

/** Tipos de cálculo soportados por el motor (`billing-calculator.ts`). */
export const TIPOS_CALCULO = ['escalonado', 'variable', 'fijo', 'tabla', 'lineal'] as const;
export type TipoCalculo = (typeof TIPOS_CALCULO)[number];

/**
 * Valores económicos de una versión de tarifa. Es lo que se copia al Kardex
 * como `valoresAnteriores` / `valoresNuevos` y lo que se transforma al aplicar
 * un porcentaje.
 */
export interface ValoresTarifa {
  tipoCalculo: string;
  rangoMinM3: number | null;
  rangoMaxM3: number | null;
  /** Precio base / cuota fija (tabla: cargo fijo para consumo > rangoMaxM3). */
  cuotaFija: number | null;
  /** Precio por m³ (tabla: m³ adicional sobre rangoMaxM3; lineal/variable: precio proporcional). */
  precioUnitario: number | null;
  /** tipoCalculo=tabla: importe acumulado por m³, índice = m³ (0..rangoMaxM3). */
  precios: number[] | null;
  ivaPct: number;
}

/** Redondeo a 4 decimales para precios unitarios y tablas (columnas DECIMAL(12,4)). */
export function redondear4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** Redondeo a 2 decimales para porcentajes de IVA (DECIMAL(5,2)). */
export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Extrae los valores económicos de una fila `Tarifa` (Decimal/Json de Prisma o números planos). */
export function snapshotValores(t: {
  tipoCalculo: string;
  rangoMinM3?: number | null;
  rangoMaxM3?: number | null;
  cuotaFija?: unknown;
  precioUnitario?: unknown;
  precios?: unknown;
  ivaPct?: unknown;
}): ValoresTarifa {
  const precios = Array.isArray(t.precios) ? (t.precios as unknown[]).map((p) => Number(p)) : null;
  return {
    tipoCalculo: t.tipoCalculo,
    rangoMinM3: t.rangoMinM3 ?? null,
    rangoMaxM3: t.rangoMaxM3 ?? null,
    cuotaFija: num(t.cuotaFija),
    precioUnitario: num(t.precioUnitario),
    precios,
    ivaPct: num(t.ivaPct) ?? 0,
  };
}

/**
 * Aplica un incremento porcentual (p. ej. 4.5 = +4.5 %; -2 = -2 %) a todos los
 * valores económicos de una tarifa. El IVA NO se toca (es configuración fiscal).
 * Los precios se redondean a 4 decimales; la tabla se recalcula elemento a elemento.
 */
export function aplicarPorcentaje(valores: ValoresTarifa, porcentaje: number): ValoresTarifa {
  if (!Number.isFinite(porcentaje)) throw new Error('Porcentaje inválido');
  const factor = 1 + porcentaje / 100;
  const ajusta = (v: number | null) => (v === null ? null : redondear4(v * factor));
  return {
    ...valores,
    cuotaFija: ajusta(valores.cuotaFija),
    precioUnitario: ajusta(valores.precioUnitario),
    precios: valores.precios ? valores.precios.map((p) => redondear4(p * factor)) : null,
  };
}

/** Diferencia porcentual entre dos valores (null si no es calculable). */
export function variacionPct(anterior: number | null, nuevo: number | null): number | null {
  if (anterior === null || nuevo === null || anterior === 0) return null;
  return redondear4(((nuevo - anterior) / anterior) * 100);
}

/**
 * Valor "representativo" de una tarifa para mostrar en listas y Kardex: para
 * tablas es el importe a `m3Referencia` m³ (por defecto 10, consumo doméstico
 * típico); para el resto el precio unitario o la cuota fija.
 */
export function valorReferencia(valores: ValoresTarifa, m3Referencia = 10): number | null {
  if (valores.tipoCalculo === 'tabla' && valores.precios?.length) {
    const idx = Math.min(m3Referencia, valores.precios.length - 1);
    return valores.precios[idx] ?? null;
  }
  if (valores.tipoCalculo === 'fijo') return valores.cuotaFija;
  return valores.precioUnitario ?? valores.cuotaFija;
}

/**
 * Cierra la vigencia anterior 1 ms antes del inicio de la nueva, para que las
 * consultas `vigenciaHasta >= fecha` (inclusive) nunca traslapen versiones.
 */
export function cierreVigenciaAnterior(vigenciaDesdeNueva: Date): Date {
  return new Date(vigenciaDesdeNueva.getTime() - 1);
}

/** Normaliza a fecha (00:00 local) una vigencia recibida como ISO `YYYY-MM-DD` o Date. */
export function normalizarVigencia(v?: string | Date | null): Date {
  if (!v) {
    const hoy = new Date();
    return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  }
  if (v instanceof Date) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha de vigencia inválida: ${v}`);
  return d;
}
