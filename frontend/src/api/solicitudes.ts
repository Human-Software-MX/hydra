import { apiRequest } from './client';
import type { SolicitudState, OrdenInspeccionData } from '@/types/solicitudes';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface SolicitudInspeccionDto {
  id: string;
  solicitudId: string;
  estado: string;
  fechaInspeccion: string | null;
  numeroOficial: string | null;
  tipoUso: string | null;
  giro: string | null;
  areaTerreno: string | null;
  condicionToma: string | null;
  condicionesPredio: string | null;
  infraHidraulicaExterna: string | null;
  infraSanitaria: string | null;
  materialCalle: string | null;
  materialBanqueta: string | null;
  metrosRupturaAguaBanqueta: string | null;
  metrosRupturaAguaCalle: string | null;
  metrosRupturaDrenajeBanqueta: string | null;
  metrosRupturaDrenajeCalle: string | null;
  observaciones: string | null;
  evidencias: string[] | null;
  resultadoEjecucion: string | null;
  resultadoInspeccion: string | null;
  inspectorNumEmpleado: string | null;
  inspectorNombre: string | null;
  firmaInspector: string | null;
  inspectoresAdicionales: Array<{ noEmpleado: string; nombre: string; firma?: string }> | null;
  inicio: string | null;
  fin: string | null;
  tipoOrdenCorrecto: string | null;
  // Legacy
  inspector: string | null;
  diametroToma: string | null;
  medidorExistente: string | null;
  numMedidorExistente: string | null;
  metrosRupturaCalle: string | null;
  metrosRupturaBanqueta: string | null;
  existeRed: string | null;
  distanciaRed: string | null;
  presionRed: string | null;
  tipoMaterialRed: string | null;
  profundidadRed: string | null;
  tomaExistente: string | null;
  diametroTomaExistente: string | null;
  estadoTomaExistente: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SolicitudDto {
  id: string;
  folio: string;
  fechaSolicitud: string;
  propTipoPersona: string;
  propNombreCompleto: string;
  propRfc: string | null;
  propCorreo: string | null;
  propTelefono: string | null;
  predioResumen: string;
  claveCatastral: string | null;
  adminId: string | null;
  tipoContratacionId: string | null;
  estado: string;
  formData: SolicitudState;
  inspeccion: SolicitudInspeccionDto | null;
  contratoId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedSolicitudes {
  data: SolicitudDto[];
  total: number;
  page: number;
  limit: number;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const fetchSolicitudes = (params?: {
  estado?: string;
  contratoId?: string;
  page?: number;
  limit?: number;
}) => {
  const sp = new URLSearchParams();
  if (params?.estado) sp.set('estado', params.estado);
  if (params?.contratoId?.trim()) sp.set('contratoId', params.contratoId.trim());
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  const q = sp.toString();
  return apiRequest<PaginatedSolicitudes>(`/solicitudes${q ? `?${q}` : ''}`);
};

export const fetchSolicitud = (id: string) => apiRequest<SolicitudDto>(`/solicitudes/${id}`);

export const createSolicitud = (dto: {
  propTipoPersona: string;
  propNombreCompleto: string;
  propRfc?: string;
  propCorreo?: string;
  propTelefono?: string;
  predioResumen: string;
  claveCatastral?: string;
  adminId?: string;
  tipoContratacionId?: string;
  formData: SolicitudState;
}) =>
  apiRequest<SolicitudDto>('/solicitudes', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const updateSolicitud = (
  id: string,
  dto: {
    propNombreCompleto?: string;
    propTipoPersona?: string;
    propRfc?: string;
    propCorreo?: string;
    propTelefono?: string;
    predioResumen?: string;
    claveCatastral?: string;
    adminId?: string;
    tipoContratacionId?: string;
    formData?: SolicitudState;
  },
) =>
  apiRequest<SolicitudDto>(`/solicitudes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });

export const upsertInspeccion = (solicitudId: string, inspeccion: OrdenInspeccionData) =>
  apiRequest<SolicitudDto>(`/solicitudes/${solicitudId}/inspeccion`, {
    method: 'POST',
    body: JSON.stringify(inspeccion),
  });

export const aceptarSolicitud = (id: string) =>
  apiRequest<{ solicitudId: string; contratoId: string; folio: string; puntoServicioId?: string | null }>(
    `/solicitudes/${id}/aceptar`,
    { method: 'POST' },
  );

export const rechazarSolicitud = (id: string) =>
  apiRequest<SolicitudDto>(`/solicitudes/${id}/rechazar`, { method: 'POST' });

export const cancelarSolicitud = (id: string) =>
  apiRequest<SolicitudDto>(`/solicitudes/${id}/cancelar`, { method: 'POST' });

export const retormarSolicitud = (id: string) =>
  apiRequest<SolicitudDto>(`/solicitudes/${id}/retomar`, { method: 'POST' });

export const deleteSolicitud = (id: string) => apiRequest<void>(`/solicitudes/${id}`, { method: 'DELETE' });

// ── PDF cotización ─────────────────────────────────────────────────────────────

/** Sube el PDF de cotización al servidor y lo guarda en uploads/cotizaciones/{id}.pdf */
// ─── Documentos entregados por el ciudadano ──────────────────────────────────

export interface SolicitudDocumentoDto {
  id: string;
  documentoId?: string | null;
  documento?: { id: string; nombre: string; presentacion?: string | null; clasificacion?: string | null } | null;
  nombreDocumento?: string | null;
  archivoNombre: string;
  mimeType: string;
  tamanoBytes: number;
  createdAt: string;
}

function apiBaseUrl(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
  const r = base.replace(/\/$/, '');
  return r.endsWith('/api') ? r : `${r}/api`;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('ctcf_access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const fetchSolicitudDocumentos = (solicitudId: string) =>
  apiRequest<SolicitudDocumentoDto[]>(`/solicitudes/${solicitudId}/documentos`);

export async function uploadSolicitudDocumento(
  solicitudId: string,
  file: File,
  params: { documentoId?: string; nombreDocumento?: string },
): Promise<SolicitudDocumentoDto> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (params.documentoId) form.append('documentoId', params.documentoId);
  if (params.nombreDocumento) form.append('nombreDocumento', params.nombreDocumento);
  const res = await fetch(`${apiBaseUrl()}/solicitudes/${solicitudId}/documentos`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(`Error al subir documento: HTTP ${res.status}`);
  return res.json() as Promise<SolicitudDocumentoDto>;
}

export const deleteSolicitudDocumento = (solicitudId: string, docId: string) =>
  apiRequest<{ ok: boolean }>(`/solicitudes/${solicitudId}/documentos/${docId}`, { method: 'DELETE' });

/** Abre el archivo (requiere JWT, por eso no sirve window.open directo). */
export async function openSolicitudDocumento(solicitudId: string, docId: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/solicitudes/${solicitudId}/documentos/${docId}/archivo`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Error al abrir documento: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function uploadCotizacionPdf(solicitudId: string, pdfBlob: Blob): Promise<{ url: string }> {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
  const normalizeBase = (b: string) => { const r = b.replace(/\/$/, ''); return r.endsWith('/api') ? r : `${r}/api`; };
  const apiBase = normalizeBase(base);
  const token = localStorage.getItem('ctcf_access_token');
  const form = new FormData();
  form.append('file', pdfBlob, `cotizacion-${solicitudId}.pdf`);
  const res = await fetch(`${apiBase}/solicitudes/${solicitudId}/cotizacion-pdf`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`Error al guardar PDF: HTTP ${res.status}`);
  return res.json() as Promise<{ url: string }>;
}

/**
 * Descarga el PDF de cotización del servidor (con auth) y lo abre en nueva pestaña.
 * window.open() directo no funciona porque el endpoint requiere JWT.
 */
export async function openCotizacionPdf(solicitudId: string): Promise<void> {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
  const normalizeBase = (b: string) => { const r = b.replace(/\/$/, ''); return r.endsWith('/api') ? r : `${r}/api`; };
  const apiBase = normalizeBase(base);
  const token = localStorage.getItem('ctcf_access_token');
  const res = await fetch(`${apiBase}/solicitudes/${solicitudId}/cotizacion-pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Revoke after a delay to allow the new tab to load
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
