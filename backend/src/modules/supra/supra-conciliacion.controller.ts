import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SupraConciliacionService } from './supra-conciliacion.service';

/** Conciliación espejo↔SUPRA bajo demanda (además del cron de las 04:00). */
@Controller('integraciones/supra/conciliacion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupraConciliacionController {
  constructor(private readonly conciliacion: SupraConciliacionService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  conciliar(@Query('muestra', new DefaultValuePipe(100), ParseIntPipe) muestra: number) {
    return this.conciliacion.conciliar(Math.min(1000, Math.max(1, muestra)));
  }
}
