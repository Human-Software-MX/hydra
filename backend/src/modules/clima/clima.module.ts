import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GisModule } from '../gis/gis.module';
import { ClimaService } from './clima.service';
import { SequiaService } from './sequia.service';
import { ClimaController } from './clima.controller';

@Module({
  imports: [PrismaModule, GisModule],
  controllers: [ClimaController],
  providers: [ClimaService, SequiaService],
  exports: [ClimaService, SequiaService],
})
export class ClimaModule {}
