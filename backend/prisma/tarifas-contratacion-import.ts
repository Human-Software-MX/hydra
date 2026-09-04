/**
 * Catálogo de tarifas de contratación (docs/Tarifas_contratacion.xlsx, precios a febrero 2026):
 * cargos únicos al contratar (derechos de conexión, contratación, infraestructura, medidor, inspecciones,
 * multas, recargos…). Mismo flujo que las periódicas:
 *   Excel → `npm run export:tarifas-contratacion-json` → prisma/data/tarifas-contratacion.json → seed idempotente.
 *
 * Particularidades del libro:
 *   - La columna TARIFA está sobrecargada: puede ser una clase (DOMÉSTICA MEDIO…), una combinación de
 *     materiales calle-banqueta (CONCRETO-CONCRETO…) o el genérico «CONTRATACION». Las clases se enlazan a
 *     `ClaseTarifa`; las demás se guardan en `Tarifa.variante`.
 *   - La TASA varía dentro de una misma clase según el concepto (AGUA (CONTRATACIÓN) doméstica 0 %, derechos
 *     16 %) y existe «No Objeto» (MULTA, RECARGOS): el IVA se toma fila a fila (`ivaPct` + `ivaNoObjeto`) y
 *     NO se hereda de la clase.
 *   - Hoja «longitud»: la base cubre los primeros 6 m y el excedente se cobra a precio proporcional →
 *     `tipoCalculo = lineal_excedente` con `parametros.cantidadIncluida = 6`.
 *   - Las filas de DERECHOS DE CONEXIÓN A RED DE AGUA de la hoja CONCEPTO FIJO duplican la hoja de longitud:
 *     se conserva la de longitud (trae la variable) y se omite la duplicada.
 */
