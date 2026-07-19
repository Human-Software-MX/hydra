import { Module } from '@nestjs/common';
import { GisModule } from '../gis/gis.module';
import { ClimaService } from './clima.service';
import { ClimaController } from './clima.controller';

@Module({
  imports: [GisModule],
  controllers: [ClimaController],
  providers: [ClimaService],
  exports: [ClimaService],
})
export class ClimaModule {}
