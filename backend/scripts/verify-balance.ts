/**
 * Verificación aislada del calculador de balance hídrico M36.
 * Ejecuta: node -r ts-node/register/transpile-only scripts/verify-balance.ts
 */
import { calcularBalanceM36 } from '../src/modules/balance/m36-balance';

let fallos = 0;
const ok = (n: string, c: boolean) => { if (!c) fallos++; console.log(`${c ? '✓' : '✗'} ${n}`); };
const approx = (a: number, b: number) => Math.abs(a - b) < 0.01;

// Caso típico: 100,000 m³ producidos, 55,000 medidos + 5,000 estimados facturados,
// $600,000 facturados. NRW = (100000-60000)/100000 = 40% (el promedio mexicano).
const b = calcularBalanceM36({
  suministradoM3: 100_000,
  facturadoMedidoM3: 55_000,
  facturadoNoMedidoM3: 5_000,
  importeFacturado: 600_000,
  parametros: { autorizadoNoFacturadoM3: 1_000, costoProduccionM3: 4 },
});

ok('NRW 40%', approx(b.indicadores.aguaNoContabilizadaPct ?? 0, 40));
ok('eficiencia física 60%', approx(b.indicadores.eficienciaFisicaPct ?? 0, 60));
ok('tarifa media $10/m³', approx(b.indicadores.tarifaMediaM3 ?? 0, 10));
ok('consumo autorizado 61,000', approx(b.consumoAutorizado.totalM3, 61_000));
ok('pérdidas totales 39,000', approx(b.perdidas.totalM3, 39_000));
// aparentes: submedición 5% × 55,000 = 2,750 + no autorizado 2% × 100,000 = 2,000 → 4,750
ok('aparentes 4,750 m³', approx(b.perdidas.aparentes.totalM3, 4_750));
ok('reales 34,250 m³', approx(b.perdidas.realesM3, 34_250));
// valor: aparentes × $10 = $47,500 ; reales × $4 = $137,000
ok('valor aparentes $47,500', approx(b.perdidas.aparentes.valorPesos, 47_500));
ok('valor reales $137,000', approx(b.perdidas.realesValorPesos, 137_000));
ok('valor total $184,500', approx(b.indicadores.perdidasTotalesValorPesos, 184_500));
ok('sin advertencias', b.advertencias.length === 0);

// Caso borde: autorizado > suministrado (macromedición mala) → advertencia y piso en 0
const malo = calcularBalanceM36({
  suministradoM3: 50_000,
  facturadoMedidoM3: 60_000,
  facturadoNoMedidoM3: 0,
  importeFacturado: 600_000,
});
ok('advierte macromedición inconsistente', malo.advertencias.some((a) => a.includes('macromedición')));
ok('pérdidas no negativas', malo.perdidas.totalM3 === 0 && malo.perdidas.realesM3 === 0);

// Caso borde: aparentes estimadas > totales → se acotan
const acotado = calcularBalanceM36({
  suministradoM3: 62_000,
  facturadoMedidoM3: 55_000,
  facturadoNoMedidoM3: 5_000,
  importeFacturado: 600_000,
  parametros: { fraccionSubmedicion: 0.1, fraccionNoAutorizado: 0.05 },
});
ok('acota aparentes al total', approx(acotado.perdidas.aparentes.totalM3, acotado.perdidas.totalM3) && acotado.perdidas.realesM3 === 0);

// Sin suministrado → indicadores null
const cero = calcularBalanceM36({ suministradoM3: 0, facturadoMedidoM3: 0, facturadoNoMedidoM3: 0, importeFacturado: 0 });
ok('sin datos → NRW null', cero.indicadores.aguaNoContabilizadaPct === null);

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
