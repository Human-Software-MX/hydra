import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
} from '@nestjs/common';
import { PuntosServicioService } from './puntos-servicio.service';

@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly service: PuntosServicioService) {}

  // --- Tipos de corte ---

  @Get('tipos-corte')
  findTiposCorte() {
    return this.service.findTiposCorte();
  }

  @Post('tipos-corte')
  createTipoCorte(
    @Body()
    body: {
      codigo: string;
      descripcion: string;
      impacto?: string;
      requiereCuadrilla?: boolean;
    },
  ) {
    return this.service.createTipoCorte(body);
  }

  @Patch('tipos-corte/:id')
  updateTipoCorte(
    @Param('id') id: string,
    @Body()
    body: {
      descripcion?: string;
      impacto?: string;
      requiereCuadrilla?: boolean;
      activo?: boolean;
    },
  ) {
    return this.service.updateTipoCorte(id, body);
  }

  // --- Tipos de suministro ---

  @Get('tipos-suministro')
  findTiposSuministro() {
    return this.service.findTiposSuministro();
  }

  @Post('tipos-suministro')
  createTipoSuministro(
    @Body() body: { codigo: string; descripcion: string; activo?: boolean },
  ) {
    return this.service.createTipoSuministro(body);
  }

  // --- Estructuras técnicas ---

  @Get('estructuras-tecnicas')
  findEstructurasTecnicas() {
    return this.service.findEstructurasTecnicas();
  }

  @Post('estructuras-tecnicas')
  createEstructuraTecnica(
    @Body() body: { codigo: string; descripcion: string; activo?: boolean },
  ) {
    return this.service.createEstructuraTecnica(body);
  }

  // --- Zonas de facturación ---

  @Get('zonas-facturacion')
  findZonasFacturacion() {
    return this.service.findZonasFacturacion();
  }

  @Post('zonas-facturacion')
  createZonaFacturacion(
    @Body() body: { codigo: string; descripcion: string; activo?: boolean },
  ) {
    return this.service.createZonaFacturacion(body);
  }

  @Patch('zonas-facturacion/:id')
  updateZonaFacturacion(
    @Param('id') id: string,
    @Body() body: Partial<{ descripcion: string; activo: boolean }>,
  ) {
    return this.service.updateZonaFacturacion(id, body);
  }

  // --- Códigos de recorrido ---

  @Get('codigos-recorrido')
  findCodigosRecorrido() {
    return this.service.findCodigosRecorrido();
  }

  @Post('codigos-recorrido')
  createCodigoRecorrido(
    @Body() body: { codigo: string; descripcion: string; rutaId?: string; activo?: boolean },
  ) {
    return this.service.createCodigoRecorrido(body);
  }

  @Patch('codigos-recorrido/:id')
  updateCodigoRecorrido(
    @Param('id') id: string,
    @Body() body: Partial<{ descripcion: string; rutaId: string; activo: boolean }>,
  ) {
    return this.service.updateCodigoRecorrido(id, body);
  }

  @Get('zonas-territoriales')
  findZonasTerritoriales() {
    return this.service.findZonasTerritoriales();
  }

  @Get('distritos')
  findDistritos() {
    return this.service.findDistritos();
  }
}
