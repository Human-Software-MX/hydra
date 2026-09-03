import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CatalogosOperativosService } from './catalogos-operativos.service';

@Controller('catalogos-operativos')
export class CatalogosOperativosController {
  constructor(private readonly service: CatalogosOperativosService) {}

  @Get('administraciones')
  getAdministraciones(@Query('uso') uso?: string) {
    return this.service.findAdministraciones({ uso });
  }

  // ─── Marcas de Medidor ─────────────────────────────────────────────────────

  @Get('marcas-medidor')
  getMarcasMedidor(@Query('activo') activo?: string) {
    return this.service.findMarcasMedidor({ activo });
  }

  @Post('marcas-medidor')
  createMarcaMedidor(@Body() body: { codigo: string; nombre: string }) {
    return this.service.createMarcaMedidor(body);
  }

  @Patch('marcas-medidor/:id')
  updateMarcaMedidor(
    @Param('id') id: string,
    @Body() body: { nombre?: string; activo?: boolean },
  ) {
    return this.service.updateMarcaMedidor(id, body);
  }

  // ─── Modelos de Medidor ────────────────────────────────────────────────────

  @Get('modelos-medidor')
  getModelosMedidor(
    @Query('activo') activo?: string,
    @Query('marcaId') marcaId?: string,
  ) {
    return this.service.findModelosMedidor({ activo, marcaId });
  }

  @Post('modelos-medidor')
  createModeloMedidor(@Body() body: { marcaId: string; codigo: string; nombre: string }) {
    return this.service.createModeloMedidor(body);
  }

  @Patch('modelos-medidor/:id')
  updateModeloMedidor(
    @Param('id') id: string,
    @Body() body: { nombre?: string; activo?: boolean },
  ) {
    return this.service.updateModeloMedidor(id, body);
  }

  // ─── Calibres ──────────────────────────────────────────────────────────────

  @Get('calibres')
  getCalibres(@Query('activo') activo?: string) {
    return this.service.findCalibres({ activo });
  }

  @Post('calibres')
  createCalibre(@Body() body: { codigo: string; descripcion: string; diametroMm?: number }) {
    return this.service.createCalibre(body);
  }

  // ─── Emplazamientos ────────────────────────────────────────────────────────

  @Get('emplazamientos')
  getEmplazamientos(@Query('activo') activo?: string) {
    return this.service.findEmplazamientos({ activo });
  }

  // ─── Tipos de Contador ─────────────────────────────────────────────────────

  @Get('tipos-contador')
  getTiposContador(@Query('activo') activo?: string) {
    return this.service.findTiposContador({ activo });
  }

  // ─── Formas de Pago ────────────────────────────────────────────────────────

  @Get('formas-pago')
  getFormasPago(
    @Query('activo') activo?: string,
    @Query('tipoRecaudacion') tipoRecaudacion?: string,
  ) {
    return this.service.findFormasPago({ activo, tipoRecaudacion });
  }

  @Post('formas-pago')
  createFormaPago(
    @Body()
    body: {
      codigo: string;
      nombre: string;
      tipoRecaudacion: string;
      aceptaEfectivo?: boolean;
      aceptaCheque?: boolean;
      aceptaTarjeta?: boolean;
      aceptaTransf?: boolean;
      requiereReferencia?: boolean;
    },
  ) {
    return this.service.createFormaPago(body);
  }

  @Patch('formas-pago/:id')
  updateFormaPago(
    @Param('id') id: string,
    @Body() body: { nombre?: string; activo?: boolean },
  ) {
    return this.service.updateFormaPago(id, body);
  }

  // ─── Oficinas ──────────────────────────────────────────────────────────────

  @Get('oficinas')
  getOficinas(
    @Query('activo') activo?: string,
    @Query('administracionId') administracionId?: string,
  ) {
    return this.service.findOficinas({ activo, administracionId });
  }

  @Get('tipos-oficina')
  getTiposOficina(@Query('activo') activo?: string) {
    return this.service.findTiposOficina({ activo });
  }

  // ─── Sectores Hidráulicos ──────────────────────────────────────────────────

  @Get('sectores-hidraulicos')
  getSectoresHidraulicos(
    @Query('activo') activo?: string,
    @Query('administracionId') administracionId?: string,
  ) {
    return this.service.findSectoresHidraulicos({ activo, administracionId });
  }

  // ─── Clases de Contrato ────────────────────────────────────────────────────

  @Get('clases-contrato')
  getClasesContrato(@Query('activo') activo?: string) {
    return this.service.findClasesContrato({ activo });
  }

  // ─── Tipos de Vía ─────────────────────────────────────────────────────────

  @Get('tipos-via')
  getTiposVia(@Query('activo') activo?: string) {
    return this.service.findTiposVia({ activo });
  }

  // ─── Tipos de Variable ────────────────────────────────────────────────────

  @Get('tipos-variable')
  getTiposVariable(@Query('activo') activo?: string) {
    return this.service.findTiposVariable({ activo });
  }

  @Post('tipos-variable')
  createTipoVariable(
    @Body()
    body: {
      codigo: string;
      nombre: string;
      tipoDato: string;
      valoresPosibles?: unknown;
      unidad?: string | null;
    },
  ) {
    return this.service.createTipoVariable({
      codigo: body.codigo,
      nombre: body.nombre,
      tipoDato: body.tipoDato,
      unidad: body.unidad,
      valoresPosibles: body.valoresPosibles as Prisma.InputJsonValue | undefined,
    });
  }

  @Patch('tipos-variable/:id')
  updateTipoVariable(
    @Param('id') id: string,
    @Body()
    body: {
      nombre?: string;
      tipoDato?: string;
      valoresPosibles?: unknown | null;
      unidad?: string | null;
      activo?: boolean;
    },
  ) {
    return this.service.updateTipoVariable(id, {
      nombre: body.nombre,
      tipoDato: body.tipoDato,
      unidad: body.unidad,
      activo: body.activo,
      valoresPosibles:
        body.valoresPosibles === undefined
          ? undefined
          : (body.valoresPosibles as Prisma.InputJsonValue | null),
    });
  }

  // ─── Variables por Tipo Contratación ──────────────────────────────────────

  @Get('variables-tipo-contratacion/:tipoContratacionId')
  getVariablesTipoContratacion(@Param('tipoContratacionId') tipoContratacionId: string) {
    return this.service.findVariablesTipoContratacion(tipoContratacionId);
  }

  @Post('variables-tipo-contratacion')
  assignVariableTipoContratacion(
    @Body()
    body: {
      tipoContratacionId: string;
      tipoVariableId: string;
      obligatorio?: boolean;
      valorDefecto?: string;
      orden?: number;
    },
  ) {
    return this.service.assignVariableTipoContratacion(body);
  }

  @Delete('variables-tipo-contratacion/:tipoContratacionId/:tipoVariableId')
  removeVariableTipoContratacion(
    @Param('tipoContratacionId') tipoContratacionId: string,
    @Param('tipoVariableId') tipoVariableId: string,
  ) {
    return this.service.removeVariableTipoContratacion(tipoContratacionId, tipoVariableId);
  }
}
