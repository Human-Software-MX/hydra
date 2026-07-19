import { DiaPronostico } from '../clima-riesgos';

/**
 * Proveedor Open-Meteo (https://open-meteo.com) — API meteorológica gratuita
 * y sin API key para uso no comercial/institucional, con modelos globales
 * (GFS/ECMWF/ICON) y hasta 16 días de pronóstico. Es el proveedor default de
 * Hydra por su fiabilidad; el SMN de CONAGUA es la alternativa oficial
 * mexicana (ver smn.provider.ts).
 */

const BASE_URL = process.env.CLIMA_OPENMETEO_URL ?? 'https://api.open-meteo.com/v1/forecast';

interface RespuestaOpenMeteo {
  daily?: {
    time: string[];
    temperature_2m_max: Array<number | null>;
    temperature_2m_min: Array<number | null>;
    precipitation_sum: Array<number | null>;
    wind_gusts_10m_max: Array<number | null>;
  };
}

export async function pronosticoOpenMeteo(
  lat: number,
  lng: number,
  dias = 14,
): Promise<DiaPronostico[]> {
  const url = new URL(BASE_URL);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set(
    'daily',
    'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max',
  );
  url.searchParams.set('forecast_days', String(Math.min(Math.max(dias, 1), 16)));
  url.searchParams.set('timezone', 'America/Mexico_City');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = (await res.json()) as RespuestaOpenMeteo;
    const d = json.daily;
    if (!d?.time?.length) throw new Error('Open-Meteo sin datos diarios');
    return d.time.map((fecha, i) => ({
      fecha,
      tmaxC: d.temperature_2m_max?.[i] ?? null,
      tminC: d.temperature_2m_min?.[i] ?? null,
      precipitacionMm: d.precipitation_sum?.[i] ?? null,
      rachaVientoKmh: d.wind_gusts_10m_max?.[i] ?? null,
    }));
  } finally {
    clearTimeout(timer);
  }
}
