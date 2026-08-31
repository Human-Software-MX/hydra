/** Verificación del generador de recibo imprimible. */
import { construirReciboHtml } from '../src/modules/recibos/recibo-html';

let fallos = 0;
const ok = (n: string, c: boolean) => { if (!c) fallos++; console.log(`${c ? '✓' : '✗'} ${n}`); };

const html = construirReciboHtml({
  reciboId: 'r1',
  organismo: 'CEA <Querétaro>',
  contrato: { numero: 1234, nombre: 'Juan Pérez', rfc: 'PEPJ800101ABC', direccion: 'Calle 1' },
  periodo: '2026-07',
  fechaEmision: '2026-07-17',
  fechaVencimiento: '2026-08-06',
  lineas: [{ concepto: 'Agua 15 m³', importe: 90 }, { concepto: 'Saneamiento', importe: 30 }],
  subtotal: 120, iva: 4.8, saldoVigente: 124.8, saldoVencido: 50, total: 174.8,
  cfdi: { uuid: 'ABC-123', serie: 'A', folio: '1234-202607' },
  mensajes: ['Pague a tiempo & evite recargos'],
});

ok('es documento HTML', html.startsWith('<!doctype html>'));
ok('incluye total', html.includes('174.80'));
ok('incluye saldo vencido', html.includes('50.00'));
ok('incluye CFDI UUID', html.includes('ABC-123'));
ok('escapa organismo con <>', html.includes('CEA &lt;Querétaro&gt;'));
ok('escapa & en mensaje', html.includes('recargos') && html.includes('&amp;'));
ok('incluye ambas líneas', html.includes('Agua 15 m³') && html.includes('Saneamiento'));

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
