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
  search(
    @Query('q') q: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
  ) {
    return this.contratosService.search(q ?? '', limit);
  }

  @ApiOperation({ summary: 'Lista todos los contratos' })
  @Get()
  findAll() {
    return this.contratosService.findAll();
  }

  @Get(':id/flujo-completo')
  getFlujoCompleto(@Param('id') id: string) {
    return this.contratosService.getFlujoCompleto(id);
  }

  @Get(':id/historial')
  getHistorial(@Param('id') id: string) {
    return this.contratosService.getHistorial(id);
  }

  @Get(':id/contexto-atencion')
  getContextoAtencion(@Param('id') id: string) {
    return this.contratosService.getContextoAtencion(id);
  }

  @Get(':id/estado-operativo')
  getEstadoOperativo(@Param('id') id: string) {
    return this.contratosService.getEstadoOperativo(id);
  }

  @Get(':id/texto-contrato')
  getTextoContratoPreview(@Param('id') id: string) {
    return this.contratosService.getTextoContratoPreview(id);
  }

  @Get(':id/contrato-pdf')
  async getContratoPdf(@Param('id') id: string, @Res() res: Response) {
    const html = await this.contratosService.getContratoPdf(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Post(':id/factura-contratacion')
  crearFacturaContratacion(@Param('id') id: string) {
    return this.contratosService.crearFacturaContratacion(id);
  }

  @ApiOperation({
    summary: 'Previsualiza la facturación de un tipo de contratación',
    description: 'Calcula conceptos y montos sin persistir. Una tarifa inválida devuelve 422 con el detalle.',
  })
  @Post('preview-facturacion')
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
  findOne(@Param('id') id: string) {
    return this.contratosService.findOne(id);
  }

  @ApiOperation({ summary: 'Crea un contrato definitivo (cierre del wizard de alta)' })
  @Post()
  create(@Body() dto: CreateContratoDto) {
    return this.contratosService.create(dto);
  }

  @ApiOperation({ summary: 'Actualiza campos de un contrato existente' })
  @Roles(...ROLES_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateContratoDto) {
    return this.contratosService.update(id, dto);
  }

  @Post(':id/cambiar-tipo')
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
