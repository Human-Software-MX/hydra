import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { construirReciboHtml } from './recibo-html';

@Controller('recibos')
@UseGuards(JwtAuthGuard)
export class RecibosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(
    @Query('contratoId') contratoId?: string,
    @Query('impreso') impreso?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    const where = {
      ...(contratoId && { contratoId }),
      ...(impreso !== undefined && { impreso: impreso === 'true' }),
    };
    const [data, total] = await Promise.all([
      this.prisma.recibo.findMany({
        where,
        include: {
          timbrado: { select: { uuid: true, total: true, estado: true, periodo: true } },
          contrato: { select: { nombre: true, estado: true } },
          pagos: { select: { id: true, monto: true, fecha: true, tipo: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.recibo.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  // IMPORTANT: declared before /:id to avoid NestJS route conflict
  @Get('preview/:reciboId')
  async getPreview(@Param('reciboId') reciboId: string) {
    const recibo = await this.prisma.recibo.findUnique({
      where: { id: reciboId },
      include: {
        contrato: {
          select: { id: true, nombre: true, rfc: true, direccion: true, tipoServicio: true },
        },
        timbrado: true,
        pagos: { orderBy: { fecha: 'desc' } },
      },
    });
    if (!recibo) return null;

    const pagado = recibo.pagos.reduce((s, p) => s + Number(p.monto), 0);
    const pendiente = Number(recibo.saldoVigente) + Number(recibo.saldoVencido) - pagado;

    // Use AND to combine OR conditions — multiple OR keys on same object overwrite each other in JS
    const now = new Date();
    const mensajes = await this.prisma.mensajeRecibo.findMany({
      where: {
        activo: true,
        AND: [
          { OR: [{ tipo: 'Global' }, { tipo: 'Individual', contratoId: recibo.contratoId }] },
          { OR: [{ vigenciaDesde: null }, { vigenciaDesde: { lte: now } }] },
          { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }] },
        ],
      },
      orderBy: [{ tipo: 'asc' }, { createdAt: 'asc' }],
    });

    return { recibo, pendiente, mensajes };
  }

  @Post(':id/marcar-impreso')
  async marcarImpreso(@Param('id') id: string) {
    return this.prisma.recibo.update({ where: { id }, data: { impreso: true } });
  }

  /** Recibo imprimible (HTML listo para guardar como PDF desde el navegador). */
  @Get(':id/html')
  async reciboHtml(@Param('id') id: string, @Res() res: Response) {
    const recibo = await this.prisma.recibo.findUnique({
      where: { id },
      include: {
        contrato: { select: { numeroContrato: true, nombre: true, rfc: true, direccion: true } },
        timbrado: true,
      },
    });
    if (!recibo) {
      res.status(404).send('<h1>Recibo no encontrado</h1>');
      return;
    }

    const now = new Date();
    const mensajes = await this.prisma.mensajeRecibo.findMany({
      where: {
        activo: true,
        AND: [
          { OR: [{ tipo: 'Global' }, { tipo: 'Individual', contratoId: recibo.contratoId }] },
          { OR: [{ vigenciaDesde: null }, { vigenciaDesde: { lte: now } }] },
          { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }] },
        ],
      },
    });

    const html = construirReciboHtml({
      reciboId: recibo.id,
      organismo: process.env.CFDI_EMISOR_NOMBRE ?? 'Organismo Operador de Agua',
      contrato: {
        numero: recibo.contrato.numeroContrato,
        nombre: recibo.contrato.nombre,
        rfc: recibo.contrato.rfc,
        direccion: recibo.contrato.direccion,
      },
      periodo: recibo.timbrado?.periodo ?? '',
      fechaEmision: recibo.timbrado?.fechaEmision ?? '',
      fechaVencimiento: recibo.fechaVencimiento,
      subtotal: Number(recibo.timbrado?.subtotal ?? 0),
      iva: Number(recibo.timbrado?.iva ?? 0),
      saldoVigente: Number(recibo.saldoVigente),
      saldoVencido: Number(recibo.saldoVencido),
      total: Number(recibo.saldoVigente) + Number(recibo.saldoVencido),
      cfdi: recibo.timbrado?.uuid
        ? {
            uuid: recibo.timbrado.uuid,
            serie: recibo.timbrado.serie ?? undefined,
            folio: recibo.timbrado.folio ?? undefined,
            selloSat: recibo.timbrado.selloSat ?? undefined,
          }
        : undefined,
      mensajes: mensajes.map((m) => m.mensaje),
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}

@Controller('mensajes-recibo')
@UseGuards(JwtAuthGuard)
export class MensajesReciboController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(@Query('activo') activo?: string) {
    return this.prisma.mensajeRecibo.findMany({
      where: activo !== undefined ? { activo: activo === 'true' } : undefined,
      orderBy: [{ tipo: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post()
  async create(
    @Body()
    body: {
      tipo: string;
      contratoId?: string;
      mensaje: string;
      vigenciaDesde?: string;
      vigenciaHasta?: string;
    },
  ) {
    return this.prisma.mensajeRecibo.create({
      data: {
        tipo: body.tipo,
        contratoId: body.contratoId ?? null,
        mensaje: body.mensaje,
        vigenciaDesde: body.vigenciaDesde ? new Date(body.vigenciaDesde) : null,
        vigenciaHasta: body.vigenciaHasta ? new Date(body.vigenciaHasta) : null,
      },
    });
  }

  @Post(':id/toggle')
  async toggle(@Param('id') id: string) {
    const m = await this.prisma.mensajeRecibo.findUnique({ where: { id } });
    if (!m) return null;
    return this.prisma.mensajeRecibo.update({
      where: { id },
      data: { activo: !m.activo },
    });
  }
}
