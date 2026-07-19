/**
 * Ranking de reemplazo de medidores — calculador puro (sin Nest/Prisma).
 *
 * Best practice del parque de medición (AWWA M6 / SWAN Smart Metering):
 * un medidor envejecido o dañado subregistra y la pérdida es ingreso no
 * facturado (pérdida aparente del balance M36). Este scorer prioriza el
 * presupuesto de reemplazo combinando las señales que el sistema ya produce:
 * excepciones VEE (caída drástica = submedición sospechada, consumo cero
 * prolongado = medidor parado), % de lecturas estimadas (medidor ilegible o
 * inaccesible), edad del equipo y tamaño del consumo (ingreso en riesgo).
 */

export interface EntradaReemplazo {
  /** Años desde la instalación; null si se desconoce. */
  edadAnios: number | null;
  /** Excepciones VEE `caida_drastica` en la ventana analizada. */
  excepcionesCaidaDrastica: number;
  /** Excepciones VEE `consumo_cero_prolongado` en la ventana analizada. */
  excepcionesConsumoCero: number;
  /** Consumos registrados en la ventana (12 periodos típicamente). */
  lecturas: number;
  /** De esos, cuántos NO son lectura real (Promedio/Mixto/Cuota fija). */
  lecturasEstimadas: number;
  /** Consumo promedio m³/periodo (ingreso en riesgo si subregistra). */
  consumoPromedioM3: number;
}

export type PrioridadReemplazo = 'critica' | 'alta' | 'media' | 'baja';

export interface ResultadoReemplazo {
  /** 0-100: urgencia de reemplazo. */
  score: number;
  prioridad: PrioridadReemplazo;
  razones: string[];
}

/** Vida útil de referencia para medidores domiciliarios (años). */
const VIDA_UTIL_ANIOS = 10;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function calcularScoreReemplazo(e: EntradaReemplazo): ResultadoReemplazo {
  const razones: string[] = [];
  let score = 0;

  // Submedición sospechada — la señal más cara: agua entregada no facturada.
  if (e.excepcionesCaidaDrastica > 0) {
    score += clamp(e.excepcionesCaidaDrastica, 0, 4) * 10;
    razones.push(
      `${e.excepcionesCaidaDrastica} excepción(es) VEE de caída drástica de consumo (submedición sospechada)`,
    );
  }

  // Medidor parado.
  if (e.excepcionesConsumoCero > 0) {
    score += clamp(e.excepcionesConsumoCero, 0, 3) * 8;
    razones.push(
      `${e.excepcionesConsumoCero} excepción(es) VEE de consumo cero prolongado (medidor posiblemente parado)`,
    );
  }

  // Lecturas estimadas: el medidor no se puede leer (dañado, ilegible, inaccesible).
  const pctEstimadas = e.lecturas > 0 ? e.lecturasEstimadas / e.lecturas : 0;
  if (pctEstimadas > 0.25) {
    score += pctEstimadas * 15;
    razones.push(`${Math.round(pctEstimadas * 100)}% de lecturas estimadas en la ventana analizada`);
  }

  // Edad: degradación metrológica progresiva pasada la vida útil.
  if (e.edadAnios === null) {
    score += 10;
    razones.push('Sin fecha de instalación registrada (edad desconocida)');
  } else if (e.edadAnios > 0) {
    score += (clamp(e.edadAnios, 0, VIDA_UTIL_ANIOS * 2) / (VIDA_UTIL_ANIOS * 2)) * 30;
    if (e.edadAnios >= VIDA_UTIL_ANIOS) {
      razones.push(`Medidor con ${Math.floor(e.edadAnios)} años (vida útil de referencia: ${VIDA_UTIL_ANIOS})`);
    }
  }

  // Ingreso en riesgo: en un gran consumidor la misma señal cuesta más dinero.
  if (e.consumoPromedioM3 >= 50) {
    score += 10;
    razones.push(`Gran consumidor (${Math.round(e.consumoPromedioM3)} m³/periodo promedio)`);
  } else if (e.consumoPromedioM3 >= 20) {
    score += 5;
  }

  score = Math.round(clamp(score, 0, 100));
  const prioridad: PrioridadReemplazo =
    score >= 70 ? 'critica' : score >= 50 ? 'alta' : score >= 30 ? 'media' : 'baja';

  return { score, prioridad, razones };
}
