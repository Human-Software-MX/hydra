import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TimbradosController } from './timbrados.controller';
import { TimbradoService } from './timbrado.service';
import { FacturacionModule } from '../facturacion/facturacion.module';

@Module({
  imports: [PrismaModule, FacturacionModule],
  controllers: [TimbradosController],
  providers: [TimbradoService],
  exports: [TimbradoService],
})
export class TimbradosModule {}
