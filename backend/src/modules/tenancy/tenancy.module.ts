import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenancyMiddleware } from './tenancy.middleware';
import { OrganismosController } from './organismos.controller';

/**
 * Multi-tenancy SaaS fase 1 (tenant-per-database).
 *
 * El middleware corre en TODAS las rutas: resuelve el organismo del header
 * `X-Organismo` (o subdominio con HYDRA_TENANCY_SUBDOMAIN=true) y ejecuta el
 * request en su AsyncLocalStorage; PrismaService delega al cliente del tenant.
 *
 * Limitaciones fase 1 (documentadas en tasks/todo.md):
 *  - Los cron jobs corren sobre la base default (fase 2: iterar organismos).
 *  - El secreto JWT es compartido entre tenants (fase 2: issuer por tenant).
 *  - Las migraciones se aplican por tenant (prisma migrate deploy con la
 *    DATABASE_URL de cada organismo).
 */
@Module({
  imports: [PrismaModule],
  controllers: [OrganismosController],
  providers: [TenancyMiddleware],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenancyMiddleware).forRoutes('*');
  }
}
