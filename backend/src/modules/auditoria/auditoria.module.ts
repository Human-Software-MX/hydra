import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditoriaInterceptor } from './auditoria.interceptor';
import { AuditoriaController } from './auditoria.controller';

/**
 * Auditoría global unificada: el interceptor se registra como APP_INTERCEPTOR
 * (aplica a todos los controladores sin tocarlos) y el controller expone la
 * consulta de la bitácora para ADMIN.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuditoriaController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditoriaInterceptor }],
})
export class AuditoriaModule {}
