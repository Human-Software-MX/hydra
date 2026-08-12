import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { AgoraService } from './agora.service';

@Controller('agora/tickets')
export class AgoraController {
  constructor(private readonly service: AgoraService) {}

  @Get()
  findAll(
    @Query('contratoId') contratoId?: string,
    @Query('estado') estado?: string,
  ) {
    return this.service.findAll({ contratoId, estado });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body()
    body: {
      contratoId?: string;
      tramiteId?: string;
      quejaId?: string;
      titulo: string;
      descripcion: string;
      prioridad?: string;
      creadoPor: string;
    },
  ) {
    return this.service.createTicket(body);
  }

  @Patch(':id/estado')
  updateEstado(@Param('id') id: string, @Body() body: { estado: string }) {
    return this.service.updateEstado(id, body.estado);
  }
}
