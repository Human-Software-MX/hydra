import type { DomicilioFormValue } from '@/components/contratacion/DomicilioPickerForm';

// Re-export for consumers that only need the form shape
export type { DomicilioFormValue };

export interface SolicitudState {
  claveCatastral: string;
  folioExpediente: string;
  predioDir: DomicilioFormValue;
  predioManzana: string;
  predioLote: string;
  superficieTotal: string;
  superficieConstruida: string;
  propTipoPersona: 'fisica' | 'moral' | '';
  propPaterno: string;
  propMaterno: string;
  propNombre: string;
  propRazonSocial: string;
  propRfc: string;
  propCorreo: string;
  propTelefono: string;
  propDir: DomicilioFormValue;
  propManzana: string;
  propLote: string;
  usoDomestico: 'si' | 'no' | '';
  hayTuberias: 'si' | 'no' | '';
  hayInfraCEA: 'si' | 'no' | '';
  esCondominio: 'si' | 'no' | '';
  condoViviendas: string;
  condoUbicacionTomas: 'banqueta' | 'cuadro' | '';
  condoTieneMedidorMacro: 'si' | 'no' | '';
  condoNumMedidor: string;
  condoAreasComunes: 'si' | 'no' | '';
  condoNumAreas: string;
  condoAgrupacion: 'si' | 'no' | '';
  condoNombreAgrupacion: string;
  personasVivienda: string;
  tieneCertConexion: 'si' | 'no' | '';
  // ── No Doméstico ──────────────────────────────────────────────────────────
  noDomHayInfra: 'si' | 'no' | '';
  // Con infraestructura — giros específicos
  noDomRestComensales: string;
  noDomRestMesas: string;
  noDomRestSanitarios: string;
  noDomLavNumLavadoras: string;
  noDomLavCapKg: string;
  noDomLavKgDia: string;
  noDomAutoAutosDia: string;
  noDomTortKgDia: string;
  noDomOficM2Oficinas: string;
  noDomOficM2Estac: string;
  noDomOtroGiro: string;
  // Sin infraestructura — requerimiento de agua
  noDomReqDomUnidades: string;
  noDomReqDomGiro: string;
  noDomReqComUnidades: string;
  noDomReqComGiro: string;
  noDomReqIndUnidades: string;
  noDomReqIndGiro: string;
  noDomReqOtroUnidades: string;
  noDomReqOtroGiro: string;
  noDomReqTotalUnidades: string;
  adminId: string;
  tipoContratacionId: string;
  /** Código SIGE (`TCT-…`) guardado junto al id para tolerar re-sembrados / migraciones de catálogo. */
  tipoContratacionCodigo?: string;
  distritoId: string;
  grupoActividadId: string;
  actividadId: string;
  contratoPadre: string;
  variablesCapturadas: Record<string, string>;
  /**
   * Opcional: líneas de cuantificación (cantidades por concepto de cobro).
   * Si se persisten, el paso Facturación del alta aplica estas cantidades con tarifas vigentes al día.
   */
  conceptosCuantificacionOverride?: { conceptoCobroId: string; cantidad: number }[];
  /** Ítems de cotización aprobados por el cliente al aceptar (persist para precarga en wizard). */
  cotizacionItems?: { descripcion: string; cantidad: number; unidad: string; precioUnitario: number; subtotal: number }[];
  variablesTexto: string;
  documentosRecibidos: string[];
  documentosTexto: string;
  requiereFactura: 'si' | 'no' | '';
  mismosDatosProp: 'si' | 'no' | '';
  fiscalTipoPersona: 'fisica' | 'moral' | '';
  fiscalRazonSocial: string;
  fiscalRfc: string;
  fiscalCorreo: string;
  fiscalDir: DomicilioFormValue;
  fiscalRegimenFiscal: string;
  fiscalUsoCfdi: string;
}

