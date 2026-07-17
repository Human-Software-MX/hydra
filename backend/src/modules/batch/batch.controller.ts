import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import { BatchService } from './batch.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class PeriodoDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodo debe tener formato YYYY-MM' })
  periodo?: string;
}

/**
 * Disparo manual y monitoreo de los procesos batch. Los mismos jobs corren
 * solos por cron cuando HYDRA_JOBS_ENABLED=true; estos endpoints permiten
 * ejecutarlos bajo demanda (reproceso, pruebas de operación).
 */
@Controller('batch')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BatchController {
  constructor(private readonly batch: BatchService) {}

  @Get('ejecuciones')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  ejecuciones() {
    return this.batch.ultimasEjecuciones();
  }

  @Post('facturacion')
  @Roles('SUPER_ADMIN', 'ADMIN')
  facturacion(@Body() dto: PeriodoDto) {
    return this.batch.ejecutarFacturacion(dto.periodo ?? this.batch.periodoAnterior());
  }

  @Post('timbrado')
  @Roles('SUPER_ADMIN', 'ADMIN')
  timbrado(@Body() dto: PeriodoDto) {
    return this.batch.ejecutarTimbrado(dto.periodo ?? this.batch.periodoAnterior());
  }

  @Post('vencimientos')
  @Roles('SUPER_ADMIN', 'ADMIN')
  vencimientos() {
    return this.batch.ejecutarAvisosVencimiento();
  }
}
