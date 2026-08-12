import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  ParseFloatPipe,
} from '@nestjs/common';
import { PuntosServicioService } from './puntos-servicio.service';

@Controller('puntos-servicio')
export class PuntosServicioController {
  constructor(private readonly service: PuntosServicioService) {}

  @Get()
  findAll(
    @Query('estado') estado?: string,
    @Query('tipoSuministroId') tipoSuministroId?: string,
    @Query('domicilioId') domicilioId?: string,
    @Query('cortable') cortable?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.service.findAll({ estado, tipoSuministroId, domicilioId, cortable, page, limit });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body()
    body: {
      codigo: string;
      domicilioId?: string;
      tipoSuministroId?: string;
      estructuraTecnicaId?: string;
      zonaFacturacionId?: string;
      codigoRecorridoId?: string;
      tipoRelacionPadreId?: string;
      diametroToma?: string;
      materialTuberia?: string;
      profundidadToma?: number;
      tieneValvula?: boolean;
      tieneCaja?: boolean;
      gpsLat?: number;
      gpsLng?: number;
      estado?: string;
      cortable?: boolean;
      motivoNoCortable?: string;
    },
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      domicilioId?: string;
      tipoSuministroId?: string;
      estructuraTecnicaId?: string;
      zonaFacturacionId?: string;
      codigoRecorridoId?: string;
      tipoRelacionPadreId?: string | null;
      diametroToma?: string;
      materialTuberia?: string;
      profundidadToma?: number;
      tieneValvula?: boolean;
      tieneCaja?: boolean;
      gpsLat?: number;
      gpsLng?: number;
      estado?: string;
      cortable?: boolean;
      motivoNoCortable?: string;
    },
  ) {
    return this.service.update(id, body);
  }

  @Get(':id/hijos')
  getHijos(@Param('id') id: string) {
    return this.service.getHijos(id);
  }

  @Post(':id/vincular-padre')
  vincularPadre(
    @Param('id') id: string,
    @Body()
    body: { padreId: string; reparticion: number; tipoRelacionPadreId?: string | null },
  ) {
    const opts =
      body.tipoRelacionPadreId !== undefined ? { tipoRelacionPadreId: body.tipoRelacionPadreId } : undefined;
    return this.service.vincularPadre(id, body.padreId, body.reparticion, opts);
  }

  @Delete(':id/vincular-padre')
  desvincularPadre(@Param('id') id: string) {
    return this.service.desvincularPadre(id);
  }
}
