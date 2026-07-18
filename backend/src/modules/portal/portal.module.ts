import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { AuthModule } from '../auth/auth.module';
import { PasarelasModule } from '../pasarelas/pasarelas.module';

@Module({
  imports: [AuthModule, PasarelasModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
