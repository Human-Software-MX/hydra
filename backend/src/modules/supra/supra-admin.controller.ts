import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SupraAdminService } from './supra-admin.service';
import { SupraEventosService } from './supra-eventos.service';
import { SupraOutboxService } from './supra-outbox.service';

/**
 * Operación de la integración SUPRA (análogo a los endpoints de verificación
 * de pagos-externos): salud de inbox/outbox/conciliación y replay manual de
 * comandos `muerto` y eventos en `cuarentena`.
 */
@Controller('integraciones/supra/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupraAdminController {
  constructor(
    private readonly admin: SupraAdminService,
    private readonly outbox: SupraOutboxService,
    private readonly eventos: SupraEventosService,
  ) {}

  @Get('salud')
  @Roles('SUPER_ADMIN', 'ADMIN')
  salud() {
    return this.admin.salud();
  }

  @Post('outbox/:id/replay')
  @Roles('SUPER_ADMIN', 'ADMIN')
  replayComando(@Param('id') id: string) {
    return this.outbox.replayMuerto(id);
  }

  @Post('inbox/:id/replay')
  @Roles('SUPER_ADMIN', 'ADMIN')
  replayEvento(@Param('id') id: string) {
    return this.eventos.replayCuarentena(id);
  }
}
