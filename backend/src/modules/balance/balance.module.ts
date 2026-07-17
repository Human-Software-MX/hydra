import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BalanceService } from './balance.service';
import { BalanceController } from './balance.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BalanceController],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
