/**
 * Verificación aislada del motor de forecasting (facturación/recaudación).
 * Ejecuta: node -r ts-node/register/transpile-only scripts/verify-forecast.ts
 */
import { pronosticar, sumarPeriodos, normalizarSerie, PuntoSerie } from '../src/modules/indicadores/forecast';

let fallos = 0;
const ok = (n: string, c: boolean) => { if (!c) fallos++; console.log(`${c ? '✓' : '✗'} ${n}`); };
const approx = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;

/** Serie mensual sintética empezando en 2023-01. */
const serie = (valores: number[]): PuntoSerie[] =>
  valores.map((v, i) => ({ periodo: sumarPeriodos('2023-01', i), valor: v }));

// ─── Aritmética de periodos ──────────────────────────────────────────────────
ok('2026-12 + 1 = 2027-01', sumarPeriodos('2026-12', 1) === '2027-01');
ok('2026-01 + 13 = 2027-02', sumarPeriodos('2026-01', 13) === '2027-02');

// ─── Normalización: huecos rellenados con 0 ─────────────────────────────────
const conHueco = normalizarSerie([
  { periodo: '2026-01', valor: 10 },
  { periodo: '2026-03', valor: 30 },
]);
ok('hueco detectado', conHueco.huecos === 1);
ok('hueco rellenado con 0', conHueco.serie[1].periodo === '2026-02' && conHueco.serie[1].valor === 0);

// ─── Serie corta (<13): promedio móvil de los últimos 3 ──────────────────────
const corta = pronosticar(serie([100, 110, 120]), 2);
ok('corta: método promedio_movil', corta.metodo === 'promedio_movil');
ok('corta: forecast = 110', approx(corta.puntos[0].valor, 110) && approx(corta.puntos[1].valor, 110));
ok('corta: periodos consecutivos', corta.puntos[0].periodo === '2023-04' && corta.puntos[1].periodo === '2023-05');

// ─── Serie media (13-23): naive estacional (mismo mes del año anterior) ──────
const media = pronosticar(serie([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), 3);
ok('media: método naive_estacional', media.metodo === 'naive_estacional');
// n=13 → forecast = valores[1], valores[2], valores[3] = 2, 3, 4
ok('media: repite el mismo mes del año anterior', approx(media.puntos[0].valor, 2) && approx(media.puntos[1].valor, 3) && approx(media.puntos[2].valor, 4));

// ─── Serie larga (≥24): Holt-Winters aditivo recupera nivel+tendencia+estación ─
// valor(t) = 100 + 2t + estacional[t%12], señal aditiva exacta
const ESTACION = [10, 5, 0, -5, -10, -5, 0, 5, 10, 5, 0, -15];
const larga = serie(Array.from({ length: 36 }, (_, t) => 100 + 2 * t + ESTACION[t % 12]));
const hw = pronosticar(larga, 3);
ok('larga: método holt_winters_aditivo', hw.metodo === 'holt_winters_aditivo');
// Continuación real: t=36 → 100+72+10 = 182; t=37 → 100+74+5 = 179; t=38 → 176
const esperados = [182, 179, 176];
const dentroDeTolerancia = hw.puntos.every((p, i) => Math.abs(p.valor - esperados[i]) / esperados[i] < 0.05);
ok(`larga: forecast dentro de ±5% de la señal real (${hw.puntos.map((p) => p.valor).join(', ')} vs ${esperados.join(', ')})`, dentroDeTolerancia);
ok('larga: MAPE in-sample reportado', hw.mapeInSample !== null && hw.mapeInSample >= 0);
ok('larga: 3 periodos pronosticados', hw.puntos.length === 3 && hw.puntos[0].periodo === '2026-01');

// ─── Bordes ──────────────────────────────────────────────────────────────────
const vacia = pronosticar([], 3);
ok('vacía: sin puntos y con advertencia', vacia.puntos.length === 0 && vacia.advertencias.length > 0);
const negativo = pronosticar(serie([5, 3, 1]), 1);
ok('forecast nunca negativo (piso 0)', negativo.puntos[0].valor >= 0);
const horizonteLoco = pronosticar(serie([100, 100, 100]), 500);
ok('horizonte acotado a 24', horizonteLoco.puntos.length === 24);

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
