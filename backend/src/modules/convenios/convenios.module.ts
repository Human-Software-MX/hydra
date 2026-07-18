import { Module } from '@nestjs/common';
import { ConveniosController } from './convenios.controller';
import { ConveniosService } from './convenios.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CarteraModule } from '../cartera/cartera.module';

@Module({
  imports: [PrismaModule, CarteraModule],
  controllers: [ConveniosController],
  providers: [ConveniosService],
  exports: [ConveniosService],
})
export class ConveniosModule {}
