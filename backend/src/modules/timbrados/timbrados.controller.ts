import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('timbrados')
@UseGuards(JwtAuthGuard)
export class TimbradosController {
  constructor(private readonly prisma: PrismaService) {}

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
      periodo: t.periodo,
      subtotal: Number(t.subtotal),
      iva: Number(t.iva),
      total: Number(t.total),
      contrato: t.contrato,
    }));
  }
}
