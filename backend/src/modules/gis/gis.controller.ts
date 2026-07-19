import {
  BadRequestException,
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

  /** Contratos afectados dentro de un radio (PostGIS o fallback JS). */
  @Get('afectados')
  afectados(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radioM') radioM: string,
    @Query('limit', new DefaultValuePipe(1000), ParseIntPipe) limit = 1000,
  ) {
    return this.service.afectadosPorRadio({
      lat: Number(lat),
      lng: Number(lng),
      radioM: Number(radioM),
      limit,
    });
  }

  /** Contratos dentro de un polígono GeoJSON (sector, colonia, zona de obra). */
  @Post('consulta-espacial')
  consultaEspacial(@Body() body: { poligono: never; limit?: number }) {
    return this.service.afectadosPorPoligono(body.poligono, body.limit ?? 5000);
  }

  /**
   * Cierre de válvula / trabajo de red: contratos afectados por radio o
   * polígono; con `avisar: true` envía el aviso de interrupción a cada uno.
   */
  @Post('cierres-valvula')
  cierreValvula(
    @Body()
    body: {
      lat?: number;
      lng?: number;
      radioM?: number;
      poligono?: never;
      motivo: string;
      detalle?: string;
      avisar?: boolean;
    },
  ) {
    if (!body?.motivo) throw new BadRequestException('motivo es requerido');
    if (!body.poligono && !(Number.isFinite(body.lat) && Number.isFinite(body.lng) && Number.isFinite(body.radioM))) {
      throw new BadRequestException('Proporcione lat+lng+radioM o un poligono GeoJSON');
    }
    return this.service.cierreValvula(body);
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
