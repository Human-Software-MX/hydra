import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ConciliacionesService } from './conciliaciones.service';

@Controller('conciliaciones')
export class ConciliacionesController {
  constructor(private readonly service: ConciliacionesService) {}

  @Get()
  listar(
    @Query('tipo') tipo?: string,
    @Query('periodo') periodo?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.listar({ tipo, periodo, page, limit });
  }

  @Post('ejecutar')
  ejecutar(@Body() body: { tipo: string; periodo: string }) {
    return this.service.ejecutar(
      body.tipo as
        | 'PADRON_VS_GIS'
        | 'RECAUDACION_VS_FACTURACION'
        | 'FACTURACION_VS_CONTABILIDAD',
      body.periodo,
    );
  }

  @Post(':id/estado')
  marcarEstado(@Param('id') id: string, @Body() body: { estado: string }) {
    return this.service.marcarEstado(id, body.estado);
  }
}
