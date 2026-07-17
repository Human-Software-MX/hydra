import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FacturacionService } from './facturacion.service';
import { FacturacionController } from './facturacion.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FacturacionController],
  providers: [FacturacionService],
  exports: [FacturacionService],
})
export class FacturacionModule {}
