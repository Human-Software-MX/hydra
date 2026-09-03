/**
 * Catálogo de tarifas periódicas (docs/Tarifas_periodicas.xlsx, precios a febrero 2026).
 *
 * Flujo (mismo patrón que catalogos-tipos-contratacion-import.ts):
 *   Excel (solo en máquina con el .xlsx) → `npm run export:tarifas-periodicas-json`
 *     → prisma/data/tarifas-periodicas.json (versionado) → seed idempotente.
 *
 * Clasificación:
 *   - CategoriaTarifa: clasificación principal/fiscal (DOMESTICA, COMERCIAL, INDUSTRIAL, PUBLICO, …).
 *     Define el IVA por defecto (DOMESTICA = 0 %).
 *   - ClaseTarifa: tipo de tarifa / variante comercial (DOMÉSTICA MEDIO, DOMÉSTICO ALTO, …). Hereda el IVA
 *     de la categoría salvo override (`ivaPct`). `sigeTpsId` enlaza con tipo_punto_servicio (tcttpsid) del SIGE.
 *   En las 5 hojas del Excel la TASA es constante por nombre de tarifa (clase), lo que confirma que la regla
 *   fiscal es propiedad de la clase/categoría y no de la fila de precio.
 *
 * El seed NUNCA sobrescribe: crea categorías/clases que no existan (respeta ediciones del configurador
 * fiscal), da de alta solo linajes de tarifa (codigo) inexistentes, y enlaza tipos de contratación sin clase.
 */
