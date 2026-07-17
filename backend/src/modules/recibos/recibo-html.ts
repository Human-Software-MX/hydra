/**
 * Generador de recibo imprimible (HTML server-side).
 *
 * Produce un HTML autocontenido y listo para imprimir/guardar como PDF desde el
 * navegador, sin dependencias externas. Es la base del "PDF de recibo"; cuando se
 * requiera PDF binario en el servidor (p. ej. adjunto de correo) se puede pasar
 * este HTML por un motor headless sin cambiar el resto del sistema.
 */

export interface ReciboHtmlData {
  reciboId: string;
  organismo: string;
  contrato: { numero: number | string; nombre: string; rfc?: string; direccion?: string };
  periodo: string;
  fechaEmision: string;
  fechaVencimiento: string;
  consumoM3?: number;
  lineas?: Array<{ concepto: string; importe: number }>;
  subtotal: number;
  iva: number;
  saldoVigente: number;
  saldoVencido: number;
  total: number;
  cfdi?: { uuid?: string; serie?: string; folio?: string; selloSat?: string };
  mensajes?: string[];
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function construirReciboHtml(d: ReciboHtmlData): string {
  const lineasHtml = (d.lineas ?? [])
    .map((l) => `<tr><td>${esc(l.concepto)}</td><td class="r">${money(l.importe)}</td></tr>`)
    .join('');

  const mensajesHtml = (d.mensajes ?? [])
    .map((m) => `<p class="msg">${esc(m)}</p>`)
    .join('');

  const cfdiHtml = d.cfdi?.uuid
    ? `<div class="cfdi"><strong>CFDI</strong> ${esc(d.cfdi.serie ?? '')}${esc(d.cfdi.folio ?? '')} · UUID: ${esc(d.cfdi.uuid)}</div>`
    : '';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Recibo ${esc(String(d.contrato.numero))} — ${esc(d.periodo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 24px; }
  .recibo { max-width: 720px; margin: 0 auto; border: 1px solid #ccc; border-radius: 8px; padding: 24px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0369a1; padding-bottom: 12px; margin-bottom: 16px; }
  .org { font-size: 18px; font-weight: bold; color: #0369a1; }
  .muted { color: #666; font-size: 12px; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  .r { text-align: right; }
  .tot { font-weight: bold; font-size: 16px; }
  .tot td { border-top: 2px solid #333; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; margin-bottom: 12px; }
  .cfdi { font-size: 11px; color: #444; margin-top: 12px; word-break: break-all; }
  .msg { background: #f1f5f9; padding: 8px; border-radius: 4px; font-size: 12px; margin: 6px 0; }
  @media print { body { padding: 0; } .recibo { border: none; } }
</style></head>
<body>
  <div class="recibo">
    <div class="head">
      <div>
        <div class="org">${esc(d.organismo)}</div>
        <div class="muted">Recibo de servicio de agua</div>
      </div>
      <div class="muted r">
        <div>Periodo: <strong>${esc(d.periodo)}</strong></div>
        <div>Emisión: ${esc(d.fechaEmision)}</div>
        <div>Vencimiento: <strong>${esc(d.fechaVencimiento)}</strong></div>
      </div>
    </div>

    <div class="grid">
      <div><h1>Contrato ${esc(String(d.contrato.numero))}</h1>${esc(d.contrato.nombre)}</div>
      <div class="r">
        ${d.contrato.rfc ? `RFC: ${esc(d.contrato.rfc)}<br/>` : ''}
        ${d.contrato.direccion ? `<span class="muted">${esc(d.contrato.direccion)}</span>` : ''}
      </div>
    </div>

    <table>
      <thead><tr><th>Concepto</th><th class="r">Importe</th></tr></thead>
      <tbody>
        ${lineasHtml || `<tr><td>Consumo ${d.consumoM3 ?? 0} m³</td><td class="r">${money(d.subtotal)}</td></tr>`}
        <tr><td class="r muted">Subtotal</td><td class="r">${money(d.subtotal)}</td></tr>
        <tr><td class="r muted">IVA</td><td class="r">${money(d.iva)}</td></tr>
        ${d.saldoVencido > 0 ? `<tr><td class="r muted">Saldo vencido anterior</td><td class="r">${money(d.saldoVencido)}</td></tr>` : ''}
        <tr class="tot"><td class="r">TOTAL A PAGAR</td><td class="r">${money(d.total)}</td></tr>
      </tbody>
    </table>

    ${mensajesHtml}
    ${cfdiHtml}
  </div>
</body></html>`;
}
