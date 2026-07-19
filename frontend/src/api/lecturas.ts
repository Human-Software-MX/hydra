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

export { hasApi };
