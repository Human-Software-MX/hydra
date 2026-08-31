import { apiRequest } from './client';

export interface NotificacionLog {
  id: string;
  contratoId?: string;
  canal: string;
  tipo: string;
  destinatario: string;
  asunto?: string;
  proveedor: string;
  enviado: boolean;
  error?: string;
  createdAt: string;
}

export async function notificarRecibo(reciboId: string): Promise<{ email: boolean; whatsapp: boolean }> {
  return apiRequest(`/notificaciones/recibo/${reciboId}`, { method: 'POST' });
}

export async function notificarVencimiento(reciboId: string): Promise<{ email: boolean; whatsapp: boolean }> {
  return apiRequest(`/notificaciones/vencimiento/${reciboId}`, { method: 'POST' });
}

export async function listarNotificaciones(params?: {
  contratoId?: string;
  canal?: string;
  tipo?: string;
}): Promise<NotificacionLog[]> {
  const p = new URLSearchParams();
  if (params?.contratoId) p.append('contratoId', params.contratoId);
  if (params?.canal) p.append('canal', params.canal);
  if (params?.tipo) p.append('tipo', params.tipo);
  const qs = p.toString();
  return apiRequest(`/notificaciones/logs${qs ? `?${qs}` : ''}`);
}

/** Abre el recibo imprimible (HTML) en una ventana nueva para imprimir/guardar como PDF. */
export async function abrirReciboImprimible(reciboId: string): Promise<void> {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
  const normalized = base.replace(/\/$/, '').endsWith('/api')
    ? base.replace(/\/$/, '')
    : `${base.replace(/\/$/, '')}/api`;
  const token = localStorage.getItem('ctcf_access_token');
  const res = await fetch(`${normalized}/recibos/${reciboId}/html`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`No se pudo generar el recibo (HTTP ${res.status})`);
  const html = await res.text();
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
