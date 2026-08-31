/**
 * Score de propensión al pago — calculador puro (sin Nest/Prisma).
 *
 * Cobranza predictiva (SWAN etapa Proactiva): en lugar de reaccionar al
 * adeudo, anticipa la probabilidad de que un contrato pague y recomienda la
 * acción de cobranza proporcional. Modelo de puntos transparente y auditable
 * (no caja negra): cada factor suma o resta sobre una base de 50 y el
 * desglose viaja en la respuesta para que el gestor entienda el porqué.
 *
 * Insumo: el libro de partida abierta de cartera (DocumentoCartera +
 * AplicacionPago), la misma verdad que usa el aging — sin fuentes paralelas.
 */

import { diasEntre, round2 } from './cartera.util';

/** Documento histórico con su fecha de liquidación derivada de las aplicaciones. */
export interface DocumentoPropension {
  montoOriginal: number;
  fechaVencimiento: string; // YYYY-MM-DD
  /** Fecha de la aplicación que dejó el documento en cero; null si sigue abierto. */
  fechaLiquidacion: string | null;
  /** Saldo actual (0 si está pagado). */
  saldo: number;
  estado: string; // vigente | vencido | parcial | pagado | en_convenio | incobrable
}

export interface EntradaPropension {
  hoy: string; // YYYY-MM-DD
  documentos: DocumentoPropension[];
  enConvenio: boolean;
  /** Convenios cancelados (compromisos de pago rotos). */
  conveniosCancelados: number;
  /** Convenios completados (compromisos cumplidos). */
  conveniosCompletados: number;
  diasMoraMax: number;
}

export type SegmentoPropension =
  | 'PAGADOR_CONFIABLE'
  | 'PAGADOR_LENTO'
  | 'RIESGO_MEDIO'
  | 'RIESGO_ALTO'
  | 'RIESGO_CRITICO';

export interface ResultadoPropension {
  /** 0-100: probabilidad relativa de pago sin gestión intensiva. */
  score: number;
  segmento: SegmentoPropension;
  accionRecomendada: string;
  /** Sin documentos liquidados: el score es neutral y poco informativo. */
  sinHistorial: boolean;
  factores: {
    documentosLiquidados: number;
    pctPagadosATiempo: number | null; // ≤ GRACIA_DIAS de retraso
    retrasoPromedioDias: number | null;
    tendencia: 'mejora' | 'estable' | 'deterioro' | null;
    diasMoraMax: number;
    docsAbiertosVencidos: number;
    enConvenio: boolean;
    conveniosCancelados: number;
    conveniosCompletados: number;
    ajustes: Array<{ factor: string; puntos: number }>;
  };
}

/** Días de gracia tras el vencimiento para considerar un pago "a tiempo". */
const GRACIA_DIAS = 5;
/** Documentos recientes considerados para la tendencia. */
const VENTANA_TENDENCIA = 6;

