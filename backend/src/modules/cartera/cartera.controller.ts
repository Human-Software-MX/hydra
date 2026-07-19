import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CarteraService } from './cartera.service';
import { DunningService } from './dunning.service';
import { PropensionService } from './propension.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { EvaluarDunningDto, MarcarIncobrableDto, RecalcularCarteraDto } from './dto/cartera.dto';
import { CreateReglaDunningDto, UpdateReglaDunningDto } from './dto/regla-dunning.dto';
import { CreateCampanaDto, EjecutarCampanaDto } from './dto/campana-cobranza.dto';

@Controller('cartera')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CarteraController {
  constructor(
    private readonly cartera: CarteraService,
    private readonly dunning: DunningService,
    private readonly propension: PropensionService,
  ) {}

  // ─── Padrón de cartera ────────────────────────────────────────────────────

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  listar(
    @Query('administracionId') administracionId?: string,
    @Query('zonaId') zonaId?: string,
    @Query('bucket') bucket?: string,
    @Query('categoria') categoria?: string,
    @Query('minDiasMora') minDiasMora?: string,
    @Query('scoreMin') scoreMin?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.cartera.listarCartera({
      administracionId,
      zonaId,
      bucket,
      categoria,
      minDiasMora: minDiasMora != null ? parseInt(minDiasMora, 10) : undefined,
      scoreMin: scoreMin != null ? parseInt(scoreMin, 10) : undefined,
      page,
      limit,
    });
  }

  /** Aging de cartera agrupado por administración/zona (dashboard). */
  @Get('aging')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  aging(
    @Query('administracionId') administracionId?: string,
    @Query('zonaId') zonaId?: string,
  ) {
    return this.cartera.aging({ administracionId, zonaId });
  }

  /** Segmentación predictiva de la cartera (score de propensión al pago). */
  @Get('segmentacion')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  segmentacion(
    @Query('administracionId') administracionId?: string,
    @Query('zonaId') zonaId?: string,
    @Query('segmento') segmento?: string,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit = 500,
  ) {
    return this.propension.segmentacion({ administracionId, zonaId, segmento, limit });
  }

  // ─── Recalculo y dunning manual ───────────────────────────────────────────

  /** Recalcula la cartera: body.contratoId → uno; sin contratoId (o full=1) → backfill completo. */
  @Post('recalcular')
  @Roles('SUPER_ADMIN', 'ADMIN')
  recalcular(@Query('full') full?: string, @Body() dto?: RecalcularCarteraDto) {
    if (dto?.contratoId && full !== '1') {
      return this.cartera.recalcularContrato(dto.contratoId);
    }
    return this.cartera.ejecutarRecalculoNocturno();
  }

  /** Corrida manual del pipeline de dunning (usar dryRun: true primero). */
  @Post('evaluar-dunning')
  @Roles('SUPER_ADMIN', 'ADMIN')
  evaluarDunning(@Body() dto: EvaluarDunningDto) {
    if (dto?.dryRun) return this.dunning.evaluar({ dryRun: true });
    return this.cartera.ejecutarDunningNocturno();
  }

  // ─── Reglas de dunning ────────────────────────────────────────────────────

  @Get('reglas-dunning')
  @Roles('SUPER_ADMIN', 'ADMIN')
  listarReglas() {
    return this.dunning.listarReglas();
  }

  @Post('reglas-dunning')
  @Roles('SUPER_ADMIN', 'ADMIN')
  crearRegla(@Body() dto: CreateReglaDunningDto) {
    return this.dunning.crearRegla(dto);
  }

  /** Siembra las 4 reglas ejemplo del diseño (solo si la tabla está vacía). */
  @Post('reglas-dunning/seed')
  @Roles('SUPER_ADMIN', 'ADMIN')
  seedReglas() {
    return this.dunning.seedReglasDefault();
  }

  @Patch('reglas-dunning/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  actualizarRegla(@Param('id') id: string, @Body() dto: UpdateReglaDunningDto) {
    return this.dunning.actualizarRegla(id, dto);
  }

  @Delete('reglas-dunning/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  eliminarRegla(@Param('id') id: string) {
    return this.dunning.eliminarRegla(id);
  }

  // ─── Campañas de cobranza ─────────────────────────────────────────────────

  @Get('campanas')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  listarCampanas(
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.dunning.listarCampanas({ estado, page, limit });
  }

  @Post('campanas')
  @Roles('SUPER_ADMIN', 'ADMIN')
  crearCampana(@Body() dto: CreateCampanaDto) {
    return this.dunning.crearCampana(dto);
  }

  @Get('campanas/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  obtenerCampana(@Param('id') id: string) {
    return this.dunning.obtenerCampana(id);
  }

  @Post('campanas/:id/ejecutar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  ejecutarCampana(@Param('id') id: string, @Body() dto: EjecutarCampanaDto) {
    return this.dunning.ejecutarCampana(id, dto?.dryRun ?? false);
  }

  // ─── Historial de acciones ────────────────────────────────────────────────

  @Get('acciones')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  listarAcciones(
    @Query('contratoId') contratoId?: string,
    @Query('tipo') tipo?: string,
    @Query('campanaId') campanaId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.cartera.listarAcciones({ contratoId, tipo, campanaId, page, limit });
  }

  // ─── Por contrato ─────────────────────────────────────────────────────────

  @Get('contratos/:id/estado-cuenta')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  estadoCuenta(@Param('id') id: string) {
    return this.cartera.estadoCuentaContrato(id);
  }

  /** Score de propensión al pago del contrato con desglose de factores. */
  @Get('contratos/:id/propension')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  propensionContrato(@Param('id') id: string) {
    return this.propension.propensionContrato(id);
  }

  /** Marca los documentos abiertos como incobrables (siempre manual y autorizado). */
  @Post('contratos/:id/incobrable')
  @Roles('SUPER_ADMIN', 'ADMIN')
  marcarIncobrable(@Param('id') id: string, @Body() dto: MarcarIncobrableDto) {
    return this.cartera.marcarIncobrable(id, dto);
  }
}
