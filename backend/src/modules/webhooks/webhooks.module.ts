import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';

/**
 * @Global (mismo patrón que NotificacionesModule): cualquier servicio de
 * negocio puede inyectar WebhooksService para emitir eventos sin crear
 * dependencias circulares de módulos.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
