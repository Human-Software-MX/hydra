import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MigracionController } from './migracion.controller';
import { MigracionService } from './migracion.service';

/**
 * Toolkit de migración desde Aquasis (CIS incumbente de TDS).
 *
 * NOTA: este módulo aún NO está registrado en app.module.ts (fuera del
 * alcance de este cambio); agregar `MigracionModule` a los imports de
 * AppModule para exponer los endpoints /migracion/*.
 */
@Module({
  imports: [PrismaModule],
  controllers: [MigracionController],
  providers: [MigracionService],
  exports: [MigracionService],
})
export class MigracionModule {}
