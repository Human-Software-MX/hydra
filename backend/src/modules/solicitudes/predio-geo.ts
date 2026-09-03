/**
 * Coordenadas del predio capturadas en `Solicitud.formData.predioDir` (mapa del formulario
 * CEA-FUS01). El JSON puede traer número, cadena numérica, null o nada; solo se propaga un
 * par completo y válido a `Domicilio.gpsLat/gpsLng` (Decimal(10,7)).
 */

function aNumero(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/** Redondea a 7 decimales (precisión de la columna). */
export function redondearCoord(v: number): number {
  return Math.round(v * 1e7) / 1e7;
}

export function coordenadasPredio(
  predioDir: Record<string, unknown>,
): { gpsLat: number; gpsLng: number } | undefined {
  const lat = aNumero(predioDir.gpsLat);
  const lng = aNumero(predioDir.gpsLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { gpsLat: redondearCoord(lat), gpsLng: redondearCoord(lng) };
}
