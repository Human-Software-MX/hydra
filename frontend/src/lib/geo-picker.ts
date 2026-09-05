/**
 * Lógica pura del selector de ubicación en mapa (MapPicker).
 *
 * Port del patrón de Agora Core (`ceaLookups/MapPicker.vue`): tiles de OpenStreetMap,
 * marcador arrastrable, click para ubicar, geocodificación con Nominatim acotada a
 * Querétaro y redondeo a 7 decimales (precisión de `Domicilio.gpsLat/gpsLng`, Decimal(10,7)).
 */

export interface Coordenadas {
  lat: number;
  lng: number;
}

/** Centro por defecto: Querétaro (mismo que `pages/Mapa.tsx` y que Agora Core). */
export const GEO_CENTRO_DEFAULT: Coordenadas = { lat: 20.5888, lng: -100.3899 };
export const GEO_ZOOM_DEFAULT = 14;
export const GEO_ZOOM_SELECCION = 16;
/** Umbral bajo el cual dos coordenadas se consideran iguales (ruido de redondeo). */
export const GEO_UMBRAL = 0.00001;
/** Caja de búsqueda de Nominatim para Querétaro: lon_min,lat_min,lon_max,lat_max. */
export const GEO_VIEWBOX_QRO = '-100.6,20.2,-99.8,21.0';
export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/** Redondea a 7 decimales, la precisión de la columna Decimal(10,7). */
export function redondearCoord(v: number): number {
  return Math.round(v * 1e7) / 1e7;
}

