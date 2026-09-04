/**
 * Módulo de tarifas periódicas — CEA Querétaro.
 *
 * Fuente: Tarifas_periodicas.xlsx (Agua Potable, feb-2026)
 *
 * Estructura del JSON:
 *   tarifasAgua[administracion][tipoTarifa] = { precios: number[], tasa: number }
 *   precios[m3] = precio total acumulado para ese consumo
 *   tasa         = tasa de IVA (0 o 0.16)
 *
 * Alcantarillado y Saneamiento se calculan como porcentaje del cargo de agua.
 * Recargos son un porcentaje mensual sobre saldo vencido.
 */

import tarifasAgua from '@/data/tarifas-agua.json';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TarifaEntry = {
  precios: number[];          // precios[m] = cargo acumulado para m m³ por unidad (0..200)
  precioBase200: number;      // cargo fijo cuando consumo > 200 m³
  precioM3Adicional: number;  // cargo por cada m³ adicional sobre 200
  tasa: number;
};
export type TarifasAguaData = Record<string, Record<string, TarifaEntry>>;

const DATA = tarifasAgua as TarifasAguaData;

// ── Constantes de porcentaje ───────────────────────────────────────────────────
// FALLBACK OFFLINE del motor de tarifas: la fuente canónica de estas reglas es
// el catálogo de conceptos de cobro del backend (`GET /catalogos/conceptos-cobro`,
// campos `porcentajeDeServicio`/`porcentaje`), leído vía
// `getReglasPorcentuales()` en `lib/cotizacion-motor.ts`. Estas constantes solo
// se usan cuando no hay backend o el fetch del catálogo falla.

/** Alcantarillado = X% del cargo de agua (sin IVA). Fallback offline del motor. */
export const ALCANTARILLADO_RATE = 0.10;

/** Saneamiento = X% del cargo de agua (sin IVA). Fallback offline del motor. */
export const SANEAMIENTO_RATE = 0.12;

/** Alias explícitos del rol de fallback (mismas constantes). */
export const FALLBACK_ALCANTARILLADO_RATE = ALCANTARILLADO_RATE;
export const FALLBACK_SANEAMIENTO_RATE = SANEAMIENTO_RATE;

/** Recargo mensual sobre saldo vencido acumulado */
export const RECARGO_MENSUAL = 0.01470;

// ── Catálogos ─────────────────────────────────────────────────────────────────

/** Lista de todas las administraciones disponibles en el catálogo */
export const ADMINISTRACIONES = Object.keys(DATA).sort();

/** Tipos de tarifa disponibles para una administración dada */
export function getTiposTarifa(administracion: string): string[] {
  return Object.keys(DATA[administracion] ?? {});
}

// ── Redondeo según regla CEA ──────────────────────────────────────────────────

/**
 * Redondea el consumo según la regla:
 *   fracción > 0.50  → sube al siguiente entero
 *   fracción ≤ 0.50  → baja al entero inferior
 */
function redondearConsumo(valor: number): number {
  const fraccion = valor % 1;
  return fraccion > 0.50 ? Math.ceil(valor) : Math.floor(valor);
}

// ── Lookup principal ──────────────────────────────────────────────────────────

/**
 * Calcula el cargo de agua por unidad para un consumo dado.
 *
 * @param administracion  Nombre exacto de la administración (ej. "QUERÉTARO")
 * @param tipoTarifa      Tipo de tarifa (ej. "DOMÉSTICA MEDIO")
 * @param consumoM3       Consumo POR UNIDAD en m³ (ya dividido; se redondea internamente)
 * @param unidades        Número de unidades servidas
 * @returns { aguaTotal, tasa } o null si no hay dato
 */
export function getPrecioAgua(
  administracion: string,
  tipoTarifa: string,
  consumoM3: number,
  unidades = 1,
): { aguaTotal: number; tasa: number } | null {
  const entry = DATA[administracion]?.[tipoTarifa];
  if (!entry) return null;

  const consumo = redondearConsumo(consumoM3);

  let aguaTotal: number;
  if (consumo > 200) {
    // Fórmula: (consumo × precioM3Adicional) × unidades + precioBase200
    aguaTotal = (consumo * entry.precioM3Adicional) * unidades + entry.precioBase200;
  } else {
    const idx = Math.max(consumo, 0);
    aguaTotal = (entry.precios[idx] ?? 0) * unidades;
  }

  return { aguaTotal, tasa: entry.tasa };
}

// ── Cálculo completo de un periodo ───────────────────────────────────────────

export interface ConceptoPeriodo {
  agua: number;
  alcantarillado: number;
  saneamiento: number;
  ivaAgua: number;
  ivaAlcantarillado: number;
  ivaSaneamiento: number;
  subtotal: number;   // sin IVA
  iva: number;
  total: number;
}

