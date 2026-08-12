import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { OrdenesService } from './ordenes.service';
import { Roles, ROLES_OPERACION } from '../auth/roles.decorator';

@Controller('ordenes')
export class OrdenesController {
  constructor(private readonly service: OrdenesService) {}

  @Get('estadisticas')
  getEstadisticas() {
    return this.service.getEstadisticas();
  }

  @Get('servicio/contrato/:contratoId')
  getByContrato(@Param('contratoId') contratoId: string) {
    return this.service.getByContrato(contratoId);
  }

  @Get()
  findAll(
    @Query('contratoId') contratoId?: string,
    @Query('tipo') tipo?: string,
    @Query('estado') estado?: string,
    @Query('operadorId') operadorId?: string,
    @Query('subtipoCorteId') subtipoCorteId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.service.findAll({ contratoId, tipo, estado, operadorId, subtipoCorteId, desde, hasta, page, limit });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body()
    body: {
      contratoId: string;
      tipo: string;
      subtipoCorteId?: string;
      prioridad?: string;
      fechaProgramada?: string;
      operadorId?: string;
      notas?: string;
      externalRef?: string;
      origenAutomatico?: boolean;
      eventoOrigen?: string;
      ubicacionCorte?: string;
      condicionCortable?: boolean;
    },
  ) {
    return this.service.create(body);
  }

  @Roles(...ROLES_OPERACION)
  @Patch(':id/estado')
  updateEstado(
    @Param('id') id: string,
    @Body() body: { estado: string; nota?: string; usuario?: string },
  ) {
    return this.service.updateEstado(id, body.estado, body.nota, body.usuario);
  }

  @Patch(':id/datos-campo')
  updateDatosCampo(@Param('id') id: string, @Body() body: object) {
    return this.service.actualizarDatosCampo(id, body);
  }

  @Get(':id/seguimientos')
  getSeguimientos(@Param('id') id: string) {
    return this.service.findOne(id).then((o) => o.seguimientos);
  }

  @Post(':id/seguimientos')
  addSeguimiento(
    @Param('id') id: string,
    @Body() body: { nota: string; usuario?: string; estadoNuevo?: string },
  ) {
    return this.service.addSeguimiento(id, body);
  }
}
