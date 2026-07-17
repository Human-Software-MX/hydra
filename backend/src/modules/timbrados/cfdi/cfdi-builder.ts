/**
 * Constructor puro de XML CFDI 4.0 (SAT México) para servicios de agua.
 *
 * Produce el Comprobante sin timbrar (sin el complemento TimbreFiscalDigital);
 * el sellado y timbrado los realiza el PAC (ver pac/). Se mantiene puro y sin
 * dependencias para poder verificarlo aislado — es un documento fiscal y su
 * estructura debe ser exacta.
 *
 * Referencias: Anexo 20 CFDI 4.0; catálogos SAT. ClaveProdServ 83101509
 * ("Servicios de suministro de agua") y ClaveUnidad MTQ (metro cúbico) / E48
 * (unidad de servicio) para conceptos de cuota fija.
 */

export interface CfdiEmisor {
  rfc: string;
  nombre: string;
  regimenFiscal: string; // c_RegimenFiscal, p.ej. "603" personas morales con fines no lucrativos
  codigoPostal: string; // LugarExpedicion
}

export interface CfdiReceptor {
  rfc: string;
  nombre: string;
  domicilioFiscalCP: string;
  regimenFiscal: string;
  usoCFDI: string; // p.ej. "G03" gastos en general / "S01" sin efectos fiscales
}

export interface CfdiConcepto {
  claveProdServ: string;
  claveUnidad: string;
  cantidad: number;
  descripcion: string;
  valorUnitario: number;
  importe: number;
  descuento?: number;
  /** "02" sí objeto de impuesto, "01" no objeto. */
  objetoImp: string;
  /** Tasa de IVA aplicable (0.16, 0 …). Solo si objetoImp === "02". */
  ivaTasa?: number;
  ivaImporte?: number;
}

export interface CfdiComprobanteInput {
  serie?: string;
  folio?: string;
  fecha: string; // ISO local sin zona, "2026-07-17T12:00:00"
  formaPago: string; // c_FormaPago, "99" por definir / "03" transferencia …
  metodoPago: 'PUE' | 'PPD';
  moneda?: string;
  emisor: CfdiEmisor;
  receptor: CfdiReceptor;
  conceptos: CfdiConcepto[];
}

const XML_ENTIDADES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => XML_ENTIDADES[c]);
}

/** Formatea un número con exactamente `dec` decimales (los importes CFDI usan 2). */
function n(num: number, dec = 2): string {
  return num.toFixed(dec);
}

export interface CfdiCalculado {
  subtotal: number;
  descuento: number;
  totalTraslados: number;
  total: number;
}

/** Suma los importes del comprobante a partir de sus conceptos. */
export function calcularTotalesCfdi(conceptos: CfdiConcepto[]): CfdiCalculado {
  const subtotal = redondear2(conceptos.reduce((s, c) => s + c.importe, 0));
  const descuento = redondear2(conceptos.reduce((s, c) => s + (c.descuento ?? 0), 0));
  const totalTraslados = redondear2(conceptos.reduce((s, c) => s + (c.ivaImporte ?? 0), 0));
  const total = redondear2(subtotal - descuento + totalTraslados);
  return { subtotal, descuento, totalTraslados, total };
}

function redondear2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Construye el XML del Comprobante CFDI 4.0 (sin timbrar). */
export function construirCfdiXml(input: CfdiComprobanteInput): { xml: string; totales: CfdiCalculado } {
  const totales = calcularTotalesCfdi(input.conceptos);
  const moneda = input.moneda ?? 'MXN';
  const hayTraslados = input.conceptos.some((c) => c.objetoImp === '02' && (c.ivaImporte ?? 0) >= 0 && c.ivaTasa !== undefined);

  const attrs = (obj: Record<string, string | undefined>): string =>
    Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
      .join(' ');

  const conceptosXml = input.conceptos
    .map((c) => {
      const impuestosConcepto =
        c.objetoImp === '02' && c.ivaTasa !== undefined
          ? `<cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado ${attrs({
              Base: n(c.importe),
              Impuesto: '002',
              TipoFactor: 'Tasa',
              TasaOCuota: n(c.ivaTasa, 6),
              Importe: n(c.ivaImporte ?? 0),
            })}/></cfdi:Traslados></cfdi:Impuestos>`
          : '';
      return `<cfdi:Concepto ${attrs({
        ClaveProdServ: c.claveProdServ,
        Cantidad: n(c.cantidad, 6),
        ClaveUnidad: c.claveUnidad,
        Descripcion: c.descripcion,
        ValorUnitario: n(c.valorUnitario),
        Importe: n(c.importe),
        Descuento: c.descuento ? n(c.descuento) : undefined,
        ObjetoImp: c.objetoImp,
      })}>${impuestosConcepto}</cfdi:Concepto>`;
    })
    .join('');

  const impuestosXml = hayTraslados
    ? `<cfdi:Impuestos ${attrs({ TotalImpuestosTrasladados: n(totales.totalTraslados) })}>` +
      `<cfdi:Traslados><cfdi:Traslado ${attrs({
        Base: n(totales.subtotal),
        Impuesto: '002',
        TipoFactor: 'Tasa',
        TasaOCuota: n(0.16, 6),
        Importe: n(totales.totalTraslados),
      })}/></cfdi:Traslados></cfdi:Impuestos>`
    : '';

  const comprobanteAttrs = attrs({
    'xmlns:cfdi': 'http://www.sat.gob.mx/cfd/4',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation':
      'http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd',
    Version: '4.0',
    Serie: input.serie,
    Folio: input.folio,
    Fecha: input.fecha,
    Sello: '', // lo llena el sellado (PAC/CSD)
    FormaPago: input.formaPago,
    NoCertificado: '',
    Certificado: '',
    SubTotal: n(totales.subtotal),
    Descuento: totales.descuento > 0 ? n(totales.descuento) : undefined,
    Moneda: moneda,
    Total: n(totales.total),
    TipoDeComprobante: 'I',
    Exportacion: '01',
    MetodoPago: input.metodoPago,
    LugarExpedicion: input.emisor.codigoPostal,
  });

  const emisorXml = `<cfdi:Emisor ${attrs({
    Rfc: input.emisor.rfc,
    Nombre: input.emisor.nombre,
    RegimenFiscal: input.emisor.regimenFiscal,
  })}/>`;

  const receptorXml = `<cfdi:Receptor ${attrs({
    Rfc: input.receptor.rfc,
    Nombre: input.receptor.nombre,
    DomicilioFiscalReceptor: input.receptor.domicilioFiscalCP,
    RegimenFiscalReceptor: input.receptor.regimenFiscal,
    UsoCFDI: input.receptor.usoCFDI,
  })}/>`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<cfdi:Comprobante ${comprobanteAttrs}>` +
    emisorXml +
    receptorXml +
    `<cfdi:Conceptos>${conceptosXml}</cfdi:Conceptos>` +
    impuestosXml +
    `</cfdi:Comprobante>`;

  return { xml, totales };
}
