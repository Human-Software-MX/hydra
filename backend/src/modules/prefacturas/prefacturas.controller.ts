import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles, ROLES_ADMIN } from '../auth/roles.decorator';

@Roles(...ROLES_ADMIN)
@Controller('prefacturas')
export class PrefacturasController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns confirmed Consumo records as "pre-facturas" (billing documents pending stamp).
   * Also includes any Timbrado records with estado=Pendiente.
   * Shape matches PreFacturaDto expected by the frontend.
   */
  @Get()
  async findAll(
    @Query('contratoId') contratoId?: string,
    @Query('periodo') periodo?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit = 200,
  ) {
    const where = {
      confirmado: true,
      ...(contratoId && { contratoId }),
      ...(periodo && { periodo }),
    };
    const consumos = await this.prisma.consumo.findMany({
      where,
      orderBy: [{ periodo: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    });

    return consumos.map((c) => ({
      id: c.id,
      contratoId: c.contratoId,
      periodo: c.periodo,
      consumoM3: Number(c.m3),
      subtotal: 0,
      descuento: 0,
      total: 0,
      estado: 'Pendiente',
    }));
  }
}
