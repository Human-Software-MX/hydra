import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RestriccionesModule } from '../restricciones/restricciones.module';
import { CarteraService } from './cartera.service';
import { DunningService } from './dunning.service';
import { CarteraController } from './cartera.controller';

/**
 * Cartera vencida y cobranza (dunning). Importante: este módulo NO importa
 * PagosModule ni ConveniosModule — son ellos quienes importan CarteraModule
 * para engancharse a `CarteraService.aplicarPago()` tras registrar un pago
 * (evita imports circulares). NotificacionesModule es @Global.
 */
@Module({
  imports: [PrismaModule, RestriccionesModule],
  controllers: [CarteraController],
  providers: [CarteraService, DunningService],
  exports: [CarteraService, DunningService],
})
export class CarteraModule {}
