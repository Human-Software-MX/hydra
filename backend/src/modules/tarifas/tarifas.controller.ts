import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { TarifasService } from './tarifas.service';
import { TarifaVersionesService, UsuarioCtx } from './tarifa-versiones.service';
import { SimularImpactoDto } from './dto/simular-impacto.dto';
import { ListarVigentesQueryDto } from './dto/filtro-tarifas.dto';
import { ActualizarTarifaDto } from './dto/actualizar-tarifa.dto';
import { CreateTarifaDto } from './dto/create-tarifa.dto';
import { UpdateTarifaMetadatosDto } from './dto/update-tarifa-metadatos.dto';
import { CalcularMontoQueryDto } from './dto/calcular-monto.dto';
import { CotizarContratacionQueryDto } from './dto/cotizar-contratacion.dto';
import { AplicarMasivaDto, PreviewMasivaDto } from './dto/actualizacion-masiva.dto';
import { UpdateCategoriaTarifaDto, UpdateClaseTarifaDto } from './dto/catalogo-fiscal.dto';
import { Roles, ROLES_ADMIN, ROLES_SERVICIOS } from '../auth/roles.decorator';

@Roles(...ROLES_ADMIN)
@Controller('tarifas')
export class TarifasController {
  constructor(
    private readonly service: TarifasService,
    private readonly versiones: TarifaVersionesService,
  ) {}

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

  /** Tarifas vigentes a una fecha con su clasificación (sin la tabla de precios). */
  // Lectura permitida a los roles que operan solicitudes (cotización en ventanilla)
  @Roles(...ROLES_SERVICIOS)
  @Get('vigentes')
  findVigentes(@Query() query: ListarVigentesQueryDto) {
    const { fecha, ...filtro } = query;
    return this.versiones.listarVigentes(filtro, fecha);
  }

  /** Servicios / conceptos distintos entre las tarifas vigentes (por catálogo). */
  // Lectura permitida a los roles que operan solicitudes (cotización en ventanilla)
  @Roles(...ROLES_SERVICIOS)
  @Get('servicios')
  findServicios() {
    return this.versiones.listarServicios();
  }

  /**
   * Cotiza un cargo único de contratación con la tarifa vigente resuelta.
   * Se declara antes de `GET :id` (y de las rutas de un solo segmento) para
   * dejar explícito el orden de resolución de rutas de Nest.
   */
  // Lectura permitida a los roles que operan solicitudes (cotización en ventanilla)
  @Roles(...ROLES_SERVICIOS)
  @Get('contratacion/cotizar')
  cotizarContratacion(@Query() query: CotizarContratacionQueryDto) {
    return this.versiones.cotizarContratacion(query);
  }

  /** Kardex global paginado. */
  @Get('movimientos')
  findMovimientos(
    @Query('codigo') codigo?: string,
    @Query('actualizacionId') actualizacionId?: string,
    @Query('tipo') tipo?: string,
    @Query('seccion') seccion?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.versiones.listarMovimientos({ codigo, actualizacionId, tipo, seccion, page, limit });
  }

  /**
   * Cálculo puntual. Sin `administracionId`/`claseTarifaId` suma TODAS las
   * tarifas vigentes del servicio; con ellos resuelve la tarifa como lo haría
   * la facturación del contrato.
   */
  // Lectura permitida a los roles que operan solicitudes (cotización en ventanilla)
  @Roles(...ROLES_SERVICIOS)
  @Get('calcular')
  calcularMonto(@Query() query: CalcularMontoQueryDto) {
    return this.service.calcularMonto(query);
  }

  // ─── Configurador fiscal (categorías / clases) ────────────────────────────

  // Lectura permitida a los roles que operan solicitudes (cotización en ventanilla)
  @Roles(...ROLES_SERVICIOS)
  @Get('catalogo/categorias')
  findCategorias() {
    return this.versiones.listarCategorias();
  }

  @Patch('catalogo/categorias/:id')
  updateCategoria(@Param('id') id: string, @Body() dto: UpdateCategoriaTarifaDto, @Req() req: any) {
    return this.versiones.actualizarCategoria(id, dto, this.usuarioDe(req));
  }

  @Patch('catalogo/clases/:id')
  updateClase(@Param('id') id: string, @Body() dto: UpdateClaseTarifaDto, @Req() req: any) {
    return this.versiones.actualizarClase(id, dto, this.usuarioDe(req));
  }

  // ─── Actualizaciones Trimestrales ─────────────────────────────────────────

  /** Previsualiza el ajuste porcentual masivo (no escribe nada). */
  @Post('actualizaciones/preview')
  previewMasiva(@Body() dto: PreviewMasivaDto) {
    return this.versiones.previewMasiva(dto);
  }

  /** Aplica el ajuste porcentual masivo: lote + una versión y un movimiento por tarifa. */
  @Post('actualizaciones/aplicar')
  aplicarMasiva(@Body() dto: AplicarMasivaDto, @Req() req: any) {
    return this.versiones.aplicarMasiva(dto, this.usuarioDe(req));
  }

  @Get('actualizaciones/lista')
  findActualizaciones(@Query('estado') estado?: string) {
    return this.versiones.listarActualizaciones(estado);
  }

  @Get('actualizaciones/:id')
  findActualizacion(@Param('id') id: string) {
    return this.versiones.getActualizacion(id);
  }

  /** Simula el impacto de un cambio tarifario sobre los consumos de un periodo (no escribe nada). */
  @Post('simular-impacto')
  @Roles('SUPER_ADMIN', 'ADMIN')
  simularImpacto(@Body() dto: SimularImpactoDto) {
    return this.service.simularImpacto(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.versiones.getTarifaDetalle(id);
  }

  /** Historia completa del linaje (versiones + movimientos). */
  @Get(':id/kardex')
  findKardex(@Param('id') id: string) {
    return this.versiones.getKardex(id);
  }

  /** Alta de una nueva versión (valores, porcentaje o IVA) conservando el histórico. */
  @Post(':id/actualizar')
  actualizarTarifa(@Param('id') id: string, @Body() dto: ActualizarTarifaDto, @Req() req: any) {
    return this.versiones.actualizarTarifa(id, dto, this.usuarioDe(req));
  }

  @Post()
  create(@Body() dto: CreateTarifaDto) {
    return this.service.createTarifa(dto);
  }

  /** Metadatos de la tarifa (nombre, activo, vigenciaHasta). Los valores van por `/actualizar`. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTarifaMetadatosDto) {
    return this.service.updateTarifa(id, dto);
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

  // ─── Actualizaciones Trimestrales (alta manual del lote) ──────────────────

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

  /** Usuario del JWT que firma los movimientos del Kardex. */
  private usuarioDe(req: any): UsuarioCtx {
    return {
      usuarioId: req?.user?.userId ?? req?.user?.sub ?? null,
      usuarioEmail: req?.user?.email ?? null,
    };
  }
}
