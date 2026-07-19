import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ContabilidadService } from './contabilidad.service';

@Controller('contabilidad')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContabilidadController {
  constructor(private readonly service: ContabilidadService) {}

  @Get('reglas')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getReglas(@Query('tipoTransaccion') tipo?: string) {
    return this.service.getReglas(tipo);
  }

  @Post('reglas')
  @Roles('SUPER_ADMIN', 'ADMIN')
  createRegla(@Body() body: object) {
    return this.service.createRegla(body as any);
  }

  @Get('polizas')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findPolizas(
    @Query('tipo') tipo?: string,
    @Query('periodo') periodo?: string,
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.service.findPolizas({ tipo, periodo, estado, page, limit });
  }

  @Post('polizas/generar/cobros')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  generarCobros(@Body() body: { fecha: string; periodo: string }) {
    return this.service.generarPolizaCobros(body.fecha, body.periodo);
  }

  @Post('polizas/generar/facturacion')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  generarFacturacion(@Body() body: { fecha: string; periodo: string }) {
    return this.service.generarPolizaFacturacion(body.fecha, body.periodo);
  }

  @Get('polizas/:id/exportar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  async exportar(@Param('id') id: string, @Res() res: Response) {
    const poliza = await this.service.getPoliza(id);
    const idoc = poliza.archivoIdoc ?? this.service.generarIdoc(poliza);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${poliza.numero} ${poliza.tipo}.txt"`);
    res.send(idoc);
  }

  @Get('polizas/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getPoliza(@Param('id') id: string) {
    return this.service.getPoliza(id);
  }
}
