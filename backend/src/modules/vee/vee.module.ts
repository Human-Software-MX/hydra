import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { VeeService } from './vee.service';
import { VeeController } from './vee.controller';

@Module({
  imports: [PrismaModule],
  controllers: [VeeController],
  providers: [VeeService],
  exports: [VeeService],
})
export class VeeModule {}
