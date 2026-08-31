import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrefacturasController } from './prefacturas.controller';
import { FacturacionModule } from '../facturacion/facturacion.module';

@Module({
  imports: [PrismaModule, FacturacionModule],
  controllers: [PrefacturasController],
})
export class PrefacturasModule {}
