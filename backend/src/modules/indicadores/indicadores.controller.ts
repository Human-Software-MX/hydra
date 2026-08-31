import { Controller, Get, Post, Body, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { IndicadoresService } from './indicadores.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class VolumenProducidoDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodo debe tener formato YYYY-MM' })
  periodo!: string;

  @IsNumber()
  @Min(0)
  m3!: number;

  @IsOptional()
  @IsString()
  administracionId?: string;

  @IsOptional()
  @IsString()
  fuente?: string;

  @IsOptional()
  @IsString()
  notas?: string;
}

@Controller('indicadores')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IndicadoresController {
  constructor(private readonly indicadores: IndicadoresService) {}

  /** Indicadores PIGOO del periodo (YYYY-MM); sin `periodo` calcula el acumulado histórico. */
  @Get('pigoo')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  pigoo(@Query('periodo') periodo?: string) {
    return this.indicadores.pigoo(periodo || undefined);
  }

  /** Serie histórica de indicadores entre dos periodos (máx. 24). */
  @Get('pigoo/serie')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  serie(@Query('desde') desde: string, @Query('hasta') hasta: string) {
    return this.indicadores.serie(desde, hasta);
  }

  /** Export CSV para reporte PIGOO/CONAGUA. */
  @Get('pigoo/csv')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  async csv(@Query('desde') desde: string, @Query('hasta') hasta: string, @Res() res: Response) {
    const csv = await this.indicadores.csv(desde, hasta);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pigoo-${desde}-a-${hasta}.csv"`);
    res.send(csv);
  }

  /**
   * Pronóstico de facturación/recaudación/consumo a N periodos (default 3,
   * máx. 24). Método en cascada según historia: Holt-Winters aditivo (≥24
   * meses), naive estacional (≥13) o promedio móvil (<13).
   */
  @Get('forecast')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  forecast(
    @Query('metrica') metrica?: string,
    @Query('horizonte') horizonte?: string,
    @Query('administracionId') administracionId?: string,
  ) {
    return this.indicadores.forecast({
      metrica: (metrica as 'facturado' | 'recaudado' | 'consumo') || 'facturado',
      horizonte: horizonte ? parseInt(horizonte, 10) : 3,
      administracionId,
    });
  }

  /** Captura/actualiza el volumen producido del periodo (macromedición). */
  @Post('volumen-producido')
  @Roles('SUPER_ADMIN', 'ADMIN')
  registrarVolumen(@Body() dto: VolumenProducidoDto) {
    return this.indicadores.registrarVolumenProducido(dto);
  }

  @Get('volumen-producido')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  listarVolumenes(@Query('periodo') periodo?: string) {
    return this.indicadores.listarVolumenes(periodo);
  }
}
