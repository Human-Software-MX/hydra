/**
 * Semilla de DESARROLLO: catálogos de referencia + fixtures de demo.
 *
 * Entry point de `prisma db seed` (y de `docker compose` en local). Crea
 * usuarios con contraseña conocida y contratos/recibos ficticios, así que se
 * niega a correr con NODE_ENV=production.
 *
 * En producción: los catálogos los siembra `prisma/seed-catalogos.ts` desde
 * `npm run start:prod`, y el primer administrador `npm run bootstrap:admin`.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { seedCatalogos } from './seed-catalogos';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'prisma/seed.ts crea usuarios de demo con contraseña conocida y no debe correr en producción. ' +
      'Usa `npm run seed:catalogos` para los datos de referencia y `npm run bootstrap:admin` para el primer administrador.',
  );
}

/** Fixtures de demo: predios, tomas, contratos y su historial de cobranza. */
async function seedDemoFixtures() {
  // Factibilidades
  await prisma.factibilidad.upsert({
    where: { id: 'F001' },
    update: {},
    create: {
      id: 'F001',
      predio: 'Lote 23-A Juriquilla',
      solicitante: 'Carlos Mendoza',
      direccion: 'Av. Juriquilla 450',
      estado: 'Aprobada',
      fecha: '2025-01-15',
      notas: 'Zona con infraestructura disponible',
    },
  });
  await prisma.factibilidad.upsert({
    where: { id: 'F002' },
    update: {},
    create: {
      id: 'F002',
      predio: 'Manzana 5 El Marqués',
      solicitante: 'María López',
      direccion: 'Calle Norte 120',
      estado: 'En comité',
      fecha: '2025-02-01',
      notas: 'Pendiente dictamen técnico',
    },
  });

  // Construcciones
  await prisma.construccion.upsert({
    where: { id: 'C001' },
    update: {},
    create: {
      id: 'C001',
      factibilidadId: 'F001',
      nombre: 'Red hidráulica Juriquilla Ph2',
      ubicacion: 'Juriquilla',
      estado: 'Finalizada',
      fecha: '2025-01-20',
    },
  });

  // Tomas
  await prisma.toma.upsert({
    where: { id: 'T001' },
    update: {},
    create: {
      id: 'T001',
      construccionId: 'C001',
      ubicacion: 'Juriquilla Lote 23-A #1',
      tipo: 'Agua',
      estado: 'Asignada',
    },
  });
  await prisma.toma.upsert({
    where: { id: 'T002' },
    update: {},
    create: {
      id: 'T002',
      construccionId: 'C001',
      ubicacion: 'Juriquilla Lote 23-A #2',
      tipo: 'Agua',
      estado: 'Disponible',
    },
  });

  // Rutas
  await prisma.ruta.upsert({
    where: { id: 'R001' },
    update: {},
    create: {
      id: 'R001',
      zonaId: 'Z001',
      sector: 'Juriquilla',
      libreta: 'LIB-001',
      lecturista: 'Pedro Ramírez',
    },
  });

  // Contratos
  await prisma.contrato.upsert({
    where: { id: 'CT001' },
    update: {},
    create: {
      id: 'CT001',
      tomaId: 'T001',
      tipoContrato: 'Agua',
      tipoServicio: 'Doméstico',
      nombre: 'Juan Pérez García',
      rfc: 'PEGJ800101XXX',
      direccion: 'Juriquilla Lote 23-A #1',
      contacto: '442-111-2233',
      estado: 'Activo',
      fecha: '2025-01-25',
      rutaId: 'R001',
      zonaId: 'Z001',
      domiciliado: true,
    },
  });
  await prisma.contrato.upsert({
    where: { id: 'CT002' },
    update: {},
    create: {
      id: 'CT002',
      tomaId: 'T002',
      tipoContrato: 'Agua',
      tipoServicio: 'Doméstico',
      nombre: 'María López',
      rfc: 'LOM850202YYY',
      direccion: 'Juriquilla Lote 23-A #2',
      contacto: '442-222-3344',
      estado: 'Activo',
      fecha: '2025-01-26',
      rutaId: 'R001',
      zonaId: 'Z001',
      domiciliado: false,
    },
  });

  // ---- Datos de portal para CT001 ----

  // Consumos (últimos 3 meses)
  await prisma.consumo.upsert({
    where: { id: 'CON001' },
    update: {},
    create: {
      id: 'CON001',
      contratoId: 'CT001',
      periodo: '2024-12',
      m3: 18,
      tipo: 'Real',
      confirmado: true,
    },
  });
  await prisma.consumo.upsert({
    where: { id: 'CON002' },
    update: {},
    create: {
      id: 'CON002',
      contratoId: 'CT001',
      periodo: '2025-01',
      m3: 21,
      tipo: 'Real',
      confirmado: true,
    },
  });
  await prisma.consumo.upsert({
    where: { id: 'CON003' },
    update: {},
    create: {
      id: 'CON003',
      contratoId: 'CT001',
      periodo: '2025-02',
      m3: 19,
      tipo: 'Real',
      confirmado: false,
    },
  });

  // Timbrado 1 — pagado (dic 2024)
  await prisma.timbrado.upsert({
    where: { id: 'TIM001' },
    update: {},
    create: {
      id: 'TIM001',
      contratoId: 'CT001',
      consumoId: 'CON001',
      uuid: 'a1b2c3d4-0001-0001-0001-000000000001',
      estado: 'Timbrada OK',
      periodo: '2024-12',
      subtotal: 360.00,
      iva: 57.60,
      total: 417.60,
      fechaEmision: '2025-01-05',
      fechaVencimiento: '2025-01-20',
    },
  });

  // Timbrado 2 — pendiente (ene 2025)
  await prisma.timbrado.upsert({
    where: { id: 'TIM002' },
    update: {},
    create: {
      id: 'TIM002',
      contratoId: 'CT001',
      consumoId: 'CON002',
      uuid: 'a1b2c3d4-0002-0002-0002-000000000002',
      estado: 'Timbrada OK',
      periodo: '2025-01',
      subtotal: 420.00,
      iva: 67.20,
      total: 487.20,
      fechaEmision: '2025-02-05',
      fechaVencimiento: '2025-02-20',
    },
  });

  // Recibo 1 — pagado (saldo 0)
  await prisma.recibo.upsert({
    where: { id: 'REC001' },
    update: {},
    create: {
      id: 'REC001',
      contratoId: 'CT001',
      timbradoId: 'TIM001',
      saldoVigente: 0,
      saldoVencido: 0,
      fechaVencimiento: '2025-01-20',
      impreso: true,
    },
  });

  // Recibo 2 — pendiente
  await prisma.recibo.upsert({
    where: { id: 'REC002' },
    update: {},
    create: {
      id: 'REC002',
      contratoId: 'CT001',
      timbradoId: 'TIM002',
      saldoVigente: 487.20,
      saldoVencido: 0,
      fechaVencimiento: '2025-02-20',
      impreso: false,
    },
  });

  // Pago histórico para dic 2024
  await prisma.pago.upsert({
    where: { id: 'PAG001' },
    update: {},
    create: {
      id: 'PAG001',
      contratoId: 'CT001',
      reciboId: 'REC001',
      timbradoId: 'TIM001',
      monto: 417.60,
      fecha: '2025-01-18',
      tipo: 'Transferencia',
      concepto: 'Pago factura dic 2024',
      origen: 'nativo',
    },
  });

  console.log('Fixtures de demo sembrados: factibilidades, construcciones, tomas, rutas, contratos, consumos, timbrados, recibos, pagos.');
}

