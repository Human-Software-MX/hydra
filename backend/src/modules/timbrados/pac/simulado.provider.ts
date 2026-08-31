import { createHash, randomUUID } from 'crypto';
import { PacProvider, TimbreResultado } from './pac-provider.interface';

/**
 * Proveedor PAC simulado — timbrado de desarrollo sin credenciales reales.
 *
 * Genera un UUID válido y un complemento TimbreFiscalDigital insertado en el XML,
 * con sellos deterministas derivados por hash (no criptográficos). Sirve para
 * desarrollar y probar el flujo completo de facturación end-to-end; en producción
 * se sustituye por un proveedor real (Finkok/SW) vía PAC_PROVIDER, sin cambiar
 * el resto del sistema.
 */
export class SimuladoPacProvider implements PacProvider {
  readonly nombre = 'simulado';

  async timbrar(xml: string, meta: { uuidSugerido?: string }): Promise<TimbreResultado> {
    const uuid = (meta.uuidSugerido ?? randomUUID()).toUpperCase();
    const fechaTimbrado = new Date().toISOString().slice(0, 19);
    const sello = createHash('sha256').update(xml).digest('base64');
    const selloSAT = createHash('sha256').update(uuid + fechaTimbrado).digest('base64');
    const noCertificadoSAT = '00001000000500000000';
    const rfcProvCertif = 'SPR190613I52'; // RFC de PAC de pruebas del SAT

    const cadenaOriginalSAT = `||1.1|${uuid}|${fechaTimbrado}|${rfcProvCertif}|${sello.slice(0, 20)}|${noCertificadoSAT}||`;

    const timbre =
      `<cfdi:Complemento>` +
      `<tfd:TimbreFiscalDigital ` +
      `xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" ` +
      `xsi:schemaLocation="http://www.sat.gob.mx/TimbreFiscalDigital http://www.sat.gob.mx/sitio_internet/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd" ` +
      `Version="1.1" ` +
      `UUID="${uuid}" ` +
      `FechaTimbrado="${fechaTimbrado}" ` +
      `RfcProvCertif="${rfcProvCertif}" ` +
      `SelloCFD="${sello}" ` +
      `NoCertificadoSAT="${noCertificadoSAT}" ` +
      `SelloSAT="${selloSAT}"/>` +
      `</cfdi:Complemento>`;

    // Inserta el complemento antes del cierre del Comprobante.
    const xmlTimbrado = xml.replace('</cfdi:Comprobante>', `${timbre}</cfdi:Comprobante>`);

    return {
      uuid,
      fechaTimbrado,
      selloCFDI: sello,
      selloSAT,
      noCertificadoSAT,
      rfcProvCertif,
      xmlTimbrado,
      cadenaOriginalSAT,
    };
  }

  async cancelar(uuid: string, _motivo: string): Promise<{ acuse: string }> {
    return { acuse: `SIMULADO-CANCEL-${uuid}` };
  }
}
