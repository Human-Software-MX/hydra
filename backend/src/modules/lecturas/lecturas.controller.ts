import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { LecturasService } from './lecturas.service';

@Controller('lecturas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LecturasController {
  constructor(private readonly service: LecturasService) {}

  @Get('lotes')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findLotes(
    @Query('zonaId') zonaId?: string,
    @Query('rutaId') rutaId?: string,
    @Query('periodo') periodo?: string,
    @Query('estado') estado?: string,
  ) {
    return this.service.findLotes({ zonaId, rutaId, periodo, estado });
  }

  @Post('lotes/upload')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  @UseInterceptors(FileInterceptor('archivo'))
  async uploadLote(
    @UploadedFile() archivo: Express.Multer.File,
    @Body() body: { zonaId?: string; rutaId?: string; periodo: string; tipoLote?: string },
  ) {
    const contenido = archivo.buffer.toString('latin1');
    return this.service.cargarLote({
      zonaId: body.zonaId,
      rutaId: body.rutaId,
      periodo: body.periodo,
      tipoLote: body.tipoLote ?? 'Lectura',
      archivoNombre: archivo.originalname,
      contenido,
    });
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findLecturas(
    @Query('loteId') loteId?: string,
    @Query('contratoId') contratoId?: string,
    @Query('rutaId') rutaId?: string,
    @Query('zonaId') zonaId?: string,
    @Query('periodo') periodo?: string,
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.service.findLecturas({ loteId, contratoId, rutaId, zonaId, periodo, estado, page, limit });
  }

  @Get('catalogo/lecturistas')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getLecturistas() {
    return this.service.getLecturistas();
  }

  @Get('catalogo/incidencias')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getIncidencias() {
    return this.service.getIncidencias();
  }

  @Get('mensajes')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getMensajes(@Query('loteId') loteId?: string, @Query('contratoId') contratoId?: string) {
    return this.service.getMensajes({ loteId, contratoId });
  }

  @Post('mensajes')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  createMensaje(
    @Body() body: { loteId?: string; contratoId?: string; mensaje: string; tipo?: string },
  ) {
    return this.service.createMensaje(body);
  }
}
