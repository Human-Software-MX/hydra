import { apiRequest, hasApi } from './client';

export interface LecturaDto {
  id: string;
  contratoId: string;
  rutaId: string;
  lecturaAnterior: number;
  lecturaActual: number;
  consumo: number;
  estado: string;
  incidencia: string;
  fecha: string;
  periodo: string;
  lecturaMinZona?: number;
  lecturaMaxZona?: number;
  simuladoMensual?: number;
  motivoInvalidacion?: string;
}

/** Forma real que devuelve el backend (Prisma). Difiere del DTO que consume la UI. */
interface LecturaApiRaw {
  id: string;
  contratoId: string;
  loteId?: string | null;
  lecturaAnterior?: number | null;
  lecturaActual?: number | null;
  consumoReal?: number | null;
  consumoEstimado?: number | null;
  estado?: string | null;
  incidencia?: { codigo?: string; descripcion?: string } | string | null;
  fecha?: string | null;
  periodo?: string | null;
  createdAt?: string | null;
  lecturaMinZona?: number | null;
  lecturaMaxZona?: number | null;
  motivoInvalidacion?: string | null;
}

/** Normaliza un registro del backend a la forma que espera la UI. */
function mapLectura(raw: LecturaApiRaw): LecturaDto {
  const incidencia =
    typeof raw.incidencia === 'string'
      ? raw.incidencia
      : raw.incidencia?.descripcion ?? raw.incidencia?.codigo ?? '';
  return {
    id: raw.id,
    contratoId: raw.contratoId,
    rutaId: raw.loteId ?? '',
    lecturaAnterior: raw.lecturaAnterior ?? 0,
    lecturaActual: raw.lecturaActual ?? 0,
    consumo: raw.consumoReal ?? raw.consumoEstimado ?? 0,
    estado: raw.estado ?? 'Pendiente',
    incidencia,
    fecha: raw.fecha ?? (raw.createdAt ? raw.createdAt.slice(0, 10) : ''),
    periodo: raw.periodo ?? '',
    lecturaMinZona: raw.lecturaMinZona ?? undefined,
    lecturaMaxZona: raw.lecturaMaxZona ?? undefined,
    simuladoMensual: raw.consumoEstimado ?? undefined,
    motivoInvalidacion: raw.motivoInvalidacion ?? undefined,
  };
}

export async function fetchLecturas(): Promise<LecturaDto[]> {
  const res = await apiRequest<LecturaApiRaw[] | { data: LecturaApiRaw[] }>('/lecturas?limit=200');
  const rows = Array.isArray(res) ? res : (res?.data ?? []);
  return rows.map(mapLectura);
}

export interface UploadLoteResult {
  loteId: string;
  totalRegistros: number;
  totalValidos: number;
  totalConError: number;
  totalReemplazadas?: number;
  errores: { contrato: string; motivo: string }[];
}

/** Error de carga de lote; `duplicado` marca el rechazo 409 (archivo repetido). */
export class UploadLoteError extends Error {
  duplicado: boolean;
  constructor(message: string, duplicado: boolean) {
    super(message);
    this.name = 'UploadLoteError';
    this.duplicado = duplicado;
  }
}

/**
 * B6 — Sube un archivo plano de lecturas a `POST /lecturas/lotes/upload` (multipart).
 * Devuelve el reporte de validación por renglón. Un 409 se traduce a
 * `UploadLoteError.duplicado = true` (archivo ya cargado para el periodo).
 */
export async function uploadLote(params: {
  archivo: File;
  periodo: string;
  zonaId?: string;
  rutaId?: string;
  tipoLote?: string;
  /** Reemplaza las lecturas previas del (contrato, periodo) — corrección explícita del operador. */
  reemplazar?: boolean;
}): Promise<UploadLoteResult> {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
  const normalizeBase = (b: string) => {
    const r = b.replace(/\/$/, '');
    return r.endsWith('/api') ? r : `${r}/api`;
  };
  const apiBase = normalizeBase(base);
  const token = localStorage.getItem('ctcf_access_token');

  const form = new FormData();
  form.append('archivo', params.archivo);
  form.append('periodo', params.periodo);
  if (params.zonaId) form.append('zonaId', params.zonaId);
  if (params.rutaId) form.append('rutaId', params.rutaId);
  if (params.tipoLote) form.append('tipoLote', params.tipoLote);
  if (params.reemplazar) form.append('reemplazar', 'true');

  const res = await fetch(`${apiBase}/lecturas/lotes/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    let message = body || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(body);
      if (j.message) message = typeof j.message === 'string' ? j.message : JSON.stringify(j.message);
    } catch {
      /* usa el cuerpo tal cual */
    }
    throw new UploadLoteError(message, res.status === 409);
  }

  return (await res.json()) as UploadLoteResult;
}

export { hasApi };
