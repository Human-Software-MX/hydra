import { apiRequest } from './client';

export interface TipoContratacion {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  requiereMedidor: boolean;
  requiereInspeccion: boolean;
  esIndividualizacion: boolean;
  activo: boolean;
  administracionId?: string | null;
  // P1/P6
  claseProceso: string | null;
  esContratoFormal: boolean;
  requiereSolicitudPrevia: boolean;
  diasCaducidadSolicitud: number | null;
  organismoAprobacion: string | null;
  diasPlazoAprobacion: number | null;
  periodicidadesPermitidas: string | null;
  tiposClientePermitidos: string | null;
  _count?: { contratos: number };
}

export interface CatalogoDocumento {
  id: string;
  codigoSige?: number | null;
  nombre: string;
  presentacion?: string | null; // ORIGINAL | COPIA | ORIGINAL_Y_COPIA
  clasificacion?: string | null; // COMUN | PERSONA_MORAL | REPRESENTACION | ...
  activo: boolean;
}

export interface DocumentoRequeridoTipoContratacion {
  id: string;
  documentoId?: string | null;
  documento?: CatalogoDocumento | null;
  /// Texto libre legacy; si hay documento del catálogo, úsese documento.nombre
  nombreDocumento?: string | null;
  obligatorio: boolean;
  aplicaUso?: 'domestico' | 'no_domestico' | null;
  orden?: number;
  descripcion?: string | null;
}

export interface TipoContratacionConfiguracion extends TipoContratacion {
  conceptos: Array<{
    id: string;
    obligatorio: boolean;
    orden: number;
    conceptoCobro: {
      id: string;
      codigo: string;
      nombre: string;
    };
  }>;
  clausulas: Array<{
    id: string;
    obligatorio: boolean;
    orden: number;
    clausula: {
      id: string;
      codigo: string;
      titulo: string;
    };
  }>;
  documentos: DocumentoRequeridoTipoContratacion[];
  variables: Array<{
    id: string;
    obligatorio: boolean;
    orden: number;
    valorDefecto?: string | null;
    tipoVariable: {
      id: string;
      codigo: string;
      nombre: string;
      tipoDato: string;
      valoresPosibles?: unknown;
      unidad?: string | null;
    };
  }>;
}

export interface UpdateTipoContratacionDto {
  nombre?: string;
  descripcion?: string;
  requiereMedidor?: boolean;
  esIndividualizacion?: boolean;
  activo?: boolean;
  claseProceso?: string | null;
  esContratoFormal?: boolean;
  requiereSolicitudPrevia?: boolean;
  diasCaducidadSolicitud?: number | null;
  organismoAprobacion?: string | null;
  diasPlazoAprobacion?: number | null;
  periodicidadesPermitidas?: string | null;
  tiposClientePermitidos?: string | null;
}

export interface CreateTipoContratacionDto {
  codigo: string;
  nombre: string;
  descripcion?: string;
  requiereMedidor?: boolean;
  claseProceso?: string;
  esContratoFormal?: boolean;
  requiereSolicitudPrevia?: boolean;
  diasCaducidadSolicitud?: number;
  organismoAprobacion?: string;
  diasPlazoAprobacion?: number;
  periodicidadesPermitidas?: string;
  tiposClientePermitidos?: string;
}

export function fetchTiposContratacion(params?: {
  activo?: boolean;
  page?: number;
  limit?: number;
  administracionId?: string;
  /** Rama del árbol de uso ('domestico' | 'no_domestico'); el backend filtra por la categoría tarifaria del tipo. */
  uso?: 'domestico' | 'no_domestico';
}) {
  const q = new URLSearchParams();
  q.set('page', String(params?.page ?? 1));
  q.set('limit', String(params?.limit ?? 100));
  if (params?.activo === true) q.set('activo', 'true');
  if (params?.activo === false) q.set('activo', 'false');
  const aid = params?.administracionId?.trim();
  if (aid) q.set('administracionId', aid);
  if (params?.uso) q.set('uso', params.uso);
  return apiRequest<{ data: TipoContratacion[]; total: number }>(
    `/tipos-contratacion?${q.toString()}`,
  );
}

export const fetchCatalogoDocumentos = (params?: { activo?: boolean }) =>
  apiRequest<CatalogoDocumento[]>(
    params?.activo !== undefined
      ? `/catalogos/documentos?activo=${params.activo}`
      : '/catalogos/documentos',
  );

export const fetchTipoContratacion = (id: string) =>
  apiRequest<TipoContratacion>(`/tipos-contratacion/${id}`);

export const fetchTipoContratacionConfiguracion = (id: string) =>
  apiRequest<TipoContratacionConfiguracion>(`/tipos-contratacion/${id}/configuracion`);

export const createTipoContratacion = (dto: CreateTipoContratacionDto) =>
  apiRequest<TipoContratacion>('/tipos-contratacion', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const updateTipoContratacion = (id: string, dto: UpdateTipoContratacionDto) =>
  apiRequest<TipoContratacion>(`/tipos-contratacion/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
