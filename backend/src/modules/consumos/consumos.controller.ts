import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('consumos')
@UseGuards(JwtAuthGuard)
export class ConsumosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(
    @Query('contratoId') contratoId?: string,
    @Query('periodo') periodo?: string,
    @Query('confirmado') confirmado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit = 200,
  ) {
    const where = {
      ...(contratoId && { contratoId }),
      ...(periodo && { periodo }),
      ...(confirmado !== undefined && { confirmado: confirmado === 'true' }),
    };
    const [data, total] = await Promise.all([
      this.prisma.consumo.findMany({
        where,
        orderBy: [{ periodo: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contrato: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.consumo.count({ where }),
    ]);
    return data.map((c) => ({
      id: c.id,
      contratoId: c.contratoId,
      lecturaId: '',
      tipo: c.tipo,
      m3: Number(c.m3),
      periodo: c.periodo,
      confirmado: c.confirmado,
      contrato: c.contrato,
    }));
  }
}
