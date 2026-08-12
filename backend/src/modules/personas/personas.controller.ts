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
import { PersonasService } from './personas.service';

@Controller('personas')
export class PersonasController {
  constructor(private readonly service: PersonasService) {}

  @Get()
  findAll(
    @Query('nombre') nombre?: string,
    @Query('rfc') rfc?: string,
    @Query('curp') curp?: string,
    @Query('tipo') tipo?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.findAll({ nombre, rfc, curp, tipo, page, limit });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() body: object) {
    return this.service.create(body as any);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: object) {
    return this.service.update(id, body as any);
  }

  @Post(':id/roles')
  asignarRol(
    @Param('id') personaId: string,
    @Body() body: { contratoId: string; rol: string },
  ) {
    return this.service.asignarRol(personaId, body.contratoId, body.rol);
  }

  @Post(':id/roles/revocar')
  revocarRol(
    @Param('id') personaId: string,
    @Body() body: { contratoId: string; rol: string },
  ) {
    return this.service.revocarRol(personaId, body.contratoId, body.rol);
  }
}