const SEGMENTOS: Array<{
  min: number;
  segmento: SegmentoPropension;
  accion: string;
}> = [
  { min: 80, segmento: 'PAGADOR_CONFIABLE', accion: 'recordatorio_digital' },
  { min: 60, segmento: 'PAGADOR_LENTO', accion: 'aviso_vencimiento_anticipado' },
  { min: 40, segmento: 'RIESGO_MEDIO', accion: 'gestion_telefonica_oferta_convenio' },
  { min: 20, segmento: 'RIESGO_ALTO', accion: 'visita_campo_convenio_proactivo' },
  { min: 0, segmento: 'RIESGO_CRITICO', accion: 'restriccion_lga_o_juridico' },
];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function calcularPropensionPago(entrada: EntradaPropension): ResultadoPropension {
  const ajustes: Array<{ factor: string; puntos: number }> = [];
  const sumar = (factor: string, puntos: number) => {
    if (puntos !== 0) ajustes.push({ factor, puntos: round2(puntos) });
    return puntos;
  };

  // Historial de pago: documentos ya liquidados, en orden de vencimiento.
  const liquidados = entrada.documentos
    .filter((d) => d.fechaLiquidacion !== null)
    .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));

  const retrasos = liquidados.map((d) =>
    Math.max(0, diasEntre(d.fechaVencimiento, d.fechaLiquidacion as string)),
  );
  const aTiempo = retrasos.filter((r) => r <= GRACIA_DIAS).length;
  const pctATiempo = liquidados.length > 0 ? aTiempo / liquidados.length : null;
  const retrasoPromedio =
    retrasos.length > 0 ? round2(retrasos.reduce((s, r) => s + r, 0) / retrasos.length) : null;

  const sinHistorial = liquidados.length === 0;
  let score = 50;

  if (pctATiempo !== null) {
    // Puntualidad histórica: el factor con más peso (−15 … +30).
    score += sumar('puntualidad_historica', pctATiempo * 45 - 15);
  }
  if (retrasoPromedio !== null && retrasoPromedio > GRACIA_DIAS) {
    score += sumar('retraso_promedio', -clamp(retrasoPromedio, 0, 60) / 60 * 15);
  }

  // Tendencia: puntualidad de los últimos N liquidados vs los anteriores.
  let tendencia: 'mejora' | 'estable' | 'deterioro' | null = null;
  if (liquidados.length >= VENTANA_TENDENCIA * 2) {
    const recientes = retrasos.slice(-VENTANA_TENDENCIA);
    const previos = retrasos.slice(0, -VENTANA_TENDENCIA);
    const pct = (arr: number[]) => arr.filter((r) => r <= GRACIA_DIAS).length / arr.length;
    const delta = pct(recientes) - pct(previos);
    tendencia = delta > 0.15 ? 'mejora' : delta < -0.15 ? 'deterioro' : 'estable';
    if (tendencia === 'mejora') score += sumar('tendencia_mejora', 5);
    if (tendencia === 'deterioro') score += sumar('tendencia_deterioro', -10);
  }

  // Situación actual: mora vigente pesa aunque el historial sea bueno.
  const docsAbiertosVencidos = entrada.documentos.filter(
    (d) => d.fechaLiquidacion === null && d.estado === 'vencido',
  ).length;
  if (entrada.diasMoraMax > 0) {
    score += sumar('mora_vigente', -clamp(entrada.diasMoraMax, 0, 180) / 180 * 25);
  }
  if (docsAbiertosVencidos > 0) {
    score += sumar('documentos_vencidos_abiertos', -clamp(docsAbiertosVencidos, 0, 6) * 2);
  }

  // Convenios: uno activo es compromiso vigente; cancelados son promesas rotas.
  if (entrada.enConvenio) score += sumar('convenio_activo', 5);
  if (entrada.conveniosCancelados > 0) {
    score += sumar('convenios_cancelados', -clamp(entrada.conveniosCancelados, 0, 3) * 10);
  }
  if (entrada.conveniosCompletados > 0) {
    score += sumar('convenios_completados', clamp(entrada.conveniosCompletados, 0, 2) * 5);
  }

  score = Math.round(clamp(score, 0, 100));
  const seg = SEGMENTOS.find((s) => score >= s.min) ?? SEGMENTOS[SEGMENTOS.length - 1];

  return {
    score,
    segmento: seg.segmento,
    accionRecomendada: seg.accion,
    sinHistorial,
    factores: {
      documentosLiquidados: liquidados.length,
      pctPagadosATiempo: pctATiempo !== null ? round2(pctATiempo * 100) : null,
      retrasoPromedioDias: retrasoPromedio,
      tendencia,
      diasMoraMax: entrada.diasMoraMax,
      docsAbiertosVencidos,
      enConvenio: entrada.enConvenio,
      conveniosCancelados: entrada.conveniosCancelados,
      conveniosCompletados: entrada.conveniosCompletados,
      ajustes,
    },
  };
}

/**
 * Deriva la fecha de liquidación de un documento a partir de sus aplicaciones:
 * la fecha de la aplicación que acumuló el monto original (con tolerancia de
 * centavos). Null si las aplicaciones no lo cubren.
 */
export function fechaLiquidacionDocumento(
  montoOriginal: number,
  aplicaciones: Array<{ monto: number; fecha: string }>,
  epsilon = 0.01,
): string | null {
  if (montoOriginal <= epsilon) return null;
  const ordenadas = [...aplicaciones].sort((a, b) => a.fecha.localeCompare(b.fecha));
  let acumulado = 0;
  for (const a of ordenadas) {
    acumulado = round2(acumulado + a.monto);
    if (acumulado >= montoOriginal - epsilon) return a.fecha;
  }
  return null;
}