import * as fs from 'fs';
import type { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { resolveDataFile } from './data-dir';
import {
  findHeaderRow,
  matrix,
  normalizarNombreTarifa,
  resolverAdministracionId,
  resolverClasePorNombre,
  slugServicio,
  tasaAPct,
  toNum,
} from './tarifas-periodicas-import';
import {
  redondear4,
  snapshotValores,
  TIPOS_MOVIMIENTO,
  ValoresTarifa,
  valorReferencia,
} from '../src/modules/tarifas/tarifa-valores';

export const VIGENCIA_TARIFAS_CONTRATACION_EXCEL = '2026-02-01';
export const SECCION_CONTRATACION = 'CONTRATACION';

export interface TarifaContratacionPayloadRow extends ValoresTarifa {
  codigo: string;
  nombre: string;
  administracionId: string;
  /** Clase tarifaria cuando la columna TARIFA es una clase; null para materiales/genérico. */
  claseCodigo: string | null;
  /** Variable cuando TARIFA/VARIABLE no es una clase (materiales, diámetro, plan de pago). */
  variante: string | null;
  tipoServicio: string;
  concepto: string;
  parametros: Record<string, unknown> | null;
  ivaNoObjeto: boolean;
}

export interface TarifasContratacionPayload {
  fuente: string;
  vigenciaDesde: string;
  generadoEn: string;
  tarifas: TarifaContratacionPayloadRow[];
  advertencias: string[];
}

export function defaultTarifasContratacionJsonPath(): string {
  return resolveDataFile('tarifas-contratacion.json');
}

/** Quita el sufijo «(CONTRATACIÓN)» y espacios sobrantes del nombre del concepto. */
export function conceptoBase(concepto: unknown): string {
  return String(concepto ?? '')
    .replace(/\s*\(\s*CONTRATACI[OÓ]N\s*\)\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nombre presentable de una variante (recorta el texto de la variable a 60 caracteres). */
function etiquetaVariante(v: string): string {
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

function tasaFila(v: unknown): { ivaPct: number; ivaNoObjeto: boolean } {
  if (typeof v === 'string' && /no\s*objeto/i.test(v)) return { ivaPct: 0, ivaNoObjeto: true };
  return { ivaPct: tasaAPct(v), ivaNoObjeto: false };
}

interface FilaBase {
  administracionId: string;
  concepto: string;
  subconcepto: string | null;
  tarifaCol: string;
  variable: string | null;
  ivaPct: number;
  ivaNoObjeto: boolean;
  cuotaFija: number;
  precioUnitario: number;
  tipoCalculo: 'lineal' | 'lineal_excedente';
  cantidadIncluida: number | null;
  consumoAsignadoM3: number | null;
}

function filaATarifa(f: FilaBase): TarifaContratacionPayloadRow {
  const clase = resolverClasePorNombre(f.tarifaCol);
  const esGenerica = normalizarNombreTarifa(f.tarifaCol) === 'CONTRATACION';
  // Clase → sin variante (la VARIABLE, si existe, queda como parámetro).
  // Genérico «CONTRATACION» → la VARIABLE es la variante (diámetro, plan de pago).
  // Otro texto (materiales calle-banqueta) → la propia columna TARIFA es la variante.
  const variante = clase ? null : esGenerica ? (f.variable?.trim() || null) : f.tarifaCol.trim();
  const sufijo = clase ? clase.codigo : variante ? slugServicio(variante).toUpperCase() : 'GENERAL';
  const concepto = conceptoBase(f.concepto);
  // Prefijo para no colisionar con los servicios periódicos (p. ej. «AGUA (CONTRATACIÓN)» vs `agua`)
  // y para que SERVICIOS_FACTURABLES de facturación periódica nunca los seleccione.
  const tipoServicio = `contratacion_${slugServicio(concepto)}`;
  const parametros: Record<string, unknown> = {};
  if (f.consumoAsignadoM3 != null) parametros.consumoAsignadoM3 = f.consumoAsignadoM3;
  if (f.cantidadIncluida != null) parametros.cantidadIncluida = f.cantidadIncluida;
  if (f.variable && f.variable.trim() !== variante) parametros.variable = f.variable.trim();
  if (f.subconcepto && normalizarNombreTarifa(f.subconcepto) !== normalizarNombreTarifa(concepto)) {
    parametros.subconcepto = f.subconcepto.trim();
  }
  const etiqueta = clase ? clase.nombre : variante ? etiquetaVariante(variante) : 'General';
  return {
    codigo: `${f.administracionId}:${tipoServicio}:${sufijo}`,
    nombre: `${concepto} · ${etiqueta}`,
    administracionId: f.administracionId,
    claseCodigo: clase?.codigo ?? null,
    variante,
    tipoServicio,
    concepto,
    parametros: Object.keys(parametros).length ? parametros : null,
    ivaNoObjeto: f.ivaNoObjeto,
    tipoCalculo: f.tipoCalculo,
    rangoMinM3: null,
    rangoMaxM3: null,
    cuotaFija: redondear4(f.cuotaFija),
    precioUnitario: redondear4(f.precioUnitario),
    precios: null,
    ivaPct: f.ivaPct,
  };
}

/** Lee el Excel completo y devuelve el payload que se guarda en JSON. */
export function buildTarifasContratacionPayloadFromXlsx(xlsxPath: string): TarifasContratacionPayload {
  const wb = XLSX.readFile(xlsxPath);
  const advertencias: string[] = [];
  const tarifas: TarifaContratacionPayloadRow[] = [];
  const codigos = new Set<string>();
  let duplicadas = 0;
  const push = (t: TarifaContratacionPayloadRow) => {
    if (codigos.has(t.codigo)) {
      duplicadas++;
      return;
    }
    codigos.add(t.codigo);
    tarifas.push(t);
  };
  const hoja = (nombre: string): unknown[][] => {
    const ws = wb.Sheets[nombre];
    if (!ws) throw new Error(`Hoja «${nombre}» no encontrada`);
    return matrix(ws);
  };

  // ── VARIABLES longitud: ADMIN, CONCEPTO, VARIABLE, TARIFA(materiales), TASA, BASE, PROPORCIONAL, cantidad, FÓRMULA
  {
    const m = hoja('TARIFAS POR VARIABLES longitud.');
    const h = findHeaderRow(m, 'ADMINISTRACION');
    for (let r = h + 1; r < m.length; r++) {
      const row = m[r];
      if (!row || !row[0]) continue;
      const administracionId = resolverAdministracionId(row[0], advertencias);
      if (!administracionId) continue;
      const cantidad = String(row[7] ?? '');
      const incluida = /excedente de (\d+)/i.exec(cantidad);
      const tasa = tasaFila(row[4]);
      push(
        filaATarifa({
          administracionId,
          concepto: String(row[1]),
          subconcepto: null,
          tarifaCol: String(row[3]),
          variable: row[2] ? String(row[2]) : null,
          ...tasa,
          cuotaFija: toNum(row[5]),
          precioUnitario: toNum(row[6]),
          tipoCalculo: 'lineal_excedente',
          cantidadIncluida: incluida ? Number(incluida[1]) : 6,
          consumoAsignadoM3: null,
        }),
      );
    }
  }

  // ── VARIABLES diámetro: ADMIN, CONCEPTO, VARIABLE, TARIFA(CONTRATACION), TASA, BASE, PROPORCIONAL, FÓRMULA
  {
    const m = hoja('TARIFAS POR VARIABLES diametro');
    const h = findHeaderRow(m, 'ADMINISTRACION');
    for (let r = h + 1; r < m.length; r++) {
      const row = m[r];
      if (!row || !row[0]) continue;
      const administracionId = resolverAdministracionId(row[0], advertencias);
      if (!administracionId) continue;
      const tasa = tasaFila(row[4]);
      push(
        filaATarifa({
          administracionId,
          concepto: String(row[1]),
          subconcepto: null,
          tarifaCol: String(row[3]),
          variable: row[2] ? String(row[2]) : null,
          ...tasa,
          cuotaFija: toNum(row[5]),
          precioUnitario: toNum(row[6]),
          tipoCalculo: 'lineal',
          cantidadIncluida: null,
          consumoAsignadoM3: null,
        }),
      );
    }
  }

  // ── CONCEPTO FIJO: ADMIN, CONCEPTO, SUBCONCEPTO, TARIFA, TASA, BASE, PROPORCIONAL, CONSUMO ASIGNADO, FÓRMULA
  {
    const m = hoja('TARIFAS POR CONCEPTO FIJO');
    const h = findHeaderRow(m, 'ADMINISTRACION');
    for (let r = h + 1; r < m.length; r++) {
      const row = m[r];
      if (!row || !row[0]) continue;
      const administracionId = resolverAdministracionId(row[0], advertencias);
      if (!administracionId) continue;
      const tasa = tasaFila(row[4]);
      const consumo = row[7] != null && row[7] !== '' ? toNum(row[7]) : null;
      push(
        filaATarifa({
          administracionId,
          concepto: String(row[1]),
          subconcepto: row[2] ? String(row[2]) : null,
          tarifaCol: String(row[3]),
          variable: null,
          ...tasa,
          cuotaFija: toNum(row[5]),
          precioUnitario: toNum(row[6]),
          tipoCalculo: 'lineal',
          cantidadIncluida: null,
          consumoAsignadoM3: consumo,
        }),
      );
    }
  }

  if (duplicadas) advertencias.push(`${duplicadas} filas duplicadas entre hojas (mismo linaje); se conservó la primera.`);

  return {
    fuente: 'docs/Tarifas_contratacion.xlsx (precios a febrero 2026)',
    vigenciaDesde: VIGENCIA_TARIFAS_CONTRATACION_EXCEL,
    generadoEn: new Date().toISOString(),
    tarifas,
    advertencias,
  };
}

export function readTarifasContratacionPayload(jsonPath: string): TarifasContratacionPayload {
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as TarifasContratacionPayload;
}

export interface SeedTarifasContratacionOptions {
  jsonPath?: string;
  creadoPor?: string;
}

/**
 * Siembra las tarifas de contratación. Idempotente: solo da de alta linajes (codigo) inexistentes;
 * nunca reescribe versiones. Requiere que categorías/clases ya existan (seedTarifasPeriodicas).
 */
export async function seedTarifasContratacion(prisma: PrismaClient, options: SeedTarifasContratacionOptions = {}): Promise<void> {
  const creadoPor = options.creadoPor ?? 'seed';
  const jsonPath = options.jsonPath ?? process.env.TARIFAS_CONTRATACION_JSON ?? defaultTarifasContratacionJsonPath();
  if (!fs.existsSync(jsonPath)) {
    console.warn(`[tarifas] No existe ${jsonPath}; se omite la carga de tarifas de contratación (npm run export:tarifas-contratacion-json).`);
    return;
  }
  const payload = readTarifasContratacionPayload(jsonPath);
  const vigenciaDesde = new Date(`${payload.vigenciaDesde}T00:00:00Z`);
  const clases = await prisma.claseTarifa.findMany({ select: { id: true, codigo: true } });
  const claseId = new Map(clases.map((c) => [c.codigo, c.id]));
  const existentes = new Set(
    (await prisma.tarifa.findMany({ where: { codigo: { in: payload.tarifas.map((t) => t.codigo) } }, select: { codigo: true }, distinct: ['codigo'] })).map((t) => t.codigo),
  );
  const nuevas = payload.tarifas.filter((t) => !existentes.has(t.codigo));
  let creadas = 0;
  const sinClase: string[] = [];
  for (let i = 0; i < nuevas.length; i += 25) {
    const lote = nuevas.slice(i, i + 25);
    await prisma.$transaction(async (tx) => {
      for (const t of lote) {
        if (t.claseCodigo && !claseId.has(t.claseCodigo)) sinClase.push(t.claseCodigo);
        const tarifa = await tx.tarifa.create({
          data: {
            codigo: t.codigo,
            nombre: t.nombre,
            tipoServicio: t.tipoServicio,
            tipoCalculo: t.tipoCalculo,
            administracionId: t.administracionId,
            claseTarifaId: t.claseCodigo ? (claseId.get(t.claseCodigo) ?? null) : null,
            concepto: t.concepto,
            seccion: SECCION_CONTRATACION,
            variante: t.variante,
            parametros: (t.parametros ?? undefined) as object | undefined,
            ivaNoObjeto: t.ivaNoObjeto,
            rangoMinM3: null,
            rangoMaxM3: null,
            cuotaFija: t.cuotaFija,
            precioUnitario: t.precioUnitario,
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
  console.log(`[tarifas] Tarifas de contratación: ${payload.tarifas.length} en JSON, ${creadas} nuevas, ${existentes.size} ya existentes.`);
  if (sinClase.length) console.warn(`[tarifas]   Clases no encontradas (tarifas creadas sin clase): ${[...new Set(sinClase)].join(', ')}`);
}
