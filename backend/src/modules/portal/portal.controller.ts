import { Controller, Get, Post, Patch, Query, Param, Body, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PortalGuard } from '../auth/portal.guard';
import { AllowPortal } from '../auth/allow-portal.decorator';
import { PortalService } from './portal.service';
import { CrearIntentoPortalDto } from './dto/crear-intento-portal.dto';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  contratoIds: string[];
}

/** POST /portal/reportes-fuga — reporte de fuga desde el portal del cliente. */
export class CrearReporteFugaDto {
  @IsString()
  @IsNotEmpty({ message: 'La descripción de la fuga es obligatoria' })
  @MaxLength(2000)
  descripcion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ubicacion?: string;
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

  /** Descarga del XML timbrado (CFDI) del propio contrato. */
  @Get('timbrados/:id/descargar')
  async getTimbradoDescarga(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const user = req.user as AuthUser;
    const { xml, timbradoId } = await this.portalService.getTimbradoDescarga(id, user.contratoIds ?? []);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cfdi-${timbradoId}.xml"`);
    res.send(xml);
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

  @Post('reportes-fuga')
  crearReporteFuga(
    @Query('contratoId') contratoId: string,
    @Body() dto: CrearReporteFugaDto,
    @Req() req: Request,
  ) {
    const user = req.user as AuthUser;
    return this.portalService.crearReporteFuga(contratoId, user.contratoIds ?? [], dto);
  }

  @Get('reportes-fuga')
  getReportesFuga(@Query('contratoId') contratoId: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    return this.portalService.getReportesFuga(contratoId, user.contratoIds ?? []);
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
