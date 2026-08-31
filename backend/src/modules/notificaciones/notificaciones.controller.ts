import { Controller, Get, Post, Body, Query, Param, UseGuards } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { NotificacionesService } from './notificaciones.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class PruebaDto {
  @IsIn(['email', 'whatsapp'])
  canal!: 'email' | 'whatsapp';

  @IsString()
  @MinLength(3)
  destinatario!: string;

  @IsOptional()
  @IsString()
  mensaje?: string;
}

@Controller('notificaciones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificacionesController {
  constructor(private readonly notificaciones: NotificacionesService) {}

  /** Bitácora de notificaciones enviadas. */
  @Get('logs')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  logs(
    @Query('contratoId') contratoId?: string,
    @Query('canal') canal?: string,
    @Query('tipo') tipo?: string,
  ) {
    return this.notificaciones.listarLogs({ contratoId, canal, tipo });
  }

  /** Envío de prueba (verifica el canal configurado). */
  @Post('prueba')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async prueba(@Body() dto: PruebaDto) {
    const mensaje = dto.mensaje ?? 'Mensaje de prueba de Hydra.';
    if (dto.canal === 'email') {
      return this.notificaciones.enviarEmail({
        destinatario: dto.destinatario,
        asunto: 'Prueba Hydra',
        cuerpo: `<p>${mensaje}</p>`,
        tipo: 'prueba',
      });
    }
    return this.notificaciones.enviarWhatsApp({ telefono: dto.destinatario, mensaje, tipo: 'prueba' });
  }

  /** Notifica al usuario que su recibo está disponible. */
  @Post('recibo/:reciboId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  notificarRecibo(@Param('reciboId') reciboId: string) {
    return this.notificaciones.notificarReciboEmitido(reciboId);
  }

  /** Envía aviso de vencimiento de un recibo. */
  @Post('vencimiento/:reciboId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  notificarVencimiento(@Param('reciboId') reciboId: string) {
    return this.notificaciones.notificarVencimiento(reciboId);
  }
}
