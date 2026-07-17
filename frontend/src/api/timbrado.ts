import { apiRequest } from './client';

export interface ResultadoTimbradoPeriodo {
  periodo: string;
  procesados: number;
  timbrados: number;
  conError: number;
  errores: Array<{ timbradoId: string; error: string }>;
}

export async function timbrarPeriodo(params: {
  periodo: string;
  contratoId?: string;
}): Promise<ResultadoTimbradoPeriodo> {
  return apiRequest<ResultadoTimbradoPeriodo>('/timbrados/timbrar-periodo', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function timbrarComprobante(id: string) {
  return apiRequest(`/timbrados/${id}/timbrar`, { method: 'POST' });
}

/** Descarga el XML del CFDI vía fetch con JWT (evita 401 de navegación directa). */
export async function descargarCfdiXml(id: string): Promise<void> {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
  const normalized = base.replace(/\/$/, '').endsWith('/api')
    ? base.replace(/\/$/, '')
    : `${base.replace(/\/$/, '')}/api`;
  const token = localStorage.getItem('ctcf_access_token');
  const res = await fetch(`${normalized}/timbrados/${id}/xml`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`No se pudo descargar el XML (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cfdi-${id}.xml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