/**
 * Calcula todos los cargos del periodo (agua + alcantarillado + saneamiento).
 *
 * @param administracion  Nombre de la administración
 * @param tipoTarifa      Tipo de tarifa
 * @param m3Total         Consumo TOTAL en m³ (suma de todas las unidades)
 * @param unidades        Número de unidades servidas
 *
 * Internamente calcula: consumo_por_unidad = m3Total / unidades (con redondeo CEA),
 * luego aplica tarifa de tabla (≤200 m³) o fórmula (>200 m³).
 */
export function calcularCargoPeriodo(
  administracion: string,
  tipoTarifa: string,
  m3Total: number,
  unidades = 1,
): ConceptoPeriodo | null {
  const consumoPorUnidad = m3Total / (unidades || 1);
  const result = getPrecioAgua(administracion, tipoTarifa, consumoPorUnidad, unidades);
  if (!result) return null;

  const agua          = result.aguaTotal;
  const alcantarillado = agua * ALCANTARILLADO_RATE;
  const saneamiento   = agua * SANEAMIENTO_RATE;
  const ivaAgua       = agua * result.tasa;

  const subtotal = agua + alcantarillado + saneamiento;
  const iva      = ivaAgua;

  return {
    agua,
    alcantarillado,
    saneamiento,
    ivaAgua,
    ivaAlcantarillado: 0,
    ivaSaneamiento:    0,
    subtotal,
    iva,
    total: subtotal + iva,
  };
}

// ── Mapa de nombres de administración ────────────────────────────────────────

/**
 * Intenta encontrar la administración en el catálogo a partir de un nombre
 * parcial o ID (e.g. "Querétaro" → "QUERÉTARO").
 */
export function resolveAdministracion(nombre?: string | null): string | null {
  if (!nombre) return null;
  const upper = nombre.toUpperCase().trim();
  // Exact match
  if (DATA[upper]) return upper;
  // Partial match
  const found = ADMINISTRACIONES.find((a) => a.includes(upper) || upper.includes(a.split('-')[0].trim()));
  return found ?? null;
}

/**
 * Mapa de tipos de contratación → tipo de tarifa en el CSV.
 * Ampliar según los tipos definidos en la base de datos.
 */
export const TIPO_CONTRATACION_TO_TARIFA: Record<string, string> = {
  // Nombres parciales o exactos del tipo de contratación → nombre en CSV
  'DOMÉSTICO INDIVIDUAL': 'DOMÉSTICA MEDIO',
  'DOMÉSTICO MEDIO':      'DOMÉSTICA MEDIO',
  'DOMESTICO MEDIO':      'DOMÉSTICA MEDIO',
  'DOMÉSTICO ALTO':       'DOMÉSTICO ALTO',
  'DOMÉSTICO ECONÓMICO':  'DOMESTICO ECONOMICO',
  'DOMÉSTICO ECONOMICO':  'DOMESTICO ECONOMICO',
  'APOYO SOCIAL':         'DOMÉSTICO APOYO SOCIAL',
  'BENEFICENCIA':         'BENEFICENCIA',
  'COMERCIAL':            'COMERCIAL',
  'INDUSTRIAL':           'INDUSTRIAL',
  'ZONA RURAL':           'DOMESTICO ZONA RURAL',
  'HIDRANTE':             'HIDRANTE',
  'PÚBLICO CONCESIONADO': 'PÚBLICO CONCESIONADO',
  'PÚBLICO OFICIAL':      'PÚBLICO OFICIAL',
  'SANTA MARIA':          'SANTA MARIA MAGDALENA',
};

/**
 * Resuelve el tipo de tarifa del CSV a partir del nombre del tipo de contratación.
 * Primero busca coincidencia exacta, luego parcial.
 */
export function resolveTipoTarifa(
  tipoContratacionNombre?: string | null,
  administracion = 'QUERÉTARO',
): string | null {
  if (!tipoContratacionNombre) return null;
  const upper = tipoContratacionNombre.toUpperCase().trim();

  // Exact key match
  if (TIPO_CONTRATACION_TO_TARIFA[tipoContratacionNombre]) {
    return TIPO_CONTRATACION_TO_TARIFA[tipoContratacionNombre];
  }

  // Partial key match
  for (const [key, val] of Object.entries(TIPO_CONTRATACION_TO_TARIFA)) {
    if (upper.includes(key.toUpperCase()) || key.toUpperCase().includes(upper)) {
      return val;
    }
  }

  // Fallback: look directly in the CSV tariff names
  const tiposTarifa = getTiposTarifa(administracion);
  const directMatch = tiposTarifa.find(
    (t) => t.toUpperCase() === upper || upper.includes(t.toUpperCase()) || t.toUpperCase().includes(upper),
  );
  return directMatch ?? null;
}
