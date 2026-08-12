import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { QuejasService } from './quejas.service';
import { CreateQuejaDto } from './dto/create-queja.dto';
import { UpdateQuejaDto } from './dto/update-queja.dto';
import { CreateSeguimientoDto } from './dto/create-seguimiento.dto';

@Controller('quejas')
export class QuejasController {
  constructor(private readonly quejasService: QuejasService) {}

  @Get()
  findAll(@Query('contratoId') contratoId: string) {
    return this.quejasService.findByContrato(contratoId);
  }

  @Get('contrato/:contratoId')
  findByContratoId(@Param('contratoId') contratoId: string) {
    return this.quejasService.findByContrato(contratoId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quejasService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateQuejaDto) {
    return this.quejasService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateQuejaDto) {
    return this.quejasService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.quejasService.remove(id);
  }

  @Post(':id/seguimientos')
  addSeguimiento(
    @Param('id') id: string,
    @Body() dto: CreateSeguimientoDto,
  ) {
    return this.quejasService.addSeguimiento(id, dto);
  }
}
