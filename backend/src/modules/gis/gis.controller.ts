import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { GisService } from './gis.service';

@Controller('gis')
export class GisController {
  constructor(private readonly service: GisService) {}

  @Get('estado')
  getEstado() {
    return this.service.getEstado();
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
