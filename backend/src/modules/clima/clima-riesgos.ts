/**
 * Motor de reglas de riesgo operativo por clima — calculador puro.
 *
 * Traduce un pronóstico meteorológico diario en alertas accionables para un
 * organismo operador de agua (SWAN etapa Proactiva: anticipar la incidencia
 * en lugar de reaccionar a la queja). Umbrales configurables con defaults
 * documentados; cada alerta dice qué sistema se afecta y qué hacer antes.
 */

export interface DiaPronostico {
  fecha: string; // YYYY-MM-DD
  tmaxC: number | null;
  tminC: number | null;
  precipitacionMm: number | null;
  rachaVientoKmh: number | null;
}

export interface UmbralesRiesgo {
  /** mm/día para lluvia fuerte (default 30). */
  lluviaFuerteMm?: number;
  /** mm/día para lluvia torrencial (default 70). */
  lluviaTorrencialMm?: number;
  /** °C de temperatura máxima para ola de calor (default 34). */
  olaCalorTmaxC?: number;
  /** Días consecutivos calurosos para declarar ola de calor (default 3). */
  olaCalorDias?: number;
  /** °C de temperatura mínima para riesgo de helada (default 0). */
  heladaTminC?: number;
  /** km/h de racha para viento fuerte (default 60). */
  vientoFuerteKmh?: number;
  /** mm acumulados bajo los cuales el horizonte se considera seco (default 2). */
  estiajeAcumuladoMm?: number;
  /** Días mínimos de horizonte para evaluar estiaje (default 14). */
  estiajeDiasMin?: number;
}

export type TipoRiesgo =
  | 'lluvia_fuerte'
  | 'lluvia_torrencial'
  | 'ola_calor'
  | 'helada'
  | 'viento_fuerte'
  | 'estiaje';

export interface AlertaClimatica {
  tipo: TipoRiesgo;
  severidad: 'media' | 'alta' | 'critica';
  fechas: string[];
  detalle: string;
  /** Sistemas del organismo que se afectan. */
  impacto: string;
  accionRecomendada: string;
}

const DEFAULTS: Required<UmbralesRiesgo> = {
  lluviaFuerteMm: 30,
  lluviaTorrencialMm: 70,
  olaCalorTmaxC: 34,
  olaCalorDias: 3,
  heladaTminC: 0,
  vientoFuerteKmh: 60,
  estiajeAcumuladoMm: 2,
  estiajeDiasMin: 14,
};

