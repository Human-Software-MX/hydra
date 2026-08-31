import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SupraSettlementsService } from './supra-settlements.service';
import { SettlementDto } from './supra-settlements.dto';

/**
 * Settlement write-back de SUPRA → Hydra (contrato acordado con el equipo
 * SUPRA; lo consume el conector de ingesta, pushSettlement). Protegido con la
 * misma auth JWT que el resto del API. Responde 200 tanto en `applied` como en
 * `already_applied` (idempotente).
 */
@Controller('integraciones/supra')
@UseGuards(JwtAuthGuard)
export class SupraSettlementsController {
  constructor(private readonly settlements: SupraSettlementsService) {}

  @Post('settlements')
  @HttpCode(200)
  aplicar(@Body() dto: SettlementDto) {
    return this.settlements.aplicar(dto);
  }
}
