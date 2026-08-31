/**
 * Contrato de un proveedor de timbrado (PAC — Proveedor Autorizado de Certificación).
 *
 * Permite conectar Finkok, SW sapien, Facturama, etc. sin tocar el resto del
 * sistema: cada integración implementa esta interfaz y se selecciona por
 * configuración (env PAC_PROVIDER). El proveedor recibe el XML del comprobante
 * (sin timbrar) y devuelve los datos del timbre fiscal.
 */
export interface TimbreResultado {
  uuid: string;
  fechaTimbrado: string; // ISO
  selloCFDI: string;
  selloSAT: string;
  noCertificadoSAT: string;
  rfcProvCertif: string;
  /** XML final ya timbrado (con complemento TimbreFiscalDigital). */
  xmlTimbrado: string;
  /** cadena original del complemento de certificación del SAT. */
  cadenaOriginalSAT?: string;
}

export interface PacProvider {
  readonly nombre: string;
  /** Timbra el XML del comprobante. Lanza si el PAC rechaza el CFDI. */
  timbrar(xml: string, meta: { uuidSugerido?: string }): Promise<TimbreResultado>;
  /** Cancela un CFDI ya timbrado ante el SAT. */
  cancelar(uuid: string, motivo: string): Promise<{ acuse: string }>;
}
