/**
 * Motor de reglas VEE (Validation, Estimation, Editing) para lecturas de medidor.
 *
 * Práctica MDM estándar (SWAN Forum / Oracle MDM): toda lectura pasa por reglas
 * de validación antes de facturarse; las que fallan van a una cola de excepciones
 * para revisión comercial. Este módulo es puro (sin Prisma/Nest) para poder
 * verificarlo de forma aislada.
 *
 * Reglas implementadas:
 *  - lectura_negativa        lectura actual < anterior (vuelta de medidor o error de captura)
 *  - fuera_rango_zona        lectura fuera del rango min/max esperado de la zona
 *  - spike                   consumo > umbralSpike × promedio histórico
 *  - caida_drastica          consumo < umbralCaida × promedio (posible submedición/deriva)
 *  - consumo_cero_prolongado N periodos consecutivos en cero con toma activa (posible
 *                            medidor parado o consumo no autorizado)
 *  - estimaciones_encadenadas N estimaciones consecutivas (la factura pierde base real)
 */

export interface LecturaVee {
  lecturaActual: number | null;
  lecturaAnterior: number | null;
  consumoReal: number | null;
  consumoEstimado: number | null;
  esEstimada: boolean;
  lecturaMinZona: number | null;
  lecturaMaxZona: number | null;
}

export interface HistorialVee {
  /** Consumos reales de periodos anteriores, del más reciente al más antiguo. */
  consumosPrevios: number[];
  /** ¿Cuántas de las últimas lecturas (incluyendo previas) fueron estimadas, consecutivamente? */
  estimadasConsecutivasPrevias: number;
}

export interface UmbralesVee {
  /** Factor sobre el promedio histórico para marcar spike (default 3). */
  factorSpike: number;
  /** Fracción del promedio bajo la cual se marca caída drástica (default 0.3). */
  factorCaida: number;
  /** Mínimo de periodos históricos para aplicar reglas estadísticas (default 3). */
  minHistorial: number;
  /** Periodos consecutivos en cero para marcar consumo_cero_prolongado (default 3). */
  maxCeros: number;
  /** Estimaciones consecutivas toleradas antes de marcar excepción (default 2). */
  maxEstimadas: number;
}

export const UMBRALES_DEFAULT: UmbralesVee = {
  factorSpike: 3,
  factorCaida: 0.3,
  minHistorial: 3,
  maxCeros: 3,
  maxEstimadas: 2,
};

export interface ExcepcionVee {
  regla: string;
  severidad: 'critica' | 'advertencia';
  detalle: Record<string, number | string | boolean | null>;
}

export function promedio(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/** Evalúa todas las reglas VEE sobre una lectura con su historial. */
export function evaluarLectura(
  lectura: LecturaVee,
  historial: HistorialVee,
  umbrales: UmbralesVee = UMBRALES_DEFAULT,
): ExcepcionVee[] {
  const excepciones: ExcepcionVee[] = [];
  const consumo = lectura.esEstimada ? lectura.consumoEstimado : lectura.consumoReal;

  // 1. Lectura negativa (actual < anterior)
  if (
    lectura.lecturaActual !== null &&
    lectura.lecturaAnterior !== null &&
    lectura.lecturaActual < lectura.lecturaAnterior
  ) {
    excepciones.push({
      regla: 'lectura_negativa',
      severidad: 'critica',
      detalle: { lecturaActual: lectura.lecturaActual, lecturaAnterior: lectura.lecturaAnterior },
    });
  }

  // 2. Fuera del rango esperado de la zona
  if (lectura.lecturaActual !== null) {
    if (lectura.lecturaMinZona !== null && lectura.lecturaActual < lectura.lecturaMinZona) {
      excepciones.push({
        regla: 'fuera_rango_zona',
        severidad: 'advertencia',
        detalle: { lecturaActual: lectura.lecturaActual, min: lectura.lecturaMinZona, lado: 'bajo' },
      });
    } else if (lectura.lecturaMaxZona !== null && lectura.lecturaActual > lectura.lecturaMaxZona) {
      excepciones.push({
        regla: 'fuera_rango_zona',
        severidad: 'advertencia',
        detalle: { lecturaActual: lectura.lecturaActual, max: lectura.lecturaMaxZona, lado: 'alto' },
      });
    }
  }

  // Reglas estadísticas: requieren historial suficiente y consumo conocido.
  const hist = historial.consumosPrevios;
  const prom = promedio(hist);
  if (consumo !== null && hist.length >= umbrales.minHistorial && prom > 0) {
    // 3. Spike
    if (consumo > prom * umbrales.factorSpike) {
      excepciones.push({
        regla: 'spike',
        severidad: 'critica',
        detalle: { consumo, promedio: Math.round(prom * 100) / 100, factor: umbrales.factorSpike },
      });
    }
    // 4. Caída drástica (posible submedición / deriva del medidor)
    if (consumo > 0 && consumo < prom * umbrales.factorCaida) {
      excepciones.push({
        regla: 'caida_drastica',
        severidad: 'advertencia',
        detalle: { consumo, promedio: Math.round(prom * 100) / 100, factor: umbrales.factorCaida },
      });
    }
  }

  // 5. Consumo cero prolongado (medidor parado o consumo no autorizado)
  if (consumo === 0 && hist.length >= umbrales.maxCeros - 1) {
    const cerosPrevios = contarCerosIniciales(hist);
    if (cerosPrevios >= umbrales.maxCeros - 1) {
      excepciones.push({
        regla: 'consumo_cero_prolongado',
        severidad: 'critica',
        detalle: { periodosEnCero: cerosPrevios + 1 },
      });
    }
  }

  // 6. Estimaciones encadenadas
  if (lectura.esEstimada && historial.estimadasConsecutivasPrevias >= umbrales.maxEstimadas) {
    excepciones.push({
      regla: 'estimaciones_encadenadas',
      severidad: 'advertencia',
      detalle: { estimadasConsecutivas: historial.estimadasConsecutivasPrevias + 1 },
    });
  }

  return excepciones;
}

/** Cuenta cuántos consumos consecutivos en cero hay al inicio (más recientes) del historial. */
function contarCerosIniciales(consumos: number[]): number {
  let n = 0;
  for (const c of consumos) {
    if (c === 0) n++;
    else break;
  }
  return n;
}
