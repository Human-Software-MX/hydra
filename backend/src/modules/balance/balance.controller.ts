import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('balance-hidrico')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BalanceController {
  constructor(private readonly balance: BalanceService) {}

  /**
   * Balance hídrico M36 del periodo. Parámetros de estimación opcionales:
   * autorizadoNoFacturadoM3, fraccionSubmedicion, fraccionNoAutorizado,
   * costoProduccionM3, gradoMacromedicion. Con longitudRedKm + numeroTomas
   * (y opcionalmente presionMediaM, longitudAcometidasKm) se calcula UARL/ILI
   * con banda del Banco Mundial.
   */
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  balancePeriodo(
    @Query('periodo') periodo: string,
    @Query('administracionId') administracionId?: string,
    @Query('autorizadoNoFacturadoM3') autorizadoNoFacturadoM3?: string,
    @Query('fraccionSubmedicion') fraccionSubmedicion?: string,
    @Query('fraccionNoAutorizado') fraccionNoAutorizado?: string,
    @Query('costoProduccionM3') costoProduccionM3?: string,
    @Query('gradoMacromedicion') gradoMacromedicion?: string,
    @Query('longitudRedKm') longitudRedKm?: string,
    @Query('numeroTomas') numeroTomas?: string,
    @Query('longitudAcometidasKm') longitudAcometidasKm?: string,
    @Query('presionMediaM') presionMediaM?: string,
  ) {
    const num = (v?: string) => {
      if (v === undefined || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const redKm = num(longitudRedKm);
    const tomas = num(numeroTomas);
    return this.balance.balancePeriodo({
      periodo,
      administracionId,
      parametros: {
        autorizadoNoFacturadoM3: num(autorizadoNoFacturadoM3),
        fraccionSubmedicion: num(fraccionSubmedicion),
        fraccionNoAutorizado: num(fraccionNoAutorizado),
        costoProduccionM3: num(costoProduccionM3),
        gradoMacromedicion: num(gradoMacromedicion),
      },
      red:
        redKm !== undefined && tomas !== undefined
          ? {
              longitudRedKm: redKm,
              numeroTomas: tomas,
              longitudAcometidasKm: num(longitudAcometidasKm),
              presionMediaM: num(presionMediaM),
            }
          : undefined,
    });
  }
}
