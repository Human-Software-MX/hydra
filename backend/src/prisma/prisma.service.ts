import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  ContextoTenant,
  TENANT_DEFAULT,
  tenancyContext,
} from '../modules/tenancy/tenancy.context';

/**
 * PrismaService multi-tenant (tenant-per-database).
 *
 * Fuera de un contexto de tenant (arranque, cron jobs, requests sin header
 * X-Organismo) se comporta EXACTAMENTE como antes: un PrismaClient sobre
 * DATABASE_URL. Dentro de un request con tenant resuelto (middleware de
 * tenancy), el Proxy delega cada acceso — modelos, $transaction, $queryRaw —
 * al PrismaClient de la base de ese organismo (lazy, cacheado por slug).
 *
 * Ventaja del modelo tenant-per-database: cero cambios en los ~40 servicios
 * de negocio y aislamiento físico de datos entre organismos (el requisito
 * duro al vender SaaS a organismos públicos). Las bases de tenant deben tener
 * el mismo esquema (prisma migrate deploy por tenant).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly clientesTenant = new Map<string, PrismaClient>();

  constructor() {
    super();
    // eslint-disable-next-line no-constructor-return
    return new Proxy(this, {
      get: (target, prop) => {
        const ctx = tenancyContext.getStore();
        // Camino caliente sin tenant: comportamiento idéntico al original.
        if (!ctx || ctx.slug === TENANT_DEFAULT || !ctx.dbUrl) {
          const v = Reflect.get(target, prop, target);
          return typeof v === 'function' ? v.bind(target) : v;
        }
        const cliente = target.clienteDeTenant(ctx);
        const v = Reflect.get(cliente, prop, cliente);
        return typeof v === 'function' ? v.bind(cliente) : v;
      },
    });
  }

  /** PrismaClient del tenant (lazy + cacheado). Solo tenants con dbUrl propio. */
  private clienteDeTenant(ctx: ContextoTenant): PrismaClient {
    let cliente = this.clientesTenant.get(ctx.slug);
    if (!cliente) {
      cliente = new PrismaClient({ datasources: { db: { url: ctx.dbUrl } } });
      this.clientesTenant.set(ctx.slug, cliente);
      this.logger.log(`Cliente Prisma creado para organismo "${ctx.slug}"`);
    }
    return cliente;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    for (const [slug, cliente] of this.clientesTenant) {
      await cliente.$disconnect().catch(() => undefined);
      this.clientesTenant.delete(slug);
    }
  }
}
