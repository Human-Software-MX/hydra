import { apiRequest } from './client';

export interface AgoraTicketDto {
  id: string;
  contratoId?: string | null;
  tramiteId?: string | null;
  quejaId?: string | null;
  agoraRef?: string | null;
  titulo: string;
  descripcion: string;
  estado: string;
  prioridad: string;
  creadoPor: string;
  createdAt: string;
  updatedAt: string;
  _mock?: boolean;
}

export const getAgoraTickets = (params?: { contratoId?: string; estado?: string }) => {
  const q = new URLSearchParams();
  if (params?.contratoId) q.set('contratoId', params.contratoId);
  if (params?.estado) q.set('estado', params.estado);
  return apiRequest<AgoraTicketDto[]>(`/agora/tickets?${q.toString()}`);
};

export const getAgoraTicket = (id: string) =>
  apiRequest<AgoraTicketDto>(`/agora/tickets/${id}`);

export const createAgoraTicket = (data: {
  contratoId?: string;
  tramiteId?: string;
  quejaId?: string;
  titulo: string;
  descripcion: string;
  prioridad?: string;
  creadoPor: string;
  /** Nº de contrato CEA: Agora lo valida contra el SOAP de la CEA, sólo enviarlo si es real. */
  ceaContractNumber?: string;
}) =>
  apiRequest<AgoraTicketDto>('/agora/tickets', {
    method: 'POST',
    body: JSON.stringify(data),
  });

/** Relee el ticket en Agora y actualiza el estado local. */
export const syncAgoraTicket = (id: string) =>
  apiRequest<AgoraTicketDto>(`/agora/tickets/${id}/sync`, { method: 'POST' });

export const updateAgoraTicketEstado = (id: string, estado: string) =>
  apiRequest<AgoraTicketDto>(`/agora/tickets/${id}/estado`, {
    method: 'PATCH',
    body: JSON.stringify({ estado }),
  });
