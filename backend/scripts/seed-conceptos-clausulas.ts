/**
 * Importa desde el catálogo SIGE (JSON versionado en prisma/data/conceptos-clausulas-sige.json):
 *  1. Catálogo de conceptos de contratación (21, con tconid y clasificación fiscal)
 *  2. Conceptos referenciados en relaciones pero ausentes del catálogo (se crean con aviso)
 *  3. Conceptos periódicos de lecturas (8: AGUA, SANEAMIENTO, ALCANTARILLADO y especiales)
 *  4. Relación tipo de contratación ↔ concepto (contratación: 2 420 filas; lecturas: 344)
 *  5. Cláusulas contractuales (125 con texto completo) y su vínculo por tipo (5 309)
 *
 * A diferencia del mapeo de documentos, ESTAS RELACIONES SÍ SON REALES en SIGE
 * (varían por administración: zonas sin drenaje no cobran alcantarillado, etc.).
 *
 * Idempotente: upsert por claves naturales (sigeTconId / codigo / pares únicos).
 * La columna `tarifa` de la relación de lecturas NO se persiste aquí: ese enlace ya
 * está modelado por TipoContratacion.claseTarifaId (seed de tarifas periódicas).
 *
 * Uso: npm run seed:conceptos-clausulas
 */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { resolveDataFile } from '../prisma/data-dir';

const prisma = new PrismaClient();

type Payload = {
  conceptosCatalogo: { tconid: number; nombre: string; origen: string; clasificacionIva: string | null }[];
  relacionContratacion: { tctcod: number; concepto: string }[];
  relacionLecturas: { tctcod: number; concepto: string; tarifa: string | null }[];
  clausulas: { clauid: number; titulo: string; aplicaPuntoServicio: boolean; contenido: string }[];
  clausulasVinculos: { tctcod: number; clauid: number }[];
};