export const SOLICITUD_STATE_EMPTY: SolicitudState = {
  claveCatastral: '',
  folioExpediente: '',
  predioDir: { estadoINEGIId: '', municipioINEGIId: '', localidadINEGIId: '', coloniaINEGIId: '', codigoPostal: '', calle: '', numExterior: '', numInterior: '', referencia: '' },
  predioManzana: '',
  predioLote: '',
  superficieTotal: '',
  superficieConstruida: '',
  propTipoPersona: '',
  propPaterno: '',
  propMaterno: '',
  propNombre: '',
  propRazonSocial: '',
  propRfc: '',
  propCorreo: '',
  propTelefono: '',
  propDir: { estadoINEGIId: '', municipioINEGIId: '', localidadINEGIId: '', coloniaINEGIId: '', codigoPostal: '', calle: '', numExterior: '', numInterior: '', referencia: '' },
  propManzana: '',
  propLote: '',
  usoDomestico: '',
  hayTuberias: '',
  hayInfraCEA: '',
  esCondominio: '',
  condoViviendas: '',
  condoUbicacionTomas: '',
  condoTieneMedidorMacro: '',
  condoNumMedidor: '',
  condoAreasComunes: '',
  condoNumAreas: '',
  condoAgrupacion: '',
  condoNombreAgrupacion: '',
  personasVivienda: '',
  tieneCertConexion: '',
  noDomHayInfra: '',
  noDomRestComensales: '', noDomRestMesas: '', noDomRestSanitarios: '',
  noDomLavNumLavadoras: '', noDomLavCapKg: '', noDomLavKgDia: '',
  noDomAutoAutosDia: '',
  noDomTortKgDia: '',
  noDomOficM2Oficinas: '', noDomOficM2Estac: '',
  noDomOtroGiro: '',
  noDomReqDomUnidades: '', noDomReqDomGiro: '',
  noDomReqComUnidades: '', noDomReqComGiro: '',
  noDomReqIndUnidades: '', noDomReqIndGiro: '',
  noDomReqOtroUnidades: '', noDomReqOtroGiro: '',
  noDomReqTotalUnidades: '',
  adminId: '',
  tipoContratacionId: '',
  tipoContratacionCodigo: '',
  distritoId: '',
  grupoActividadId: '',
  actividadId: '',
  contratoPadre: '',
  variablesCapturadas: {},
  variablesTexto: '',
  documentosRecibidos: [],
  documentosTexto: '',
  requiereFactura: '',
  mismosDatosProp: '',
  fiscalTipoPersona: '',
  fiscalRazonSocial: '',
  fiscalRfc: '',
  fiscalCorreo: '',
  fiscalDir: { estadoINEGIId: '', municipioINEGIId: '', localidadINEGIId: '', coloniaINEGIId: '', codigoPostal: '', calle: '', numExterior: '', numInterior: '', referencia: '' },
  fiscalRegimenFiscal: '',
  fiscalUsoCfdi: '',
};

// ── Inspection order ──────────────────────────────────────────────────────────

export interface OrdenInspeccionData {
  estado: 'en_proceso' | 'completada';
  // General
  fechaInspeccion?: string;
  numeroOficial?: string;
  tipoUso?: string;
  giro?: string;
  // Áreas
  areaTerreno?: string;
  // Condiciones
  condicionToma?: string;
  condicionesPredio?: string;
  // Infraestructura
  infraHidraulicaExterna?: 'si' | 'no' | '';
  infraSanitaria?: 'si' | 'no' | '';
  materialCalle?: string;
  materialBanqueta?: string;
  metrosRupturaAguaBanqueta?: string;
  metrosRupturaAguaCalle?: string;
  metrosRupturaDrenajeBanqueta?: string;
  metrosRupturaDrenajeCalle?: string;
  // Observaciones y evidencia
  observaciones?: string;
  evidencias?: string[];            // base64 data URLs
  // Resultados
  resultadoEjecucion?: string;
  resultadoInspeccion?: string;
  // Inspector principal
  inspectorNumEmpleado?: string;
  inspectorNombre?: string;
  firmaInspector?: string;          // base64 data URL
  // Inspectores adicionales
  inspectoresAdicionales?: Array<{ noEmpleado: string; nombre: string; firma?: string }>;
  // Tiempos y validación
  inicio?: string;
  fin?: string;
  tipoOrdenCorrecto?: 'si' | 'no' | '';
  // ── Campos formales (junta CEA 02-sep) ───────────────────────────────────
  tieneMedidor?: boolean;
  diametroDescarga?: string;
  metrosLinealesToma?: number | string;
  metrosLinealesDescarga?: number | string;
  realizada?: boolean;
  motivoNoRealizada?: string;
  intentos?: number;
  /** display_id de la orden de inspección en AgoraCore */
  agoraOrdenRef?: string;
  // ── Legacy (kept for cotización engine backward compat) ──────────────────
  inspector?: string;
  diametroToma?: string;
  medidorExistente?: 'si' | 'no' | '';
  numMedidorExistente?: string;
  metrosRupturaCalle?: string;
  metrosRupturaBanqueta?: string;
  existeRed?: 'si' | 'no' | '';
  distanciaRed?: string;
  presionRed?: string;
  tipoMaterialRed?: string;
  profundidadRed?: string;
  tomaExistente?: 'si' | 'no' | '';
  diametroTomaExistente?: string;
  estadoTomaExistente?: string;
}

// ── Solicitud record (persisted) ──────────────────────────────────────────────

export type SolicitudEstado =
  | 'borrador'
  | 'inspeccion_pendiente'
  | 'inspeccion_en_proceso'
  | 'inspeccion_completada'
  | 'en_cotizacion'
  | 'aceptada'
  | 'rechazada'
  | 'cotizado'
  | 'contratado'
  | 'cancelada';

export interface SolicitudRecord {
  id: string;
  folio: string;
  fechaSolicitud: string;
  propNombreCompleto: string;
  propTelefono: string;
  predioResumen: string;
  adminId: string;
  tipoContratacionId: string;
  usoDomestico: 'si' | 'no' | '';
  estado: SolicitudEstado;
  ordenInspeccion?: OrdenInspeccionData;
  formData: SolicitudState;
  contratoId?: string;
  createdAt: string;
}
