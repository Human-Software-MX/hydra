/**
 * Mapeo inicial (PROPUESTA) tipo de contratación → documentos requeridos.
 *
 * SIGE no trae esta relación (su tabla era un producto cartesiano: los 170 tipos
 * con los mismos 24 documentos), así que este seed la propone a partir de la
 * clasificación semántica del catálogo. PENDIENTE DE VALIDACIÓN POR CEA
 * (TKT-20260903-00144): ajustar aquí y re-ejecutar — es idempotente (upsert por
 * (tipoContratacionId, documentoId)) y NO toca asignaciones hechas a mano vía UI
 * salvo las de los documentos que este script administra.
 *
 * Reglas propuestas:
 *  - COMUN            → todos los tipos. Obligatorios: Identificación Oficial,
 *                       Constancia de Propiedad, Croquis de Ubicación.
 *  - PERSONA_MORAL    → todos los tipos, solo rama no_domestico, opcionales.
 *  - REPRESENTACION   → todos los tipos, opcionales (solo si hay representante).
 *  - CONDOMINAL       → solo tipos cuyo nombre contiene CONDOMINAL, obligatorios.
 *  - HIDRANTE         → solo tipos cuyo nombre contiene HIDRANTE, obligatorios.
 *  - FACTIBILIDAD     → todos los tipos, opcional.
 *  - OTRO (Petición/Solicitud por escrito) → todos, opcionales.
 *  - REGULARIZACION y BAJA → no se asignan (no aplican al alta).
 *
 * Uso:  npm run seed:mapeo-documentos
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Regla = {
  /** codigo_sige del documento en catalogo_documentos */
  codigoSige: number;
  obligatorio: boolean;
  /** null = ambas ramas */
  aplicaUso: 'domestico' | 'no_domestico' | null;
  /** null = todos los tipos activos; string = solo tipos cuyo nombre la contiene */
  soloTiposConNombre: string | null;
};

const REGLAS: Regla[] = [
  // ── COMUN: todos los tipos ──
  { codigoSige: 2, obligatorio: true, aplicaUso: null, soloTiposConNombre: null },   // Identificación Oficial
  { codigoSige: 3, obligatorio: true, aplicaUso: null, soloTiposConNombre: null },   // Constancia de Propiedad
  { codigoSige: 10, obligatorio: true, aplicaUso: null, soloTiposConNombre: null },  // Croquis de Ubicación
  { codigoSige: 1, obligatorio: false, aplicaUso: null, soloTiposConNombre: null },  // Certificado de Número Oficial
  { codigoSige: 5, obligatorio: false, aplicaUso: null, soloTiposConNombre: null },  // Certificado de Conexión
  { codigoSige: 6, obligatorio: false, aplicaUso: null, soloTiposConNombre: null },  // Póliza de Garantía / Acta Entrega Vivienda
  { codigoSige: 9, obligatorio: false, aplicaUso: null, soloTiposConNombre: null },  // Documento que lo Avale como Propietario
  { codigoSige: 41, obligatorio: false, aplicaUso: null, soloTiposConNombre: null }, // Uso de suelo

  // ── PERSONA_MORAL: solo rama no doméstica ──
  { codigoSige: 22, obligatorio: false, aplicaUso: 'no_domestico', soloTiposConNombre: null }, // Acta Constitutiva
  { codigoSige: 23, obligatorio: false, aplicaUso: 'no_domestico', soloTiposConNombre: null }, // RFC (Cédula)
  { codigoSige: 24, obligatorio: false, aplicaUso: 'no_domestico', soloTiposConNombre: null }, // Poder del Representante Legal

  // ── REPRESENTACION: cualquier tipo, solo si hay representante ──
  { codigoSige: 19, obligatorio: false, aplicaUso: null, soloTiposConNombre: null }, // Identificación del Representante
  { codigoSige: 20, obligatorio: false, aplicaUso: null, soloTiposConNombre: null }, // Identificación de 2 Testigos
  { codigoSige: 21, obligatorio: false, aplicaUso: null, soloTiposConNombre: null }, // Carta Poder Simple

  // ── CONDOMINAL / HIDRANTE: solo sus tipos ──
  { codigoSige: 7, obligatorio: true, aplicaUso: null, soloTiposConNombre: 'CONDOMINAL' },  // Acta Asociación Condóminos
  { codigoSige: 8, obligatorio: true, aplicaUso: null, soloTiposConNombre: 'CONDOMINAL' },  // Identificación Rep. Asociación
  { codigoSige: 16, obligatorio: true, aplicaUso: null, soloTiposConNombre: 'HIDRANTE' },   // IFE titular Hidrante
  { codigoSige: 17, obligatorio: true, aplicaUso: null, soloTiposConNombre: 'HIDRANTE' },   // IFE familias beneficiadas

  // ── FACTIBILIDAD / OTRO: opcionales generales ──
  { codigoSige: 12, obligatorio: false, aplicaUso: null, soloTiposConNombre: null }, // Expediente Factibilidades
  { codigoSige: 15, obligatorio: false, aplicaUso: null, soloTiposConNombre: null }, // Petición por escrito
  { codigoSige: 18, obligatorio: false, aplicaUso: null, soloTiposConNombre: null }, // Solicitud Por Escrito
  // 11 Carta de Adhesión, 13 Regularizaciones, 14 Baja Definitiva: sin asignar.
];

async function main(): Promise<void> {
  const docs = await prisma.catalogoDocumento.findMany({
    where: { codigoSige: { not: null } },
    select: { id: true, codigoSige: true, nombre: true },
  });
  const porSige = new Map(docs.map((d) => [d.codigoSige as number, d]));

  const tipos = await prisma.tipoContratacion.findMany({
    where: { activo: true },
    select: { id: true, nombre: true },
  });
  console.log(`Tipos activos: ${tipos.length} · Documentos en catálogo: ${docs.length}`);

  let creados = 0;
  let actualizados = 0;
  let omitidos = 0;

  for (const regla of REGLAS) {
    const doc = porSige.get(regla.codigoSige);
    if (!doc) {
      console.warn(`⚠ documento codigo_sige=${regla.codigoSige} no está en catálogo; regla omitida`);
      omitidos++;
      continue;
    }
    const destino = regla.soloTiposConNombre
      ? tipos.filter((t) => t.nombre.toUpperCase().includes(regla.soloTiposConNombre as string))
      : tipos;
    for (const tipo of destino) {
      const res = await prisma.documentoRequeridoTipoContratacion.upsert({
        where: {
          tipoContratacionId_documentoId: { tipoContratacionId: tipo.id, documentoId: doc.id },
        },
        update: { obligatorio: regla.obligatorio, aplicaUso: regla.aplicaUso },
        create: {
          tipoContratacionId: tipo.id,
          documentoId: doc.id,
          obligatorio: regla.obligatorio,
          aplicaUso: regla.aplicaUso,
        },
      });
      void res;
      creados++;
    }
    console.log(`✓ ${doc.nombre} → ${destino.length} tipo(s)` +
      (regla.aplicaUso ? ` [${regla.aplicaUso}]` : '') +
      (regla.obligatorio ? ' (obligatorio)' : ''));
  }

  const total = await prisma.documentoRequeridoTipoContratacion.count();
  console.log(`\nAsignaciones procesadas: ${creados} (upsert) · total en tabla: ${total} · reglas omitidas: ${omitidos}`);
  console.log('Recuerda: esta es la PROPUESTA inicial — pendiente de validación CEA (TKT-20260903-00144).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
