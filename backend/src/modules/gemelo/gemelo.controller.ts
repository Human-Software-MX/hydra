import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { GemeloService } from './gemelo.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('gemelo-comercial')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GemeloController {
  constructor(private readonly gemelo: GemeloService) {}

  /** Demanda agregada del periodo por zona/administración (m³/día, L/s, tomas). */
  @Get('demanda')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  demanda(
    @Query('periodo') periodo: string,
    @Query('agrupacion') agrupacion?: 'zona' | 'administracion',
  ) {
    return this.gemelo.demanda({ periodo, agrupacion });
  }

  /** Serie de demanda de los últimos N periodos (patrón estacional por grupo). */
  @Get('demanda/serie')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  serie(
    @Query('hasta') hasta: string,
    @Query('periodos', new DefaultValuePipe(12), ParseIntPipe) periodos = 12,
    @Query('agrupacion') agrupacion?: 'zona' | 'administracion',
  ) {
    return this.gemelo.serieDemanda({ hasta, periodos, agrupacion });
  }
}
