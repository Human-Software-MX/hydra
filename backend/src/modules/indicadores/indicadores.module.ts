import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IndicadoresService } from './indicadores.service';
import { IndicadoresController } from './indicadores.controller';

@Module({
  imports: [PrismaModule],
  controllers: [IndicadoresController],
  providers: [IndicadoresService],
  exports: [IndicadoresService],
})
export class IndicadoresModule {}
