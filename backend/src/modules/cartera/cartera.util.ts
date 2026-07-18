/**
 * Helpers puros de cartera (aging, score, redondeo). Sin dependencias de Nest
 * ni Prisma para que cualquier servicio (cartera, dunning) los importe sin
 * crear ciclos de módulos.
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Tolerancia de centavos para considerar un saldo como liquidado. */
export const EPSILON = 0.01;

export const hoyIso = (): string => new Date().toISOString().slice(0, 10);

/** Días naturales transcurridos desde `fechaIso` hasta `hoy` (negativo si es futura). */
export function diasEntre(fechaIso: string, hoy: string): number {
  const a = new Date(`${fechaIso}T00:00:00Z`).getTime();
  const b = new Date(`${hoy}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

export function bucketPorDias(diasVencido: number): string {
  if (diasVencido <= 0) return 'corriente';
  if (diasVencido <= 30) return 'b1_30';
  if (diasVencido <= 60) return 'b31_60';
  if (diasVencido <= 90) return 'b61_90';
  return 'b90_mas';
}

export function categoriaPorDias(diasMoraMax: number): string {
  if (diasMoraMax <= 0) return 'AL_CORRIENTE';
  if (diasMoraMax <= 30) return 'INCIPIENTE';
  if (diasMoraMax <= 60) return 'MODERADO';
  if (diasMoraMax <= 90) return 'ALTO';
  return 'CRITICO';
}

/** Fórmula única de score de morosidad (0-100). */
export function scoreMorosidad(docsVencidos: number, diasMoraMax: number): number {
  return Math.min(100, 25 * docsVencidos + Math.round(diasMoraMax / 3));
}

/** Mapa bucket → campo denormalizado en EstadoCuenta. */
export const BUCKET_FIELD: Record<
  string,
  'bucketCorriente' | 'bucket1_30' | 'bucket31_60' | 'bucket61_90' | 'bucket90_mas'
> = {
  corriente: 'bucketCorriente',
  b1_30: 'bucket1_30',
  b31_60: 'bucket31_60',
  b61_90: 'bucket61_90',
  b90_mas: 'bucket90_mas',
};
