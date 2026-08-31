/**
 * Medición de uplift de campañas de cobranza — calculador puro.
 *
 * Compara el comportamiento de pago del grupo TRATAMIENTO (contratos
 * gestionados por la campaña) contra el grupo CONTROL (reservados sin
 * gestión, asignados determinísticamente al ejecutar): la diferencia es el
 * efecto causal atribuible a la campaña, no a la estacionalidad ni a la
 * propensión natural de pago (SWAN 2026-2030: resultados medibles).
 */

import { round2 } from './cartera.util';

export interface ParticipanteUplift {
  contratoId: string;
  esControl: boolean;
  /** Saldo vencido al momento de la acción. */
  saldoAlMomento: number;
  /** Pagos del contrato dentro de la ventana posterior a la acción. */
  montoPagado: number;
}

export interface MetricasGrupo {
  contratos: number;
  pagaron: number;
  tasaPagoPct: number | null;
  saldoGestionado: number;
  montoRecuperado: number;
  recuperacionPct: number | null;
}

export interface ResultadoUplift {
  tratamiento: MetricasGrupo;
  control: MetricasGrupo;
  /** Diferencia de tasas de pago en puntos porcentuales (tratamiento − control). */
  upliftTasaPagoPp: number | null;
  /** Diferencia de recuperación en puntos porcentuales del saldo. */
  upliftRecuperacionPp: number | null;
  /** Recuperación incremental estimada: (Δ recuperación %) × saldo tratado. */
  ingresoIncrementalEstimado: number | null;
  advertencias: string[];
}

const EPSILON = 0.01;
/** Muestra mínima por grupo para considerar la comparación informativa. */
const MUESTRA_MINIMA = 30;

function metricas(grupo: ParticipanteUplift[]): MetricasGrupo {
  const contratos = grupo.length;
  const pagaron = grupo.filter((p) => p.montoPagado > EPSILON).length;
  const saldo = round2(grupo.reduce((s, p) => s + p.saldoAlMomento, 0));
  const recuperado = round2(grupo.reduce((s, p) => s + Math.min(p.montoPagado, p.saldoAlMomento), 0));
  return {
    contratos,
    pagaron,
    tasaPagoPct: contratos > 0 ? round2((pagaron / contratos) * 100) : null,
    saldoGestionado: saldo,
    montoRecuperado: recuperado,
    recuperacionPct: saldo > 0 ? round2((recuperado / saldo) * 100) : null,
  };
}

export function calcularUplift(participantes: ParticipanteUplift[]): ResultadoUplift {
  const advertencias: string[] = [];
  const tratamiento = metricas(participantes.filter((p) => !p.esControl));
  const control = metricas(participantes.filter((p) => p.esControl));

  if (control.contratos === 0) {
    advertencias.push('La campaña no reservó grupo control (grupoControlPct); el uplift no es medible — solo se reportan métricas absolutas');
  } else {
    if (tratamiento.contratos < MUESTRA_MINIMA || control.contratos < MUESTRA_MINIMA) {
      advertencias.push(`Muestras pequeñas (tratamiento=${tratamiento.contratos}, control=${control.contratos}; mínimo recomendado ${MUESTRA_MINIMA} por grupo): interprete con cautela`);
    }
  }

  const upliftTasa =
    tratamiento.tasaPagoPct !== null && control.tasaPagoPct !== null
      ? round2(tratamiento.tasaPagoPct - control.tasaPagoPct)
      : null;
  const upliftRecuperacion =
    tratamiento.recuperacionPct !== null && control.recuperacionPct !== null
      ? round2(tratamiento.recuperacionPct - control.recuperacionPct)
      : null;

  return {
    tratamiento,
    control,
    upliftTasaPagoPp: upliftTasa,
    upliftRecuperacionPp: upliftRecuperacion,
    ingresoIncrementalEstimado:
      upliftRecuperacion !== null ? round2((upliftRecuperacion / 100) * tratamiento.saldoGestionado) : null,
    advertencias,
  };
}
