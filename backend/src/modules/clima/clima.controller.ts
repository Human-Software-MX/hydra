import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ClimaService } from './clima.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('clima')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClimaController {
  constructor(private readonly clima: ClimaService) {}

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
