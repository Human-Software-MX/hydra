import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ContratosService } from './contratos.service';
import { CreateContratoDto } from './dto/create-contrato.dto';
import { UpdateContratoDto } from './dto/update-contrato.dto';
import { TiposContratacionService } from '../tipos-contratacion/tipos-contratacion.service';
import { BillingEngineService } from './billing-engine.service';

@Controller('contratos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContratosController {
  constructor(
    private readonly contratosService: ContratosService,
    private readonly tiposContratacionService: TiposContratacionService,
    private readonly billingEngine: BillingEngineService,
  ) {}

  // IMPORTANT: static routes declared BEFORE /:id
  @Get('search')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  search(
    @Query('q') q: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
  ) {
    return this.contratosService.search(q ?? '', limit);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findAll() {
    return this.contratosService.findAll();
  }

  @Get(':id/flujo-completo')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getFlujoCompleto(@Param('id') id: string) {
    return this.contratosService.getFlujoCompleto(id);
  }

  @Get(':id/historial')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getHistorial(@Param('id') id: string) {
    return this.contratosService.getHistorial(id);
  }

  @Get(':id/contexto-atencion')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getContextoAtencion(@Param('id') id: string) {
    return this.contratosService.getContextoAtencion(id);
  }

  @Get(':id/estado-operativo')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getEstadoOperativo(@Param('id') id: string) {
    return this.contratosService.getEstadoOperativo(id);
  }

  @Get(':id/texto-contrato')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getTextoContratoPreview(@Param('id') id: string) {
    return this.contratosService.getTextoContratoPreview(id);
  }

  @Get(':id/contrato-pdf')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  async getContratoPdf(@Param('id') id: string, @Res() res: Response) {
    const html = await this.contratosService.getContratoPdf(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Post(':id/factura-contratacion')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  crearFacturaContratacion(@Param('id') id: string) {
    return this.contratosService.crearFacturaContratacion(id);
  }

  @Post('preview-facturacion')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  previewFacturacion(
    @Body() body: { tipoContratacionId: string; variables: Record<string, string | number | boolean> },
  ) {
    return this.billingEngine.calcular(body.tipoContratacionId, body.variables ?? {});
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findOne(@Param('id') id: string) {
    return this.contratosService.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  create(@Body() dto: CreateContratoDto) {
    return this.contratosService.create(dto);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  update(@Param('id') id: string, @Body() dto: UpdateContratoDto) {
    return this.contratosService.update(id, dto);
  }

  @Post(':id/cambiar-tipo')
  @Roles('SUPER_ADMIN', 'ADMIN')
  cambiarTipo(
    @Param('id') id: string,
    @Body() body: { nuevoTipoId: string; motivo: string; usuario?: string },
  ) {
    return this.tiposContratacionService.cambiarTipoContrato(
      id,
      body.nuevoTipoId,
      body.motivo,
      body.usuario,
    );
  }
}
