import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PagosController } from './pagos.controller';
import { PagosExternosController } from './pagos-externos.controller';
import { PagosExternosService } from './pagos-externos.service';
import { EtlPagosService } from './etl-pagos.service';
import { PagosService } from './pagos.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CarteraModule } from '../cartera/cartera.module';

@Module({
  imports: [PrismaModule, CarteraModule, MulterModule.register({ limits: { fileSize: 50 * 1024 * 1024 } })],
  controllers: [PagosController, PagosExternosController],
  providers: [PagosExternosService, EtlPagosService, PagosService],
  exports: [PagosExternosService, EtlPagosService, PagosService],
})
export class PagosModule {}
