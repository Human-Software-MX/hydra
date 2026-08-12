import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { TramitesService } from './tramites.service';
import { Roles, ROLES_ATENCION } from '../auth/roles.decorator';

@Controller('tramites')
export class TramitesController {
  constructor(private readonly service: TramitesService) {}

  // Static routes MUST come before /:id
  @Get('catalogo')
  getCatalogo(@Query('tipo') tipo?: string) {
    return this.service.getCatalogo(tipo);
  }

  @Get()
  findAll(
    @Query('contratoId') contratoId?: string,
    @Query('tipo') tipo?: string,
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.findAll({ contratoId, tipo, estado, page, limit });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/seguimientos')
  getSeguimientos(@Param('id') id: string) {
    return this.service.getSeguimientos(id);
  }

  @Roles(...ROLES_ATENCION)
  @Post()
  create(@Body() body: object) {
    return this.service.create(body as any);
  }

  @Roles(...ROLES_ATENCION)
  @Patch(':id/estado')
  updateEstado(
    @Param('id') id: string,
    @Body() body: { estado: string; aprobadoPor?: string },
  ) {
    return this.service.updateEstado(id, body.estado, body.aprobadoPor);
  }

  @Roles(...ROLES_ATENCION)
  @Post(':id/documentos')
  addDocumento(
    @Param('id') tramiteId: string,
    @Body() body: { nombre: string; tipo: string; url?: string; notas?: string },
  ) {
    return this.service.addDocumento(tramiteId, body);
  }

  @Roles(...ROLES_ATENCION)
  @Patch('documentos/:documentoId/verificar')
  verificarDocumento(
    @Param('documentoId') documentoId: string,
    @Body() body: { verificado: boolean },
  ) {
    return this.service.verificarDocumento(documentoId, body.verificado);
  }

  @Roles(...ROLES_ATENCION)
  @Post(':id/seguimientos')
  addSeguimiento(
    @Param('id') tramiteId: string,
    @Body() body: { nota: string; usuario: string; tipo?: string },
  ) {
    return this.service.addSeguimiento(tramiteId, body);
  }
}
