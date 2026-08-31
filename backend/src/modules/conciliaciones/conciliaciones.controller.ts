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
import { Roles, ROLES_ADMIN } from '../auth/roles.decorator';

@Roles(...ROLES_ADMIN)
@Controller('conciliaciones')
export class ConciliacionesController {
  constructor(private readonly service: ConciliacionesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  listar(
    @Query('tipo') tipo?: string,
    @Query('periodo') periodo?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.listar({ tipo, periodo, page, limit });
  }

  @Post('ejecutar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
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
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  marcarEstado(@Param('id') id: string, @Body() body: { estado: string }) {
    return this.service.marcarEstado(id, body.estado);
  }
}
