import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'crypto';
import { LecturasService } from './lecturas.service';

@Controller('lecturas')
export class LecturasController {
  constructor(private readonly service: LecturasService) {}

  @Get('lotes')
  findLotes(
    @Query('zonaId') zonaId?: string,
    @Query('rutaId') rutaId?: string,
    @Query('periodo') periodo?: string,
    @Query('estado') estado?: string,
  ) {
    return this.service.findLotes({ zonaId, rutaId, periodo, estado });
  }

  @Post('lotes/upload')
  @UseInterceptors(FileInterceptor('archivo'))
  async uploadLote(
    @UploadedFile() archivo: Express.Multer.File,
    @Body()
    body: {
      zonaId?: string;
      rutaId?: string;
      periodo: string;
      tipoLote?: string;
      reemplazar?: string | boolean;
    },
  ) {
    const contenido = archivo.buffer.toString('latin1');
    // B1 — huella del archivo original para rechazar re-cargas idénticas (periodo + hash).
    const archivoHash = createHash('sha256').update(archivo.buffer).digest('hex');
    // multipart llega como string ("true"/"false"); normaliza a boolean.
    const reemplazar = body.reemplazar === true || body.reemplazar === 'true';
    return this.service.cargarLote({
      zonaId: body.zonaId,
      rutaId: body.rutaId,
      periodo: body.periodo,
      tipoLote: body.tipoLote ?? 'Lectura',
      archivoNombre: archivo.originalname,
      contenido,
      archivoHash,
      reemplazar,
    });
  }

  @Get()
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
  getLecturistas() {
    return this.service.getLecturistas();
  }

  @Get('catalogo/incidencias')
  getIncidencias() {
    return this.service.getIncidencias();
  }

  @Get('mensajes')
  getMensajes(@Query('loteId') loteId?: string, @Query('contratoId') contratoId?: string) {
    return this.service.getMensajes({ loteId, contratoId });
  }

  @Post('mensajes')
  createMensaje(
    @Body() body: { loteId?: string; contratoId?: string; mensaje: string; tipo?: string },
  ) {
    return this.service.createMensaje(body);
  }
}
