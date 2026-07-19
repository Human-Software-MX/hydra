import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ConveniosService } from './convenios.service';

@Controller('convenios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConveniosController {
  constructor(private readonly service: ConveniosService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findAll(
    @Query('contratoId') contratoId?: string,
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.service.findAll({ contratoId, estado, page, limit });
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  create(@Body() body: object) {
    return this.service.create(body as any);
  }

  @Post(':id/parcialidades/aplicar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  aplicar(
    @Param('id') id: string,
    @Body() body: { monto: number; tipo: string },
  ) {
    return this.service.aplicarParcialidad(id, body.monto, body.tipo);
  }

  @Post(':id/cancelar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  cancelar(@Param('id') id: string) {
    return this.service.cancelar(id);
  }

  @Patch(':id/checklist')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  updateChecklist(
    @Param('id') id: string,
    @Body() body: Record<string, boolean>,
  ) {
    return this.service.updateChecklist(id, body);
  }
}
