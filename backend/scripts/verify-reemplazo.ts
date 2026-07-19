/**
 * Verificación aislada del scorer de reemplazo de medidores.
 * Ejecuta: node -r ts-node/register/transpile-only scripts/verify-reemplazo.ts
 */
import { calcularScoreReemplazo } from '../src/modules/medidores/reemplazo-scorer';

let fallos = 0;
const ok = (n: string, c: boolean) => { if (!c) fallos++; console.log(`${c ? '✓' : '✗'} ${n}`); };

// ─── Medidor sano: joven, sin excepciones, lecturas reales ───────────────────
const sano = calcularScoreReemplazo({
  edadAnios: 3,
  excepcionesCaidaDrastica: 0,
  excepcionesConsumoCero: 0,
  lecturas: 12,
  lecturasEstimadas: 0,
  consumoPromedioM3: 15,
});
// solo edad: 3/20 × 30 = 4.5 → 5
ok('sano: score 5', sano.score === 5);
ok('sano: prioridad baja', sano.prioridad === 'baja');
ok('sano: sin razones', sano.razones.length === 0);

// ─── Crítico: viejo, submedición, parado, ilegible, gran consumidor ──────────
const critico = calcularScoreReemplazo({
  edadAnios: 15,
  excepcionesCaidaDrastica: 3,
  excepcionesConsumoCero: 1,
  lecturas: 12,
  lecturasEstimadas: 6,
  consumoPromedioM3: 60,
});
// 30 (caída) + 8 (cero) + 7.5 (50% estimadas) + 22.5 (edad 15/20×30) + 10 (gran consumidor) = 78
ok('crítico: score 78', critico.score === 78);
ok('crítico: prioridad critica', critico.prioridad === 'critica');
ok('crítico: 5 razones', critico.razones.length === 5);
ok('crítico: menciona submedición', critico.razones.some((r) => r.includes('submedición')));
ok('crítico: menciona vida útil', critico.razones.some((r) => r.includes('vida útil')));

// ─── Edad desconocida penaliza con razón explícita ───────────────────────────
const sinFecha = calcularScoreReemplazo({
  edadAnios: null,
  excepcionesCaidaDrastica: 0,
  excepcionesConsumoCero: 0,
  lecturas: 0,
  lecturasEstimadas: 0,
  consumoPromedioM3: 0,
});
ok('sin fecha: score 10', sinFecha.score === 10);
ok('sin fecha: razón de edad desconocida', sinFecha.razones.some((r) => r.includes('edad desconocida')));

// ─── Señales extremas se acotan y el score se clampa a 100 ───────────────────
const extremo = calcularScoreReemplazo({
  edadAnios: 40,
  excepcionesCaidaDrastica: 10,
  excepcionesConsumoCero: 5,
  lecturas: 12,
  lecturasEstimadas: 12,
  consumoPromedioM3: 100,
});
// 40 (clamp 4×10) + 24 (clamp 3×8) + 15 (100% estimadas) + 30 (edad clamp 20) + 10 = 119 → 100
ok('extremo: score clampeado a 100', extremo.score === 100);
ok('extremo: prioridad critica', extremo.prioridad === 'critica');

// ─── 25% de estimadas exacto no dispara la señal (umbral estricto >25%) ──────
const umbral = calcularScoreReemplazo({
  edadAnios: 1,
  excepcionesCaidaDrastica: 0,
  excepcionesConsumoCero: 0,
  lecturas: 12,
  lecturasEstimadas: 3,
  consumoPromedioM3: 10,
});
ok('umbral: 25% de estimadas no penaliza', !umbral.razones.some((r) => r.includes('estimadas')));

// ─── Consumidor medio suma 5 sin razón (no es hallazgo, solo desempate) ──────
const medio = calcularScoreReemplazo({
  edadAnios: 0,
  excepcionesCaidaDrastica: 0,
  excepcionesConsumoCero: 0,
  lecturas: 12,
  lecturasEstimadas: 0,
  consumoPromedioM3: 25,
});
ok('consumidor medio: score 5', medio.score === 5);

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
