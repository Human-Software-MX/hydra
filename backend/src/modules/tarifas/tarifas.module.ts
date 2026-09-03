import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { TarifasController } from './tarifas.controller';
import { TarifasService } from './tarifas.service';
import { TarifaVersionesService } from './tarifa-versiones.service';

@Module({
  imports: [PrismaModule, FacturacionModule],
  controllers: [TarifasController],
  providers: [TarifasService, TarifaVersionesService],
  exports: [TarifasService, TarifaVersionesService],
})
export class TarifasModule {}
