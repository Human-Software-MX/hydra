/**
 * Geometría espacial pura — fallback JS cuando PostGIS no está disponible.
 *
 * El módulo GIS intenta primero PostGIS (ST_DWithin / ST_Contains, índices y
 * precisión geodésica server-side); si la extensión no existe en el servidor,
 * estas funciones resuelven lo mismo en memoria con precisión suficiente
 * para radios urbanos (<50 km): haversine para distancia y ray-casting para
 * punto-en-polígono.
 */

const RADIO_TIERRA_M = 6_371_000;

/** Distancia haversine en metros entre dos coordenadas WGS84. */
export function distanciaHaversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(a));
}

/**
 * Punto-en-polígono por ray-casting. `anillo` es el anillo exterior de un
 * Polygon GeoJSON: array de [lng, lat] (la convención GeoJSON), cerrado o no.
 */
export function puntoEnPoligono(lat: number, lng: number, anillo: Array<[number, number]>): boolean {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    const cruza = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

export interface PoligonoGeoJSON {
  type: 'Polygon';
  /** [anillo exterior, ...huecos]; cada anillo es [[lng,lat], ...]. */
  coordinates: Array<Array<[number, number]>>;
}

/** Valida estructura mínima de un Polygon GeoJSON (anillo exterior ≥ 3 vértices). */
export function esPoligonoValido(p: unknown): p is PoligonoGeoJSON {
  const poly = p as PoligonoGeoJSON;
  return (
    poly?.type === 'Polygon' &&
    Array.isArray(poly.coordinates) &&
    Array.isArray(poly.coordinates[0]) &&
    poly.coordinates[0].length >= 3 &&
    poly.coordinates[0].every(
      (v) => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]),
    )
  );
}

/** Punto dentro del polígono considerando huecos (anillos interiores). */
export function puntoEnPoligonoGeoJSON(lat: number, lng: number, poligono: PoligonoGeoJSON): boolean {
  const [exterior, ...huecos] = poligono.coordinates;
  if (!puntoEnPoligono(lat, lng, exterior)) return false;
  return !huecos.some((h) => puntoEnPoligono(lat, lng, h));
}
