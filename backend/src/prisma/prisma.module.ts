import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { createGisTrackingExtension } from './gis-tracking.extension';

/**
 * B5 — El proveedor entrega el cliente Prisma YA EXTENDIDO con el hook de
 * tracking GIS, de modo que toda la app (que inyecta `PrismaService`) pasa por
 * él. `$extends` devuelve un cliente nuevo; re-cableamos los hooks de ciclo de
 * vida de Nest hacia el cliente base para conservar connect/disconnect.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => {
        const base = new PrismaService();
        const extended = base.$extends(createGisTrackingExtension(base));
        (extended as unknown as { onModuleInit: () => Promise<void> }).onModuleInit = () =>
          base.$connect();
        (extended as unknown as { onModuleDestroy: () => Promise<void> }).onModuleDestroy = () =>
          base.$disconnect();
        return extended as unknown as PrismaService;
      },
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
