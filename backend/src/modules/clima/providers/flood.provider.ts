import { PuntoCaudal } from '../alertas-oficiales';

/**
 * Proveedor Open-Meteo Flood API — caudal diario del río principal en ~5 km
 * de la coordenada, del Global Flood Awareness System (GloFAS/Copernicus).
 * Gratuito y sin API key: https://open-meteo.com/en/docs/flood-api
 *
 * Se piden días pasados (línea base del régimen del río) + pronóstico; el
 * evaluador puro (evaluarCrecidaRio) decide si la crecida es anómala.
 */

const FLOOD_URL = process.env.CLIMA_FLOOD_URL ?? 'https://flood-api.open-meteo.com/v1/flood';

interface RespuestaFlood {
  daily?: {
    time: string[];
    river_discharge: Array<number | null>;
  };
}

export async function caudalRioGlofas(
  lat: number,
  lng: number,
  opts: { pastDays?: number; forecastDays?: number } = {},
): Promise<PuntoCaudal[]> {
  const url = new URL(FLOOD_URL);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('daily', 'river_discharge');
  url.searchParams.set('past_days', String(Math.min(Math.max(opts.pastDays ?? 90, 1), 92)));
  url.searchParams.set('forecast_days', String(Math.min(Math.max(opts.forecastDays ?? 30, 1), 92)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Open-Meteo Flood HTTP ${res.status}`);
    const json = (await res.json()) as RespuestaFlood;
    const d = json.daily;
    if (!d?.time?.length) throw new Error('Open-Meteo Flood sin datos diarios');
    const hoy = new Date().toISOString().slice(0, 10);
    return d.time.map((fecha, i) => ({
      fecha,
      caudalM3s: d.river_discharge?.[i] ?? null,
      esPronostico: fecha >= hoy,
    }));
  } finally {
    clearTimeout(timer);
  }
}
