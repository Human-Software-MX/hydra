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
import { ProcesosContratacionService } from './procesos-contratacion.service';
import { Roles, ROLES_SERVICIOS } from '../auth/roles.decorator';

@Roles(...ROLES_SERVICIOS)
@Controller('procesos-contratacion')
export class ProcesosContratacionController {
  constructor(private readonly service: ProcesosContratacionService) {}

  // ─── Procesos ─────────────────────────────────────────────────────────────

  @Get()
  findAll(
    @Query('contratoId') contratoId?: string,
    @Query('etapa') etapa?: string,
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.findAll({ contratoId, etapa, estado, page, limit });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body()
    body: {
      contratoId?: string;
      tramiteId?: string;
      plantillaId?: string;
      creadoPor?: string;
      datosAdicionales?: object;
    },
  ) {
    return this.service.create(body);
  }

  @Post(':id/avanzar')
  avanzar(
    @Param('id') id: string,
    @Body() body: { nota?: string; usuario?: string; datosAdicionales?: object },
  ) {
    return this.service.avanzarEtapa(id, body);
  }

  @Post(':id/cancelar')
  cancelar(
    @Param('id') id: string,
    @Body() body: { motivo: string; usuario?: string },
  ) {
    return this.service.cancelar(id, body.motivo, body.usuario);
  }

  // ─── Plantillas ───────────────────────────────────────────────────────────

  @Get('plantillas/lista')
  findPlantillas(@Query('soloActivas') soloActivas?: string) {
    return this.service.findPlantillas(soloActivas === 'true');
  }

  @Get('plantillas/:id')
  findOnePlantilla(@Param('id') id: string) {
    return this.service.findOnePlantilla(id);
  }

  @Post('plantillas')
  createPlantilla(
    @Body()
    body: {
      nombre: string;
      version?: string;
      contenido: string;
      variables?: object;
    },
  ) {
    return this.service.createPlantilla(body);
  }

  @Patch('plantillas/:id')
  updatePlantilla(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      nombre: string;
      version: string;
      contenido: string;
      variables: object;
      activo: boolean;
    }>,
  ) {
    return this.service.updatePlantilla(id, body);
  }
}
