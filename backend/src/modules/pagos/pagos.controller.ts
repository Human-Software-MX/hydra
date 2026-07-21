import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PagosService } from './pagos.service';
import { SupraClientService } from '../supra/supra-client.service';

@Controller('pagos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PagosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pagosService: PagosService,
    private readonly supra: SupraClientService,
  ) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  async findAll(
    @Query('contratoId') contratoId?: string,
    @Query('origen') origen?: string,
    @Query('updatedSince') updatedSince?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    // Filtro incremental para integradores (conector de ingesta de SUPRA):
    // siempre sirve el espejo local con orden estable ascendente — el conector
    // necesita un recorrido determinista, no la vista SUPRA re-mapeada.
    if (updatedSince) {
      const where = {
        ...(contratoId && { contratoId }),
        ...(origen && { origen }),
        updatedAt: { gte: new Date(updatedSince) },
      };
      const [data, total] = await Promise.all([
        this.prisma.pago.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.pago.count({ where }),
      ]);
      return { data, total, page, limit };
    }
    // Fuente de verdad: SUPRA (GET /v1/payments) cuando la integración está activa.
    if (this.supra.enabled) {
      return this.pagosService.listar({ contratoId, origen, page, limit });
    }
    const where = {
      ...(contratoId && { contratoId }),
      ...(origen && { origen }),
    };
    const [data, total] = await Promise.all([
      this.prisma.pago.findMany({
        where,
        include: {
          contrato: { select: { nombre: true } },
          recibo: { select: { id: true, saldoVigente: true } },
        },
        orderBy: { fecha: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pago.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  async crear(
    @Body()
    body: {
      contratoId: string;
      reciboId?: string;
      timbradoId?: string;
      convenioId?: string;
      monto: number;
      tipo: string;
      concepto?: string;
      fecha?: string;
    },
    @Req() req: Request,
  ) {
    // Cajero autenticado → vínculo pago↔sesión para el corte de caja.
    const usuarioId = (req.user as { id?: string } | undefined)?.id;
    return this.pagosService.crear({ ...body, usuarioId });
  }

  /** Devolución vía SUPRA (dueño de refunds; maker-checker por umbral). */
  @Post(':id/devolucion')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async devolver(
    @Param('id') id: string,
    @Body() body: { monto?: number; motivo?: string },
  ) {
    return this.pagosService.devolver(id, body);
  }
}
