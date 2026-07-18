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
import { IsBoolean, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { MdmService } from './mdm.service';
import { TandeoService } from './tandeo.service';
import { MdmIngestGuard } from './mdm-ingest.guard';
import { IngestarLecturasDto } from './dto/ingestar-lecturas.dto';
import {
  ActualizarCalendarioSuministroDto,
  CrearCalendarioSuministroDto,
} from './dto/calendario-suministro.dto';

class DetectarFugasDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  horasMinimas?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  caudalMinimoLh?: number;

  /** Si true, además de detectar envía los avisos a los usuarios afectados. */
  @IsOptional()
  @IsBoolean()
  notificar?: boolean;
}

/**
 * Ingesta de lecturas de intervalo — controller separado porque su guard es
 * dual (X-API-KEY de colector IoT o JWT interno) y no puede convivir con el
 * JwtAuthGuard a nivel de clase del resto del módulo.
 */
@Controller('mdm')
export class MdmIngestController {
  constructor(private readonly mdm: MdmService) {}

  /** Ingesta bulk idempotente (máx 10,000 lecturas por request). */
  @Post('lecturas')
  @UseGuards(MdmIngestGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  ingestar(@Body() dto: IngestarLecturasDto) {
    return this.mdm.ingestarLecturas(dto.lecturas);
  }
}

@Controller('mdm')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MdmController {
  constructor(
    private readonly mdm: MdmService,
    private readonly tandeo: TandeoService,
  ) {}

  // ─── Series de intervalo ───────────────────────────────────────────────────

  /** Serie de un medidor (cruda o agregada por hora/día). */
  @Get('medidores/:id/serie')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  serie(
    @Param('id') id: string,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('resolucion') resolucion?: string,
  ) {
    return this.mdm.serieMedidor(id, desde, hasta, resolucion);
  }

  // ─── Fugas ─────────────────────────────────────────────────────────────────

  /** Corre la detección de flujo nocturno continuo bajo demanda. */
  @Post('detectar-fugas')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async detectarFugas(@Body() dto: DetectarFugasDto) {
    const resultado = await this.mdm.detectarFugas({
      horasMinimas: dto.horasMinimas,
      caudalMinimoLh: dto.caudalMinimoLh,
    });
    if (dto.notificar) {
      const avisos = await this.mdm.notificarFugas(resultado.candidatos);
      return { ...resultado, avisos };
    }
    return resultado;
  }

  /** Últimas alarmas de fuga persistidas en las series de intervalo. */
  @Get('alertas')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  alertas(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50) {
    return this.mdm.alertasFuga(limit);
  }

  // ─── Calendarios de suministro (tandeo) ────────────────────────────────────
  // Nota: las rutas literales (vigente, estado) van ANTES de ':id'.

  @Get('calendarios-suministro/vigente')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  vigente(@Query('sectorId') sectorId: string, @Query('fecha') fecha?: string) {
    return this.tandeo.calendarioVigente(sectorId, fecha);
  }

  /** ¿Hay suministro programado en el sector en ese instante? (default: ahora) */
  @Get('calendarios-suministro/estado')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  estado(@Query('sectorId') sectorId: string, @Query('en') en?: string) {
    return this.tandeo.estaEnSuministro(sectorId, en ? new Date(en) : new Date());
  }

  @Get('calendarios-suministro')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  listarCalendarios(@Query('sectorId') sectorId?: string, @Query('activo') activo?: string) {
    return this.tandeo.listar({
      sectorId,
      activo: activo === undefined ? undefined : activo === 'true',
    });
  }

  @Get('calendarios-suministro/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  obtenerCalendario(@Param('id') id: string) {
    return this.tandeo.obtener(id);
  }

  @Post('calendarios-suministro')
  @Roles('SUPER_ADMIN', 'ADMIN')
  crearCalendario(@Body() dto: CrearCalendarioSuministroDto) {
    return this.tandeo.crear(dto);
  }

  @Patch('calendarios-suministro/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  actualizarCalendario(@Param('id') id: string, @Body() dto: ActualizarCalendarioSuministroDto) {
    return this.tandeo.actualizar(id, dto);
  }

  @Delete('calendarios-suministro/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  eliminarCalendario(@Param('id') id: string) {
    return this.tandeo.eliminar(id);
  }
}
