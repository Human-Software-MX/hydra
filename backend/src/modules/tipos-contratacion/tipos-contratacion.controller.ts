import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { TiposContratacionService } from './tipos-contratacion.service';
import { Roles, ROLES_ADMIN, ROLES_INTERNAL } from '../auth/roles.decorator';

@Roles(...ROLES_ADMIN)
@Controller('tipos-contratacion')
export class TiposContratacionController {
  constructor(private readonly service: TiposContratacionService) {}

  @Roles(...ROLES_INTERNAL)
  @Get()
  findAll(
    @Query('activo') activo?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('administracionId') administracionId?: string,
  ) {
    return this.service.findAll({ activo, page, limit, administracionId });
  }

  @Roles(...ROLES_INTERNAL)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body()
    body: {
      codigo: string;
      nombre: string;
      descripcion?: string;
      requiereMedidor?: boolean;
    },
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      nombre?: string;
      descripcion?: string;
      requiereMedidor?: boolean;
      activo?: boolean;
      // P1/P6 configuración del proceso
      claseProceso?: string | null;
      esContratoFormal?: boolean;
      requiereSolicitudPrevia?: boolean;
      diasCaducidadSolicitud?: number | null;
      organismoAprobacion?: string | null;
      diasPlazoAprobacion?: number | null;
      periodicidadesPermitidas?: string | null;
      tiposClientePermitidos?: string | null;
    },
  ) {
    return this.service.update(id, body);
  }

  // ─── Configuración ────────────────────────────────────────────────────────

  @Roles(...ROLES_INTERNAL)
  @Get(':id/configuracion')
  getConfiguracion(@Param('id') id: string) {
    return this.service.getConfiguracion(id);
  }

  // ─── Conceptos ────────────────────────────────────────────────────────────

  @Post(':id/conceptos')
  agregarConcepto(
    @Param('id') id: string,
    @Body() body: { conceptoCobroId: string; obligatorio?: boolean; orden?: number },
  ) {
    return this.service.agregarConcepto(id, body);
  }

  @Delete(':id/conceptos/:conceptoCobroId')
  removerConcepto(
    @Param('id') id: string,
    @Param('conceptoCobroId') conceptoCobroId: string,
  ) {
    return this.service.removerConcepto(id, conceptoCobroId);
  }

  // ─── Cláusulas ────────────────────────────────────────────────────────────

  @Post(':id/clausulas')
  agregarClausula(
    @Param('id') id: string,
    @Body() body: { clausulaId: string; obligatorio?: boolean; orden?: number },
  ) {
    return this.service.agregarClausula(id, body);
  }

  @Delete(':id/clausulas/:clausulaId')
  removerClausula(
    @Param('id') id: string,
    @Param('clausulaId') clausulaId: string,
  ) {
    return this.service.removerClausula(id, clausulaId);
  }

  // ─── Documentos Requeridos ────────────────────────────────────────────────

  @Post(':id/documentos-requeridos')
  agregarDocumento(
    @Param('id') id: string,
    @Body()
    body: {
      documentoId?: string;
      nombreDocumento?: string;
      descripcion?: string;
      obligatorio?: boolean;
      aplicaUso?: string;
      orden?: number;
    },
  ) {
    return this.service.agregarDocumento(id, body);
  }

  @Delete(':id/documentos-requeridos/:documentoId')
  removerDocumento(
    @Param('id') id: string,
    @Param('documentoId') documentoId: string,
  ) {
    return this.service.removerDocumento(id, documentoId);
  }
}
