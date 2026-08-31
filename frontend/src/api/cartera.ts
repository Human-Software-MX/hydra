import { apiRequest } from './client';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Buckets de aging válidos (mismos keys que BUCKET_FIELD del backend). */
export const BUCKETS_CARTERA = ['corriente', 'b1_30', 'b31_60', 'b61_90', 'b90_mas'] as const;
export type BucketCartera = (typeof BUCKETS_CARTERA)[number];

export const CATEGORIAS_MOROSIDAD = [
  'AL_CORRIENTE',
  'INCIPIENTE',
  'MODERADO',
  'ALTO',
  'CRITICO',
] as const;
export type CategoriaMorosidad = (typeof CATEGORIAS_MOROSIDAD)[number];

export const ACCIONES_DUNNING = [
  'notificar_aviso',
  'notificar_requerimiento',
  'generar_restriccion',
  'generar_corte',
  'ofrecer_convenio',
  'proponer_incobrable',
] as const;
export type AccionDunning = (typeof ACCIONES_DUNNING)[number];

export const CANALES_DUNNING = ['email', 'whatsapp', 'ambos'] as const;
export type CanalDunning = (typeof CANALES_DUNNING)[number];

/** EstadoCuenta materializado por contrato (los decimales llegan como string del backend; usar Number()). */
export interface EstadoCuentaDto {
  id: string;
  contratoId: string;
  saldoTotal: number;
  saldoCorriente: number;
  saldoVencido: number;
  bucketCorriente: number;
  bucket1_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90_mas: number;
  docsVencidos: number;
  diasMoraMax: number;
  scoreMorosidad: number;
  categoria: string;
  enConvenio: boolean;
  restringido: boolean;
  recalculadoEn: string;
}

export interface ContratoCarteraResumen {
  numeroContrato: number;
  nombre: string;
  estado: string;
  tipoServicio: string;
  zonaId?: string | null;
  zona?: { nombre: string; administracionId?: string; administracion?: { nombre: string } } | null;
}

export type CarteraItemDto = EstadoCuentaDto & { contrato: ContratoCarteraResumen };

export interface AplicacionPagoDto {
  id: string;
  pagoId: string;
  documentoCarteraId: string;
  monto: number;
  fecha: string;
  pago?: { id: string; fecha: string; monto: number; tipo: string; concepto: string };
}

export interface DocumentoCarteraDto {
  id: string;
  contratoId: string;
  reciboId?: string | null;
  tipo: string;
  periodo?: string | null;
  montoOriginal: number;
  montoAbonado: number;
  saldo: number;
  fechaEmision: string;
  fechaVencimiento: string;
  diasVencido: number;
  bucket: string;
  estado: string; // vigente | vencido | parcial | pagado | en_convenio | incobrable
  convenioId?: string | null;
  recalculadoEn: string;
  aplicaciones?: AplicacionPagoDto[];
}

export interface AccionCobranzaDto {
  id: string;
  contratoId: string;
  campanaId?: string | null;
  reglaId?: string | null;
  etapa: number;
  tipo: string; // aviso | requerimiento | restriccion | corte | convenio_ofrecido | incobrable
  canal?: string | null;
  estado: string; // ejecutada | fallida | omitida
  saldoAlMomento: number;
  diasMoraAlMomento: number;
  restriccionId?: string | null;
  ordenId?: string | null;
  autorizadoPor?: string | null;
  motivo?: string | null;
  createdAt: string;
  contrato?: { numeroContrato: number; nombre: string };
}

export interface AgingAggDto {
  administracionId: string | null;
  administracion: string | null;
  zonaId: string | null;
  zona: string | null;
  contratos: number;
  contratosVencidos: number;
  saldoTotal: number;
  saldoCorriente: number;
  saldoVencido: number;
  bucketCorriente: number;
  bucket1_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90_mas: number;
}

export interface AgingResumenDto {
  total: AgingAggDto;
  zonas: AgingAggDto[];
}

export interface EstadoCuentaContratoDto {
  contrato: {
    id: string;
    numeroContrato: number;
    nombre: string;
    estado: string;
    tipoServicio: string;
    zona?: { nombre: string; administracion?: { nombre: string } } | null;
  };
  estadoCuenta: EstadoCuentaDto | null;
  documentos: DocumentoCarteraDto[];
  acciones: AccionCobranzaDto[];
}