/** Cuentas de demo (contraseña `demo123`) — sólo desarrollo. */
async function seedUser() {
  const hash = await bcrypt.hash('demo123', 10);

  await prisma.user.upsert({
    where: { email: 'demo@ctcf.local' },
    update: { role: 'SUPER_ADMIN' },
    create: {
      email: 'demo@ctcf.local',
      passwordHash: hash,
      name: 'Usuario Demo',
      role: 'SUPER_ADMIN',
      administracionIds: ['EXP-01'],
      zonaIds: ['Z001', 'Z002'],
      contratoIds: [],
    },
  });

  await prisma.user.upsert({
    where: { email: 'operador@ctcf.local' },
    update: {},
    create: {
      email: 'operador@ctcf.local',
      passwordHash: hash,
      name: 'Usuario Operador',
      role: 'OPERADOR',
      administracionIds: ['EXP-01'],
      zonaIds: ['Z001'],
      contratoIds: [],
    },
  });

  await prisma.user.upsert({
    where: { email: 'lecturista@ctcf.local' },
    update: {},
    create: {
      email: 'lecturista@ctcf.local',
      passwordHash: hash,
      name: 'Usuario Lecturista',
      role: 'LECTURISTA',
      administracionIds: ['EXP-01'],
      zonaIds: ['Z001'],
      contratoIds: [],
    },
  });

  await prisma.user.upsert({
    where: { email: 'atencion@ctcf.local' },
    update: {},
    create: {
      email: 'atencion@ctcf.local',
      passwordHash: hash,
      name: 'Atención Clientes',
      role: 'ATENCION_CLIENTES',
      administracionIds: ['EXP-01'],
      zonaIds: ['Z001', 'Z002'],
      contratoIds: [],
    },
  });

  await prisma.user.upsert({
    where: { email: 'cliente@ctcf.local' },
    update: { contratoIds: ['CT001', 'CT002'] },
    create: {
      email: 'cliente@ctcf.local',
      passwordHash: hash,
      name: 'Cliente Demo',
      role: 'CLIENTE',
      administracionIds: [],
      zonaIds: [],
      contratoIds: ['CT001', 'CT002'],
    },
  });

  console.log('Usuarios creados: demo (SUPER_ADMIN), operador (OPERADOR), lecturista (LECTURISTA), atencion (ATENCION_CLIENTES), cliente (CLIENTE) — todos con contraseña demo123');
}

seedCatalogos(prisma)
  .then(() => seedDemoFixtures())
  .then(() => seedUser())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
