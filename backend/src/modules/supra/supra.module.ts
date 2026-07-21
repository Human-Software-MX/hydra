import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CarteraModule } from '../cartera/cartera.module';
import { SupraClientService } from './supra-client.service';
import { SupraConciliacionController } from './supra-conciliacion.controller';
import { SupraConciliacionService } from './supra-conciliacion.service';
import { SupraEventosService } from './supra-eventos.service';
import { SupraMapService } from './supra-map.service';
import { SupraOutboxService } from './supra-outbox.service';
import { SupraWebhookController } from './supra-webhook.controller';

/**
 * Integración con SUPRA (Payment Engine — fuente de verdad financiera).
 *
 * @Global: pagos, convenios y portal consumen SupraClientService/SupraMapService
 * sin importar el módulo explícitamente (mismo patrón que NotificacionesModule).
 * El kill-switch es SUPRA_INTEGRACION_ENABLED; apagado, ningún módulo toca SUPRA.
 */
@Global()
@Module({
  imports: [PrismaModule, CarteraModule],
  controllers: [SupraWebhookController, SupraConciliacionController],
  providers: [
    SupraClientService,
    SupraMapService,
    SupraEventosService,
    SupraOutboxService,
    SupraConciliacionService,
  ],
  exports: [
    SupraClientService,
    SupraMapService,
    SupraEventosService,
    SupraOutboxService,
    SupraConciliacionService,
  ],
})
export class SupraModule {}
