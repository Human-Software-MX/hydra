import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Res,
  ParseIntPipe,
  DefaultValuePipe,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { ContratosService } from './contratos.service';
import { CreateContratoDto } from './dto/create-contrato.dto';
import { UpdateContratoDto } from './dto/update-contrato.dto';
import { TiposContratacionService } from '../tipos-contratacion/tipos-contratacion.service';
import { BillingEngineService } from './billing-engine.service';
import { Roles, ROLES_ADMIN } from '../auth/roles.decorator';

@ApiTags('contratos')
@ApiBearerAuth()
@Controller('contratos')
export class ContratosController {
  constructor(
    private readonly contratosService: ContratosService,
    private readonly tiposContratacionService: TiposContratacionService,
    private readonly billingEngine: BillingEngineService,
  ) {}

  // IMPORTANT: static routes declared BEFORE /:id
  @ApiOperation({ summary: 'Busca contratos por número, titular o RFC' })
  @Get('search')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  search(
    @Query('q') q: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
  ) {
    return this.contratosService.search(q ?? '', limit);
  }

  @ApiOperation({ summary: 'Lista todos los contratos' })
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('updatedSince') updatedSince?: string,
  ) {
    // Con `page` presente → envelope paginado (contrato para el conector de
    // SUPRA); sin `page` → array legacy completo (UI de Hydra intacta).
    if (page !== undefined) {
      return this.contratosService.findAllPaginado({
        page: Math.max(1, Number(page) || 1),
        limit: Math.min(500, Math.max(1, Number(limit) || 100)),
        updatedSince,
      });
    }
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

  @ApiOperation({
    summary: 'Previsualiza la facturación de un tipo de contratación',
    description: 'Calcula conceptos y montos sin persistir. Una tarifa inválida devuelve 422 con el detalle.',
  })
  @Post('preview-facturacion')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  async previewFacturacion(
    @Body() body: { tipoContratacionId: string; variables: Record<string, string | number | boolean> },
  ) {
    try {
      return await this.billingEngine.calcular(body.tipoContratacionId, body.variables ?? {});
    } catch (err: unknown) {
      // B3: safeEvalArithmetic lanza Error con la expresión ofensiva. El preview
      // debe devolver ese mensaje descriptivo al wizard, NO un 500 enmascarado.
      if (err instanceof HttpException) throw err;
      throw new UnprocessableEntityException(
        err instanceof Error ? err.message : 'No se pudo calcular la facturación (tarifa inválida).',
      );
    }
  }

  @ApiOperation({ summary: 'Obtiene un contrato por id' })
  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findOne(@Param('id') id: string) {
    return this.contratosService.findOne(id);
  }

  @ApiOperation({ summary: 'Crea un contrato definitivo (cierre del wizard de alta)' })
  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  create(@Body() dto: CreateContratoDto) {
    return this.contratosService.create(dto);
  }

  @ApiOperation({ summary: 'Actualiza campos de un contrato existente' })
  @Roles(...ROLES_ADMIN)
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
