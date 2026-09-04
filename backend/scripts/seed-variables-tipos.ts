/**
 * Asigna las variables de captura a los tipos de contratación (PROPUESTA por reglas).
 *
 * SIGE no trae esta relación en ningún catálogo; las reglas salen de la junta
 * CEA 02-sep-2026 (la inspección captura diámetros, materiales y metros porque
 * las tarifas de conexión dependen de ellos) y del catálogo de tarifas de
 * contratación (variantes por materiales CALLE-BANQUETA y por diámetro).
 *
 * Reglas:
 *  - Núcleo de cuantificación → TODOS los tipos activos:
 *      DIAMETRO_TOMA*, MATERIAL_CALLE*, MATERIAL_BANQUETA*, METROS_TOMA*,
 *      DIAMETRO_DESCARGA, METROS_DESCARGA  (* = obligatoria)
 *  - Con medidor (requiereMedidor): TIPO_MEDIDOR*, PLAN_PAGO_MEDIDOR
 *  - CONDOMINAL en el nombre: UNIDADES_SERVIDAS*, NUM_DEPARTAMENTOS
 *  - Nombre con INDUSTRIAL o COMERCIAL: GIRO_ACTIVIDAD
 *
 * Idempotente (upsert por par único); re-ejecutable tras ajustar reglas.
 * Pendiente de validación con CEA (TKT-20260903-00144).
 *
 * Uso: npm run seed:variables-tipos
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Regla = {
  codigo: string;
  obligatorio: boolean;
  orden: number;
  aplica: (t: { nombre: string; requiereMedidor: boolean }) => boolean;
};

const SIEMPRE = () => true;
const REGLAS: Regla[] = [
  { codigo: 'DIAMETRO_TOMA', obligatorio: true, orden: 1, aplica: SIEMPRE },
  { codigo: 'DIAMETRO_DESCARGA', obligatorio: false, orden: 2, aplica: SIEMPRE },
  { codigo: 'MATERIAL_CALLE', obligatorio: true, orden: 3, aplica: SIEMPRE },
  { codigo: 'MATERIAL_BANQUETA', obligatorio: true, orden: 4, aplica: SIEMPRE },
  { codigo: 'METROS_TOMA', obligatorio: true, orden: 5, aplica: SIEMPRE },
  { codigo: 'METROS_DESCARGA', obligatorio: false, orden: 6, aplica: SIEMPRE },
  { codigo: 'TIPO_MEDIDOR', obligatorio: true, orden: 7, aplica: (t) => t.requiereMedidor },
  { codigo: 'PLAN_PAGO_MEDIDOR', obligatorio: false, orden: 8, aplica: (t) => t.requiereMedidor },
  { codigo: 'UNIDADES_SERVIDAS', obligatorio: true, orden: 9, aplica: (t) => t.nombre.toUpperCase().includes('CONDOMINAL') },
  { codigo: 'NUM_DEPARTAMENTOS', obligatorio: false, orden: 10, aplica: (t) => t.nombre.toUpperCase().includes('CONDOMINAL') },
  { codigo: 'GIRO_ACTIVIDAD', obligatorio: false, orden: 11, aplica: (t) => /INDUSTRIAL|COMERCIAL/i.test(t.nombre) },
];

async function main(): Promise<void> {
  const variables = await prisma.tipoVariable.findMany({ select: { id: true, codigo: true } });
  const varPorCodigo = new Map(variables.map((v) => [v.codigo, v.id]));
  const tipos = await prisma.tipoContratacion.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, requiereMedidor: true },
  });
  console.log(`Tipos activos: ${tipos.length} · Variables en catálogo: ${variables.length}`);

  let asignadas = 0;
  for (const regla of REGLAS) {
    const tipoVariableId = varPorCodigo.get(regla.codigo);
    if (!tipoVariableId) {
      console.warn(`⚠ variable ${regla.codigo} no existe en catálogo; regla omitida`);
      continue;
    }
    const destino = tipos.filter((t) => regla.aplica(t));
    for (const tipo of destino) {
      await prisma.variableTipoContratacion.upsert({
        where: { tipoContratacionId_tipoVariableId: { tipoContratacionId: tipo.id, tipoVariableId } },
        update: { obligatorio: regla.obligatorio, orden: regla.orden },
        create: { tipoContratacionId: tipo.id, tipoVariableId, obligatorio: regla.obligatorio, orden: regla.orden },
      });
      asignadas++;
    }
    console.log(`✓ ${regla.codigo} → ${destino.length} tipo(s)${regla.obligatorio ? ' (obligatoria)' : ''}`);
  }
  const total = await prisma.variableTipoContratacion.count();
  console.log(`\nAsignaciones procesadas: ${asignadas} · total en tabla: ${total}`);
  console.log('PROPUESTA por reglas — pendiente de validación CEA (TKT-20260903-00144).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
