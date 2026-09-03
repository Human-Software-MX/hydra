/**
 * Verificación aislada del constructor de CFDI 4.0 y del PAC simulado.
 * Ejecuta: node -r ts-node/register/transpile-only scripts/verify-cfdi.ts
 */
import { construirCfdiXml, calcularTotalesCfdi } from '../src/modules/timbrados/cfdi/cfdi-builder';
import { SimuladoPacProvider } from '../src/modules/timbrados/pac/simulado.provider';

let fallos = 0;
function ok(nombre: string, cond: boolean) {
  if (!cond) fallos++;
  console.log(`${cond ? '✓' : '✗'} ${nombre}`);
}

const { xml, totales } = construirCfdiXml({
  serie: 'A',
  folio: '123-202607',
  fecha: '2026-07-17T12:00:00',
  formaPago: '99',
  metodoPago: 'PUE',
  emisor: { rfc: 'EKU9003173C9', nombre: 'ORGANISMO OPERADOR', regimenFiscal: '603', codigoPostal: '76000' },
  receptor: { rfc: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL', domicilioFiscalCP: '76000', regimenFiscal: '616', usoCFDI: 'S01' },
  conceptos: [
    { claveProdServ: '83101509', claveUnidad: 'MTQ', cantidad: 15, descripcion: 'Consumo de agua', valorUnitario: 6, importe: 90, objetoImp: '01' },
    { claveProdServ: '83101509', claveUnidad: 'E48', cantidad: 1, descripcion: 'Saneamiento', valorUnitario: 30, importe: 30, objetoImp: '02', ivaTasa: 0.16, ivaImporte: 4.8 },
  ],
});

ok('XML declara CFDI 4.0', xml.includes('Version="4.0"'));
ok('incluye Emisor', xml.includes('cfdi:Emisor') && xml.includes('EKU9003173C9'));
ok('incluye Receptor público general', xml.includes('XAXX010101000') && xml.includes('UsoCFDI="S01"'));
ok('incluye 2 conceptos', (xml.match(/<cfdi:Concepto /g) || []).length === 2);
ok('concepto con IVA lleva Traslado', xml.includes('Impuesto="002"') && xml.includes('TasaOCuota="0.160000"'));
ok('SubTotal = 120', xml.includes('SubTotal="120.00"'));
ok('Total = 124.80', xml.includes('Total="124.80"'));
ok('totales.total correcto', Math.abs(totales.total - 124.8) < 0.005);
ok('Impuestos globales TotalImpuestosTrasladados', xml.includes('TotalImpuestosTrasladados="4.80"'));
// La Base del traslado a nivel comprobante es la suma de los importes GRAVADOS
// (el concepto de agua es ObjetoImp '01', no objeto de impuesto), no el SubTotal.
ok('Base del traslado = sólo el concepto gravado (30.00)', xml.includes('<cfdi:Traslado Base="30.00"'));
// Un traslado en el concepto gravado y uno solo (una tasa) a nivel comprobante.
ok('un traslado por tasa: 1 en concepto + 1 en comprobante', (xml.match(/<cfdi:Traslado /g) || []).length === 2);

// ── Factura mixta 0 % / 16 %: un Traslado por tasa, cada uno con su propia base ──
const mixta = construirCfdiXml({
  fecha: '2026-07-17T12:00:00', formaPago: '99', metodoPago: 'PUE',
  emisor: { rfc: 'EKU9003173C9', nombre: 'ORGANISMO OPERADOR', regimenFiscal: '603', codigoPostal: '76000' },
  receptor: { rfc: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL', domicilioFiscalCP: '76000', regimenFiscal: '616', usoCFDI: 'S01' },
  conceptos: [
    // Doméstico: gravado a tasa 0 % (SAT exige el Traslado con TasaOCuota 0.000000).
    { claveProdServ: '83101509', claveUnidad: 'MTQ', cantidad: 12, descripcion: 'Consumo de agua doméstico', valorUnitario: 5, importe: 60, objetoImp: '02', ivaTasa: 0, ivaImporte: 0 },
    // Saneamiento comercial: 16 %.
    { claveProdServ: '83101509', claveUnidad: 'E48', cantidad: 1, descripcion: 'Saneamiento comercial', valorUnitario: 40, importe: 40, objetoImp: '02', ivaTasa: 0.16, ivaImporte: 6.4 },
  ],
});
ok('mixta: SubTotal = 100.00', mixta.xml.includes('SubTotal="100.00"'));
ok('mixta: Total = 106.40', mixta.xml.includes('Total="106.40"'));
ok('mixta: TotalImpuestosTrasladados = 6.40', mixta.xml.includes('TotalImpuestosTrasladados="6.40"'));
ok('mixta: 2 traslados de concepto + 2 tasas en el comprobante', (mixta.xml.match(/<cfdi:Traslado /g) || []).length === 4);
ok(
  'mixta: traslado 0 % con base 60.00',
  mixta.xml.includes('<cfdi:Traslado Base="60.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.000000" Importe="0.00"/><cfdi:Traslado Base="40.00"'),
);
ok(
  'mixta: traslado 16 % con base 40.00 (no el subtotal)',
  mixta.xml.includes('<cfdi:Traslado Base="40.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="6.40"/></cfdi:Traslados></cfdi:Impuestos>'),
);

// Escapado XML
const conAmp = construirCfdiXml({
  fecha: '2026-07-17T12:00:00', formaPago: '99', metodoPago: 'PUE',
  emisor: { rfc: 'EKU9003173C9', nombre: 'AGUA & DRENAJE', regimenFiscal: '603', codigoPostal: '76000' },
  receptor: { rfc: 'XAXX010101000', nombre: 'X', domicilioFiscalCP: '76000', regimenFiscal: '616', usoCFDI: 'S01' },
  conceptos: [{ claveProdServ: '83101509', claveUnidad: 'E48', cantidad: 1, descripcion: 'x', valorUnitario: 1, importe: 1, objetoImp: '01' }],
});
ok('escapa & en nombre emisor', conAmp.xml.includes('AGUA &amp; DRENAJE'));

// PAC simulado
(async () => {
  const pac = new SimuladoPacProvider();
  const timbre = await pac.timbrar(xml, {});
  ok('PAC genera UUID', /^[0-9A-F-]{36}$/.test(timbre.uuid));
  ok('PAC inserta TimbreFiscalDigital', timbre.xmlTimbrado.includes('tfd:TimbreFiscalDigital'));
  ok('XML timbrado cierra Comprobante después del timbre', timbre.xmlTimbrado.trim().endsWith('</cfdi:Comprobante>'));

  console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
  process.exit(fallos === 0 ? 0 : 1);
})();
