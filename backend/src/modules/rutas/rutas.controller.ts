import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('rutas')
export class RutasController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(
    @Query('zonaId') zonaId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit = 200,
  ) {
    const where = { ...(zonaId && { zonaId }) };
    const rutas = await this.prisma.ruta.findMany({
      where,
      orderBy: [{ sector: 'asc' }, { libreta: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        zona: { select: { id: true, nombre: true } },
        contratos: { select: { id: true, nombre: true, estado: true } },
      },
    });
    return rutas.map((r) => ({
      id: r.id,
      zonaId: r.zonaId,
      sector: r.sector,
      libreta: r.libreta,
      lecturista: r.lecturista,
      zona: r.zona,
      contratoIds: r.contratos.map((c) => c.id),
      contratos: r.contratos,
    }));
  }
}
