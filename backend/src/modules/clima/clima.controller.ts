import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsOptional, IsString, Matches } from 'class-validator';
import { ClimaService } from './clima.service';
import { SequiaService, RegistroSequiaEntrada } from './sequia.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class IngestaSequiaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaCorte debe ser YYYY-MM-DD' })
  fechaCorte!: string;

  @IsOptional()
  @IsArray()
  registros?: RegistroSequiaEntrada[];

  @IsOptional()
  @IsString()
  csv?: string;
}

@Controller('clima')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClimaController {
  constructor(
    private readonly clima: ClimaService,
    private readonly sequia: SequiaService,
  ) {}

  /** Resumen del corte vigente del Monitor de Sequía CONAGUA para el estado. */
  @Get('sequia')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  sequiaActual(@Query('estado') estado?: string) {
    return this.sequia.resumenActual(estado);
  }

  /** Ingesta manual del corte quincenal MSM (registros JSON o CSV simple). */
  @Post('sequia/ingesta')
  @Roles('SUPER_ADMIN', 'ADMIN')
  ingestarSequia(@Body() dto: IngestaSequiaDto) {
    return this.sequia.ingestar(dto);
  }

  /** Ingesta desde CSV remoto configurado en CLIMA_SEQUIA_URL. */
  @Post('sequia/ingesta-remota')
  @Roles('SUPER_ADMIN', 'ADMIN')
  ingestarSequiaRemota(@Body() dto: { fechaCorte: string }) {
    return this.sequia.ingestarRemoto(dto.fechaCorte);
  }

  /** Pronóstico diario + alertas de riesgo para una coordenada (o la sede). */
  @Get('pronostico')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  pronostico(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('dias') dias?: string,
  ) {
    const num = (v?: string) => {
      const n = Number(v);
      return v !== undefined && v !== '' && Number.isFinite(n) ? n : undefined;
    };
    return this.clima.pronostico({ lat: num(lat), lng: num(lng), dias: num(dias) });
  }

  /** Riesgos climáticos por zona operativa (centroides del padrón). */
  @Get('riesgos')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  riesgos(@Query('administracionId') administracionId?: string, @Query('dias') dias?: string) {
    const n = Number(dias);
    return this.clima.riesgosPorZona({
      administracionId,
      dias: dias && Number.isFinite(n) ? n : undefined,
    });
  }
}
