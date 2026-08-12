/**
 * Importa administraciones y tipos de contratación SIGE.
 * Orden de fuentes: 1) JSON versionado en prisma/data, 2) Excel local (dev), 3) respaldo de administraciones.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { administracionExcluidaDelSelector } from '../src/common/administraciones-selector-excluidas';
import { resolveDataFile } from './data-dir';

/** IDs estables alineados a expid (1–13) del catálogo SIGE. */
export function expIdToAdministracionId(expId: number): string {
  if (!Number.isFinite(expId) || expId < 1 || expId > 99) {
    throw new Error(`expid administración fuera de rango: ${expId}`);
  }
  return `EXP-${String(expId).padStart(2, '0')}`;
}

/** Respaldo si no hay JSON ni xlsx (CI o checkout parcial). Debe coincidir con la hoja «administracion». */
export const FALLBACK_ADMINISTRACIONES: { id: string; nombre: string }[] = [
  { id: 'EXP-01', nombre: 'QUERÉTARO' },
  { id: 'EXP-02', nombre: 'SANTA ROSA JÁUREGUI' },
  { id: 'EXP-03', nombre: 'CORREGIDORA' },
  { id: 'EXP-04', nombre: 'PEDRO ESCOBEDO' },
  { id: 'EXP-05', nombre: 'TEQUISQUIAPAN' },
  { id: 'EXP-06', nombre: 'EZEQUIEL MONTES' },
  { id: 'EXP-07', nombre: 'AMEALCO DE BONFIL' },
  { id: 'EXP-08', nombre: 'HUIMILPAN' },
  { id: 'EXP-09', nombre: 'CADEREYTA DE MONTES-SAN JOAQUÍN' },
  { id: 'EXP-10', nombre: 'COLÓN-TOLIMÁN' },
  { id: 'EXP-11', nombre: 'JALPAN DE SERRA-LANDA DE MATAMOROS-ARROYO SECO' },
  { id: 'EXP-12', nombre: 'EL MARQUÉS' },
  { id: 'EXP-13', nombre: 'PINAL DE AMOLES-PEÑAMILLER' },
];

const STUB_TIPOS_LEGACY = ['DOM_HAB', 'COM', 'IND', 'GOB', 'MIXTO'] as const;

/** Payload del archivo `prisma/data/catalogos-tipos-contratacion-sige.json`. */
export type CatalogosTiposContratacionPayload = {
  administraciones: { expid: number; nombre: string }[];
  tiposConMedidor: Record<string, unknown>[];
  tiposSinMedidor: Record<string, unknown>[];
};

export function defaultCatalogosJsonPath(): string {
  return resolveDataFile('catalogos-tipos-contratacion-sige.json');
}

/** Ruta por defecto al Excel legacy (solo desarrollo / regeneración JSON). */
export function defaultSigeCatalogosXlsxPath(): string {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '_DocumentacIon_Interna_Sistema_Anterior',
    'Gestion Servicio',
    'Contratos',
    'Catálogos de tipos contratacion.xlsx',
  );
}

function matrixFindHeaderRow(matrix: unknown[][], key: string): number {
  const idx = matrix.findIndex((r) => r && r[0] === key);
  if (idx === -1) throw new Error(`No se encontró la fila de encabezado con primera columna "${key}"`);
  return idx;
}

export function parseTipoRows(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
  const hdrIdx = matrixFindHeaderRow(matrix, 'tctcod');
  const headers = matrix[hdrIdx] as string[];
  const out: Record<string, unknown>[] = [];
  for (let i = hdrIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] as unknown[];
    const tct = row[0];
    if (tct === null || tct === undefined || String(tct).trim() === '') continue;
    const obj: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (h && String(h).trim() !== '') obj[String(h)] = row[j];
    }
    out.push(obj);
  }
  return out;
}

export function parseAdministracionesSheet(sheet: XLSX.WorkSheet): { expid: number; nombre: string }[] {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
  const hdrIdx = matrixFindHeaderRow(matrix, 'expid');
  const out: { expid: number; nombre: string }[] = [];
  for (let i = hdrIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] as unknown[];
    const rawId = row[0];
    const nombre = row[1];
    if (rawId === null || rawId === undefined || String(rawId).trim() === '') break;
    const expid = typeof rawId === 'number' ? rawId : parseInt(String(rawId), 10);
    if (!Number.isFinite(expid)) continue;
    out.push({ expid, nombre: String(nombre ?? '').trim() });
  }
  return out;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function activoFromSn(v: unknown): boolean {
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'S' || s === '1' || s === 'SI';
}

/**
 * Orden para vínculos cláusula–tipo a partir del código HYDRA_NN_…
 */
export function ordenFromHydraCodigo(codigo: string): number {
  const m = /^HYDRA_(\d+)_/i.exec(codigo);
  return m ? parseInt(m[1], 10) : 0;
}

