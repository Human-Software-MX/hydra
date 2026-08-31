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
  ParseFloatPipe,
} from '@nestjs/common';
import { TarifasService } from './tarifas.service';
import { SimularImpactoDto } from './dto/simular-impacto.dto';
import { Roles, ROLES_ADMIN } from '../auth/roles.decorator';

@Roles(...ROLES_ADMIN)
@Controller('tarifas')
export class TarifasController {
  constructor(private readonly service: TarifasService) {}

  // ─── Tarifa ───────────────────────────────────────────────────────────────

  @Get()
  findAll(
    @Query('tipoServicio') tipoServicio?: string,
    @Query('tipoCalculo') tipoCalculo?: string,
    @Query('soloActivas') soloActivas?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.findAllTarifas({ tipoServicio, tipoCalculo, soloActivas: soloActivas === 'true', page, limit });
  }

  @Get('vigentes')
  findVigentes(
    @Query('tipoServicio') tipoServicio: string,
    @Query('fecha') fecha?: string,
  ) {
    return this.service.findTarifaVigente(tipoServicio, fecha);
  }

  @Get('calcular')
  calcularMonto(
    @Query('tipoServicio') tipoServicio: string,
    @Query('consumoM3', ParseFloatPipe) consumoM3: number,
    @Query('fecha') fecha?: string,
  ) {
    return this.service.calcularMonto({ tipoServicio, consumoM3, fecha });
  }

  /** Simula el impacto de un cambio tarifario sobre los consumos de un periodo (no escribe nada). */
  @Post('simular-impacto')
  @Roles('SUPER_ADMIN', 'ADMIN')
  simularImpacto(@Body() dto: SimularImpactoDto) {
    return this.service.simularImpacto(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOneTarifa(id);
  }

  @Post()
  create(
    @Body()
    body: {
      codigo: string;
      nombre: string;
      tipoServicio: string;
      tipoCalculo: string;
      rangoMinM3?: number;
      rangoMaxM3?: number;
      precioUnitario?: number;
      cuotaFija?: number;
      ivaPct?: number;
      vigenciaDesde: string;
      vigenciaHasta?: string;
    },
  ) {
    return this.service.createTarifa(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      nombre: string;
      rangoMinM3: number;
      rangoMaxM3: number;
      precioUnitario: number;
      cuotaFija: number;
      ivaPct: number;
      vigenciaHasta: string;
      activo: boolean;
    }>,
  ) {
    return this.service.updateTarifa(id, body);
  }

  // ─── Correcciones ─────────────────────────────────────────────────────────

  @Get('correcciones/lista')
  findCorrecciones(@Query('tarifaId') tarifaId?: string) {
    return this.service.findCorrecciones(tarifaId);
  }

  @Post('correcciones')
  createCorreccion(
    @Body()
    body: {
      tarifaId: string;
      tipo: string;
      descripcion: string;
      formula?: string;
      porcentaje?: number;
      montoFijo?: number;
      condiciones?: object;
    },
  ) {
    return this.service.createCorreccion(body);
  }

  @Patch('correcciones/:id')
  updateCorreccion(
    @Param('id') id: string,
    @Body() body: Partial<{ descripcion: string; activo: boolean; porcentaje: number; montoFijo: number }>,
  ) {
    return this.service.updateCorreccion(id, body);
  }

  // ─── Ajustes Manuales ─────────────────────────────────────────────────────

  @Get('ajustes/lista')
  findAjustes(@Query('contratoId') contratoId?: string) {
    return this.service.findAjustes(contratoId);
  }

  @Post('ajustes')
  createAjuste(
    @Body()
    body: {
      contratoId: string;
      periodo: string;
      tipo: string;
      concepto: string;
      montoOriginal: number;
      montoAjustado: number;
      motivo: string;
      aprobadoPor?: string;
    },
  ) {
    return this.service.createAjuste(body);
  }

  // ─── Actualizaciones Trimestrales ─────────────────────────────────────────

  @Get('actualizaciones/lista')
  findActualizaciones(@Query('estado') estado?: string) {
    return this.service.findActualizaciones(estado);
  }

  @Post('actualizaciones')
  createActualizacion(
    @Body()
    body: {
      descripcion: string;
      fechaPublicacion: string;
      fechaAplicacion: string;
      fuenteOficial?: string;
      tarifasAfectadas?: object;
    },
  ) {
    return this.service.createActualizacion(body);
  }

  @Post('actualizaciones/:id/aplicar')
  aplicarActualizacion(
    @Param('id') id: string,
    @Body() body: { aplicadoPor: string },
  ) {
    return this.service.aplicarActualizacion(id, body.aplicadoPor);
  }
}
