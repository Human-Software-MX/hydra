import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Request,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CajaService } from './caja.service';

@Controller('caja')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CajaController {
  constructor(private readonly service: CajaService) {}

  @Get('sesion-activa')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getSesionActiva(@Request() req: any) {
    return this.service.getSesionActiva(req.user?.id ?? req.user?.sub ?? 'unknown');
  }

  @Post('abrir')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  abrir(@Request() req: any, @Body() body: { montoInicial?: number }) {
    const usuarioId = req.user?.id ?? req.user?.sub ?? 'unknown';
    return this.service.abrir(usuarioId, body.montoInicial ?? 0);
  }

  @Post('cerrar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  cerrar(@Body() body: { sesionId: string }) {
    return this.service.cerrar(body.sesionId);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getHistorial(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.getHistorial({ page, limit });
  }
}
