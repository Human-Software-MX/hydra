/**
 * Motor de tarifas para cotización de conexión (una vez, al contratar).
 *
 * Datos fuente: src/data/tarifas-contratacion.json (Feb-2026)
 * Scripts:     scripts/build-cotizacion-json.cjs
 *
 * Conceptos cubiertos:
 *  1. DERECHOS DE CONEXIÓN A RED DE AGUA  → por combo matCalle-matBanqueta + longitud toma
 *  2. DERECHOS DE CONEXIÓN RED DE DRENAJE → por combo matCalle-matBanqueta + longitud descarga
 *  3. INSTALACIÓN DE MEDIDOR              → por diámetro de toma
 *
 * Fórmula: (max(0, longitud - 6) × precioProporcional) + precioBase
 *          (los primeros 6 m están incluidos en el precio base)
 */

import tarifasRaw from '@/data/tarifas-contratacion.json';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface EntradaLongitud {
  precioBase: number;
  precioProporcional: number;
  tasa: number;
}

interface EntradaMedidor {
  precio: number;
  tasa: number;
}

type TarifasContratacion = Record<string, {
  longitud: { agua: Record<string, EntradaLongitud>; drenaje: Record<string, EntradaLongitud> };
  medidor:  { instalacion: Record<string, EntradaMedidor>; medidorTipos: Record<string, EntradaMedidor> };
}>;

const tarifas = tarifasRaw as TarifasContratacion;

// ── Resolución de administración ────────────────────────────────────────────
// Los mismos alias usados en tarifas.ts para agua periódica.

const ADMIN_ALIAS: Record<string, string> = {
  'QUERÉTARO':                              'QUERÉTARO',
  'QUERETARO':                              'QUERÉTARO',
  'SANTA ROSA':                             'SANTA ROSA JÁUREGUI',
  'SANTA ROSA JÁUREGUI':                    'SANTA ROSA JÁUREGUI',
  'CORREGIDORA':                            'CORREGIDORA',
  'PEDRO ESCOBEDO':                         'PEDRO ESCOBEDO',
  'TEQUISQUIAPAN':                          'TEQUISQUIAPAN',
  'EZEQUIEL MONTES':                        'EZEQUIEL MONTES',
  'AMEALCO':                                'AMEALCO DE BONFIL',
  'AMEALCO DE BONFIL':                      'AMEALCO DE BONFIL',
  'HUIMILPAN':                              'HUIMILPAN',
  'CADEREYTA':                              'CADEREYTA DE MONTES-SAN JOAQUÍN',
  'CADEREYTA DE MONTES':                    'CADEREYTA DE MONTES-SAN JOAQUÍN',
  'CADEREYTA DE MONTES-SAN JOAQUÍN':        'CADEREYTA DE MONTES-SAN JOAQUÍN',
  'COLÓN':                                  'COLÓN-TOLIMÁN',
  'COLÓN-TOLIMÁN':                          'COLÓN-TOLIMÁN',
  'COLON-TOLIMAN':                          'COLÓN-TOLIMÁN',
  'JALPAN':                                 'JALPAN DE SERRA-LANDA DE MATAMOROS-ARROYO SECO',
  'JALPAN DE SERRA':                        'JALPAN DE SERRA-LANDA DE MATAMOROS-ARROYO SECO',
  'JALPAN DE SERRA-LANDA DE MATAMOROS-ARROYO SECO': 'JALPAN DE SERRA-LANDA DE MATAMOROS-ARROYO SECO',
  'EL MARQUÉS':                             'EL MARQUÉS',
  'EL MARQUES':                             'EL MARQUÉS',
  'PINAL DE AMOLES':                        'PINAL DE AMOLES-PEÑAMILLER',
  'PINAL DE AMOLES-PEÑAMILLER':             'PINAL DE AMOLES-PEÑAMILLER',
};

export function resolveAdminContratacion(nombre: string): string | null {
  const upper = nombre.trim().toUpperCase().normalize('NFD').replace(/\p{M}/gu, '');
  // Primero busca normalizado
  for (const [alias, canon] of Object.entries(ADMIN_ALIAS)) {
    const normAlias = alias.normalize('NFD').replace(/\p{M}/gu, '');
    if (normAlias === upper || canon.normalize('NFD').replace(/\p{M}/gu, '') === upper) return canon;
  }
  // Fallback: contiene
  for (const [alias, canon] of Object.entries(ADMIN_ALIAS)) {
    if (upper.includes(alias.normalize('NFD').replace(/\p{M}/gu, ''))) return canon;
  }
  return null;
}

