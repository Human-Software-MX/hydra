import { apiRequest } from './client';

export interface CatalogoGrupoActividad {
  id: string;
  codigo: string;
  descripcion: string;
  activo: boolean;
}

export interface CatalogoActividad {
  id: string;
  codigo: string;
  descripcion: string;
  grupoId: string | null;
  activo: boolean;
  grupo?: CatalogoGrupoActividad;
}

/** Id del grupo bajo el que el seed sembró el catálogo operativo SIGE (`ACTIPOL_*`). Ver `docs/catalogo-actividad-sige.md`. */
export const CATALOGO_SIGE_GRUPO_ACTIVIDAD_ID = 'GA_SIGE';

/**
 * Actividades visibles al elegir un grupo: primero las ligadas al grupo;
 * si no hay ninguna (grupos CIG2018 sin hijos en BD), el catálogo SIGE compartido bajo {@link CATALOGO_SIGE_GRUPO_ACTIVIDAD_ID}.
 */
export function actividadesVisiblesParaGrupo(
  actividades: CatalogoActividad[],
  grupoId: string,
): CatalogoActividad[] {
  if (!grupoId) return [];
  const directas = actividades.filter((a) => a.grupoId === grupoId);
  if (directas.length > 0) return directas;
  return actividades.filter((a) => a.grupoId === CATALOGO_SIGE_GRUPO_ACTIVIDAD_ID);
}

export interface CatalogoCategoria {
  id: string;
  codigo: string;
  descripcion: string;
  activo: boolean;
}

export interface CatalogoTipoRelacionPS {
  id: string;
  codigo: string;
  descripcion: string;
  metodo: string;
  reparteConsumo: boolean;
  activo: boolean;
}

export const fetchActividades = () =>
  apiRequest<CatalogoActividad[]>('/catalogos/actividades');

export const fetchGruposActividad = () =>
  apiRequest<CatalogoGrupoActividad[]>('/catalogos/grupos-actividad');

export const fetchCategorias = () =>
  apiRequest<CatalogoCategoria[]>('/catalogos/categorias');

export const fetchTiposRelacionPS = () =>
  apiRequest<CatalogoTipoRelacionPS[]>('/catalogos/tipos-relacion-ps');

// ── Contratación: conceptos y cláusulas ─────────────────────────────────────

export interface ConceptoCobro {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  /** CONTRATACION | LECTURAS | VARIOS */
  origen?: string;
  /**
   * Regla porcentual: este concepto se cobra como % de otro servicio
   * (p. ej. saneamiento = 12 % del cargo de 'agua'). null = no aplica.
   */
  porcentajeDeServicio?: string | null;
  /** Porcentaje de la regla (10 = 10 %); Decimal serializado. */
  porcentaje?: string | number | null;
  montoBase?: string | number | null;
  ivaPct?: string | number | null;
  formula?: string | null;
  variablesFormula?: unknown;
  activo: boolean;
}

export interface ClausulaContractual {
  id: string;
  codigo: string;
  titulo: string;
  contenido: string;
  version: string;
  activo: boolean;
}

export const fetchConceptosCobro = () =>
  apiRequest<ConceptoCobro[]>('/catalogos/conceptos-cobro');

export const fetchClausulas = () =>
  apiRequest<ClausulaContractual[]>('/catalogos/clausulas');

// ── Punto de servicio (operativo) ───────────────────────────────────────────

export interface CatalogoTipoCorte {
  id: string;
  codigo: string;
  descripcion: string;
  impacto?: string | null;
  requiereCuadrilla: boolean;
  activo: boolean;
}

export interface CatalogoCodigoDescripcion {
  id: string;
  codigo: string;
  descripcion: string;
  activo: boolean;
}

export interface CatalogoCodigoRecorrido extends CatalogoCodigoDescripcion {
  rutaId?: string | null;
}

export const fetchTiposCorte = () =>
  apiRequest<CatalogoTipoCorte[]>('/catalogos/tipos-corte');

export const fetchTiposSuministro = () =>
  apiRequest<CatalogoCodigoDescripcion[]>('/catalogos/tipos-suministro');

export const fetchEstructurasTecnicas = () =>
  apiRequest<CatalogoCodigoDescripcion[]>('/catalogos/estructuras-tecnicas');

export const fetchZonasFacturacion = () =>
  apiRequest<CatalogoCodigoDescripcion[]>('/catalogos/zonas-facturacion');

export const fetchCodigosRecorrido = () =>
  apiRequest<CatalogoCodigoRecorrido[]>('/catalogos/codigos-recorrido');

export interface DistritoCatalogo {
  id: string;
  nombre: string;
  zonaId: string;
}

export const fetchDistritos = () =>
  apiRequest<DistritoCatalogo[]>('/catalogos/distritos');

export interface ZonaTerritorialCatalogo {
  id: string;
  nombre: string;
  administracionId: string;
}

export const fetchZonasTerritoriales = () =>
  apiRequest<ZonaTerritorialCatalogo[]>('/catalogos/zonas-territoriales');

export interface AdministracionCatalogo {
  id: string;
  nombre: string;
}

export const fetchAdministraciones = (params?: { uso?: 'domestico' | 'no_domestico' }) =>
  apiRequest<AdministracionCatalogo[]>(
    params?.uso
      ? `/catalogos-operativos/administraciones?uso=${params.uso}`
      : '/catalogos-operativos/administraciones',
  );

// ── Catálogos Operativos (medidores, pagos, oficinas, contratación) ──────────