/** Vincular todas las cláusulas Hydra existentes a todos los tipos de contratación. */
export async function linkHydraClausulasToAllTipos(prisma: PrismaClient): Promise<void> {
  const tipos = await prisma.tipoContratacion.findMany({ select: { id: true, codigo: true } });
  const clausulasDb = await prisma.clausulaContractual.findMany({
    where: { codigo: { startsWith: 'HYDRA_' } },
    select: { id: true, codigo: true },
  });
  let linkCount = 0;
  for (const tipo of tipos) {
    for (const cl of clausulasDb) {
      const orden = ordenFromHydraCodigo(cl.codigo);
      await prisma.clausulaTipoContratacion.upsert({
        where: { tipoContratacionId_clausulaId: { tipoContratacionId: tipo.id, clausulaId: cl.id } },
        update: { orden },
        create: { tipoContratacionId: tipo.id, clausulaId: cl.id, obligatorio: true, orden },
      });
      linkCount++;
    }
  }
  console.log(`Vínculos cláusula→tipo (Hydra): ${linkCount} (${tipos.length} tipos × ${clausulasDb.length} cláusulas)`);
}

async function upsertAdministraciones(
  prisma: PrismaClient,
  rows: { expid: number; nombre: string }[],
): Promise<void> {
  const aplicables = rows.filter((r) => !administracionExcluidaDelSelector(r.nombre));
  const omitidas = rows.length - aplicables.length;
  if (omitidas > 0) {
    console.warn(
      `[catalogos] Se omiten ${omitidas} administración(es) que no corresponden al listado municipal (selector).`,
    );
  }
  for (const r of aplicables) {
    const id = expIdToAdministracionId(r.expid);
    await prisma.administracion.upsert({
      where: { id },
      update: { nombre: r.nombre },
      create: { id, nombre: r.nombre },
    });
  }
  console.log(`Administraciones (catálogo SIGE): ${aplicables.length} registros`);
}

function readPayloadFromJsonFile(jsonPath: string): CatalogosTiposContratacionPayload {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw) as unknown;
  if (!data || typeof data !== 'object') throw new Error('JSON inválido: raíz debe ser un objeto');
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.administraciones)) throw new Error('JSON inválido: falta array "administraciones"');
  const administraciones = o.administraciones as { expid: number; nombre: string }[];
  const tiposConMedidor = Array.isArray(o.tiposConMedidor)
    ? (o.tiposConMedidor as Record<string, unknown>[])
    : [];
  const tiposSinMedidor = Array.isArray(o.tiposSinMedidor)
    ? (o.tiposSinMedidor as Record<string, unknown>[])
    : [];
  return { administraciones, tiposConMedidor, tiposSinMedidor };
}

async function upsertTiposFromRows(
  prisma: PrismaClient,
  rowsCon: Record<string, unknown>[],
  rowsSin: Record<string, unknown>[],
  removeLegacyStubTipos: boolean | undefined,
): Promise<void> {
  const clasesMap = new Map<string, string>();
  const clasesRows = await prisma.claseContrato.findMany({ select: { id: true, codigo: true } });
  for (const c of clasesRows) clasesMap.set(c.codigo, c.id);

  if (removeLegacyStubTipos !== false) {
    await prisma.tipoContratacion.deleteMany({
      where: { codigo: { in: [...STUB_TIPOS_LEGACY] } },
    });
  }

  async function upsertTipoBatch(
    rows: Record<string, unknown>[],
    requiereMedidor: boolean,
    label: string,
  ): Promise<number> {
    let n = 0;
    for (const raw of rows) {
      const tctcod = num(raw['tctcod']);
      if (tctcod === null) continue;
      const nombre = String(raw['tipo_contratacion'] ?? '').trim();
      if (!nombre) continue;
      const expid = num(raw['tctexpid']);
      if (expid === null) continue;
      const codigo = `TCT-${tctcod}`;
      const clsccod = String(raw['tctclsccod'] ?? '').trim();
      const claseContratoId = clsccod ? clasesMap.get(clsccod) ?? null : null;
      const administracionId = expIdToAdministracionId(Math.round(expid));
      const activo = activoFromSn(raw['tctsnactivo']);

      await prisma.tipoContratacion.upsert({
        where: { codigo },
        update: {
          nombre,
          activo,
          requiereMedidor,
          administracionId,
          claseContratoId,
        },
        create: {
          codigo,
          nombre,
          activo,
          requiereMedidor,
          administracionId,
          claseContratoId,
        },
      });
      n++;
    }
    console.log(`Tipos de contratación (${label}): ${n} filas`);
    return n;
  }

  await upsertTipoBatch(rowsCon, true, 'con medidor');
  await upsertTipoBatch(rowsSin, false, 'sin medidor');
}

