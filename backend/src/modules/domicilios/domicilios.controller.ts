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
import { DomiciliosService, CreateDomicilioDto, UpdateDomicilioDto } from './domicilios.service';

@Controller('domicilios')
export class DomiciliosController {
  constructor(private readonly service: DomiciliosService) {}

  @Get('estados')
  findEstados() {
    return this.service.findEstados();
  }

  @Get('municipios')
  buscarMunicipios(
    @Query('nombre') nombre?: string,
    @Query('estadoId') estadoId?: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit = 30,
  ) {
    return this.service.buscarMunicipios({ nombre, estadoId, limit });
  }

  @Get('colonias')
  buscarColonias(
    @Query('nombre') nombre?: string,
    @Query('localidadId') localidadId?: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit = 30,
  ) {
    return this.service.buscarColonias({ nombre, localidadId, limit });
  }

  /** Resumen de volúmenes de catálogo INEGI */
  @Get('catalogo-inegi/resumen')
  catalogoInegiResumen() {
    return this.service.findCatalogoInegiResumen();
  }

  /** Municipios INEGI paginados (catálogo en UI) */
  @Get('catalogo-inegi/municipios')
  catalogoInegiMunicipios(
    @Query('estadoId') estadoId?: string,
    @Query('nombre') nombre?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.service.findCatalogoMunicipiosPaginated({ estadoId, nombre, page, limit });
  }

  /** Localidades INEGI paginadas */
  @Get('catalogo-inegi/localidades')
  catalogoInegiLocalidades(
    @Query('municipioId') municipioId?: string,
    @Query('nombre') nombre?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.service.findCatalogoLocalidadesPaginated({ municipioId, nombre, page, limit });
  }

  /** Colonias paginadas */
  @Get('catalogo-inegi/colonias')
  catalogoInegiColonias(
    @Query('localidadId') localidadId?: string,
    @Query('nombre') nombre?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.service.findCatalogoColoniasPaginated({ localidadId, nombre, page, limit });
  }

  @Get()
  findAll(
    @Query('codigoPostal') codigoPostal?: string,
    @Query('municipioId') municipioId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.findAll({ codigoPostal, municipioId, page, limit });
  }

  @Get('persona/:personaId')
  findByPersona(@Param('personaId') personaId: string) {
    return this.service.findByPersona(personaId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDomicilioDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDomicilioDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/personas/:personaId')
  vincularPersona(
    @Param('id') domicilioId: string,
    @Param('personaId') personaId: string,
    @Body() body: { tipo?: string; principal?: boolean },
  ) {
    return this.service.vincularPersona(domicilioId, personaId, body.tipo, body.principal);
  }

  @Delete(':id/personas/:personaId')
  desvincularPersona(
    @Param('id') domicilioId: string,
    @Param('personaId') personaId: string,
    @Query('tipo') tipo = 'fiscal',
  ) {
    return this.service.desvincularPersona(domicilioId, personaId, tipo);
  }
}