export interface CatalogoMarcaMedidor {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
}

export interface CatalogoModeloMedidor {
  id: string;
  marcaId: string;
  codigo: string;
  nombre: string;
  activo: boolean;
  marca?: CatalogoMarcaMedidor;
}

export interface CatalogoCalibre {
  id: string;
  codigo: string;
  descripcion: string;
  diametroMm?: number | null;
  activo: boolean;
}

export interface FormaPago {
  id: string;
  codigo: string;
  nombre: string;
  tipoRecaudacion: string;
  aceptaEfectivo: boolean;
  aceptaCheque: boolean;
  aceptaTarjeta: boolean;
  aceptaTransf: boolean;
  requiereReferencia: boolean;
  activo: boolean;
}

export interface SectorHidraulico {
  id: string;
  codigo: string;
  nombre: string;
  administracionId?: string | null;
  activo: boolean;
}

export interface ClaseContrato {
  id: string;
  codigo: string;
  descripcion: string;
  activo: boolean;
}

export interface TipoVariable {
  id: string;
  codigo: string;
  nombre: string;
  tipoDato: string;
  valoresPosibles?: unknown;
  unidad?: string | null;
  activo: boolean;
}

export interface VariableTipoContratacionAsignacion {
  id: string;
  obligatorio: boolean;
  orden: number;
  valorDefecto?: string | null;
  tipoVariable: TipoVariable;
}

export interface CreateTipoVariableDto {
  codigo: string;
  nombre: string;
  tipoDato: string;
  valoresPosibles?: unknown;
  unidad?: string | null;
}

export interface UpdateTipoVariableDto {
  nombre?: string;
  tipoDato?: string;
  valoresPosibles?: unknown | null;
  unidad?: string | null;
  activo?: boolean;
}

export const fetchMarcasMedidor = () =>
  apiRequest<CatalogoMarcaMedidor[]>('/catalogos-operativos/marcas-medidor');

export const fetchModelosMedidor = () =>
  apiRequest<CatalogoModeloMedidor[]>('/catalogos-operativos/modelos-medidor');

export const fetchCalibres = () =>
  apiRequest<CatalogoCalibre[]>('/catalogos-operativos/calibres');

export const fetchEmplazamientos = () =>
  apiRequest<CatalogoCodigoDescripcion[]>('/catalogos-operativos/emplazamientos');

export const fetchTiposContador = () =>
  apiRequest<CatalogoCodigoDescripcion[]>('/catalogos-operativos/tipos-contador');

export const fetchFormasPago = () =>
  apiRequest<FormaPago[]>('/catalogos-operativos/formas-pago');

export const fetchTiposOficina = () =>
  apiRequest<CatalogoCodigoDescripcion[]>('/catalogos-operativos/tipos-oficina');

export const fetchSectoresHidraulicos = () =>
  apiRequest<SectorHidraulico[]>('/catalogos-operativos/sectores-hidraulicos');

export const fetchClasesContrato = () =>
  apiRequest<ClaseContrato[]>('/catalogos-operativos/clases-contrato');

export const fetchTiposVia = () =>
  apiRequest<CatalogoCodigoDescripcion[]>('/catalogos-operativos/tipos-via');

export const fetchTiposVariable = () =>
  apiRequest<TipoVariable[]>('/catalogos-operativos/tipos-variable');

export const createTipoVariable = (dto: CreateTipoVariableDto) =>
  apiRequest<TipoVariable>('/catalogos-operativos/tipos-variable', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const updateTipoVariable = (id: string, dto: UpdateTipoVariableDto) =>
  apiRequest<TipoVariable>(`/catalogos-operativos/tipos-variable/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });

export const fetchVariablesTipoContratacion = (tipoContratacionId: string) =>
  apiRequest<VariableTipoContratacionAsignacion[]>(
    `/catalogos-operativos/variables-tipo-contratacion/${tipoContratacionId}`,
  );

export const assignVariableTipoContratacion = (body: {
  tipoContratacionId: string;
  tipoVariableId: string;
  obligatorio?: boolean;
  valorDefecto?: string;
  orden?: number;
}) =>
  apiRequest<unknown>('/catalogos-operativos/variables-tipo-contratacion', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const removeVariableTipoContratacion = (
  tipoContratacionId: string,
  tipoVariableId: string,
) =>
  apiRequest<void>(
    `/catalogos-operativos/variables-tipo-contratacion/${tipoContratacionId}/${tipoVariableId}`,
    { method: 'DELETE' },
  );

// ── SAT / CFDI (Anexo 20) ───────────────────────────────────────────────────

export type CatalogoSatTipoApi = 'REGIMEN_FISCAL' | 'USO_CFDI';

export interface CatalogoSatItem {
  id: string;
  tipo: CatalogoSatTipoApi;
  clave: string;
  descripcion: string;
  aplicaFisica: boolean;
  aplicaMoral: boolean;
  vigenciaInicio?: string | null;
  vigenciaFin?: string | null;
  regimenesReceptorPermitidos?: string | null;
  orden: number;
  activo: boolean;
}

/** `tipo` opcional: todo el catálogo o solo régimen fiscal / uso CFDI */
export const fetchCatalogoSat = (tipo?: CatalogoSatTipoApi) => {
  const q = tipo ? `?tipo=${encodeURIComponent(tipo)}` : '';
  return apiRequest<CatalogoSatItem[]>(`/catalogos/sat${q}`);
};
