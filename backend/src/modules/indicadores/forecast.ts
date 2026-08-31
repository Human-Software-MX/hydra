/**
 * Forecasting de series mensuales (facturación, recaudación, consumo) —
 * calculador puro, sin dependencias.
 *
 * Métodos en cascada según historia disponible (documentado en la respuesta):
 *  - ≥ 24 periodos: Holt-Winters aditivo estacionalidad 12 (nivel+tendencia+
 *    estacionalidad), parámetros fijos y auditables (α=0.3, β=0.05, γ=0.3).
 *  - ≥ 13 periodos: naive estacional (mismo mes del año anterior).
 *  - < 13 periodos: promedio móvil de los últimos 3.
 *
 * SWAN etapa Proactiva: presupuestar recaudación y anticipar desviaciones de
 * facturación con un método transparente antes de invertir en ML opaco.
 */

export interface PuntoSerie {
  periodo: string; // YYYY-MM
  valor: number;
}

export type MetodoForecast = 'holt_winters_aditivo' | 'naive_estacional' | 'promedio_movil';

export interface Pronostico {
  metodo: MetodoForecast;
  periodosHistoricos: number;
  /** MAPE % del ajuste un-paso-adelante dentro de muestra (null si no aplica). */
  mapeInSample: number | null;
  puntos: PuntoSerie[];
  advertencias: string[];
}

const ESTACIONALIDAD = 12;
const ALPHA = 0.3;
const BETA = 0.05;
const GAMMA = 0.3;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Periodo YYYY-MM + n meses (maneja cruce de año). */
export function sumarPeriodos(periodo: string, n: number): string {
  const [anio, mes] = periodo.split('-').map(Number);
  const total = anio * 12 + (mes - 1) + n;
  const a = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${a}-${String(m).padStart(2, '0')}`;
}

/** Rellena huecos de la serie con 0 (mes sin datos) y la ordena. */
export function normalizarSerie(serie: PuntoSerie[]): { serie: PuntoSerie[]; huecos: number } {
  if (serie.length === 0) return { serie: [], huecos: 0 };
  const ordenada = [...serie].sort((a, b) => a.periodo.localeCompare(b.periodo));
  const completa: PuntoSerie[] = [];
  let huecos = 0;
  let esperado = ordenada[0].periodo;
  for (const p of ordenada) {
    while (esperado < p.periodo) {
      completa.push({ periodo: esperado, valor: 0 });
      huecos++;
      esperado = sumarPeriodos(esperado, 1);
    }
    completa.push(p);
    esperado = sumarPeriodos(p.periodo, 1);
  }
  return { serie: completa, huecos };
}

function holtWinters(valores: number[], horizonte: number): { forecast: number[]; ajuste: number[] } {
  const m = ESTACIONALIDAD;
  const temporadas = Math.floor(valores.length / m);

  // Inicialización clásica: tendencia = diferencia de medias entre las dos
  // primeras temporadas / m; nivel = nivel implícito en t = −1 (la media de la
  // 1.ª temporada representa el centro de la temporada, (m−1)/2); estacional
  // inicial = promedio de los valores DESTENDIDOS por posición del año (sin
  // destender, la rampa de la tendencia contamina los índices estacionales).
  const mediaTemporada = (t: number) =>
    valores.slice(t * m, (t + 1) * m).reduce((s, v) => s + v, 0) / m;
  const centro = (m - 1) / 2;
  let tendencia = (mediaTemporada(1) - mediaTemporada(0)) / m;
  let nivel = mediaTemporada(0) - tendencia * (centro + 1);
  const estacional: number[] = Array.from({ length: m }, (_, i) => {
    let suma = 0;
    for (let t = 0; t < temporadas; t++) {
      const idx = t * m + i;
      suma += valores[idx] - (mediaTemporada(0) + tendencia * (idx - centro));
    }
    return suma / temporadas;
  });

  const ajuste: number[] = [];
  for (let t = 0; t < valores.length; t++) {
    const s = t % m;
    ajuste.push(nivel + tendencia + estacional[s]);
    const nivelPrevio = nivel;
    nivel = ALPHA * (valores[t] - estacional[s]) + (1 - ALPHA) * (nivel + tendencia);
    tendencia = BETA * (nivel - nivelPrevio) + (1 - BETA) * tendencia;
    estacional[s] = GAMMA * (valores[t] - nivel) + (1 - GAMMA) * estacional[s];
  }

  const forecast = Array.from({ length: horizonte }, (_, h) => {
    const s = (valores.length + h) % m;
    return nivel + (h + 1) * tendencia + estacional[s];
  });
  return { forecast, ajuste };
}

export function pronosticar(serieEntrada: PuntoSerie[], horizonte: number): Pronostico {
  const advertencias: string[] = [];
  const { serie, huecos } = normalizarSerie(serieEntrada);
  if (huecos > 0) advertencias.push(`${huecos} mes(es) sin datos rellenados con 0`);

  const n = serie.length;
  const valores = serie.map((p) => p.valor);
  const ultimo = n > 0 ? serie[n - 1].periodo : null;
  const h = Math.max(1, Math.min(horizonte, 24));

  if (n === 0) {
    return { metodo: 'promedio_movil', periodosHistoricos: 0, mapeInSample: null, puntos: [], advertencias: ['Serie vacía'] };
  }

  let metodo: MetodoForecast;
  let forecast: number[];
  let mape: number | null = null;

  if (n >= ESTACIONALIDAD * 2) {
    metodo = 'holt_winters_aditivo';
    const hw = holtWinters(valores, h);
    forecast = hw.forecast;
    // MAPE un-paso-adelante dentro de muestra (sobre valores > 0).
    let suma = 0;
    let cuenta = 0;
    for (let t = 0; t < n; t++) {
      if (valores[t] > 0) {
        suma += Math.abs((valores[t] - hw.ajuste[t]) / valores[t]);
        cuenta++;
      }
    }
    mape = cuenta > 0 ? r2((suma / cuenta) * 100) : null;
  } else if (n >= ESTACIONALIDAD + 1) {
    metodo = 'naive_estacional';
    forecast = Array.from({ length: h }, (_, i) => valores[n - ESTACIONALIDAD + (i % ESTACIONALIDAD)]);
    advertencias.push('Historia menor a 24 meses: pronóstico = mismo mes del año anterior');
  } else {
    metodo = 'promedio_movil';
    const ventana = valores.slice(-3);
    const promedio = ventana.reduce((s, v) => s + v, 0) / ventana.length;
    forecast = Array.from({ length: h }, () => promedio);
    advertencias.push('Historia menor a 13 meses: pronóstico = promedio móvil de los últimos 3');
  }

  return {
    metodo,
    periodosHistoricos: n,
    mapeInSample: mape,
    puntos: forecast.map((v, i) => ({
      periodo: sumarPeriodos(ultimo as string, i + 1),
      valor: r2(Math.max(0, v)),
    })),
    advertencias,
  };
}