async function importFromPayload(
  prisma: PrismaClient,
  payload: CatalogosTiposContratacionPayload,
  options: ImportCatalogosOptions,
): Promise<void> {
  if (payload.administraciones.length === 0) {
    throw new Error('[catalogos] El payload no contiene administraciones');
  }
  await upsertAdministraciones(prisma, payload.administraciones);
  const totalTipos = payload.tiposConMedidor.length + payload.tiposSinMedidor.length;
  if (totalTipos === 0) {
    console.warn(
      '[catalogos] Payload sin filas de tipos (tiposConMedidor / tiposSinMedidor vacíos). ' +
        'Regenera el JSON con: npm run export:catalogos-tipos-sige-json -- "<ruta-al.xlsx>"',
    );
  }
  await upsertTiposFromRows(
    prisma,
    payload.tiposConMedidor,
    payload.tiposSinMedidor,
    options.removeLegacyStubTipos,
  );
}

export type ImportCatalogosOptions = {
  /** Ruta al JSON versionado; por defecto prisma/data/catalogos-tipos-contratacion-sige.json */
  jsonPath?: string;
  /** Ruta al xlsx (solo si no se usa JSON o forzarExcel). */
  xlsxPath?: string;
  /** Si true, ignora JSON y usa solo Excel (regeneración / pruebas). */
  forzarExcel?: boolean;
  /** Elimina los 5 tipos stub del seed anterior (DOM_HAB, COM, …) */
  removeLegacyStubTipos?: boolean;
};

/**
 * Importa administraciones + tipos: JSON (repo) → Excel (dev) → respaldo administraciones.
 */
export async function importCatalogosTiposContratacion(
  prisma: PrismaClient,
  options: ImportCatalogosOptions = {},
): Promise<void> {
  const jsonPath = options.jsonPath ?? process.env.SIGE_CATALOGOS_JSON ?? defaultCatalogosJsonPath();
  const xlsxPath = options.xlsxPath ?? process.env.SIGE_CATALOGOS_XLSX ?? defaultSigeCatalogosXlsxPath();

  if (!options.forzarExcel && fs.existsSync(jsonPath)) {
    console.log(`[catalogos] Cargando catálogo SIGE desde JSON: ${jsonPath}`);
    const payload = readPayloadFromJsonFile(jsonPath);
    await importFromPayload(prisma, payload, options);
    return;
  }

  if (fs.existsSync(xlsxPath)) {
    console.log(`[catalogos] Cargando catálogo SIGE desde Excel: ${xlsxPath}`);
    const wb = XLSX.readFile(xlsxPath);
    const adminSheet = wb.Sheets['administracion'];
    if (!adminSheet) throw new Error('Hoja «administracion» no encontrada en el libro');
    const admins = parseAdministracionesSheet(adminSheet);
    const sheetCon = wb.Sheets['tipos de contratacion'];
    const sheetSin = wb.Sheets['tipos de contratacion sin medid'];
    if (!sheetCon) throw new Error('Hoja «tipos de contratacion» no encontrada');
    if (!sheetSin) throw new Error('Hoja «tipos de contratacion sin medid» no encontrada');
    const rowsCon = parseTipoRows(sheetCon);
    const rowsSin = parseTipoRows(sheetSin);
    await importFromPayload(prisma, { administraciones: admins, tiposConMedidor: rowsCon, tiposSinMedidor: rowsSin }, options);
    return;
  }

  console.warn(
    `[catalogos] No hay JSON (${jsonPath}) ni Excel (${xlsxPath}). ` +
      `Se usan solo administraciones embebidas y no se importan tipos. ` +
      `Para producción: genera y commitea el JSON (npm run export:catalogos-tipos-sige-json).`,
  );
  for (const a of FALLBACK_ADMINISTRACIONES) {
    await prisma.administracion.upsert({
      where: { id: a.id },
      update: { nombre: a.nombre },
      create: a,
    });
  }
}

/** Lee el Excel SIGE y devuelve el mismo payload que se guarda en JSON (para script de exportación). */
export function buildCatalogosPayloadFromXlsx(xlsxPath: string): CatalogosTiposContratacionPayload {
  const wb = XLSX.readFile(xlsxPath);
  const adminSheet = wb.Sheets['administracion'];
  if (!adminSheet) throw new Error('Hoja «administracion» no encontrada en el libro');
  const sheetCon = wb.Sheets['tipos de contratacion'];
  const sheetSin = wb.Sheets['tipos de contratacion sin medid'];
  if (!sheetCon) throw new Error('Hoja «tipos de contratacion» no encontrada');
  if (!sheetSin) throw new Error('Hoja «tipos de contratacion sin medid» no encontrada');
  return {
    administraciones: parseAdministracionesSheet(adminSheet),
    tiposConMedidor: parseTipoRows(sheetCon),
    tiposSinMedidor: parseTipoRows(sheetSin),
  };
}
