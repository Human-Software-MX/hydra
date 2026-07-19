import { CiclonActivo } from '../alertas-oficiales';

/**
 * Proveedor NHC/NOAA — ciclones tropicales activos en Atlántico y Pacífico
 * Oriental (las dos cuencas que afectan a México). JSON público, sin API key,
 * actualizado con cada aviso oficial: https://www.nhc.noaa.gov/CurrentStorms.json
 */

const NHC_URL = process.env.CLIMA_NHC_URL ?? 'https://www.nhc.noaa.gov/CurrentStorms.json';

interface StormNhc {
  id?: string;
  name?: string;
  classification?: string;
  intensity?: string | number;
  pressure?: string | number;
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  latitude?: string;
  longitude?: string;
  movementDir?: number | string | null;
  movementSpeed?: number | string | null;
  lastUpdate?: string;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? n : null;
};

export async function ciclonesActivosNhc(): Promise<CiclonActivo[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(NHC_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`NHC HTTP ${res.status}`);
    const json = (await res.json()) as { activeStorms?: StormNhc[] };
    return (json.activeStorms ?? [])
      .map((s): CiclonActivo | null => {
        const lat = num(s.latitudeNumeric) ?? num(s.latitude);
        const lng = num(s.longitudeNumeric) ?? num(s.longitude);
        if (lat == null || lng == null) return null;
        return {
          id: s.id ?? `${s.name ?? 'storm'}-${lat}-${lng}`,
          nombre: s.name ?? 'Sin nombre',
          clasificacion: s.classification ?? '',
          intensidadKt: num(s.intensity),
          presionMb: num(s.pressure),
          lat,
          lng,
          direccionMovimiento: s.movementDir != null ? String(s.movementDir) : null,
          velocidadMovimientoKt: num(s.movementSpeed),
          actualizado: s.lastUpdate ?? null,
        };
      })
      .filter((c): c is CiclonActivo => c !== null);
  } finally {
    clearTimeout(timer);
  }
}