// ── Mapeo de material de inspección → clave del catálogo CSV ─────────────────

/**
 * Convierte el material de la inspección (o el nombre mostrado al usuario)
 * a la clave de material del CSV.
 * El CSV usa: CONCRETO, ASFALTO, ADOQUIN, ADOCRETO, EMPEDRADO, LOSA, TERRACERÍA, CANTERA
 */
const MAT_CALLE_MAP: Record<string, string> = {
  concreto_hidraulico: 'CONCRETO',
  concreto:            'CONCRETO',
  concreto_asfaltico:  'CONCRETO',   // calle de concreto-asfáltico → columna calle = CONCRETO
  losa:                'LOSA',
  adoquin:             'ADOQUIN',
  adoquín:             'ADOQUIN',
  empedrado:           'EMPEDRADO',
  tierra:              'TERRACERÍA',
  terraceria:          'TERRACERÍA',
  otro:                'CONCRETO',   // fallback razonable
};

const MAT_BANQUETA_MAP: Record<string, string> = {
  concreto_hidraulico: 'CONCRETO',
  concreto:            'CONCRETO',
  asfalto:             'ASFALTO',
  concreto_asfaltico:  'ASFALTO',    // banqueta asfáltica
  adoquin:             'ADOQUIN',
  adoquín:             'ADOQUIN',
  adocreto:            'ADOCRETO',
  empedrado:           'EMPEDRADO',
  tierra:              'TERRACERÍA',
  terraceria:          'TERRACERÍA',
  losa:                'CONCRETO',   // fallback razonable
  cantera:             'CANTERA',
  otro:                'CONCRETO',
};

export function resolveMatCalle(mat: string): string {
  return MAT_CALLE_MAP[mat?.toLowerCase().trim()] ?? 'CONCRETO';
}

export function resolveMatBanqueta(mat: string): string {
  return MAT_BANQUETA_MAP[mat?.toLowerCase().trim()] ?? 'CONCRETO';
}

/** Construye la clave de tarifa compuesta: "{matCalle}-{matBanqueta}" */
export function buildTarifaKey(matCalle: string, matBanqueta: string): string {
  return `${resolveMatCalle(matCalle)}-${resolveMatBanqueta(matBanqueta)}`;
}

// ── Cálculo de conexión a red de agua ────────────────────────────────────────

export interface ResultadoConexion {
  precioNeto: number;
  tasa: number;
  iva: number;
  total: number;
}

/**
 * Calcula el costo de DERECHOS DE CONEXIÓN A RED DE AGUA.
 * @param adminNombre  Nombre de la administración (tal como viene de la DB)
 * @param matCalle     Material de la calle (key interno del formulario)
 * @param matBanqueta  Material de la banqueta
 * @param longitud     Metros lineales de la toma
 */
export function calcularDerechosAgua(
  adminNombre: string,
  matCalle: string,
  matBanqueta: string,
  longitud: number,
): ResultadoConexion | null {
  const admin = resolveAdminContratacion(adminNombre);
  if (!admin) return null;
  const tarifaKey = buildTarifaKey(matCalle, matBanqueta);
  const entry = tarifas[admin]?.longitud?.agua?.[tarifaKey];
  if (!entry) return null;

  const excedente = Math.max(0, longitud - 6);
  const precioNeto = entry.precioBase + excedente * entry.precioProporcional;
  const iva = precioNeto * entry.tasa;
  return { precioNeto, tasa: entry.tasa, iva, total: precioNeto + iva };
}

// ── Cálculo de conexión a red de drenaje ────────────────────────────────────

export function calcularDerechosDrenaje(
  adminNombre: string,
  matCalle: string,
  matBanqueta: string,
  longitud: number,
): ResultadoConexion | null {
  const admin = resolveAdminContratacion(adminNombre);
  if (!admin) return null;
  const tarifaKey = buildTarifaKey(matCalle, matBanqueta);
  const entry = tarifas[admin]?.longitud?.drenaje?.[tarifaKey];
  if (!entry) return null;

  const excedente = Math.max(0, longitud - 6);
  const precioNeto = entry.precioBase + excedente * entry.precioProporcional;
  const iva = precioNeto * entry.tasa;
  return { precioNeto, tasa: entry.tasa, iva, total: precioNeto + iva };
}

