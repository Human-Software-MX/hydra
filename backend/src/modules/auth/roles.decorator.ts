import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Grupos de roles para `@Roles(...)`.
 *
 * `SUPER_ADMIN` y `ADMIN` se incluyen en TODOS los grupos: deben conservar
 * acceso a todo (no hay bypass en `RolesGuard`, la inclusión explícita mantiene
 * la doc de Swagger fiel). Cada grupo deriva 1:1 de `allowedRoles` en
 * `frontend/src/config/routes.ts` + `frontend/src/hooks/usePermissions.ts`.
 */
export const ROLES_ADMIN = ['SUPER_ADMIN', 'ADMIN'];
/** Todos los roles internos (para GETs transversales bajo un controlador restringido). */
export const ROLES_INTERNAL = [
  'SUPER_ADMIN',
  'ADMIN',
  'OPERADOR',
  'LECTURISTA',
  'ATENCION_CLIENTES',
];
/** Infra/facturación operativa: medidores, consumos. */
export const ROLES_OPERACION = ['SUPER_ADMIN', 'ADMIN', 'OPERADOR'];
/** Servicios (solicitudes, puntos de servicio, procesos, contratos-write). */
export const ROLES_SERVICIOS = ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES'];
/** Trabajo de campo: rutas, lecturas. */
export const ROLES_CAMPO = ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'LECTURISTA'];
/** Finanzas de cara al cliente: pagos, caja, recibos, atención. */
export const ROLES_ATENCION = ['SUPER_ADMIN', 'ADMIN', 'ATENCION_CLIENTES'];
/** Quejas: OPERADOR y ATENCION pueden ver/crear (resolución/borrado = admin). */
export const ROLES_QUEJAS = ['SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES'];