export function esLatValida(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function esLngValida(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function aNumero(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/**
 * Normaliza un par lat/lng proveniente de formulario o JSON (número, cadena, null,
 * undefined). Devuelve coordenadas válidas o `null` si falta o es inválido cualquiera.
 */
export function coordenadasDesde(lat: unknown, lng: unknown): Coordenadas | null {
  const la = aNumero(lat);
  const ln = aNumero(lng);
  if (!esLatValida(la) || !esLngValida(ln)) return null;
  return { lat: la, lng: ln };
}

/** `true` si las coordenadas difieren más allá del umbral (o una existe y la otra no). */
export function coordenadasDifieren(
  a: Coordenadas | null,
  b: Coordenadas | null,
  umbral = GEO_UMBRAL,
): boolean {
  if (!a || !b) return Boolean(a) !== Boolean(b);
  return Math.abs(a.lat - b.lat) > umbral || Math.abs(a.lng - b.lng) > umbral;
}

/** Texto legible para resúmenes: "20.588800, -100.389900". */
export function formatearCoordenadas(lat: unknown, lng: unknown): string {
  const c = coordenadasDesde(lat, lng);
  if (!c) return '';
  return `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
}

/** URL de búsqueda Nominatim (OSM) acotada a Querétaro, como en Agora Core. */
export function nominatimSearchUrl(q: string, email?: string): string {
  const params = new URLSearchParams({
    q,
    format: 'json',
    countrycodes: 'mx',
    viewbox: GEO_VIEWBOX_QRO,
    bounded: '1',
    limit: '1',
  });
  if (email) params.set('email', email);
  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Geocodifica una dirección con Nominatim. Devuelve `null` si no hay resultado o si la
 * petición falla (el llamador decide cómo avisar al usuario).
 */
export async function geocodificarDireccion(
  direccion: string,
  opts: { email?: string; fetchImpl?: FetchLike } = {},
): Promise<Coordenadas | null> {
  const q = direccion.trim();
  if (!q) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(nominatimSearchUrl(q, opts.email), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const primero = data[0] as { lat?: unknown; lon?: unknown };
    const c = coordenadasDesde(primero.lat, primero.lon);
    return c ? { lat: redondearCoord(c.lat), lng: redondearCoord(c.lng) } : null;
  } catch {
    return null;
  }
}

// ── Búsqueda con sugerencias (autocomplete estilo Google Maps) ───────────────

/** Resultado de búsqueda libre: lugar/POI/dirección con su etiqueta legible. */
export interface SugerenciaDireccion {
  etiqueta: string;
  coords: Coordenadas;
}

/** URL de sugerencias: misma caja de Querétaro, varias opciones, etiquetas en español. */
export function nominatimSuggestUrl(q: string, email?: string): string {
  const params = new URLSearchParams({
    q,
    format: 'json',
    countrycodes: 'mx',
    viewbox: GEO_VIEWBOX_QRO,
    bounded: '1',
    limit: '6',
    'accept-language': 'es',
  });
  if (email) params.set('email', email);
  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
}

/**
 * Busca lugares por texto libre (POIs, calles, colonias) dentro de Querétaro.
 * Devuelve lista vacía si no hay resultados o si la petición falla; deduplica
 * por etiqueta (Nominatim repite el mismo lugar con distintos osm_type).
 */
export async function buscarSugerenciasDireccion(
  q: string,
  opts: { email?: string; fetchImpl?: FetchLike } = {},
): Promise<SugerenciaDireccion[]> {
  const texto = q.trim();
  if (texto.length < 3) return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(nominatimSuggestUrl(texto, opts.email), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    const vistas = new Set<string>();
    const sugerencias: SugerenciaDireccion[] = [];
    for (const item of data as Array<{ display_name?: unknown; lat?: unknown; lon?: unknown }>) {
      const etiqueta = typeof item.display_name === 'string' ? item.display_name : '';
      const c = coordenadasDesde(item.lat, item.lon);
      if (!etiqueta || !c || vistas.has(etiqueta)) continue;
      vistas.add(etiqueta);
      sugerencias.push({ etiqueta, coords: { lat: redondearCoord(c.lat), lng: redondearCoord(c.lng) } });
    }
    return sugerencias;
  } catch {
    return [];
  }
}

// ── Geocodificación inversa (pin → dirección) ────────────────────────────────

export const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

/** Dirección derivada de un punto en el mapa (Nominatim /reverse). */
export interface DireccionInversa {
  calle: string;
  numExterior: string;
  codigoPostal: string;
  colonia: string;
  localidad: string;
  municipio: string;
  estado: string;
}

export function nominatimReverseUrl(c: Coordenadas, email?: string): string {
  const sp = new URLSearchParams({
    format: 'jsonv2',
    lat: String(c.lat),
    lon: String(c.lng),
    addressdetails: '1',
    'accept-language': 'es',
  });
  if (email) sp.set('email', email);
  return `${NOMINATIM_REVERSE_URL}?${sp.toString()}`;
}

type NominatimAddress = Record<string, string | undefined>;

/** Mapea los campos de Nominatim a nuestros nombres; en MX `city`/`municipality` suele ser el municipio. */
export function direccionDesdeNominatim(addr: NominatimAddress): DireccionInversa {
  return {
    calle: addr.road ?? addr.pedestrian ?? addr.footway ?? addr.path ?? '',
    numExterior: addr.house_number ?? '',
    codigoPostal: addr.postcode ?? '',
    colonia: addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? addr.residential ?? addr.hamlet ?? '',
    localidad: addr.village ?? addr.town ?? addr.city ?? '',
    municipio: addr.municipality ?? addr.county ?? addr.city ?? '',
    estado: addr.state ?? '',
  };
}

/**
 * Dirección a partir de coordenadas. Devuelve null si Nominatim falla — el pin
 * sigue siendo válido aunque no se pueda prellenar.
 */
export async function geocodificarInverso(
  c: Coordenadas,
  opts: { email?: string; fetchImpl?: typeof fetch } = {},
): Promise<DireccionInversa | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(nominatimReverseUrl(c, opts.email), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: NominatimAddress };
    if (!data?.address) return null;
    return direccionDesdeNominatim(data.address);
  } catch {
    return null;
  }
}