import * as fs from 'fs';
import type { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { resolveDataFile } from './data-dir';
import { FALLBACK_ADMINISTRACIONES } from './catalogos-tipos-contratacion-import';
import {
  redondear4,
  snapshotValores,
  TIPOS_MOVIMIENTO,
  ValoresTarifa,
  valorReferencia,
} from '../src/modules/tarifas/tarifa-valores';

// ─── Clasificación ─────────────────────────────────────────────────────────────

export interface CategoriaTarifaDef {
  codigo: string;
  nombre: string;
  descripcion: string;
  ivaPct: number;
  orden: number;
}

export interface ClaseTarifaDef {
  codigo: string;
  /** Nombre canónico (como aparece en el Excel / recibos). */
  nombre: string;
  categoria: string;
  /** Override de IVA; null/undefined = hereda de la categoría. */
  ivaPct?: number | null;
  /** tcttpsid (tipo_punto_servicio) del SIGE. */
  sigeTpsId?: number;
  /** Nombres alternativos (normalizados con `normalizarNombreTarifa`) con los que aparece en Excel/SIGE. */
  aliases?: string[];
  orden: number;
}

export const CATEGORIAS_TARIFA: CategoriaTarifaDef[] = [
  { codigo: 'DOMESTICA', nombre: 'Doméstica', descripcion: 'Uso habitacional. Servicio exento de IVA.', ivaPct: 0, orden: 1 },
  { codigo: 'COMERCIAL', nombre: 'Comercial', descripcion: 'Comercios y servicios.', ivaPct: 16, orden: 2 },
  { codigo: 'INDUSTRIAL', nombre: 'Industrial', descripcion: 'Industria y procesos productivos.', ivaPct: 16, orden: 3 },
  { codigo: 'PUBLICO', nombre: 'Público', descripcion: 'Dependencias y entes públicos (oficial, concesionado, poder ejecutivo, IAP, hidrantes).', ivaPct: 16, orden: 4 },
  { codigo: 'BENEFICENCIA', nombre: 'Beneficencia', descripcion: 'Instituciones de beneficencia.', ivaPct: 16, orden: 5 },
  { codigo: 'GANADERO', nombre: 'Ganadero', descripcion: 'Uso ganadero / agropecuario.', ivaPct: 16, orden: 6 },
  { codigo: 'GENERAL', nombre: 'General', descripcion: 'Tarifa única por concepto (agua tratada, cargos por concepto, comunidades sin clase propia).', ivaPct: 16, orden: 7 },
];

export const CLASES_TARIFA: ClaseTarifaDef[] = [
  // DOMÉSTICA (todas exentas: heredan 0 %)
  { codigo: 'DOM_MEDIO', nombre: 'DOMÉSTICA MEDIO', categoria: 'DOMESTICA', sigeTpsId: 123, aliases: ['DOMESTICO MEDIO', 'DOMESTICO INDIVIDUAL'], orden: 10 },
  { codigo: 'DOM_ALTO', nombre: 'DOMÉSTICO ALTO', categoria: 'DOMESTICA', sigeTpsId: 124, aliases: ['DOMESTICA ALTO'], orden: 11 },
  { codigo: 'DOM_ECONOMICO', nombre: 'DOMÉSTICO ECONÓMICO', categoria: 'DOMESTICA', sigeTpsId: 122, aliases: ['DOMESTICA ECONOMICA', 'DOMESTICO ECONOMICA'], orden: 12 },
  { codigo: 'DOM_APOYO_SOCIAL', nombre: 'DOMÉSTICO APOYO SOCIAL', categoria: 'DOMESTICA', sigeTpsId: 1, aliases: ['APOYO SOCIAL'], orden: 13 },
  { codigo: 'DOM_ZONA_RURAL', nombre: 'DOMÉSTICO ZONA RURAL', categoria: 'DOMESTICA', sigeTpsId: 125, aliases: ['ZONA RURAL'], orden: 14 },
  { codigo: 'DOM_CABECERA_ECONOMICA', nombre: 'DOMÉSTICO CABECERA ECONÓMICA', categoria: 'DOMESTICA', sigeTpsId: 126, orden: 15 },
  { codigo: 'DOM_CABECERA_MEDIA', nombre: 'DOMÉSTICO CABECERA MEDIA', categoria: 'DOMESTICA', sigeTpsId: 127, orden: 16 },
  { codigo: 'DOM_SANTA_MARIA_MAGDALENA', nombre: 'SANTA MARIA MAGDALENA', categoria: 'DOMESTICA', aliases: ['SANTA MARIA'], orden: 17 },
  { codigo: 'DOM_COMUNIDAD_LA_LIRA', nombre: 'COMUNIDAD LA LIRA', categoria: 'DOMESTICA', orden: 18 },
  // COMERCIAL / INDUSTRIAL / BENEFICENCIA / GANADERO
  { codigo: 'COMERCIAL', nombre: 'COMERCIAL', categoria: 'COMERCIAL', sigeTpsId: 2, orden: 20 },
  { codigo: 'INDUSTRIAL', nombre: 'INDUSTRIAL', categoria: 'INDUSTRIAL', sigeTpsId: 11, orden: 30 },
  { codigo: 'BENEFICENCIA', nombre: 'BENEFICENCIA', categoria: 'BENEFICENCIA', sigeTpsId: 105, aliases: ['INST. DE BENEFICIENCIA', 'INST DE BENEFICIENCIA', 'BENEFICIENCIA'], orden: 50 },
  { codigo: 'GANADERO', nombre: 'GANADERO', categoria: 'GANADERO', sigeTpsId: 17, orden: 60 },
  // PÚBLICO
  { codigo: 'PUB_OFICIAL', nombre: 'PÚBLICO OFICIAL', categoria: 'PUBLICO', sigeTpsId: 102, orden: 40 },
  { codigo: 'PUB_CONCESIONADO', nombre: 'PÚBLICO CONCESIONADO', categoria: 'PUBLICO', sigeTpsId: 103, orden: 41 },
  // Hidrantes: en el Excel siempre a 0 % (abasto por pipas a comunidades) → override explícito.
  { codigo: 'PUB_HIDRANTE', nombre: 'HIDRANTE', categoria: 'PUBLICO', sigeTpsId: 104, ivaPct: 0, orden: 42 },
  { codigo: 'PUB_PODER_EJECUTIVO', nombre: 'PODER EJECUTIVO', categoria: 'PUBLICO', orden: 43 },
  { codigo: 'PUB_PODER_EJECUTIVO_SOLO_AGUA', nombre: 'PODER EJECUTIVO (SOLO AGUA)', categoria: 'PUBLICO', orden: 44 },
  { codigo: 'PUB_PODER_EJECUTIVO_C_SAN', nombre: 'PODER EJECUTIVO (C/SAN)', categoria: 'PUBLICO', orden: 45 },
  { codigo: 'PUB_IAP', nombre: 'IAP', categoria: 'PUBLICO', orden: 46 },
  { codigo: 'PUB_IAP_SOLO_AGUA', nombre: 'IAP (SOLO AGUA)', categoria: 'PUBLICO', orden: 47 },
  { codigo: 'PUB_IAP_C_SAN', nombre: 'IAP (C/SAN)', categoria: 'PUBLICO', orden: 48 },
  // GENERAL (tarifa única por concepto) y clases nominales del Excel que codifican la tasa en el nombre
  { codigo: 'GENERAL', nombre: 'GENERAL', categoria: 'GENERAL', aliases: ['AGUA TRATADA'], orden: 70 },
  { codigo: 'GEN_COMUNIDAD_SEBASTIANES', nombre: 'COMUNIDAD SEBASTIANES', categoria: 'GENERAL', orden: 71 },
  { codigo: 'GEN_PUERTO_SAN_ANTONIO', nombre: 'PUERTO SAN ANTONIO', categoria: 'GENERAL', orden: 72 },
  { codigo: 'GEN_ALC_PIPAS_0', nombre: 'ALCANTARILLADO PIPAS 0%', categoria: 'GENERAL', ivaPct: 0, orden: 73 },
  { codigo: 'GEN_ALC_PIPAS_16', nombre: 'ALCANTARILLADO PIPAS 16%', categoria: 'GENERAL', orden: 74 },
  { codigo: 'GEN_SAN_PIPAS_16', nombre: 'SANEAMIENTO PIPAS 16%', categoria: 'GENERAL', orden: 75 },
];

/** Mayúsculas, sin acentos, espacios colapsados. */
export function normalizarNombreTarifa(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Erratas conocidas del Excel origen → forma canónica (se corrigen antes de generar el slug). */
const ERRATAS_CONCEPTO: Record<string, string> = { SANEMIENTO: 'SANEAMIENTO' };

/** Slug estable para tipoServicio a partir de un concepto (p. ej. "AGUA TRATADA VIA RED" → agua_tratada_via_red). */
export function slugServicio(s: unknown): string {
  let n = normalizarNombreTarifa(s);
  for (const [errata, ok] of Object.entries(ERRATAS_CONCEPTO)) n = n.replace(errata, ok);
  return n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const claseIndex: Map<string, ClaseTarifaDef> = (() => {
  const m = new Map<string, ClaseTarifaDef>();
  for (const c of CLASES_TARIFA) {
    m.set(normalizarNombreTarifa(c.nombre), c);
    for (const a of c.aliases ?? []) m.set(normalizarNombreTarifa(a), c);
  }
  return m;
})();

/** Resuelve una clase por nombre exacto (normalizado) o alias. */
export function resolverClasePorNombre(nombre: unknown): ClaseTarifaDef | null {
  return claseIndex.get(normalizarNombreTarifa(nombre)) ?? null;
}

const categoriaIndex = new Map(CATEGORIAS_TARIFA.map((c) => [c.codigo, c]));

/** IVA efectivo de una clase (override o el de su categoría). */
export function ivaEfectivoClaseDef(clase: ClaseTarifaDef): number {
  if (clase.ivaPct !== undefined && clase.ivaPct !== null) return clase.ivaPct;
  const cat = categoriaIndex.get(clase.categoria);
  if (!cat) throw new Error(`Clase ${clase.codigo} referencia categoría inexistente ${clase.categoria}`);
  return cat.ivaPct;
}

/**
 * Deduce la clase tarifaria de un tipo de contratación SIGE a partir de su nombre
 * ("ALTA NUEVA DOMESTICO MEDIO CONDOMINAL PROVISIONAL" → DOM_MEDIO).
 */
export function resolverClaseDesdeTipoContratacion(nombreTipo: unknown): ClaseTarifaDef | null {
  let n = normalizarNombreTarifa(nombreTipo);
  for (const token of [
    'ALTA NUEVA',
    'SIN SUMINISTRO',
    'CONDOMINAL',
    'INDIVIDUAL',
    'PROVISIONAL',
    '(USO DOMESTICO)',
    '(INDUSTRIAL)',
    'Y/O SANEAMIENTO',
    'ALCANTARILLADO',
  ]) {
    n = n.replace(token, ' ');
  }
  n = n.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  const directa = resolverClasePorNombre(n);
  if (directa) return directa;
  // Coincidencia por contención (nombre de clase contenido en el del tipo o viceversa), del más largo al más corto.
  const candidatos = [...claseIndex.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [alias, clase] of candidatos) {
    if (alias.length >= 5 && (n.includes(alias) || alias.includes(n))) return clase;
  }
  return null;
}

// ─── Payload (JSON versionado) ────────────────────────────────────────────────

export interface TarifaPayloadRow extends ValoresTarifa {
  /** Linaje estable: `${administracionId}:${tipoServicio}:${claseCodigo}`. */
  codigo: string;
  nombre: string;
  administracionId: string;
  claseCodigo: string;
  tipoServicio: string;
  /** Concepto de cobro original del Excel (tarifas por concepto). */
  concepto: string | null;
}

export interface CorreccionPayloadRow {
  tarifaCodigo: string;
  tipo: string;
  descripcion: string;
  montoFijo: number;
  condiciones: Record<string, unknown>;
}

export interface TarifasPeriodicasPayload {
  fuente: string;
  vigenciaDesde: string;
  generadoEn: string;
  tarifas: TarifaPayloadRow[];
  correcciones: CorreccionPayloadRow[];
  advertencias: string[];
}

export const VIGENCIA_TARIFAS_EXCEL = '2026-02-01';

export function defaultTarifasPeriodicasJsonPath(): string {
  return resolveDataFile('tarifas-periodicas.json');
}

const adminIndex = new Map(FALLBACK_ADMINISTRACIONES.map((a) => [normalizarNombreTarifa(a.nombre), a.id]));

function resolverAdministracionId(nombre: unknown, advertencias: string[]): string | null {
  const id = adminIndex.get(normalizarNombreTarifa(nombre));
  if (!id) {
    const aviso = `Administración no reconocida en Excel: "${String(nombre)}"`;
    if (!advertencias.includes(aviso)) advertencias.push(aviso);
    return null;
  }
  return id;
}

/** Números del Excel: acepta números, "0.16" y cadenas contables (" $ - " → 0). */
export function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/[$,\s]/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function tasaAPct(v: unknown): number {
  const t = toNum(v);
  // TASA viene como fracción (0.16). Si alguien captura 16 se respeta como porcentaje.
  return t <= 1 ? Math.round(t * 10000) / 100 : t;
}

const etiquetaServicio: Record<string, string> = {
  agua: 'Agua potable',
  agua_tratada_via_red: 'Agua tratada vía red',
};

function matrix(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];
}

function findHeaderRow(m: unknown[][], primeraColumna: string): number {
  const idx = m.findIndex((r) => r && normalizarNombreTarifa(r[0]) === primeraColumna);
  if (idx === -1) throw new Error(`No se encontró encabezado "${primeraColumna}"`);
  return idx;
}

interface TablaAcumulada {
  precios: number[];
  cuotaFija: number;
  precioUnitario: number;
  ivaPct: number;
  claseNombre: string;
}

function tablaATarifa(
  key: { administracionId: string; tipoServicio: string; concepto: string | null },
  clase: ClaseTarifaDef,
  t: TablaAcumulada,
  advertencias: string[],
): TarifaPayloadRow {
  const rangoMaxM3 = t.precios.length - 1;
  if (rangoMaxM3 !== 200) {
    advertencias.push(`${key.administracionId}/${key.tipoServicio}/${clase.codigo}: tabla con ${t.precios.length} tramos (se esperaban 201)`);
  }
  const ivaClase = ivaEfectivoClaseDef(clase);
  if (ivaClase !== t.ivaPct) {
    advertencias.push(`${key.administracionId}/${key.tipoServicio}/${clase.codigo}: TASA Excel ${t.ivaPct}% ≠ IVA de la clase ${ivaClase}%`);
  }
  const servicio = etiquetaServicio[key.tipoServicio] ?? key.concepto ?? key.tipoServicio;
  return {
    codigo: `${key.administracionId}:${key.tipoServicio}:${clase.codigo}`,
    nombre: `${clase.nombre} · ${servicio}`,
    administracionId: key.administracionId,
    claseCodigo: clase.codigo,
    tipoServicio: key.tipoServicio,
    concepto: key.concepto,
    tipoCalculo: 'tabla',
    rangoMinM3: 0,
    rangoMaxM3,
    cuotaFija: redondear4(t.cuotaFija),
    precioUnitario: redondear4(t.precioUnitario),
    precios: t.precios.map(redondear4),
    ivaPct: t.ivaPct,
  };
}

function linealATarifa(
  key: { administracionId: string; tipoServicio: string; concepto: string | null; subconcepto?: string | null },
  clase: ClaseTarifaDef,
  v: { cuotaFija: number; precioUnitario: number; ivaPct: number },
  advertencias: string[],
): TarifaPayloadRow {
  const ivaClase = ivaEfectivoClaseDef(clase);
  if (ivaClase !== v.ivaPct) {
    advertencias.push(`${key.administracionId}/${key.tipoServicio}/${clase.codigo}: TASA Excel ${v.ivaPct}% ≠ IVA de la clase ${ivaClase}%`);
  }
  const servicio = etiquetaServicio[key.tipoServicio] ?? key.concepto ?? key.tipoServicio;
  const sub = key.subconcepto && normalizarNombreTarifa(key.subconcepto) !== normalizarNombreTarifa(key.concepto)
    ? ` (${key.subconcepto})`
    : '';
  return {
    codigo: `${key.administracionId}:${key.tipoServicio}:${clase.codigo}`,
    nombre: `${clase.nombre} · ${servicio}${sub}`,
    administracionId: key.administracionId,
    claseCodigo: clase.codigo,
    tipoServicio: key.tipoServicio,
    concepto: key.concepto,
    tipoCalculo: 'lineal',
    rangoMinM3: null,
    rangoMaxM3: null,
    cuotaFija: redondear4(v.cuotaFija),
    precioUnitario: redondear4(v.precioUnitario),
    precios: null,
    ivaPct: v.ivaPct,
  };
}

/** Lee el Excel completo y devuelve el payload que se guarda en JSON. */
export function buildTarifasPeriodicasPayloadFromXlsx(xlsxPath: string): TarifasPeriodicasPayload {
  const wb = XLSX.readFile(xlsxPath);
  const advertencias: string[] = [];
  const tarifas: TarifaPayloadRow[] = [];
  const correcciones: CorreccionPayloadRow[] = [];
  const codigos = new Set<string>();
  const push = (t: TarifaPayloadRow) => {
    if (codigos.has(t.codigo)) {
      advertencias.push(`Tarifa duplicada en Excel, se conserva la primera: ${t.codigo}`);
      return;
    }
    codigos.add(t.codigo);
    tarifas.push(t);
  };
  const claseDe = (nombre: unknown, ctx: string): ClaseTarifaDef | null => {
    const c = resolverClasePorNombre(nombre);
    if (!c) advertencias.push(`${ctx}: tarifa "${String(nombre)}" sin clase conocida (agregar a CLASES_TARIFA)`);
    return c;
  };

  // ── Hoja 1: AGUA POTABLE PERIODICAS M3 (formato ancho: 13 bloques TARIFA/PRECIO BASE/M3 ADICIONAL/TASA)
  {
    const ws = wb.Sheets['AGUA POTABLE PERIODICAS M3'];
    if (!ws) throw new Error('Hoja «AGUA POTABLE PERIODICAS M3» no encontrada');
    const m = matrix(ws);
    const h = findHeaderRow(m, 'ADMINISTRACION');
    const header = m[h];
    const bloques: number[] = [];
    header.forEach((c, i) => {
      if (/^TARIFA \d+$/.test(normalizarNombreTarifa(c))) bloques.push(i);
    });
    const acumulado = new Map<string, TablaAcumulada & { administracionId: string; filas: Map<number, number> }>();
    for (let r = h + 1; r < m.length; r++) {
      const row = m[r];
      if (!row || !row[0]) continue;
      const administracionId = resolverAdministracionId(row[0], advertencias);
      if (!administracionId) continue;
      const m3Raw = row[1];
      const esExcedente = typeof m3Raw === 'string' && m3Raw.replace(/\s/g, '').startsWith('>');
      const m3 = esExcedente ? null : Number(m3Raw);
      if (!esExcedente && !Number.isInteger(m3)) continue;
      for (const b of bloques) {
        const nombreTarifa = row[b];
        if (!nombreTarifa || !String(nombreTarifa).trim()) continue;
        const key = `${administracionId}|${normalizarNombreTarifa(nombreTarifa)}`;
        let acc = acumulado.get(key);
        if (!acc) {
          acc = { administracionId, claseNombre: String(nombreTarifa).trim(), precios: [], cuotaFija: 0, precioUnitario: 0, ivaPct: tasaAPct(row[b + 3]), filas: new Map() };
          acumulado.set(key, acc);
        }
        if (esExcedente) {
          acc.cuotaFija = toNum(row[b + 1]);
          acc.precioUnitario = toNum(row[b + 2]);
        } else {
          acc.filas.set(m3 as number, toNum(row[b + 1]));
        }
      }
    }
    for (const acc of acumulado.values()) {
      const max = Math.max(...acc.filas.keys());
      acc.precios = Array.from({ length: max + 1 }, (_, i) => acc.filas.get(i) ?? 0);
      const clase = claseDe(acc.claseNombre, 'Hoja 1');
      if (!clase) continue;
      push(tablaATarifa({ administracionId: acc.administracionId, tipoServicio: 'agua', concepto: null }, clase, acc, advertencias));
    }
  }

  // ── Hoja 2: AGUA POTABL PERIODICAS M3 FIJAS → lineal (cantidad × proporcional + base), servicio agua
  {
    const ws = wb.Sheets['AGUA POTABL PERIODICAS M3 FIJAS'];
    if (!ws) throw new Error('Hoja «AGUA POTABL PERIODICAS M3 FIJAS» no encontrada');
    const m = matrix(ws);
    const h = findHeaderRow(m, 'ADMINISTRACION');
    for (let r = h + 1; r < m.length; r++) {
      const row = m[r];
      if (!row || !row[0]) continue;
      const administracionId = resolverAdministracionId(row[0], advertencias);
      const clase = claseDe(row[1], 'Hoja 2');
      if (!administracionId || !clase) continue;
      push(linealATarifa({ administracionId, tipoServicio: 'agua', concepto: null }, clase, { ivaPct: tasaAPct(row[2]), cuotaFija: toNum(row[3]), precioUnitario: toNum(row[4]) }, advertencias));
    }
  }

  // ── Hoja 3: AGUA TRATADA PERIODICA POR M3 → tabla, servicio slug(concepto)
  {
    const ws = wb.Sheets['AGUA TRATADA PERIODICA POR M3'];
    if (!ws) throw new Error('Hoja «AGUA TRATADA PERIODICA POR M3» no encontrada');
    const m = matrix(ws);
    const h = findHeaderRow(m, 'ADMINISTRACION');
    const acumulado = new Map<string, TablaAcumulada & { administracionId: string; concepto: string; filas: Map<number, number> }>();
    for (let r = h + 1; r < m.length; r++) {
      const row = m[r];
      if (!row || !row[0]) continue;
      const administracionId = resolverAdministracionId(row[0], advertencias);
      if (!administracionId) continue;
      const concepto = String(row[1]).trim();
      const key = `${administracionId}|${slugServicio(concepto)}|${normalizarNombreTarifa(row[2])}`;
      let acc = acumulado.get(key);
      if (!acc) {
        acc = { administracionId, concepto, claseNombre: String(row[2]).trim(), precios: [], cuotaFija: 0, precioUnitario: 0, ivaPct: tasaAPct(row[3]), filas: new Map() };
        acumulado.set(key, acc);
      }
      const m3Raw = row[4];
      if (typeof m3Raw === 'string' && m3Raw.replace(/\s/g, '').startsWith('>')) {
        acc.cuotaFija = toNum(row[5]);
        acc.precioUnitario = toNum(row[6]);
      } else if (Number.isInteger(Number(m3Raw))) {
        acc.filas.set(Number(m3Raw), toNum(row[5]));
      }
    }
    for (const acc of acumulado.values()) {
      const max = Math.max(...acc.filas.keys());
      acc.precios = Array.from({ length: max + 1 }, (_, i) => acc.filas.get(i) ?? 0);
      const clase = claseDe(acc.claseNombre, 'Hoja 3');
      if (!clase) continue;
      push(tablaATarifa({ administracionId: acc.administracionId, tipoServicio: slugServicio(acc.concepto), concepto: acc.concepto }, clase, acc, advertencias));
    }
  }

  // ── Hoja 4: TARIFAS POR CONCEPTO FIJO → lineal, servicio slug(concepto)
  {
    const ws = wb.Sheets['TARIFAS POR CONCEPTO FIJO'];
    if (!ws) throw new Error('Hoja «TARIFAS POR CONCEPTO FIJO» no encontrada');
    const m = matrix(ws);
    const h = findHeaderRow(m, 'ADMINISTRACION');
    for (let r = h + 1; r < m.length; r++) {
      const row = m[r];
      if (!row || !row[0]) continue;
      const administracionId = resolverAdministracionId(row[0], advertencias);
      const clase = claseDe(row[3], 'Hoja 4');
      if (!administracionId || !clase) continue;
      const concepto = String(row[1]).trim();
      push(
        linealATarifa(
          { administracionId, tipoServicio: slugServicio(concepto), concepto, subconcepto: row[2] ? String(row[2]).trim() : null },
          clase,
          { ivaPct: tasaAPct(row[4]), cuotaFija: toNum(row[5]), precioUnitario: toNum(row[6]) },
          advertencias,
        ),
      );
    }
  }

  // ── Hoja 5: TARIFAS CORRECTORES → CorreccionTarifaria (descuento pensionado) sobre la tarifa de agua de la clase
  {
    const ws = wb.Sheets['TARIFAS CORRECTORES'];
    if (!ws) throw new Error('Hoja «TARIFAS CORRECTORES» no encontrada');
    const m = matrix(ws);
    const h = findHeaderRow(m, 'ADMINISTRACION');
    for (let r = h + 1; r < m.length; r++) {
      const row = m[r];
      if (!row || !row[0]) continue;
      const administracionId = resolverAdministracionId(row[0], advertencias);
      const clase = claseDe(row[3], 'Hoja 5');
      if (!administracionId || !clase) continue;
      const tarifaCodigo = `${administracionId}:agua:${clase.codigo}`;
      if (!codigos.has(tarifaCodigo)) {
        advertencias.push(`Hoja 5: corrector para tarifa inexistente ${tarifaCodigo}`);
        continue;
      }
      const concepto = String(row[1]).trim();
      const corrector = String(row[2]).trim();
      correcciones.push({
        tarifaCodigo,
        tipo: 'descuento',
        descripcion: `${concepto} — ${corrector}`,
        montoFijo: redondear4(toNum(row[4])),
        condiciones: {
          concepto,
          corrector,
          consumoMinM3: /MAYOR DE (\d+)/i.exec(corrector) ? Number(/MAYOR DE (\d+)/i.exec(corrector)![1]) : null,
          precioProporcional: redondear4(toNum(row[5])),
          formula: row[6] ? String(row[6]).trim() : null,
        },
      });
    }
  }

  return {
    fuente: 'docs/Tarifas_periodicas.xlsx (precios a febrero 2026)',
    vigenciaDesde: VIGENCIA_TARIFAS_EXCEL,
    generadoEn: new Date().toISOString(),
    tarifas,
    correcciones,
    advertencias,
  };
}

export function readTarifasPeriodicasPayload(jsonPath: string): TarifasPeriodicasPayload {
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TarifasPeriodicasPayload;
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

export interface SeedTarifasPeriodicasOptions {
  jsonPath?: string;
  /** Ruta al JSON SIGE (para enlazar tipos de contratación por tcttpsid). */
  sigeJsonPath?: string;
  creadoPor?: string;
}

/**
 * Siembra categorías, clases y tarifas del Excel. Idempotente y no destructivo:
 * - categorías/clases: se crean solo si no existen (no pisa IVA/nombres editados desde el configurador);
 * - tarifas: se da de alta el linaje (codigo) solo si NO existe ninguna versión → nunca reescribe histórico;
 * - correcciones: se crean si no existe una con la misma descripción sobre la versión vigente;
 * - tipos de contratación: se enlaza `claseTarifaId` solo cuando está vacío.
 */
export async function seedTarifasPeriodicas(prisma: PrismaClient, options: SeedTarifasPeriodicasOptions = {}): Promise<void> {
  const creadoPor = options.creadoPor ?? 'seed';

  // 1) Categorías
  const categoriaId = new Map<string, string>();
  for (const c of CATEGORIAS_TARIFA) {
    const existente = await prisma.categoriaTarifa.findUnique({ where: { codigo: c.codigo }, select: { id: true } });
    const row = existente ?? (await prisma.categoriaTarifa.create({ data: { codigo: c.codigo, nombre: c.nombre, descripcion: c.descripcion, ivaPct: c.ivaPct, orden: c.orden }, select: { id: true } }));
    categoriaId.set(c.codigo, row.id);
  }

  // 2) Clases
  const claseId = new Map<string, string>();
  for (const c of CLASES_TARIFA) {
    const existente = await prisma.claseTarifa.findUnique({ where: { codigo: c.codigo }, select: { id: true } });
    const row =
      existente ??
      (await prisma.claseTarifa.create({
        data: {
          codigo: c.codigo,
          nombre: c.nombre,
          categoriaId: categoriaId.get(c.categoria)!,
          ivaPct: c.ivaPct ?? null,
          sigeTpsId: c.sigeTpsId ?? null,
          orden: c.orden,
        },
        select: { id: true },
      }));
    claseId.set(c.codigo, row.id);
  }
  console.log(`[tarifas] Categorías: ${categoriaId.size}, clases: ${claseId.size}`);

  // 3) Tarifas del Excel (JSON versionado)
  const jsonPath = options.jsonPath ?? process.env.TARIFAS_PERIODICAS_JSON ?? defaultTarifasPeriodicasJsonPath();
  if (!fs.existsSync(jsonPath)) {
    console.warn(`[tarifas] No existe ${jsonPath}; se omite la carga de tarifas del Excel (npm run export:tarifas-periodicas-json).`);
  } else {
    const payload = readTarifasPeriodicasPayload(jsonPath);
    const vigenciaDesde = new Date(`${payload.vigenciaDesde}T00:00:00`);
    const existentes = new Set(
      (await prisma.tarifa.findMany({ where: { codigo: { in: payload.tarifas.map((t) => t.codigo) } }, select: { codigo: true }, distinct: ['codigo'] })).map((t) => t.codigo),
    );
    const nuevas = payload.tarifas.filter((t) => !existentes.has(t.codigo));
    let creadas = 0;
    for (let i = 0; i < nuevas.length; i += 25) {
      const lote = nuevas.slice(i, i + 25);
      await prisma.$transaction(async (tx) => {
        for (const t of lote) {
          const tarifa = await tx.tarifa.create({
            data: {
              codigo: t.codigo,
              nombre: t.nombre,
              tipoServicio: t.tipoServicio,
              tipoCalculo: t.tipoCalculo,
              administracionId: t.administracionId,
              claseTarifaId: claseId.get(t.claseCodigo) ?? null,
              concepto: t.concepto,
              rangoMinM3: t.rangoMinM3,
              rangoMaxM3: t.rangoMaxM3,
              cuotaFija: t.cuotaFija,
              precioUnitario: t.precioUnitario,
              precios: t.precios ?? undefined,
              valorReferencia: valorReferencia(t),
              ivaPct: t.ivaPct,
              vigenciaDesde,
              version: 1,
              motivo: `Carga inicial: ${payload.fuente}`,
              creadoPor,
            },
          });
          await tx.tarifaMovimiento.create({
            data: {
              codigo: t.codigo,
              tarifaId: tarifa.id,
              tipo: TIPOS_MOVIMIENTO.ALTA,
              valoresNuevos: snapshotValores(tarifa) as object,
              vigenciaDesde,
              motivo: `Carga inicial: ${payload.fuente}`,
              usuarioEmail: creadoPor,
            },
          });
          creadas++;
        }
      });
    }
    console.log(`[tarifas] Tarifas del Excel: ${payload.tarifas.length} en JSON, ${creadas} nuevas, ${existentes.size} ya existentes.`);

    // 4) Correcciones (descuento pensionado) sobre la versión vigente del linaje
    let corrCreadas = 0;
    for (const c of payload.correcciones) {
      const vigente = await prisma.tarifa.findFirst({ where: { codigo: c.tarifaCodigo, activo: true }, orderBy: { version: 'desc' }, select: { id: true } });
      if (!vigente) continue;
      const dup = await prisma.correccionTarifaria.findFirst({ where: { tarifaId: vigente.id, descripcion: c.descripcion }, select: { id: true } });
      if (dup) continue;
      await prisma.correccionTarifaria.create({
        data: { tarifaId: vigente.id, tipo: c.tipo, descripcion: c.descripcion, montoFijo: c.montoFijo, condiciones: c.condiciones as object },
      });
      corrCreadas++;
    }
    if (payload.correcciones.length) console.log(`[tarifas] Correcciones: ${corrCreadas} nuevas de ${payload.correcciones.length}.`);
  }

  // 5) Enlace tipos de contratación → clase (solo los que no tienen clase)
  const tpsPorCodigoTipo = new Map<string, number>();
  const sigeJsonPath = options.sigeJsonPath ?? process.env.SIGE_CATALOGOS_JSON ?? resolveDataFile('catalogos-tipos-contratacion-sige.json');
  if (fs.existsSync(sigeJsonPath)) {
    const sige = JSON.parse(fs.readFileSync(sigeJsonPath, 'utf8')) as { tiposConMedidor?: Record<string, unknown>[]; tiposSinMedidor?: Record<string, unknown>[] };
    for (const t of [...(sige.tiposConMedidor ?? []), ...(sige.tiposSinMedidor ?? [])]) {
      const tps = Number(t.tcttpsid);
      if (t.tctcod != null && Number.isFinite(tps)) tpsPorCodigoTipo.set(`TCT-${t.tctcod}`, tps);
    }
  }
  const clasePorTps = new Map<number, string>();
  for (const c of CLASES_TARIFA) if (c.sigeTpsId != null) clasePorTps.set(c.sigeTpsId, c.codigo);

  const sinClase = await prisma.tipoContratacion.findMany({ where: { claseTarifaId: null }, select: { id: true, codigo: true, nombre: true } });
  let enlazados = 0;
  const sinResolver: string[] = [];
  for (const tipo of sinClase) {
    const tps = tpsPorCodigoTipo.get(tipo.codigo);
    const claseCodigo = (tps != null ? clasePorTps.get(tps) : undefined) ?? resolverClaseDesdeTipoContratacion(tipo.nombre)?.codigo;
    const id = claseCodigo ? claseId.get(claseCodigo) : undefined;
    if (!id) {
      sinResolver.push(`${tipo.codigo} "${tipo.nombre}"`);
      continue;
    }
    await prisma.tipoContratacion.update({ where: { id: tipo.id }, data: { claseTarifaId: id } });
    enlazados++;
  }
  console.log(`[tarifas] Tipos de contratación enlazados a clase: ${enlazados}; sin resolver: ${sinResolver.length}`);
  if (sinResolver.length) console.log(`[tarifas]   Sin clase: ${sinResolver.slice(0, 10).join('; ')}${sinResolver.length > 10 ? ' …' : ''}`);
}
