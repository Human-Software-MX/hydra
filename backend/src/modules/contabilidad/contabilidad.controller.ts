import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ContabilidadService } from './contabilidad.service';
import { Roles, ROLES_ADMIN } from '../auth/roles.decorator';

@Roles(...ROLES_ADMIN)
@Controller('contabilidad')
export class ContabilidadController {
  constructor(private readonly service: ContabilidadService) {}

  @Get('reglas')
  getReglas(@Query('tipoTransaccion') tipo?: string) {
    return this.service.getReglas(tipo);
  }

  @Post('reglas')
  createRegla(@Body() body: object) {
    return this.service.createRegla(body as any);
  }

  @Get('polizas')
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
  generarCobros(@Body() body: { fecha: string; periodo: string }) {
    return this.service.generarPolizaCobros(body.fecha, body.periodo);
  }

  @Post('polizas/generar/facturacion')
  generarFacturacion(@Body() body: { fecha: string; periodo: string }) {
    return this.service.generarPolizaFacturacion(body.fecha, body.periodo);
  }

  @Get('polizas/:id/exportar')
  async exportar(@Param('id') id: string, @Res() res: Response) {
    const poliza = await this.service.getPoliza(id);
    const idoc = poliza.archivoIdoc ?? this.service.generarIdoc(poliza);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${poliza.numero} ${poliza.tipo}.txt"`);
    res.send(idoc);
  }

  @Get('polizas/:id')
  getPoliza(@Param('id') id: string) {
    return this.service.getPoliza(id);
  }
}