// ── Cálculo de instalación de medidor ───────────────────────────────────────

/**
 * Mapeo de diámetro de toma (string del formulario) → clave de instalación.
 * Grupos del CSV:
 *   "1/2-3/4-1" → 1/2", 3/4", 1"
 *   "2"         → 2"
 *   "3"         → 3"
 *   "4"         → 4"
 */
function diamToInstalacionKey(diametro: string): string {
  const d = diametro.replace(/"/g, '').trim();
  if (d === '1/2' || d === '3/4' || d === '1') return '1/2-3/4-1';
  if (d === '1.5') return '1/2-3/4-1'; // 1.5" no está en el CSV — usar el grupo 1/2-3/4-1 como fallback
  if (d === '2')   return '2';
  if (d === '3')   return '3';
  if (d === '4')   return '4';
  return '1/2-3/4-1'; // fallback
}

export function calcularInstalacionMedidor(
  adminNombre: string,
  diametroToma: string,
): ResultadoConexion | null {
  const admin = resolveAdminContratacion(adminNombre);
  if (!admin) return null;
  const key = diamToInstalacionKey(diametroToma);
  const entry = tarifas[admin]?.medidor?.instalacion?.[key];
  if (!entry) return null;

  const iva = entry.precio * entry.tasa;
  return { precioNeto: entry.precio, tasa: entry.tasa, iva, total: entry.precio + iva };
}

// ── Listar tarifas conocidas para un admin ───────────────────────────────────

/** Devuelve las claves de tarifa disponibles (agua) para una administración. */
export function getTarifasAgua(adminNombre: string): string[] {
  const admin = resolveAdminContratacion(adminNombre) ?? 'QUERÉTARO';
  return Object.keys(tarifas[admin]?.longitud?.agua ?? {});
}

// ── Variantes válidas del catálogo Feb-2026 (normalizadas sin acentos) ────────
// Fuente: backend/prisma/data/tarifas-contratacion.json. Si la combinación
// calle-banqueta capturada no está aquí, no existe tarifa que cotizar y la UI
// debe decirlo como "combinación no tarifada", no como error de administración.
export const VARIANTES_CONEXION_AGUA = new Set([
  'ADOQUIN-ADOQUIN', 'CONCRETO-CONCRETO', 'CONCRETO-ASFALTO', 'CONCRETO-ADOCRETO',
  'CONCRETO-EMPEDRADO', 'CONCRETO-TERRACERIA', 'LOSA-ADOQUIN', 'LOSA-CANTERA',
  'TERRACERIA-EMPEDRADO', 'TERRACERIA-TERRACERIA',
]);
export const VARIANTES_CONEXION_DRENAJE = new Set([
  'ADOQUIN-ADOQUIN', 'CONCRETO-CONCRETO', 'CONCRETO-ASFALTO', 'CONCRETO-ADOCRETO',
  'CONCRETO-EMPEDRADO', 'LOSA-ADOQUIN', 'LOSA-CANTERA',
  'TERRACERIA-EMPEDRADO', 'TERRACERIA-TERRACERIA',
]);

/** Normaliza una variante para comparar contra los sets (sin acentos, mayúsculas). */
export function normalizarVariante(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

export function varianteConexionValida(key: string, servicio: 'agua' | 'drenaje'): boolean {
  const set = servicio === 'agua' ? VARIANTES_CONEXION_AGUA : VARIANTES_CONEXION_DRENAJE;
  return set.has(normalizarVariante(key));
}

/**
 * Variante de instalación de medidor del catálogo de contratación en BD.
 * Gemela de `diamToInstalacionKey` (claves del JSON local); esta produce los
 * strings exactos de `tarifas-contratacion.json`. 1.5" no existe en el catálogo
 * y cae al grupo 1/2-3/4-1 (mismo criterio documentado arriba).
 */
export function varianteInstalacionMedidor(diametro: string): string {
  const d = diametro.replace(/"/g, '').trim();
  if (d === '2') return 'Instalación Med 2 pulg';
  if (d === '3') return 'Instalación Med 3 pulg';
  if (d === '4') return 'Instalación Med 4 pulg';
  return 'Instalación Med 1/2, 3/4 y 1 pulg';
}
