import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RestriccionesService } from './restricciones.service';
import { RestriccionesController } from './restricciones.controller';

@Module({
  imports: [PrismaModule],
  controllers: [RestriccionesController],
  providers: [RestriccionesService],
  exports: [RestriccionesService],
})
export class RestriccionesModule {}
