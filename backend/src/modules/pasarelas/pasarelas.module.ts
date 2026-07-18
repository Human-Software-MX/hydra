import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PasarelasController } from './pasarelas.controller';
import { PasarelasService } from './pasarelas.service';

@Module({
  imports: [PrismaModule],
  controllers: [PasarelasController],
  providers: [PasarelasService],
  exports: [PasarelasService],
})
export class PasarelasModule {}
