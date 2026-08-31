import { apiRequest, getBaseUrl, normalizeApiBase } from './client';

export interface PortalContrato {
  id: string;
  nombre: string;
  rfc: string;
  tipoContrato: string;
  tipoServicio: string;
  estado: string;
  direccion: string;
  fecha: string;
  ceaNumContrato?: string | null;
}

export interface PortalConsumo {
  id: string;
  contratoId: string;
  periodo: string;
  m3: number;
  tipo: string;
  confirmado: boolean;
}

export interface PortalRecibo {
  id: string;
  contratoId: string;
  timbradoId: string;
  saldoVigente: number;
  saldoVencido: number;
  fechaVencimiento: string;
  parcialidades: number;
  impreso: boolean;
}

export interface PortalTimbrado {
  id: string;
  contratoId: string;
  uuid: string;
  estado: string;
  periodo: string;
  subtotal: number;
  iva: number;
  total: number;
  fechaEmision: string;
  fechaVencimiento: string;
  recibos: PortalRecibo[];
}

export interface PortalPago {
  id: string;
  contratoId: string;
  monto: number;
  fecha: string;
  tipo: string;
  concepto: string;
  origen: string;
}

export interface PortalSaldos {
  vencido: number;
  vigente: number;
  total: number;
  intereses: number;
}

export const getPortalContratos = () =>
  apiRequest<PortalContrato[]>('/portal/contratos');

export const getPortalConsumos = (contratoId: string) =>
  apiRequest<PortalConsumo[]>(`/portal/consumos?contratoId=${contratoId}`);

export const getPortalTimbrados = (contratoId: string) =>
  apiRequest<PortalTimbrado[]>(`/portal/timbrados?contratoId=${contratoId}`);

export const getPortalRecibos = (contratoId: string) =>
  apiRequest<PortalRecibo[]>(`/portal/recibos?contratoId=${contratoId}`);

export const getPortalPagos = (contratoId: string) =>
  apiRequest<PortalPago[]>(`/portal/pagos?contratoId=${contratoId}`);

export const getPortalSaldos = (contratoId: string) =>
  apiRequest<PortalSaldos>(`/portal/saldos?contratoId=${contratoId}`);

export interface PortalEstadoOperativo {
  contratoId: string;
  estado: string;
  bloqueadoJuridico: boolean;
  tieneAdeudo: boolean;
  montoAdeudo: number;
  fechaReconexionPrevista?: string | null;
}

export interface PortalOrden {
  id: string;
  tipo: string;
  estado: string;
  prioridad: string;
  fechaSolicitud: string;
  fechaProgramada?: string | null;
  fechaEjecucion?: string | null;
  notas?: string | null;
  seguimientos: Array<{ id: string; fecha: string; nota?: string | null; estadoNuevo?: string | null }>;
}

export interface PortalDatosFiscales {
  id: string;
  nombre: string;
  rfc: string;
  razonSocial?: string | null;
  regimenFiscal?: string | null;
  constanciaFiscalUrl?: string | null;
}

export interface PortalContacto {
  id: string;
  personaId: string;
  contratoId: string;
  rol: string;
  activo: boolean;
  fechaDesde: string;
  persona: { id: string; nombre: string; rfc?: string | null; email?: string | null; telefono?: string | null; tipo: string };
}

export interface PortalReporteFuga {
  id: string;
  contratoId: string;
  fecha: string;
  tipo: string;
  descripcion: string;
  estado: string;
  categoria?: string | null;
  prioridad: string;
  canal: string;
  areaAsignada: string;
  createdAt: string;
}

export const getPortalEstadoOperativo = (contratoId: string) =>
  apiRequest<PortalEstadoOperativo>(`/portal/estado-operativo?contratoId=${contratoId}`);

export const getPortalOrdenes = (contratoId: string) =>
  apiRequest<PortalOrden[]>(`/portal/ordenes?contratoId=${contratoId}`);

export const getPortalDatosFiscales = (contratoId: string) =>
  apiRequest<PortalDatosFiscales>(`/portal/datos-fiscales?contratoId=${contratoId}`);

export const updatePortalDatosFiscales = (
  contratoId: string,
  data: { rfc?: string; razonSocial?: string; regimenFiscal?: string },
) =>
  apiRequest<PortalDatosFiscales>(`/portal/datos-fiscales?contratoId=${contratoId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const getPortalContactos = (contratoId: string) =>
  apiRequest<PortalContacto[]>(`/portal/contactos?contratoId=${contratoId}`);

export const addPortalContacto = (
  contratoId: string,
  data: { nombre?: string; rfc?: string; email?: string; telefono?: string; rol: string },
) =>
  apiRequest<PortalContacto>(`/portal/contactos?contratoId=${contratoId}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

/**
 * Descarga el XML del CFDI del portal vía fetch con JWT → blob → <a download>.
 * No usar window.open directo: la navegación sin header Authorization da 401.
 */
export async function descargarPortalCfdiXml(timbradoId: string): Promise<void> {
  const base = getBaseUrl() ?? normalizeApiBase('http://localhost:3001');
  const token = localStorage.getItem('ctcf_access_token');
  const res = await fetch(`${base}/portal/timbrados/${timbradoId}/descargar`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `No se pudo descargar el XML (HTTP ${res.status})`;
    try {
      const j = JSON.parse(await res.text());
      if (j.message) message = j.message;
    } catch {
      // use default message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cfdi-${timbradoId}.xml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const crearPortalReporteFuga = (
  contratoId: string,
  data: { descripcion: string; ubicacion?: string },
) =>
  apiRequest<PortalReporteFuga>(`/portal/reportes-fuga?contratoId=${contratoId}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getPortalReportesFuga = (contratoId: string) =>
  apiRequest<PortalReporteFuga[]>(`/portal/reportes-fuga?contratoId=${contratoId}`);
