import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { FacturacionService } from '../facturacion/facturacion.service';

@UseGuards(JwtAuthGuard)
@Controller('prefacturas')
export class PrefacturasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facturacion: FacturacionService,
  ) {}

  /**
   * Devuelve los consumos confirmados aún no facturados como "pre-facturas",
   * con los importes reales calculados por el motor de facturación (tarifa vigente
   * por servicio). Shape compatible con PreFacturaDto del frontend.
   */
  @Get()
  async findAll(
    @Query('contratoId') contratoId?: string,
    @Query('periodo') periodo?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit = 200,
  ) {
    const consumos = await this.prisma.consumo.findMany({
      where: {
        confirmado: true,
        timbrado: { is: null },
        ...(contratoId && { contratoId }),
        ...(periodo && { periodo }),
      },
      orderBy: [{ periodo: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    });

    return Promise.all(
      consumos.map(async (c) => {
        try {
          const f = await this.facturacion.calcularConsumo(c.id);
          return {
            id: c.id,
            contratoId: c.contratoId,
            periodo: c.periodo,
            consumoM3: Number(c.m3),
            subtotal: f.subtotal,
            iva: f.iva,
            descuento: 0,
            total: f.total,
            saldoVencido: f.saldoVencido,
            estado: 'Pendiente',
          };
        } catch (e: any) {
          return {
            id: c.id,
            contratoId: c.contratoId,
            periodo: c.periodo,
            consumoM3: Number(c.m3),
            subtotal: 0,
            iva: 0,
            descuento: 0,
            total: 0,
            saldoVencido: 0,
            estado: 'Sin tarifa',
            error: e?.message ?? 'Error de cálculo',
          };
        }
      }),
    );
  }
}
