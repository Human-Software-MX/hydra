import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IndicadoresService } from './indicadores.service';

@Controller('indicadores')
@UseGuards(JwtAuthGuard)
export class IndicadoresController {
  constructor(private readonly service: IndicadoresService) {}

  /** KPIs PIGOO/IMTA. `periodo` opcional en formato YYYY-MM; sin él calcula histórico. */
  @Get('pigoo')
  pigoo(@Query('periodo') periodo?: string) {
    return this.service.pigoo(periodo || undefined);
  }
}
