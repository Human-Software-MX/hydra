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
  UploadedFile,
  UseInterceptors,
  Res,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response } from 'express';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SolicitudesService } from './solicitudes.service';
import { Roles, ROLES_SERVICIOS } from '../auth/roles.decorator';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'cotizaciones');
const DOCS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'documentos-solicitud');
// Ensure directories exist at module load time
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(DOCS_UPLOAD_DIR, { recursive: true });

const DOC_MIME_PERMITIDOS = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Roles(...ROLES_SERVICIOS)
@Controller('solicitudes')
export class SolicitudesController {
  constructor(private readonly service: SolicitudesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findAll(
    @Query('estado') estado?: string,
    @Query('contratoId') contratoId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.service.findAll({ estado, contratoId, page, limit });
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.updateFormData(id, body);
  }

  /** Crea (o re-crea) la orden de inspección en AgoraCore para esta solicitud. */
  @Post(':id/inspeccion/orden-agora')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  crearOrdenAgora(@Param('id') id: string) {
    return this.service.crearOrdenInspeccionAgora(id);
  }

  /** Trae de Agora los datos levantados por el inspector y los persiste. */
  @Post(':id/inspeccion/sync-agora')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  syncInspeccionAgora(@Param('id') id: string) {
    return this.service.syncInspeccionDesdeAgora(id);
  }

  @Post(':id/inspeccion')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  upsertInspeccion(@Param('id') id: string, @Body() body: any) {
    return this.service.upsertInspeccion(id, body);
  }

  @Post(':id/aceptar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  aceptar(@Param('id') id: string) {
    return this.service.aceptar(id);
  }

  @Post(':id/rechazar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  rechazar(@Param('id') id: string) {
    return this.service.rechazar(id);
  }

  @Post(':id/cancelar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  cancelar(@Param('id') id: string) {
    return this.service.cancelar(id);
  }

  @Post(':id/retomar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  retomar(@Param('id') id: string) {
    return this.service.retomar(id);
  }

  /** Guarda el PDF de cotización generado en el cliente. */
  @Post(':id/cotizacion-pdf')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, _file, cb) => {
          // filename set after upload using solicitudId; handled below
          cb(null, `tmp_${Date.now()}.pdf`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Only PDF files allowed'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  saveCotizacionPdf(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ) {
    if (!file) throw new BadRequestException('No file received');
    // Rename to {solicitudId}.pdf
    const { renameSync } = require('fs') as typeof import('fs');
    const dest = join(UPLOAD_DIR, `${id}.pdf`);
    renameSync(file.path, dest);
    res.json({ path: dest, url: `/api/solicitudes/${id}/cotizacion-pdf` });
  }

  /** Descarga el PDF de cotización almacenado. */
  @Get(':id/cotizacion-pdf')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  getCotizacionPdf(@Param('id') id: string, @Res() res: Response) {
    const filePath = join(UPLOAD_DIR, `${id}.pdf`);
    if (!existsSync(filePath)) throw new NotFoundException('PDF no encontrado para esta solicitud');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="cotizacion-${id}.pdf"`);
    createReadStream(filePath).pipe(res);
  }

  // ─── Documentos entregados por el ciudadano ────────────────────────────────

  @Get(':id/documentos')
  listDocumentos(@Param('id') id: string) {
    return this.service.listDocumentos(id);
  }

  /** Sube un archivo clasificado contra el catálogo de documentos (varios por tipo permitidos). */
  @Post(':id/documentos')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: DOCS_UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
          cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!DOC_MIME_PERMITIDOS.has(file.mimetype)) {
          return cb(new BadRequestException('Solo PDF o imagen (JPG/PNG/WebP)'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
    }),
  )
  async subirDocumento(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { documentoId?: string; nombreDocumento?: string },
  ) {
    if (!file) throw new BadRequestException('No se recibió archivo');
    try {
      return await this.service.addDocumento(id, {
        documentoId: body.documentoId || undefined,
        nombreDocumento: body.nombreDocumento || undefined,
        archivoNombre: file.originalname,
        archivoPath: file.path,
        mimeType: file.mimetype,
        tamanoBytes: file.size,
      });
    } catch (e) {
      // si el registro falla, no dejar el archivo huérfano
      const { unlinkSync } = require('fs') as typeof import('fs');
      try { unlinkSync(file.path); } catch { /* noop */ }
      throw e;
    }
  }

  /** Descarga/visualiza el archivo de un documento entregado. */
  @Get(':id/documentos/:docId/archivo')
  async descargarDocumento(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Res() res: Response,
  ) {
    const doc = await this.service.getDocumento(id, docId);
    if (!existsSync(doc.archivoPath)) throw new NotFoundException('Archivo no encontrado en disco');
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.archivoNombre.replace(/"/g, '')}"`);
    createReadStream(doc.archivoPath).pipe(res);
  }

  @Delete(':id/documentos/:docId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  async eliminarDocumento(@Param('id') id: string, @Param('docId') docId: string) {
    const doc = await this.service.removeDocumento(id, docId);
    const { unlinkSync } = require('fs') as typeof import('fs');
    try { unlinkSync(doc.archivoPath); } catch { /* archivo ya no existe: no bloquear */ }
    return { ok: true };
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
