import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TimbradoService } from './timbrado.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsOptional, IsString, Matches } from 'class-validator';

class TimbrarPeriodoDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodo debe tener formato YYYY-MM' })
  periodo!: string;

  @IsOptional()
  @IsString()
  contratoId?: string;
}

@Controller('timbrados')
export class TimbradosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timbrado: TimbradoService,
  ) {}

  @Get()
  async findAll(
    @Query('contratoId') contratoId?: string,
    @Query('estado') estado?: string,
    @Query('periodo') periodo?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit = 100,
  ) {
    const where = {
      ...(contratoId && { contratoId }),
      ...(estado && { estado }),
      ...(periodo && { periodo }),
    };
    const data = await this.prisma.timbrado.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        contrato: { select: { id: true, nombre: true } },
      },
    });
    return data.map((t) => ({
      id: t.id,
      preFacturaId: t.consumoId ?? '',
      contratoId: t.contratoId,
      uuid: t.uuid,
      estado: t.estado,
      error: t.error ?? undefined,
      fecha: t.fechaEmision,
      fechaTimbrado: t.fechaTimbrado ?? undefined,
      periodo: t.periodo,
      subtotal: Number(t.subtotal),
      iva: Number(t.iva),
      total: Number(t.total),
      serie: t.serie ?? undefined,
      folio: t.folio ?? undefined,
      contrato: t.contrato,
    }));
  }

  /** Timbra un comprobante individual (Pendiente/Error → Timbrada OK). */
  @Post(':id/timbrar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  timbrar(@Param('id') id: string) {
    return this.timbrado.timbrar(id);
  }

  /** Timbrado masivo de un periodo. */
  @Post('timbrar-periodo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  timbrarPeriodo(@Body() dto: TimbrarPeriodoDto) {
    return this.timbrado.timbrarPeriodo(dto);
  }

  /** Descarga del XML timbrado (CFDI). */
  @Get(':id/xml')
  @UseGuards(JwtAuthGuard)
  async descargarXml(@Param('id') id: string, @Res() res: Response) {
    const xml = await this.timbrado.obtenerXml(id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cfdi-${id}.xml"`);
    res.send(xml);
  }
}
