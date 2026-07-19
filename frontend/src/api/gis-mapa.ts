import { apiRequest } from './client';

/** Propiedades de cada contrato georreferenciado en el GeoJSON del padrón. */
export interface PadronFeatureProps {
  contratoId: string;
  numeroContrato: number;
  nombre: string;
  estado: string;
  tipoServicio: string;
  zonaId: string | null;
  zona: string | null;
  direccion: string | null;
  carteraCategoria: string; // AL_CORRIENTE | INCIPIENTE | MODERADO | ALTO | CRITICO | SIN_DATOS
  saldoVencido: number;
  diasMoraMax: number;
}

export interface PadronGeojson {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: PadronFeatureProps;
  }>;
  meta: { total: number; limit: number; georreferenciados: number };
}

export async function fetchPadronGeojson(params?: {
  zonaId?: string;
  administracionId?: string;
  limit?: number;
}): Promise<PadronGeojson> {
  const qs = new URLSearchParams();
  if (params?.zonaId) qs.set('zonaId', params.zonaId);
  if (params?.administracionId) qs.set('administracionId', params.administracionId);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest<PadronGeojson>(`/gis/padron.geojson${suffix}`);
}

// ─── Clima operativo ─────────────────────────────────────────────────────────

export interface AlertaClimatica {
  tipo: string;
  severidad: 'media' | 'alta' | 'critica';
  fechas: string[];
  detalle: string;
  impacto: string;
  accionRecomendada: string;
}

export interface RiesgosClima {
  horizonteDias: number;
  fuente: string;
  general: { lat: number; lng: number; alertas: AlertaClimatica[] };
  zonasEvaluadas: number;
  zonasConAlertas: number;
  zonas: Array<{ zonaId: string; zona: string; lat: number; lng: number; alertas: AlertaClimatica[] }>;
}

export async function fetchRiesgosClima(administracionId?: string): Promise<RiesgosClima> {
  const qs = administracionId ? `?administracionId=${encodeURIComponent(administracionId)}` : '';
  return apiRequest<RiesgosClima>(`/clima/riesgos${qs}`);
}

// ─── Alertas oficiales multi-fuente (NHC ciclones, GloFAS crecidas, CAP) ────

export interface AlertaOficial {
  fuente: 'nhc_noaa' | 'glofas_openmeteo' | 'cap';
  tipo: string;
  severidad: 'media' | 'alta' | 'critica';
  titulo: string;
  detalle: string;
  vigencia?: { desde?: string; hasta?: string };
  zona?: string;
  impacto: string;
  accionRecomendada: string;
  claveDedup: string;
}

export interface ResumenAlertasOficiales {
  generadoEn: string;
  sede: { lat: number; lng: number };
  fuentes: Record<string, { activa: boolean; ok?: boolean; detalle?: string }>;
  alertas: AlertaOficial[];
  cache?: boolean;
}

export async function fetchAlertasOficiales(): Promise<ResumenAlertasOficiales> {
  return apiRequest<ResumenAlertasOficiales>('/clima/alertas');
}
