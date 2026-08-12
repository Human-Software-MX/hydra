import { Controller, Get, Post, Patch, Query, Param, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PortalGuard } from '../auth/portal.guard';
import { AllowPortal } from '../auth/allow-portal.decorator';
import { PortalService } from './portal.service';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  contratoIds: string[];
}

// Superficie del portal de clientes. El JWT lo valida el guard global;
// @AllowPortal() levanta el filtro de audiencia interna y PortalGuard cierra
// el otro lado: aquí sólo entran tokens con rol CLIENTE.
@AllowPortal()
@UseGuards(PortalGuard)
@Controller('portal')
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Get('contratos')
  getContratos(@Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getContratos(user.contratoIds ?? []);
  }

  @Get('consumos')
  getConsumos(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getConsumos(contratoId, user.contratoIds ?? []);
  }

  @Get('timbrados')
  getTimbrados(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getTimbrados(contratoId, user.contratoIds ?? []);
  }

  @Get('timbrados/:id/descargar')
  getTimbradoDescarga(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getTimbradoDescarga(id, user.contratoIds ?? []);
  }

  @Get('recibos')
  getRecibos(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getRecibos(contratoId, user.contratoIds ?? []);
  }

  @Get('pagos')
  getPagos(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getPagos(contratoId, user.contratoIds ?? []);
  }

  @Get('saldos')
  getSaldos(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getSaldos(contratoId, user.contratoIds ?? []);
  }

  @Get('ordenes')
  getOrdenes(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getOrdenes(contratoId, user.contratoIds ?? []);
  }

  @Get('estado-operativo')
  getEstadoOperativo(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getEstadoOperativo(contratoId, user.contratoIds ?? []);
  }

  @Get('datos-fiscales')
  getDatosFiscales(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getDatosFiscales(contratoId, user.contratoIds ?? []);
  }

  @Patch('datos-fiscales')
  updateDatosFiscales(
    @Query('contratoId') contratoId: string,
    @Body() body: { rfc?: string; razonSocial?: string; regimenFiscal?: string; constanciaFiscalUrl?: string },
    @Req() req: Request,
  ) {
    const user = req.user as AuthUser;
    return this.portalService.updateDatosFiscales(contratoId, user.contratoIds ?? [], body);
  }

  @Get('contactos')
  getContactos(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getContactos(contratoId, user.contratoIds ?? []);
  }

  @Post('contactos')
  addContacto(
    @Query('contratoId') contratoId: string,
    @Body() body: { personaId?: string; nombre?: string; rfc?: string; email?: string; telefono?: string; rol: string },
    @Req() req: Request,
  ) {
    const user = req.user as AuthUser;
    return this.portalService.addContacto(contratoId, user.contratoIds ?? [], body);
  }
}