export function evaluarRiesgosClimaticos(
  dias: DiaPronostico[],
  umbrales?: UmbralesRiesgo,
): AlertaClimatica[] {
  const u = { ...DEFAULTS, ...(umbrales ?? {}) };
  const alertas: AlertaClimatica[] = [];
  if (dias.length === 0) return alertas;

  // ─── Lluvia fuerte / torrencial ────────────────────────────────────────────
  const torrenciales = dias.filter((d) => (d.precipitacionMm ?? 0) >= u.lluviaTorrencialMm);
  const fuertes = dias.filter(
    (d) => (d.precipitacionMm ?? 0) >= u.lluviaFuerteMm && (d.precipitacionMm ?? 0) < u.lluviaTorrencialMm,
  );
  if (torrenciales.length > 0) {
    alertas.push({
      tipo: 'lluvia_torrencial',
      severidad: 'critica',
      fechas: torrenciales.map((d) => d.fecha),
      detalle: `Precipitación ≥ ${u.lluviaTorrencialMm} mm/día (máx ${Math.max(...torrenciales.map((d) => d.precipitacionMm ?? 0))} mm)`,
      impacto: 'Colapso de alcantarillado, infiltración a la red, turbiedad en fuentes, acceso de cuadrillas',
      accionRecomendada:
        'Activar protocolo de tormenta: pre-vaciar cárcamos, brigadas de desazolve en puntos negros, suspender órdenes de zanja, monitoreo de turbiedad en captación',
    });
  }
  if (fuertes.length > 0) {
    alertas.push({
      tipo: 'lluvia_fuerte',
      severidad: 'alta',
      fechas: fuertes.map((d) => d.fecha),
      detalle: `Precipitación ≥ ${u.lluviaFuerteMm} mm/día en ${fuertes.length} día(s)`,
      impacto: 'Saturación de alcantarillado, quejas por encharcamiento, lecturas en campo interrumpidas',
      accionRecomendada:
        'Reforzar cuadrillas de alcantarillado, reprogramar rutas de lectura de zonas inundables, avisar a atención a clientes del pico de reportes',
    });
  }

  // ─── Ola de calor (días consecutivos) ─────────────────────────────────────
  let racha: DiaPronostico[] = [];
  let mejorRacha: DiaPronostico[] = [];
  for (const d of dias) {
    if ((d.tmaxC ?? -Infinity) >= u.olaCalorTmaxC) {
      racha.push(d);
      if (racha.length > mejorRacha.length) mejorRacha = [...racha];
    } else {
      racha = [];
    }
  }
  if (mejorRacha.length >= u.olaCalorDias) {
    alertas.push({
      tipo: 'ola_calor',
      severidad: mejorRacha.length >= u.olaCalorDias * 2 ? 'critica' : 'alta',
      fechas: mejorRacha.map((d) => d.fecha),
      detalle: `${mejorRacha.length} días consecutivos con Tmáx ≥ ${u.olaCalorTmaxC} °C`,
      impacto: 'Pico de demanda, abatimiento de pozos, estrés en equipos de bombeo, presión baja en partes altas',
      accionRecomendada:
        'Programar tandeo preventivo por sector, verificar arrancadores/ventilación de pozos, priorizar pipas para zonas de presión baja, campaña de uso eficiente',
    });
  }

  // ─── Helada ────────────────────────────────────────────────────────────────
  const heladas = dias.filter((d) => (d.tminC ?? Infinity) <= u.heladaTminC);
  if (heladas.length > 0) {
    alertas.push({
      tipo: 'helada',
      severidad: 'alta',
      fechas: heladas.map((d) => d.fecha),
      detalle: `Tmín ≤ ${u.heladaTminC} °C en ${heladas.length} día(s) (mín ${Math.min(...heladas.map((d) => d.tminC ?? 0))} °C)`,
      impacto: 'Rotura de medidores y cuadros expuestos, congelamiento de tomas superficiales, fugas al deshielo',
      accionRecomendada:
        'Avisar a usuarios que protejan el cuadro del medidor, alistar cuadrilla de fugas para la mañana posterior, revisar cloración (dosis a baja temperatura)',
    });
  }

  // ─── Viento fuerte ─────────────────────────────────────────────────────────
  const vientos = dias.filter((d) => (d.rachaVientoKmh ?? 0) >= u.vientoFuerteKmh);
  if (vientos.length > 0) {
    alertas.push({
      tipo: 'viento_fuerte',
      severidad: 'media',
      fechas: vientos.map((d) => d.fecha),
      detalle: `Rachas ≥ ${u.vientoFuerteKmh} km/h en ${vientos.length} día(s)`,
      impacto: 'Cortes de energía en pozos y rebombeos (paro de suministro), daños en casetas',
      accionRecomendada:
        'Verificar plantas de emergencia y transferencias automáticas, tener guardia electromecánica disponible',
    });
  }

  // ─── Estiaje (horizonte seco) ─────────────────────────────────────────────
  if (dias.length >= u.estiajeDiasMin) {
    const acumulado = dias.reduce((s, d) => s + (d.precipitacionMm ?? 0), 0);
    if (acumulado <= u.estiajeAcumuladoMm) {
      alertas.push({
        tipo: 'estiaje',
        severidad: 'media',
        fechas: [dias[0].fecha, dias[dias.length - 1].fecha],
        detalle: `Precipitación acumulada de ${Math.round(acumulado * 10) / 10} mm en ${dias.length} días de horizonte`,
        impacto: 'Abatimiento de fuentes, presión del balance hídrico, mayor dependencia de pozos',
        accionRecomendada:
          'Revisar balance por fuente, ajustar calendario de tandeo, acelerar reparación de fugas detectadas (cada m³ cuenta en estiaje)',
      });
    }
  }

  // Orden: crítica → alta → media (lo urgente primero).
  const peso = { critica: 0, alta: 1, media: 2 } as const;
  return alertas.sort((a, b) => peso[a.severidad] - peso[b.severidad]);
}
