import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SolicitudesService } from './solicitudes.service';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'cotizaciones');
// Ensure directory exists at module load time
mkdirSync(UPLOAD_DIR, { recursive: true });

@Controller('solicitudes')
@UseGuards(JwtAuthGuard, RolesGuard)
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

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
