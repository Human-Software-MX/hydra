/**
 * Motor de tarifas versionado (backend) para cuantificación / cotización.
 *
 * Espejo async del motor offline (`lib/cotizacion-tarifas.ts` para cargos de
 * contratación y `lib/tarifas.ts` para agua periódica): mismas formas de
 * retorno, resueltas contra `GET /tarifas/contratacion/cotizar` y
 * `GET /tarifas/calcular` con el `administracionId` real (EXP-01…EXP-13).
 *
 * Contrato de fallo: NINGUNA función lanza. Cuando no hay backend
 * (`hasApi()` false) o el fetch falla devuelven `null` (o el fallback offline
 * en `getReglasPorcentuales`) para que el caller caiga al motor offline sin
 * romper el flujo demo.
 */

import { hasApi } from '@/api/client';
import {
  calcularMonto,
  cotizarContratacion,
  type CotizacionContratacionDto,
} from '@/api/tarifas';
import { fetchConceptosCobro } from '@/api/catalogos';
import {
  buildTarifaKey,
  normalizarVariante,
  varianteConexionValida,
  varianteInstalacionMedidor,
  type ResultadoConexion,
} from '@/lib/cotizacion-tarifas';
import { ALCANTARILLADO_RATE, SANEAMIENTO_RATE } from '@/lib/tarifas';

// ── tipoServicio del catálogo versionado ─────────────────────────────────────

export const TIPO_SERVICIO_CONEXION_AGUA =
  'contratacion_derechos_de_conexion_a_red_de_agua';
export const TIPO_SERVICIO_CONEXION_DRENAJE =
  'contratacion_derechos_de_conexion_red_de_drenaje';
export const TIPO_SERVICIO_INSTALACION_MEDIDOR =
  'contratacion_instalacion_de_medidor';
/** Agua periódica (facturación por consumo). */
export const TIPO_SERVICIO_AGUA = 'agua';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Ejecuta un fetch del motor; `null` si no hay backend o el fetch falla. */
async function intentar<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!hasApi()) return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * Mapea la cotización del backend a la forma del motor offline
 * (`ResultadoConexion`). El backend ya devuelve `ivaPct` efectivo
 * (0 cuando el acto es no objeto de IVA).
 */
function aResultadoConexion(res: CotizacionContratacionDto): ResultadoConexion {
  return {
    precioNeto: res.importe,
    tasa: (res.ivaPct ?? 0) / 100,
    iva: res.iva,
    total: res.total,
  };
}

// ── Cargos únicos de contratación ────────────────────────────────────────────

/**
 * DERECHOS DE CONEXIÓN A RED DE AGUA vía motor versionado.
 * Si la combinación calle-banqueta no está tarifada, regresa `null` sin
 * llamar al backend (mismo criterio que el motor offline).
 */
export async function calcularDerechosAguaApi(
  administracionId: string,
  matCalle: string,
  matBanqueta: string,
  metros: number,
): Promise<ResultadoConexion | null> {
  if (!administracionId || metros <= 0) return null;
  const variante = buildTarifaKey(matCalle, matBanqueta);
  if (!varianteConexionValida(variante, 'agua')) return null;
  const res = await intentar(() =>
    cotizarContratacion({
      administracionId,
      tipoServicio: TIPO_SERVICIO_CONEXION_AGUA,
      variante,
      cantidad: metros,
    }),
  );
  return res ? aResultadoConexion(res) : null;
}

/** DERECHOS DE CONEXIÓN RED DE DRENAJE vía motor versionado. */
export async function calcularDerechosDrenajeApi(
  administracionId: string,
  matCalle: string,
  matBanqueta: string,
  metros: number,
): Promise<ResultadoConexion | null> {
  if (!administracionId || metros <= 0) return null;
  const variante = buildTarifaKey(matCalle, matBanqueta);
  if (!varianteConexionValida(variante, 'drenaje')) return null;
  const res = await intentar(() =>
    cotizarContratacion({
      administracionId,
      tipoServicio: TIPO_SERVICIO_CONEXION_DRENAJE,
      variante,
      cantidad: metros,
    }),
  );
  return res ? aResultadoConexion(res) : null;
}