/** Normaliza nombres para casar relación ↔ catálogo (acentos, espacios, paréntesis). */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\(/g, ' (')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(s: string): string {
  return norm(s)
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Tipo de cálculo según lo definido en la junta 02-sep: saneamiento/alcantarillado
 *  son % del agua; el agua periódica es variable por consumo; el resto cuota fija. */
function tipoCalculo(nombre: string): string {
  const n = norm(nombre);
  if (n.startsWith('SANEAMIENTO') || n.startsWith('ALCANTARILLADO') || n.startsWith('TRATAMIENTO')) return 'porcentual';
  if (n === 'AGUA' || n.startsWith('AGUA (') || n.startsWith('AGUA TRATADA')) return 'variable';
  return 'fijo';
}

function ivaPctDe(clasificacion: string | null): number {
  if (clasificacion === 'TASA_0' || clasificacion === 'NO_OBJETO') return 0;
  return 16; // TASA_16 y AMBAS (para AMBAS el motor decide por uso; 16 es el caso general)
}

async function main(): Promise<void> {
  const raw = fs.readFileSync(resolveDataFile('conceptos-clausulas-sige.json'), 'utf8');
  const data = JSON.parse(raw) as Payload;

  // ─── 1) Catálogo de conceptos (con tconid) ───
  const porNombre = new Map<string, string>(); // nombre normalizado → id
  for (const c of data.conceptosCatalogo) {
    const row = await prisma.conceptoCobro.upsert({
      where: { sigeTconId: c.tconid },
      update: { nombre: c.nombre, clasificacionIva: c.clasificacionIva, ivaPct: ivaPctDe(c.clasificacionIva) },
      create: {
        codigo: `TCON-${c.tconid}`,
        nombre: c.nombre,
        tipo: tipoCalculo(c.nombre),
        origen: 'CONTRATACION',
        sigeTconId: c.tconid,
        clasificacionIva: c.clasificacionIva,
        ivaPct: ivaPctDe(c.clasificacionIva),
      },
    });
    porNombre.set(norm(c.nombre), row.id);
  }
  console.log(`Conceptos de catálogo (tconid): ${data.conceptosCatalogo.length}`);

  // ─── 2) Conceptos referenciados sin catálogo ───
  const referenciados = new Set(data.relacionContratacion.map((r) => norm(r.concepto)));
  let extras = 0;
  for (const n of referenciados) {
    if (porNombre.has(n)) continue;
    const original = data.relacionContratacion.find((r) => norm(r.concepto) === n)!.concepto;
    const codigo = `CONC-${slug(original)}`;
    const row = await prisma.conceptoCobro.upsert({
      where: { codigo },
      update: { nombre: original },
      create: { codigo, nombre: original, tipo: tipoCalculo(original), origen: 'CONTRATACION' },
    });
    porNombre.set(n, row.id);
    console.warn(`⚠ concepto sin entrada en «Cat conceptos contrat»: ${original} → ${codigo}`);
    extras++;
  }

  // ─── 3) Conceptos periódicos (lecturas) ───
  const lecturasNombres = new Set(data.relacionLecturas.map((r) => norm(r.concepto)));
  for (const n of lecturasNombres) {
    if (porNombre.has(n)) continue;
    const original = data.relacionLecturas.find((r) => norm(r.concepto) === n)!.concepto;
    const codigo = `LECT-${slug(original)}`;
    const row = await prisma.conceptoCobro.upsert({
      where: { codigo },
      update: { nombre: original },
      create: { codigo, nombre: original, tipo: tipoCalculo(original), origen: 'LECTURAS' },
    });
    porNombre.set(n, row.id);
  }
  console.log(`Conceptos extra: ${extras} contratación + ${lecturasNombres.size} lecturas`);

  // ─── 4) Relaciones tipo ↔ concepto ───
  const tipos = await prisma.tipoContratacion.findMany({ select: { id: true, codigo: true } });
  const tipoPorCodigo = new Map(tipos.map((t) => [t.codigo, t.id]));
  let vinculados = 0;
  let tiposFaltantes = new Set<number>();
  const relaciones = [
    ...data.relacionContratacion.map((r) => ({ ...r, orden: 0 })),
    ...data.relacionLecturas.map((r) => ({ tctcod: r.tctcod, concepto: r.concepto, orden: 100 })),
  ];
  for (const r of relaciones) {
    const tipoId = tipoPorCodigo.get(`TCT-${r.tctcod}`);
    const conceptoId = porNombre.get(norm(r.concepto));
    if (!tipoId) { tiposFaltantes.add(r.tctcod); continue; }
    if (!conceptoId) { console.warn(`⚠ concepto no resuelto: ${r.concepto}`); continue; }
    await prisma.conceptoCobroTipoContratacion.upsert({
      where: { tipoContratacionId_conceptoCobroId: { tipoContratacionId: tipoId, conceptoCobroId: conceptoId } },
      update: { orden: r.orden },
      create: { tipoContratacionId: tipoId, conceptoCobroId: conceptoId, obligatorio: true, orden: r.orden },
    });
    vinculados++;
  }
  if (tiposFaltantes.size > 0) {
    console.warn(`⚠ ${tiposFaltantes.size} tctcod sin TipoContratacion en BD: ${[...tiposFaltantes].slice(0, 10).join(', ')}`);
  }
  console.log(`Relaciones tipo↔concepto: ${vinculados} (contratación + lecturas)`);

  // ─── 5) Cláusulas ───
  const clauIdPorSige = new Map<number, string>();
  for (const c of data.clausulas) {
    const codigo = `CLAU-${c.clauid}`;
    const row = await prisma.clausulaContractual.upsert({
      where: { codigo },
      update: { titulo: c.titulo, contenido: c.contenido, aplicaPuntoServicio: c.aplicaPuntoServicio },
      create: { codigo, titulo: c.titulo, contenido: c.contenido, aplicaPuntoServicio: c.aplicaPuntoServicio },
    });
    clauIdPorSige.set(c.clauid, row.id);
  }
  console.log(`Cláusulas contractuales: ${data.clausulas.length}`);

  let vin = 0;
  for (const v of data.clausulasVinculos) {
    const tipoId = tipoPorCodigo.get(`TCT-${v.tctcod}`);
    const clausulaId = clauIdPorSige.get(v.clauid);
    if (!tipoId || !clausulaId) continue;
    const titulo = data.clausulas.find((c) => c.clauid === v.clauid)?.titulo ?? '';
    const m = /^(\d+)/.exec(titulo);
    const orden = m ? parseInt(m[1], 10) : 0;
    await prisma.clausulaTipoContratacion.upsert({
      where: { tipoContratacionId_clausulaId: { tipoContratacionId: tipoId, clausulaId } },
      update: { orden },
      create: { tipoContratacionId: tipoId, clausulaId, obligatorio: true, orden },
    });
    vin++;
  }
  console.log(`Vínculos cláusula↔tipo: ${vin}`);

  const [tc, tr, tcl, tvl] = await Promise.all([
    prisma.conceptoCobro.count(),
    prisma.conceptoCobroTipoContratacion.count(),
    prisma.clausulaContractual.count(),
    prisma.clausulaTipoContratacion.count(),
  ]);
  console.log(`\nTotales en BD → conceptos: ${tc} · relaciones: ${tr} · cláusulas: ${tcl} · vínculos: ${tvl}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
