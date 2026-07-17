/**
 * Verificación aislada del motor de reglas VEE.
 * Ejecuta: node -r ts-node/register/transpile-only scripts/verify-vee.ts
 */
import { evaluarLectura, LecturaVee, UMBRALES_DEFAULT } from '../src/modules/vee/vee-rules';

let fallos = 0;
const ok = (n: string, c: boolean) => { if (!c) fallos++; console.log(`${c ? '✓' : '✗'} ${n}`); };

const base: LecturaVee = {
  lecturaActual: 150,
  lecturaAnterior: 100,
  consumoReal: 50,
  consumoEstimado: null,
  esEstimada: false,
  lecturaMinZona: null,
  lecturaMaxZona: null,
};
const histNormal = { consumosPrevios: [12, 10, 11, 13], estimadasConsecutivasPrevias: 0 };

// Lectura normal con consumo normal → sin excepciones estadísticas pero 50 > 3×11.5 → spike sí.
// Ajusto: consumo 12 (normal de verdad).
const normal = { ...base, lecturaActual: 112, consumoReal: 12 };
ok('lectura normal sin excepciones', evaluarLectura(normal, histNormal).length === 0);

// 1. Lectura negativa
const negativa = { ...base, lecturaActual: 90, consumoReal: null };
ok('detecta lectura_negativa', evaluarLectura(negativa, histNormal).some((e) => e.regla === 'lectura_negativa'));

// 2. Fuera de rango de zona
const fueraRango = { ...normal, lecturaMaxZona: 100 };
ok('detecta fuera_rango_zona (alto)', evaluarLectura(fueraRango, histNormal).some((e) => e.regla === 'fuera_rango_zona'));

// 3. Spike: 50 m³ vs promedio 11.5 → > 3×
ok('detecta spike', evaluarLectura(base, histNormal).some((e) => e.regla === 'spike'));

// 4. Caída drástica: consumo 2 vs promedio 11.5 → < 30%
const caida = { ...base, lecturaActual: 102, consumoReal: 2 };
ok('detecta caida_drastica', evaluarLectura(caida, histNormal).some((e) => e.regla === 'caida_drastica'));

// caída NO aplica con consumo 0 (eso es regla de ceros)
const cero1 = { ...base, lecturaActual: 100, consumoReal: 0 };
ok('consumo 0 no dispara caida_drastica', !evaluarLectura(cero1, histNormal).some((e) => e.regla === 'caida_drastica'));

// 5. Consumo cero prolongado: 0 actual + [0, 0] previos = 3 periodos
const histCeros = { consumosPrevios: [0, 0, 15, 14], estimadasConsecutivasPrevias: 0 };
ok('detecta consumo_cero_prolongado', evaluarLectura(cero1, histCeros).some((e) => e.regla === 'consumo_cero_prolongado'));
ok('un solo cero no dispara', !evaluarLectura(cero1, { consumosPrevios: [12, 11, 10], estimadasConsecutivasPrevias: 0 }).some((e) => e.regla === 'consumo_cero_prolongado'));

// 6. Estimaciones encadenadas: estimada actual + 2 previas consecutivas
const estimada = { ...base, lecturaActual: null, consumoReal: null, consumoEstimado: 11, esEstimada: true };
ok('detecta estimaciones_encadenadas', evaluarLectura(estimada, { consumosPrevios: [11, 11, 12], estimadasConsecutivasPrevias: 2 }).some((e) => e.regla === 'estimaciones_encadenadas'));
ok('1 estimación previa no dispara', !evaluarLectura(estimada, { consumosPrevios: [11, 11, 12], estimadasConsecutivasPrevias: 1 }).some((e) => e.regla === 'estimaciones_encadenadas'));

// Sin historial suficiente → no reglas estadísticas
ok('sin historial no hay spike', !evaluarLectura(base, { consumosPrevios: [10], estimadasConsecutivasPrevias: 0 }).some((e) => e.regla === 'spike'));

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
