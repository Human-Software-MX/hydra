/**
 * Verificación aislada del motor de riesgos climáticos.
 * Ejecuta: node -r ts-node/register/transpile-only scripts/verify-clima.ts
 */
import { evaluarRiesgosClimaticos, DiaPronostico } from '../src/modules/clima/clima-riesgos';

let fallos = 0;
const ok = (n: string, c: boolean) => { if (!c) fallos++; console.log(`${c ? '✓' : '✗'} ${n}`); };

const dia = (i: number, sobre: Partial<DiaPronostico> = {}): DiaPronostico => ({
  fecha: `2026-07-${String(i + 1).padStart(2, '0')}`,
  tmaxC: 28,
  tminC: 14,
  precipitacionMm: 5,
  rachaVientoKmh: 20,
  ...sobre,
});
const semanaNormal = Array.from({ length: 7 }, (_, i) => dia(i));

// ─── Semana templada con algo de lluvia: sin alertas ─────────────────────────
ok('semana normal: 0 alertas', evaluarRiesgosClimaticos(semanaNormal).length === 0);

// ─── Lluvia fuerte vs torrencial ─────────────────────────────────────────────
const lluvias = evaluarRiesgosClimaticos([
  ...semanaNormal.slice(0, 5),
  dia(5, { precipitacionMm: 45 }),
  dia(6, { precipitacionMm: 90 }),
]);
ok('lluvia: detecta torrencial crítica', lluvias.some((a) => a.tipo === 'lluvia_torrencial' && a.severidad === 'critica'));
ok('lluvia: detecta fuerte alta (45mm no cuenta doble)', lluvias.some((a) => a.tipo === 'lluvia_fuerte' && a.fechas.length === 1));
ok('lluvia: crítica ordenada primero', lluvias[0].severidad === 'critica');
ok('lluvia: acción de protocolo de tormenta', lluvias[0].accionRecomendada.includes('tormenta'));

// ─── Ola de calor: exige días CONSECUTIVOS ───────────────────────────────────
const calorConsecutivo = evaluarRiesgosClimaticos(
  Array.from({ length: 7 }, (_, i) => dia(i, { tmaxC: i >= 2 && i <= 5 ? 36 : 30 })),
);
ok('calor: 4 días consecutivos ≥34° → alerta', calorConsecutivo.some((a) => a.tipo === 'ola_calor' && a.fechas.length === 4));

const calorSalteado = evaluarRiesgosClimaticos(
  Array.from({ length: 7 }, (_, i) => dia(i, { tmaxC: i % 2 === 0 ? 36 : 30 })),
);
ok('calor: días salteados NO son ola de calor', !calorSalteado.some((a) => a.tipo === 'ola_calor'));

const calorLargo = evaluarRiesgosClimaticos(
  Array.from({ length: 8 }, (_, i) => dia(i, { tmaxC: 36 })),
);
ok('calor: ≥6 días consecutivos escala a crítica', calorLargo.some((a) => a.tipo === 'ola_calor' && a.severidad === 'critica'));

// ─── Helada ──────────────────────────────────────────────────────────────────
const helada = evaluarRiesgosClimaticos([...semanaNormal.slice(0, 6), dia(6, { tminC: -2 })]);
ok('helada: Tmín ≤0° → alerta alta', helada.some((a) => a.tipo === 'helada' && a.severidad === 'alta'));
ok('helada: recomienda proteger medidores', helada.some((a) => a.accionRecomendada.includes('medidor')));

// ─── Viento fuerte ───────────────────────────────────────────────────────────
const viento = evaluarRiesgosClimaticos([...semanaNormal.slice(0, 6), dia(6, { rachaVientoKmh: 75 })]);
ok('viento: racha ≥60 km/h → alerta media', viento.some((a) => a.tipo === 'viento_fuerte' && a.severidad === 'media'));

// ─── Estiaje: horizonte ≥14 días sin lluvia ──────────────────────────────────
const seco14 = evaluarRiesgosClimaticos(
  Array.from({ length: 14 }, (_, i) => dia(i, { precipitacionMm: 0 })),
);
ok('estiaje: 14 días secos → alerta', seco14.some((a) => a.tipo === 'estiaje'));

const seco7 = evaluarRiesgosClimaticos(
  Array.from({ length: 7 }, (_, i) => dia(i, { precipitacionMm: 0 })),
);
ok('estiaje: horizonte corto (7 días) no alerta', !seco7.some((a) => a.tipo === 'estiaje'));

// ─── Umbrales configurables y datos nulos ────────────────────────────────────
const umbralCustom = evaluarRiesgosClimaticos(
  [...semanaNormal.slice(0, 6), dia(6, { precipitacionMm: 25 })],
  { lluviaFuerteMm: 20 },
);
ok('umbral custom: 25mm alerta con umbral de 20', umbralCustom.some((a) => a.tipo === 'lluvia_fuerte'));

const nulos = evaluarRiesgosClimaticos(
  Array.from({ length: 14 }, (_, i) => dia(i, { tmaxC: null, tminC: null, precipitacionMm: null, rachaVientoKmh: null })),
);
ok('datos nulos: solo estiaje (precip null = 0 acumulado), sin falsos positivos', nulos.every((a) => a.tipo === 'estiaje'));
ok('serie vacía: sin alertas', evaluarRiesgosClimaticos([]).length === 0);

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
