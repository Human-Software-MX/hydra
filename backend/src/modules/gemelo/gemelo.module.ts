import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GemeloService } from './gemelo.service';
import { GemeloController } from './gemelo.controller';

@Module({
  imports: [PrismaModule],
  controllers: [GemeloController],
  providers: [GemeloService],
  exports: [GemeloService],
})
export class GemeloModule {}
