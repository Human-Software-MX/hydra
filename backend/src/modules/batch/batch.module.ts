import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { TimbradosModule } from '../timbrados/timbrados.module';
import { BatchService } from './batch.service';
import { BatchController } from './batch.controller';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, FacturacionModule, TimbradosModule],
  controllers: [BatchController],
  providers: [BatchService],
  exports: [BatchService],
})
export class BatchModule {}