/** INSTALACIÓN DE MEDIDOR (por diámetro de toma) vía motor versionado. */
export async function calcularInstalacionMedidorApi(
  administracionId: string,
  diametroToma: string,
): Promise<ResultadoConexion | null> {
  if (!administracionId || !diametroToma) return null;
  const res = await intentar(() =>
    cotizarContratacion({
      administracionId,
      tipoServicio: TIPO_SERVICIO_INSTALACION_MEDIDOR,
      variante: varianteInstalacionMedidor(diametroToma),
      cantidad: 1,
    }),
  );
  return res ? aResultadoConexion(res) : null;
}

// ── Agua periódica ───────────────────────────────────────────────────────────

export interface CargoAguaApi {
  /** Cargo de agua del periodo (sin IVA) para el consumo dado. */
  agua: number;
  iva: number;
  total: number;
}

/**
 * Cargo de agua de un periodo vía `GET /tarifas/calcular`.
 * `consumoM3` es el consumo POR UNIDAD; el backend aplica el redondeo CEA
 * de las tarifas de tabla, así que no hay que redondear aquí.
 */
export async function calcularCargoAguaPeriodoApi(
  administracionId: string,
  claseTarifaId: string,
  consumoM3: number,
): Promise<CargoAguaApi | null> {
  if (!administracionId || !claseTarifaId || consumoM3 <= 0) return null;
  const res = await intentar(() =>
    calcularMonto(TIPO_SERVICIO_AGUA, consumoM3, { administracionId, claseTarifaId }),
  );
  if (!res) return null;
  return { agua: res.subtotal, iva: res.iva, total: res.total };
}

// ── Reglas porcentuales (alcantarillado / saneamiento) ───────────────────────

export interface ReglasPorcentuales {
  /** Fracción del cargo de agua (p. ej. 0.10 = 10 %). */
  alcantarillado: number;
  /** Fracción del cargo de agua (p. ej. 0.12 = 12 %). */
  saneamiento: number;
}

/** Fallback offline (constantes de `lib/tarifas.ts`). */
export const REGLAS_PORCENTUALES_FALLBACK: ReglasPorcentuales = {
  alcantarillado: ALCANTARILLADO_RATE,
  saneamiento: SANEAMIENTO_RATE,
};

let reglasCache: ReglasPorcentuales | null = null;
let reglasPendiente: Promise<ReglasPorcentuales> | null = null;

/**
 * Lee las reglas porcentuales del catálogo de conceptos de cobro
 * (`GET /catalogos/conceptos-cobro`): un concepto con `porcentaje` cuyo nombre
 * normalizado empiece con ALCANTARILLADO / SANEAMIENTO y origen LECTURAS o
 * CONTRATACION define la fracción (porcentaje / 100). Cachea en módulo;
 * si el API falla devuelve el fallback offline sin cachearlo.
 */
export async function getReglasPorcentuales(): Promise<ReglasPorcentuales> {
  if (reglasCache) return reglasCache;
  if (reglasPendiente) return reglasPendiente;
  if (!hasApi()) return REGLAS_PORCENTUALES_FALLBACK;

  reglasPendiente = (async () => {
    try {
      const conceptos = await fetchConceptosCobro();
      const fraccion = (prefijo: string): number | null => {
        const concepto = conceptos.find((c) => {
          if (!normalizarVariante(c.nombre ?? '').startsWith(prefijo)) return false;
          if (c.origen !== 'LECTURAS' && c.origen !== 'CONTRATACION') return false;
          const n = Number(c.porcentaje);
          return Number.isFinite(n) && n > 0;
        });
        return concepto ? Number(concepto.porcentaje) / 100 : null;
      };
      const reglas: ReglasPorcentuales = {
        alcantarillado: fraccion('ALCANTARILLADO') ?? ALCANTARILLADO_RATE,
        saneamiento: fraccion('SANEAMIENTO') ?? SANEAMIENTO_RATE,
      };
      reglasCache = reglas;
      return reglas;
    } catch {
      return REGLAS_PORCENTUALES_FALLBACK;
    } finally {
      reglasPendiente = null;
    }
  })();
  return reglasPendiente;
}
