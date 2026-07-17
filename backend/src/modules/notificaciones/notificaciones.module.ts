import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificacionesService } from './notificaciones.service';
import { NotificacionesController } from './notificaciones.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [NotificacionesController],
  providers: [NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
