/**
 * Crea el PRIMER usuario administrador de una instalación nueva.
 *
 * Idempotente por omisión: si el email ya existe no toca nada y sale con 0,
 * de modo que puede quedar cableado en un arranque sin romper redespliegues.
 *
 * Uso (desde backend/):
 *   ADMIN_EMAIL=admin@cea.gob.mx ADMIN_PASSWORD='...' npm run bootstrap:admin
 *
 * Variables:
 *   ADMIN_EMAIL     (requerida) email del administrador.
 *   ADMIN_PASSWORD  (requerida) contraseña en claro; se guarda con bcrypt.
 *   ADMIN_NOMBRE    (opcional)  nombre para mostrar. Default: «Administrador».
 */
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/** Mismo costo que usa el seed de desarrollo: los hashes son intercambiables. */
const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 12;
const PLACEHOLDER_PASSWORDS = ['CHANGE_ME', 'changeme', 'demo123', 'password'];

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const nombre = (process.env.ADMIN_NOMBRE ?? '').trim() || 'Administrador';

  if (!email) {
    throw new Error('Falta ADMIN_EMAIL.');
  }
  if (!password) {
    throw new Error('Falta ADMIN_PASSWORD.');
  }
  if (PLACEHOLDER_PASSWORDS.includes(password)) {
    throw new Error('ADMIN_PASSWORD es un valor de ejemplo; usa una contraseña real.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  const existente = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existente) {
    // No se pisa la contraseña de una cuenta viva: este script sólo arranca.
    console.log(`[bootstrap-admin] ${email} ya existe; no se modifica nada.`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      name: nombre,
      role: UserRole.SUPER_ADMIN,
      administracionIds: [],
      zonaIds: [],
      contratoIds: [],
    },
    select: { id: true, email: true, role: true },
  });

  console.log(`[bootstrap-admin] Administrador creado: ${user.email} (${user.role}, id ${user.id}).`);
  console.log('[bootstrap-admin] Asigna administraciones/zonas desde la aplicación si el rol lo requiere.');
}

main()
  .catch((e) => {
    console.error(`[bootstrap-admin] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