export interface ReglaDunningDto {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
  tipoContratacionId?: string | null;
  tipoServicio?: string | null;
  diasMoraMin: number;
  minDocsVencidos: number;
  montoMinimo: number;
  accion: string;
  canal?: string | null;
  reintentoDias: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReglaDunningInput {
  nombre: string;
  orden?: number;
  activo?: boolean;
  tipoContratacionId?: string;
  tipoServicio?: string;
  diasMoraMin: number;
  minDocsVencidos?: number;
  montoMinimo?: number;
  accion: string;
  canal?: string;
  reintentoDias?: number;
}

export interface ResultadoDunningDto {
  dryRun: boolean;
  evaluados: number;
  ejecutadas: number;
  fallidas: number;
  omitidas: number;
  sinRegla: number;
  acciones: Array<{
    contratoId: string;
    numeroContrato: number;
    regla: string;
    accion: string;
    estado: string;
    detalle?: string;
  }>;
  mensaje?: string;
}

export interface ResultadoRecalculoDto {
  contratos?: number;
  documentos: number;
  aplicaciones?: number;
  aplicacionesNuevas?: number;
  registros?: number;
  errores?: number;
  saldoTotal?: number;
  saldoVencido?: number;
}

export interface CampanaCobranzaDto {
  id: string;
  nombre: string;
  descripcion?: string | null;
  estado: string; // borrador | activa | finalizada
  administracionId?: string | null;
  bucketObjetivo?: string | null;
  fechaInicio?: string | null;
  fechaFin?: string | null;
  createdAt: string;
  _count?: { acciones: number };
}

export interface Paginado<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── Padrón y aging ───────────────────────────────────────────────────────────

export async function getCartera(params?: {
  administracionId?: string;
  zonaId?: string;
  bucket?: string;
  categoria?: string;
  minDiasMora?: number;
  scoreMin?: number;
  page?: number;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (params?.administracionId) q.set('administracionId', params.administracionId);
  if (params?.zonaId) q.set('zonaId', params.zonaId);
  if (params?.bucket) q.set('bucket', params.bucket);
  if (params?.categoria) q.set('categoria', params.categoria);
  if (params?.minDiasMora != null) q.set('minDiasMora', String(params.minDiasMora));
  if (params?.scoreMin != null) q.set('scoreMin', String(params.scoreMin));
  if (params?.page) q.set('page', String(params.page));
  if (params?.limit) q.set('limit', String(params.limit));
  return apiRequest<Paginado<CarteraItemDto>>(`/cartera?${q}`);
}

export async function getCarteraAging(params?: { administracionId?: string; zonaId?: string }) {
  const q = new URLSearchParams();
  if (params?.administracionId) q.set('administracionId', params.administracionId);
  if (params?.zonaId) q.set('zonaId', params.zonaId);
  const s = q.toString();
  return apiRequest<AgingResumenDto>(`/cartera/aging${s ? `?${s}` : ''}`);
}

export async function getEstadoCuentaContrato(contratoId: string) {
  return apiRequest<EstadoCuentaContratoDto>(`/cartera/contratos/${contratoId}/estado-cuenta`);
}

// ─── Recalculo y dunning ──────────────────────────────────────────────────────

/** Sin contratoId recalcula toda la cartera (backfill completo). */
export async function recalcularCartera(contratoId?: string) {
  return apiRequest<ResultadoRecalculoDto>('/cartera/recalcular', {
    method: 'POST',
    body: JSON.stringify(contratoId ? { contratoId } : {}),
  });
}

export async function evaluarDunning(dryRun: boolean) {
  return apiRequest<ResultadoDunningDto>('/cartera/evaluar-dunning', {
    method: 'POST',
    body: JSON.stringify({ dryRun }),
  });
}

// ─── Reglas de dunning ────────────────────────────────────────────────────────

export async function getReglasDunning() {
  return apiRequest<ReglaDunningDto[]>('/cartera/reglas-dunning');
}

export async function createReglaDunning(data: ReglaDunningInput) {
  return apiRequest<ReglaDunningDto>('/cartera/reglas-dunning', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateReglaDunning(id: string, data: Partial<ReglaDunningInput>) {
  return apiRequest<ReglaDunningDto>(`/cartera/reglas-dunning/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteReglaDunning(id: string) {
  return apiRequest<{ eliminada: boolean; id: string }>(`/cartera/reglas-dunning/${id}`, {
    method: 'DELETE',
  });
}

export async function seedReglasDunning() {
  return apiRequest<{ seeded: boolean; total: number; mensaje?: string }>(
    '/cartera/reglas-dunning/seed',
    { method: 'POST' },
  );
}

// ─── Campañas de cobranza ─────────────────────────────────────────────────────

export async function getCampanasCobranza(params?: { estado?: string; page?: number; limit?: number }) {
  const q = new URLSearchParams();
  if (params?.estado) q.set('estado', params.estado);
  if (params?.page) q.set('page', String(params.page));
  if (params?.limit) q.set('limit', String(params.limit));
  return apiRequest<Paginado<CampanaCobranzaDto>>(`/cartera/campanas?${q}`);
}

export async function createCampanaCobranza(data: {
  nombre: string;
  descripcion?: string;
  administracionId?: string;
  bucketObjetivo?: string;
  fechaInicio?: string;
  fechaFin?: string;
}) {
  return apiRequest<CampanaCobranzaDto>('/cartera/campanas', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function ejecutarCampanaCobranza(id: string, dryRun = false) {
  return apiRequest<ResultadoDunningDto & { campanaId: string; nombre: string }>(
    `/cartera/campanas/${id}/ejecutar`,
    { method: 'POST', body: JSON.stringify({ dryRun }) },
  );
}

// ─── Acciones de cobranza ─────────────────────────────────────────────────────

export async function getAccionesCobranza(params?: {
  contratoId?: string;
  tipo?: string;
  campanaId?: string;
  page?: number;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (params?.contratoId) q.set('contratoId', params.contratoId);
  if (params?.tipo) q.set('tipo', params.tipo);
  if (params?.campanaId) q.set('campanaId', params.campanaId);
  if (params?.page) q.set('page', String(params.page));
  if (params?.limit) q.set('limit', String(params.limit));
  return apiRequest<Paginado<AccionCobranzaDto>>(`/cartera/acciones?${q}`);
}

// ─── Incobrable ───────────────────────────────────────────────────────────────

export async function marcarIncobrable(
  contratoId: string,
  data: { motivo: string; autorizadoPor: string },
) {
  return apiRequest<{ accion: AccionCobranzaDto; documentosMarcados: number; saldoAlMomento: number }>(
    `/cartera/contratos/${contratoId}/incobrable`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}
