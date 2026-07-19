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
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GisService } from './gis.service';

@Controller('gis')
@UseGuards(JwtAuthGuard)
export class GisController {
  constructor(private readonly service: GisService) {}

  @Get('estado')
  getEstado() {
    return this.service.getEstado();
  }

  /** Padrón georreferenciado (GeoJSON) para el mapa operativo. */
  @Get('padron.geojson')
  padronGeojson(
    @Query('zonaId') zonaId?: string,
    @Query('administracionId') administracionId?: string,
    @Query('limit', new DefaultValuePipe(5000), ParseIntPipe) limit = 5000,
  ) {
    return this.service.padronGeojson({ zonaId, administracionId, limit });
  }

  /** Centroides del padrón por zona (mapa + pronóstico climático por zona). */
  @Get('zonas/centroides')
  centroides(@Query('administracionId') administracionId?: string) {
    return this.service.centroidesZonas({ administracionId });
  }

  @Get('cambios/pendientes')
  getDelta(@Query('entidades') entidades?: string) {
    return this.service.getDelta({
      entidades: entidades ? entidades.split(',') : undefined,
    });
  }

  @Post('sincronizaciones/iniciar')
  iniciarSync() {
    return this.service.iniciarSync();
  }

  @Post('sincronizaciones/:id/completar')
  completarSync(
    @Param('id') id: string,
    @Body()
    body: {
      estado: 'exitosa' | 'fallida';
      totalExportados: number;
      totalErrores: number;
      detalles?: object;
    },
  ) {
    return this.service.completarSync(id, body);
  }

  @Get('sincronizaciones')
  getHistorial(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.getHistorialSync({ page, limit });
  }

  @Post('conciliacion')
  conciliar(@Body() body: { entidad: string; idsEnGIS: string[] }) {
    return this.service.conciliar(body);
  }
}
