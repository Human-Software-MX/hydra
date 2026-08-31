import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MigracionService } from './migracion.service';

/** Límite de tamaño del archivo de exportación Aquasis (los padrones grandes rondan decenas de MB). */
const MAX_ARCHIVO_BYTES = 100 * 1024 * 1024;

/**
 * Endpoints del toolkit de migración desde Aquasis. Solo SUPER_ADMIN:
 * la migración escribe masivamente sobre contratos, saldos y pagos.
 *
 * Los tres endpoints de archivo reciben multipart/form-data con el campo
 * `archivo` (XLSX o CSV) y el campo `tipoArchivo`
 * (padron | personas | medidores | saldos | pagos).
 */
@Controller('migracion')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class MigracionController {
  constructor(private readonly migracion: MigracionService) {}

  /** Paso 1: reconocer el layout del archivo (columnas, preview). No escribe. */
  @Post('analizar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX_ARCHIVO_BYTES } }))
  analizar(
    @UploadedFile() archivo: Express.Multer.File,
    @Body() body: { tipoArchivo: string },
  ) {
    this.exigirArchivo(archivo);
    return this.migracion.analizarArchivo(archivo.buffer, body?.tipoArchivo ?? '');
  }

  /** Paso 2: validación fila por fila (dry-run). No escribe. */
  @Post('validar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX_ARCHIVO_BYTES } }))
  validar(
    @UploadedFile() archivo: Express.Multer.File,
    @Body() body: { tipoArchivo: string },
  ) {
    this.exigirArchivo(archivo);
    return this.migracion.validar(archivo.buffer, body?.tipoArchivo ?? '');
  }

  /**
   * Paso 3: importación idempotente en lotes de 500. Con dryRun=true simula
   * (mismas decisiones, cero escrituras de datos) y reporta creados/
   * actualizados/omitidos. En multipart dryRun llega como texto: se acepta
   * "true"/"1" como verdadero.
   */
  @Post('importar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX_ARCHIVO_BYTES } }))
  importar(
    @UploadedFile() archivo: Express.Multer.File,
    @Body() body: { tipoArchivo: string; dryRun?: string | boolean },
  ) {
    this.exigirArchivo(archivo);
    const dryRun = body?.dryRun === true || body?.dryRun === 'true' || body?.dryRun === '1';
    return this.migracion.importar(archivo.buffer, body?.tipoArchivo ?? '', { dryRun });
  }

  /** Reporte de conciliación post-import (acta de migración). */
  @Get('conciliacion')
  conciliacion() {
    return this.migracion.reporteConciliacion();
  }

  /** Bitácora LogProceso de las corridas de migración. */
  @Get('logs')
  logs(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.migracion.logs(limit);
  }

  private exigirArchivo(archivo?: Express.Multer.File) {
    if (!archivo?.buffer?.length) {
      throw new BadRequestException('Falta el archivo (campo multipart "archivo")');
    }
  }
}
