import { Module } from '@nestjs/common';
import { GisController } from './gis.controller';
import { GisService } from './gis.service';
import { GisTrackerService } from './gis-tracker.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GisController],
  providers: [GisService, GisTrackerService],
  exports: [GisTrackerService, GisService],
})
export class GisModule {}
