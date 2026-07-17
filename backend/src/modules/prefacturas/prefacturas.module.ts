import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TarifasModule } from '../tarifas/tarifas.module';
import { PrefacturasController } from './prefacturas.controller';

@Module({
  imports: [PrismaModule, TarifasModule],
  controllers: [PrefacturasController],
})
export class PrefacturasModule {}
