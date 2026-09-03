/**
 * Verificación aislada del motor de facturación (billing-calculator).
 * Ejecuta: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/verify-billing.ts
 *
 * No toca la base de datos: valida la aritmética de la facturación escalonada,
 * multi-servicio, cuota fija, tabla (precios por m³), lineal e IVA por línea.
 */
import {
  calcularFactura,
  calcularServicio,
  m3Facturables,
  redondear,
  TarifaCalculo,
} from '../src/modules/facturacion/billing-calculator';

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

// ── Tarifa de tabla (Tarifas_periodicas.xlsx): importe acumulado por m³ ──
// precios[m3] = 5 * m3 en 0..200 m³; por encima del tope: 100 + 3 × m³.
const aguaTabla: TarifaCalculo[] = [
  {
    tipoServicio: 'agua',
    tipoCalculo: 'tabla',
    rangoMinM3: 0,
    rangoMaxM3: 200,
    precioUnitario: 3,
    cuotaFija: 100,
    precios: Array.from({ length: 201 }, (_, i) => i * 5),
    ivaPct: 0,
  },
];
const importeTabla = (m3: number) => calcularServicio('agua', aguaTabla, m3).reduce((s, l) => s + l.importe, 0);
assert('tabla 10 m³', importeTabla(10), 50); // precios[10]
assert('tabla 10.5 m³ (fracción = 0.5 no sube)', importeTabla(10.5), 50);
assert('tabla 10.6 m³ (fracción > 0.5 sube)', importeTabla(10.6), 55); // precios[11]
assert('tabla 250 m³ (fuera de tabla)', importeTabla(250), 850); // 100 + 3*250
assert('tabla 0 m³ (tabla arranca en 0)', importeTabla(0), 0);
assert('m3Facturables 10.5', m3Facturables(10.5), 10);
assert('m3Facturables 10.6', m3Facturables(10.6), 11);

// Mínimo de la tabla: precios[0] se cobra aunque no haya consumo.
const tablaConMinimo: TarifaCalculo[] = [{ ...aguaTabla[0], rangoMaxM3: 2, precios: [80, 85, 90] }];
assert('tabla con mínimo, 0 m³', calcularServicio('agua', tablaConMinimo, 0).reduce((s, l) => s + l.importe, 0), 80);

// ── Tarifa lineal: cuotaFija + precioUnitario × consumo ──
const aguaTratadaLineal: TarifaCalculo[] = [
  {
    tipoServicio: 'agua',
    tipoCalculo: 'lineal',
    rangoMinM3: null,
    rangoMaxM3: null,
    precioUnitario: 12.5,
    cuotaFija: 30,
    precios: null,
    ivaPct: 16,
  },
];
const lineasLineal = calcularServicio('agua', aguaTratadaLineal, 8);
assert('lineal 8 m³', lineasLineal.reduce((s, l) => s + l.importe, 0), 130); // 30 + 12.5*8
assert('lineal 8 m³ IVA 16 %', lineasLineal.reduce((s, l) => s + l.iva, 0), 20.8);
assert('lineal 0 m³ (sólo cuota fija)', calcularServicio('agua', aguaTratadaLineal, 0).reduce((s, l) => s + l.importe, 0), 30);

// ── Redondeo ──
assert('redondeo 12.005', redondear(12.005), 12.01);
assert('redondeo 0.1+0.2', redondear(0.1 + 0.2), 0.3);

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
