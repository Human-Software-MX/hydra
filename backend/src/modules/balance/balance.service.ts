import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { calcularBalanceM36, BalanceM36, ParametrosBalance, ParametrosRed } from './m36-balance';

/**
 * Balance hídrico M36 del periodo, alimentado con datos reales del sistema:
 *  - suministrado: VolumenProducido del periodo (macromedición, módulo indicadores)
 *  - facturado medido: consumos confirmados tipo "Real"
 *  - facturado no medido: consumos confirmados Promedio/Mixto/Cuota fija
 *  - importe facturado: timbrados del periodo (para tarifa media)
 *
 * Los parámetros de estimación (submedición, no autorizado, costo de producción)
 * se pasan por query y tienen defaults documentados en el calculador.
 */
@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async balancePeriodo(params: {
    periodo: string;
    administracionId?: string;
    parametros?: ParametrosBalance;
    red?: ParametrosRed;
  }): Promise<BalanceM36 & { periodo: string; fuenteSuministrado: string }> {
    if (!/^\d{4}-\d{2}$/.test(params.periodo)) {
      throw new BadRequestException('periodo debe tener formato YYYY-MM');
    }

    const producido = await this.prisma.volumenProducido.aggregate({
      where: {
        periodo: params.periodo,
        ...(params.administracionId && { administracionId: params.administracionId }),
      },
      _sum: { m3: true },
    });
    const suministradoM3 = producido._sum.m3 ? Number(producido._sum.m3) : null;
    if (suministradoM3 === null) {
      throw new NotFoundException(
        `No hay volumen producido registrado para ${params.periodo}. Capture la macromedición en POST /indicadores/volumen-producido`,
      );
    }

    // Consumos del periodo por tipo (filtrado por administración vía zona del contrato).
    const filtroContrato = params.administracionId
      ? { contrato: { zona: { administracionId: params.administracionId } } }
      : {};

    const [medido, noMedido, timbrados] = await Promise.all([
      this.prisma.consumo.aggregate({
        where: { periodo: params.periodo, confirmado: true, tipo: 'Real', ...filtroContrato },
        _sum: { m3: true },
      }),
      this.prisma.consumo.aggregate({
        where: {
          periodo: params.periodo,
          confirmado: true,
          tipo: { not: 'Real' },
          ...filtroContrato,
        },
        _sum: { m3: true },
      }),
      this.prisma.timbrado.aggregate({
        where: {
          periodo: params.periodo,
          ...(params.administracionId && {
            contrato: { zona: { administracionId: params.administracionId } },
          }),
        },
        _sum: { total: true },
      }),
    ]);

    // Días naturales del periodo (para UARL): YYYY-MM → días del mes.
    const [anio, mes] = params.periodo.split('-').map(Number);
    const diasPeriodo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();

    const balance = calcularBalanceM36({
      suministradoM3,
      facturadoMedidoM3: Number(medido._sum.m3 ?? 0),
      facturadoNoMedidoM3: Number(noMedido._sum.m3 ?? 0),
      importeFacturado: Number(timbrados._sum.total ?? 0),
      parametros: params.parametros,
      red: params.red ? { diasPeriodo, ...params.red } : undefined,
    });

    return { ...balance, periodo: params.periodo, fuenteSuministrado: 'volumenes_producidos' };
  }
}
