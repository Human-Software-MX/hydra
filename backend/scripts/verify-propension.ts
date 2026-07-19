/**
 * Verificación aislada del score de propensión al pago (cobranza predictiva).
 * Ejecuta: node -r ts-node/register/transpile-only scripts/verify-propension.ts
 */
import {
  calcularPropensionPago,
  fechaLiquidacionDocumento,
  DocumentoPropension,
} from '../src/modules/cartera/propension-pago';

let fallos = 0;
const ok = (n: string, c: boolean) => { if (!c) fallos++; console.log(`${c ? '✓' : '✗'} ${n}`); };
const approx = (a: number, b: number) => Math.abs(a - b) < 0.01;

const HOY = '2026-07-01';

/** n documentos mensuales liquidados con `retrasoDias` de retraso cada uno. */
const docsLiquidados = (n: number, retrasoDias: number, desde = 1): DocumentoPropension[] =>
  Array.from({ length: n }, (_, i) => {
    const mes = String(desde + i).padStart(2, '0');
    const venc = new Date(Date.UTC(2025, desde + i - 1, 15));
    const liq = new Date(venc.getTime() + retrasoDias * 86_400_000);
    return {
      montoOriginal: 350,
      saldo: 0,
      fechaVencimiento: `2025-${mes}-15`,
      estado: 'pagado',
      fechaLiquidacion: liq.toISOString().slice(0, 10),
    };
  });

const abiertoVencido = (): DocumentoPropension => ({
  montoOriginal: 350,
  saldo: 350,
  fechaVencimiento: '2026-05-15',
  estado: 'vencido',
  fechaLiquidacion: null,
});

// ─── Pagador puntual: 12 recibos pagados a tiempo, sin mora ──────────────────
const puntual = calcularPropensionPago({
  hoy: HOY,
  documentos: docsLiquidados(12, 0),
  enConvenio: false,
  conveniosCancelados: 0,
  conveniosCompletados: 0,
  diasMoraMax: 0,
});
// 50 base + puntualidad (1.0×45−15 = +30) = 80
ok('puntual: score 80', puntual.score === 80);
ok('puntual: PAGADOR_CONFIABLE', puntual.segmento === 'PAGADOR_CONFIABLE');
ok('puntual: acción recordatorio_digital', puntual.accionRecomendada === 'recordatorio_digital');
ok('puntual: 100% a tiempo', approx(puntual.factores.pctPagadosATiempo ?? 0, 100));
ok('puntual: tendencia estable', puntual.factores.tendencia === 'estable');

// ─── Moroso crónico: todo tarde, mora vigente, convenio roto ─────────────────
const cronico = calcularPropensionPago({
  hoy: HOY,
  documentos: [...docsLiquidados(10, 40), abiertoVencido(), abiertoVencido(), abiertoVencido()],
  enConvenio: false,
  conveniosCancelados: 1,
  conveniosCompletados: 0,
  diasMoraMax: 120,
});
// 50 −15 (0% a tiempo) −10 (retraso 40d) −16.67 (mora 120d) −6 (3 abiertos) −10 (convenio roto) → 0
ok('crónico: score 0 (clamp)', cronico.score === 0);
ok('crónico: RIESGO_CRITICO', cronico.segmento === 'RIESGO_CRITICO');
ok('crónico: acción restricción/jurídico', cronico.accionRecomendada === 'restriccion_lga_o_juridico');

// ─── Sin historial: score neutral ────────────────────────────────────────────
const nuevo = calcularPropensionPago({
  hoy: HOY,
  documentos: [],
  enConvenio: false,
  conveniosCancelados: 0,
  conveniosCompletados: 0,
  diasMoraMax: 0,
});
ok('sin historial: score 50', nuevo.score === 50);
ok('sin historial: flag sinHistorial', nuevo.sinHistorial === true);
ok('sin historial: RIESGO_MEDIO', nuevo.segmento === 'RIESGO_MEDIO');

// ─── Deterioro: 6 puntuales y luego 6 con 30 días de retraso ─────────────────
const deterioro = calcularPropensionPago({
  hoy: HOY,
  documentos: [...docsLiquidados(6, 0, 1), ...docsLiquidados(6, 30, 7), abiertoVencido()],
  enConvenio: false,
  conveniosCancelados: 0,
  conveniosCompletados: 0,
  diasMoraMax: 20,
});
// 50 +7.5 (50% a tiempo) −3.75 (retraso prom 15d) −10 (deterioro) −2.78 (mora 20d) −2 (1 abierto) ≈ 39
ok('deterioro: tendencia deterioro', deterioro.factores.tendencia === 'deterioro');
ok('deterioro: score 39', deterioro.score === 39);
ok('deterioro: RIESGO_ALTO', deterioro.segmento === 'RIESGO_ALTO');

