import { forwardRef, Module } from '@nestjs/common';
import { AgoraController } from './agora.controller';
import { AgoraWebhookController } from './agora-webhook.controller';
import { AgoraService } from './agora.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SolicitudesModule } from '../solicitudes/solicitudes.module';

@Module({
  imports: [PrismaModule, forwardRef(() => SolicitudesModule)],
  controllers: [AgoraController, AgoraWebhookController],
  providers: [AgoraService],
  exports: [AgoraService],
})
export class AgoraModule {}
