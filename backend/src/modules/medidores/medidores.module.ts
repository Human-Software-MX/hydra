import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MedidoresController } from './medidores.controller';
import { ReemplazoService } from './reemplazo.service';

@Module({
  imports: [PrismaModule],
  controllers: [MedidoresController],
  providers: [ReemplazoService],
  exports: [ReemplazoService],
})
export class MedidoresModule {}
