/**
 * Verificación aislada del motor de facturación (billing-calculator).
 * Ejecuta: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/verify-billing.ts
 *
 * No toca la base de datos: valida la aritmética de la facturación escalonada,
 * multi-servicio, cuota fija e IVA por línea.
 */
import { calcularFactura, calcularServicio, redondear, TarifaCalculo } from '../src/modules/facturacion/billing-calculator';

let fallos = 0;
function assert(nombre: string, real: number, esperado: number) {
  const ok = Math.abs(real - esperado) < 0.005;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗'} ${nombre}: esperado ${esperado}, obtuvo ${real}`);
}

// ── Tarifa de agua escalonada típica (bloques crecientes) ──
const agua: TarifaCalculo[] = [
  { tipoServicio: 'agua', tipoCalculo: 'escalonado', rangoMinM3: 0, rangoMaxM3: 10, precioUnitario: 5, cuotaFija: null, ivaPct: 0 },
  { tipoServicio: 'agua', tipoCalculo: 'escalonado', rangoMinM3: 10, rangoMaxM3: 20, precioUnitario: 8, cuotaFija: null, ivaPct: 0 },
  { tipoServicio: 'agua', tipoCalculo: 'escalonado', rangoMinM3: 20, rangoMaxM3: null, precioUnitario: 12, cuotaFija: null, ivaPct: 0 },
];

// 5 m³ -> todo en bloque 1: 5 * 5 = 25
assert('agua 5 m³', calcularServicio('agua', agua, 5).reduce((s, l) => s + l.importe, 0), 25);
// 15 m³ -> 10*5 + 5*8 = 50 + 40 = 90
assert('agua 15 m³', calcularServicio('agua', agua, 15).reduce((s, l) => s + l.importe, 0), 90);
// 30 m³ -> 10*5 + 10*8 + 10*12 = 50 + 80 + 120 = 250
assert('agua 30 m³', calcularServicio('agua', agua, 30).reduce((s, l) => s + l.importe, 0), 250);
// 0 m³ -> 0
assert('agua 0 m³', calcularServicio('agua', agua, 0).reduce((s, l) => s + l.importe, 0), 0);

// El orden de entrada no debe importar (se ordena por rango internamente)
const aguaDesordenada = [...agua].reverse();
assert('agua 15 m³ (desordenada)', calcularServicio('agua', aguaDesordenada, 15).reduce((s, l) => s + l.importe, 0), 90);

// ── Cuota fija ──
const saneamiento: TarifaCalculo[] = [
  { tipoServicio: 'saneamiento', tipoCalculo: 'fijo', rangoMinM3: null, rangoMaxM3: null, precioUnitario: null, cuotaFija: 30, ivaPct: 16 },
];
assert('saneamiento cuota fija', calcularServicio('saneamiento', saneamiento, 999).reduce((s, l) => s + l.importe, 0), 30);

// ── Factura completa multi-servicio con IVA por línea ──
const factura = calcularFactura({
  consumoM3: 15,
  tarifasPorServicio: { agua, saneamiento },
});
// subtotal = 90 (agua, iva 0%) + 30 (saneamiento, iva 16%) = 120
assert('factura subtotal', factura.subtotal, 120);
// iva = 0 (agua) + 30*0.16 = 4.8
assert('factura iva', factura.iva, 4.8);
// total = 124.8
assert('factura total', factura.total, 124.8);

// ── Redondeo ──
assert('redondeo 12.005', redondear(12.005), 12.01);
assert('redondeo 0.1+0.2', redondear(0.1 + 0.2), 0.3);

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
