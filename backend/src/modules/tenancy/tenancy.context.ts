import { AsyncLocalStorage } from 'async_hooks';

/**
 * Contexto de tenant por request (multi-tenancy SaaS, fase 1).
 *
 * Modelo: tenant-per-database — cada organismo operador tiene su propia base
 * (mismo esquema Prisma) y el registro de organismos vive en la base default.
 * El middleware resuelve el organismo del header `X-Organismo` y ejecuta el
 * request dentro de este AsyncLocalStorage; PrismaService delega cada acceso
 * al cliente del tenant activo, por lo que NINGÚN servicio de negocio cambia.
 */

export interface ContextoTenant {
  /** Slug del organismo (subdominio/header). 'default' = base principal. */
  slug: string;
  nombre?: string;
  /** Connection string del tenant; undefined = base default. */
  dbUrl?: string;
}

export const TENANT_DEFAULT = 'default';

export const tenancyContext = new AsyncLocalStorage<ContextoTenant>();

/** Slug del tenant activo ('default' fuera de un request con tenant). */
export function tenantActual(): string {
  return tenancyContext.getStore()?.slug ?? TENANT_DEFAULT;
}
