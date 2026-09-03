import { apiRequest } from './client';

export interface CatalogoEstadoINEGI {
  id: string;
  claveINEGI: string;
  nombre: string;
  activo: boolean;
}

export interface CatalogoMunicipioINEGIRow {
  id: string;
  estadoId: string;
  claveINEGI: string;
  nombre: string;
  activo: boolean;
  estado: CatalogoEstadoINEGI;
}

export interface CatalogoLocalidadINEGIRow {
  id: string;
  municipioId: string;
  aquasisPobid: number;
  nombre: string;
  activo: boolean;
  municipio: CatalogoMunicipioINEGIRow;
}

export interface CatalogoColoniaINEGIRow {
  id: string;
  localidadId: string;
  aquasisBarrId: number;
  nombre: string;
  tipo: string;
  activo: boolean;
  localidad: CatalogoLocalidadINEGIRow;
}

export interface PaginatedInegi<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface InegiResumen {
  estados: number;
  municipios: number;
  localidades: number;
  colonias: number;
}

export interface CreateDomicilioDto {
  calle: string;
  numExterior?: string;
  numInterior?: string;
  coloniaINEGIId?: string;
  codigoPostal?: string;
  localidadINEGIId?: string;
  municipioINEGIId?: string;
  estadoINEGIId?: string;
  entreCalle1?: string;
  entreCalle2?: string;
  referencia?: string;
  gpsLat?: number;
  gpsLng?: number;
}

export interface DomicilioCreado {
  id: string;
  calle: string;
  numExterior: string | null;
  numInterior: string | null;
  codigoPostal: string | null;
  coloniaINEGIId: string | null;
  municipioINEGIId: string | null;
  estadoINEGIId: string | null;
}

export const createDomicilio = (dto: CreateDomicilioDto) =>
  apiRequest<DomicilioCreado>('/domicilios', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const fetchInegiResumen = () =>
  apiRequest<InegiResumen>('/domicilios/catalogo-inegi/resumen');

export const fetchInegiEstados = () =>
  apiRequest<CatalogoEstadoINEGI[]>('/domicilios/estados');

export const fetchInegiMunicipiosCatalogo = (params: {
  page?: number;
  limit?: number;
  estadoId?: string;
  nombre?: string;
}) => {
  const sp = new URLSearchParams();
  if (params.page != null) sp.set('page', String(params.page));
  if (params.limit != null) sp.set('limit', String(params.limit));
  if (params.estadoId) sp.set('estadoId', params.estadoId);
  if (params.nombre) sp.set('nombre', params.nombre);
  const q = sp.toString();
  return apiRequest<PaginatedInegi<CatalogoMunicipioINEGIRow>>(
    `/domicilios/catalogo-inegi/municipios${q ? `?${q}` : ''}`,
  );
};

export const fetchInegiLocalidadesCatalogo = (params: {
  page?: number;
  limit?: number;
  municipioId?: string;
  nombre?: string;
}) => {
  const sp = new URLSearchParams();
  if (params.page != null) sp.set('page', String(params.page));
  if (params.limit != null) sp.set('limit', String(params.limit));
  if (params.municipioId) sp.set('municipioId', params.municipioId);
  if (params.nombre) sp.set('nombre', params.nombre);
  const q = sp.toString();
  return apiRequest<PaginatedInegi<CatalogoLocalidadINEGIRow>>(
    `/domicilios/catalogo-inegi/localidades${q ? `?${q}` : ''}`,
  );
};

export const fetchInegiColoniasCatalogo = (params: {
  page?: number;
  limit?: number;
  localidadId?: string;
  nombre?: string;
}) => {
  const sp = new URLSearchParams();
  if (params.page != null) sp.set('page', String(params.page));
  if (params.limit != null) sp.set('limit', String(params.limit));
  if (params.localidadId) sp.set('localidadId', params.localidadId);
  if (params.nombre) sp.set('nombre', params.nombre);
  const q = sp.toString();
  return apiRequest<PaginatedInegi<CatalogoColoniaINEGIRow>>(
    `/domicilios/catalogo-inegi/colonias${q ? `?${q}` : ''}`,
  );
};
