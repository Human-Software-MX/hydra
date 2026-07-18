import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MdmService } from './mdm.service';
import { TandeoService } from './tandeo.service';
import { MdmController, MdmIngestController } from './mdm.controller';
import { MdmIngestGuard } from './mdm-ingest.guard';

/**
 * MDM ligero (AMI/AMR) + alertas de fuga lado-cliente + calendarios de tandeo.
 *
 * Las series de intervalo son independientes de la lectura de facturación
 * (módulo lecturas/): MDM desacoplado del billing, práctica SWAN/AWWA.
 *
 * Nota de wiring: este módulo debe registrarse en app.module.ts (no se editó
 * aquí porque otros agentes trabajan ese archivo en paralelo).
 */
@Module({
  imports: [PrismaModule, NotificacionesModule],
  controllers: [MdmIngestController, MdmController],
  providers: [MdmService, TandeoService, MdmIngestGuard, JwtAuthGuard, RolesGuard],
  exports: [MdmService, TandeoService],
})
export class MdmModule {}
