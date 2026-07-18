import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PasarelasService } from './pasarelas.service';
import { CrearIntentoDto } from './dto/crear-intento.dto';

/**
 * Pasarelas de pago digitales (SPEI / OXXO / tarjeta).
 *
 * POST /pasarelas/webhook es deliberadamente público (la pasarela externa no
 * tiene JWT); su seguridad es la verificación de firma del provider.
 */
@Controller('pasarelas')
export class PasarelasController {
  constructor(private readonly pasarelas: PasarelasService) {}

  @Post('intentos')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  crearIntento(@Body() dto: CrearIntentoDto) {
    return this.pasarelas.crearIntento({ ...dto, origen: 'caja' });
  }

  @Get('intentos')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  listarIntentos(@Query('contratoId') contratoId?: string, @Query('estado') estado?: string) {
    return this.pasarelas.listarIntentos({ contratoId, estado });
  }

  /** Notificación de pago de la pasarela externa — sin JWT, valida firma. */
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: Record<string, unknown>,
  ) {
    return this.pasarelas.confirmarWebhook(headers, body);
  }

  /** Demo/QA: confirma el intento como si la pasarela hubiera notificado (solo modo simulada). */
  @Post('intentos/:id/simular-pago')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  simularPago(@Param('id') id: string) {
    return this.pasarelas.simularPagoExitoso(id);
  }
}
