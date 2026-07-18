import { Controller, Get, Post, Patch, Query, Param, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PortalService } from './portal.service';
import { CrearIntentoPortalDto } from '../pasarelas/dto/crear-intento.dto';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  contratoIds: string[];
}

@UseGuards(JwtAuthGuard)
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

  @Post('contratos/:id/intentos-pago')
  crearIntentoPago(@Param('id') contratoId: string, @Body() dto: CrearIntentoPortalDto, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.crearIntentoPago(contratoId, user.contratoIds ?? [], dto);
  }

  @Get('contratos/:id/intentos-pago')
  getIntentosPago(@Param('id') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getIntentosPago(contratoId, user.contratoIds ?? []);
  }

  @Post('contratos/:id/intentos-pago/:intentoId/simular')
  simularPagoIntento(
    @Param('id') contratoId: string,
    @Param('intentoId') intentoId: string,
    @Req() req: Request,
  ) {
    const user = req.user as AuthUser;
    return this.portalService.simularPagoIntento(contratoId, user.contratoIds ?? [], intentoId);
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
