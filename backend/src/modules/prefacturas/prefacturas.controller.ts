import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { TarifasService } from '../tarifas/tarifas.service';

@Controller('prefacturas')
@UseGuards(JwtAuthGuard)
export class PrefacturasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tarifasService: TarifasService,
  ) {}

  /**
   * Returns confirmed Consumo records as "pre-facturas" (billing documents pending stamp).
   * Amounts come from the tariff engine using the contract's tipoServicio and the tariffs
   * in force; consumos whose service has no tariff in force are returned with zero
   * amounts and estado 'Sin tarifa' so they stay visible but not billable.
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
      include: {
        contrato: { select: { tipoServicio: true } },
      },
    });

    const tiposServicio = [...new Set(consumos.map((c) => c.contrato?.tipoServicio).filter(Boolean))] as string[];
    const tarifasPorTipo = new Map(
      await Promise.all(
        tiposServicio.map(async (tipo) => [tipo, await this.tarifasService.findTarifaVigente(tipo)] as const),
      ),
    );

    return consumos.map((c) => {
      const tarifas = c.contrato?.tipoServicio ? tarifasPorTipo.get(c.contrato.tipoServicio) ?? [] : [];
      if (!tarifas.length) {
        return {
          id: c.id,
          contratoId: c.contratoId,
          periodo: c.periodo,
          consumoM3: Number(c.m3),
          subtotal: 0,
          descuento: 0,
          total: 0,
          estado: 'Sin tarifa',
        };
      }
      const monto = this.tarifasService.computeMonto(tarifas, Number(c.m3));
      return {
        id: c.id,
        contratoId: c.contratoId,
        periodo: c.periodo,
        consumoM3: Number(c.m3),
        subtotal: Math.round(monto.subtotal * 100) / 100,
        descuento: 0,
        total: Math.round(monto.total * 100) / 100,
        estado: 'Pendiente',
      };
    });
  }
}
