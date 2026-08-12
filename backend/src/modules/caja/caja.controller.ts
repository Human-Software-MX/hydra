import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { CajaService } from './caja.service';

@Controller('caja')
export class CajaController {
  constructor(private readonly service: CajaService) {}

  @Get('sesion-activa')
  getSesionActiva(@Request() req: any) {
    return this.service.getSesionActiva(req.user?.id ?? req.user?.sub ?? 'unknown');
  }

  @Post('abrir')
  abrir(@Request() req: any, @Body() body: { montoInicial?: number }) {
    const usuarioId = req.user?.id ?? req.user?.sub ?? 'unknown';
    return this.service.abrir(usuarioId, body.montoInicial ?? 0);
  }

  @Post('cerrar')
  cerrar(@Body() body: { sesionId: string }) {
    return this.service.cerrar(body.sesionId);
  }

  @Get()
  getHistorial(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.getHistorial({ page, limit });
  }
}