// ─── Convenio activo y cumplidos suman ───────────────────────────────────────
const convenio = calcularPropensionPago({
  hoy: HOY,
  documentos: docsLiquidados(6, 0),
  enConvenio: true,
  conveniosCancelados: 0,
  conveniosCompletados: 1,
  diasMoraMax: 0,
});
// 50 +30 (100% a tiempo, sin tendencia con solo 6) +5 (convenio activo) +5 (1 completado) = 90
ok('convenio: score 90', convenio.score === 90);
ok('convenio: sin tendencia con <12 docs', convenio.factores.tendencia === null);

// ─── fechaLiquidacionDocumento ───────────────────────────────────────────────
ok(
  'liquidación = fecha de la aplicación que completa el monto',
  fechaLiquidacionDocumento(100, [
    { monto: 50, fecha: '2026-02-01' },
    { monto: 50, fecha: '2026-01-10' },
  ]) === '2026-02-01',
);
ok(
  'aplicaciones insuficientes → null',
  fechaLiquidacionDocumento(100, [{ monto: 80, fecha: '2026-01-10' }]) === null,
);
ok('documento en cero → null', fechaLiquidacionDocumento(0, []) === null);

// ─── Uplift A/B de campañas ──────────────────────────────────────────────────
import { enGrupoControl, hashFnv1a } from '../src/modules/cartera/cartera.util';
import { calcularUplift, ParticipanteUplift } from '../src/modules/cartera/uplift';

// Asignación determinística: mismo par campaña+contrato → siempre igual
ok('control: determinístico', enGrupoControl('camp1', 'c-42', 20) === enGrupoControl('camp1', 'c-42', 20));
ok('control: pct 0 nunca asigna', enGrupoControl('camp1', 'c-42', 0) === false);
ok('control: pct 100 siempre asigna', enGrupoControl('camp1', 'c-42', 100) === true);
ok('control: hash estable', hashFnv1a('hydra') === hashFnv1a('hydra') && hashFnv1a('hydra') !== hashFnv1a('hydrb'));
// Con 10,000 contratos y 20% la proporción asignada debe rondar 20% (±3pp)
const asignados = Array.from({ length: 10_000 }, (_, i) => enGrupoControl('campX', `c-${i}`, 20)).filter(Boolean).length;
ok(`control: proporción ≈20% (${(asignados / 100).toFixed(1)}%)`, asignados > 1_700 && asignados < 2_300);

// Uplift: 100 tratados (60 pagan $500 de $1,000) vs 100 control (40 pagan $500 de $1,000)
const participante = (i: number, esControl: boolean, paga: boolean): ParticipanteUplift => ({
  contratoId: `c${esControl ? 'c' : 't'}-${i}`,
  esControl,
  saldoAlMomento: 1_000,
  montoPagado: paga ? 500 : 0,
});
const uplift = calcularUplift([
  ...Array.from({ length: 100 }, (_, i) => participante(i, false, i < 60)),
  ...Array.from({ length: 100 }, (_, i) => participante(i, true, i < 40)),
]);
ok('uplift: tasa tratamiento 60%', uplift.tratamiento.tasaPagoPct === 60);
ok('uplift: tasa control 40%', uplift.control.tasaPagoPct === 40);
ok('uplift: +20pp en tasa de pago', uplift.upliftTasaPagoPp === 20);
// recuperación: trat 60×500/100,000 = 30% ; control 40×500/100,000 = 20% → +10pp
ok('uplift: +10pp en recuperación', uplift.upliftRecuperacionPp === 10);
// ingreso incremental = 10% × 100,000 = 10,000
ok('uplift: ingreso incremental $10,000', uplift.ingresoIncrementalEstimado === 10_000);
ok('uplift: sin advertencias con muestras de 100', uplift.advertencias.length === 0);

// Sin grupo control → advertencia y uplift null
const sinControl = calcularUplift(Array.from({ length: 50 }, (_, i) => participante(i, false, i < 25)));
ok('uplift sin control: advertencia', sinControl.advertencias.some((a) => a.includes('no reservó grupo control')));
ok('uplift sin control: uplift null', sinControl.upliftTasaPagoPp === null);

// Muestras chicas → advertencia de cautela
const chico = calcularUplift([
  ...Array.from({ length: 10 }, (_, i) => participante(i, false, i < 6)),
  ...Array.from({ length: 5 }, (_, i) => participante(i, true, i < 2)),
]);
ok('uplift muestras chicas: advierte', chico.advertencias.some((a) => a.includes('Muestras pequeñas')));

// El pago se acota al saldo (no sobre-recuperación por pagos mayores al adeudo)
const acotado = calcularUplift([
  { contratoId: 'x', esControl: false, saldoAlMomento: 100, montoPagado: 500 },
  { contratoId: 'y', esControl: true, saldoAlMomento: 100, montoPagado: 0 },
]);
ok('uplift: recuperado acotado al saldo', acotado.tratamiento.montoRecuperado === 100);

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
