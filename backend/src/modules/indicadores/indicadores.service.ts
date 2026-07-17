import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Indicadores de gestión PIGOO (IMTA) calculables con los datos comerciales de Hydra.
 * Referencia: https://pigoo.imta.gob.mx — IP.14 eficiencia comercial, IP.15 eficiencia
 * de cobro, micromedición, padrón de usuarios, reclamaciones por 1,000 tomas.
 * La eficiencia física/global requiere macromedición (volumen producido) y queda fuera
 * hasta contar con esa fuente de datos.
 */
@Injectable()
export class IndicadoresService {
  constructor(private readonly prisma: PrismaService) {}

  async pigoo(periodo?: string) {
    const timbradoWhere = { estado: 'Timbrada OK', ...(periodo && { periodo }) };
    const pagoWhere = periodo ? { fecha: { startsWith: periodo } } : {};

    // Rango de fechas del periodo (YYYY-MM) para modelos con DateTime
    let quejaWhere = {};
    if (periodo && /^\d{4}-\d{2}$/.test(periodo)) {
      const desde = new Date(`${periodo}-01T00:00:00.000Z`);
      const hasta = new Date(desde);
      hasta.setUTCMonth(hasta.getUTCMonth() + 1);
      quejaWhere = { fecha: { gte: desde, lt: hasta } };
    }

    const [
      contratosTotales,
      contratosActivos,
      medidoresActivos,
      facturadoAgg,
      cobradoAgg,
      recibosEmitidos,
      recibosPagadosRows,
      pagosConVencimiento,
      quejasPeriodo,
    ] = await Promise.all([
      this.prisma.contrato.count(),
      this.prisma.contrato.count({ where: { estado: 'Activo' } }),
      this.prisma.medidor.count({ where: { estado: 'Activo' } }),
      this.prisma.timbrado.aggregate({ where: timbradoWhere, _sum: { total: true } }),
      this.prisma.pago.aggregate({ where: pagoWhere, _sum: { monto: true } }),
      this.prisma.recibo.count({ where: periodo ? { timbrado: { periodo } } : {} }),
      this.prisma.pago.findMany({
        where: { reciboId: { not: null }, ...pagoWhere },
        distinct: ['reciboId'],
        select: { reciboId: true },
      }),
      this.prisma.pago.findMany({
        where: { timbradoId: { not: null }, ...pagoWhere },
        select: { fecha: true, timbrado: { select: { fechaVencimiento: true } } },
      }),
      this.prisma.quejaAclaracion.count({ where: quejaWhere }),
    ]);

    const facturado = Number(facturadoAgg._sum.total ?? 0);
    const cobrado = Number(cobradoAgg._sum.monto ?? 0);
    const recibosPagados = recibosPagadosRows.length;
    const pagosATiempo = pagosConVencimiento.filter(
      (p) => p.timbrado?.fechaVencimiento && p.fecha <= p.timbrado.fechaVencimiento,
    ).length;

    const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 10000) / 100 : null);

    return {
      periodo: periodo ?? null,
      generadoEn: new Date().toISOString(),
      padron: {
        contratosTotales,
        contratosActivos,
        definicion: 'Cobertura del padrón de usuarios (PIGOO: padrón de usuarios)',
      },
      micromedicion: {
        medidoresActivos,
        contratosActivos,
        pct: pct(medidoresActivos, contratosActivos),
        definicion: 'Medidores activos entre contratos activos (PIGOO: micromedición)',
      },
      eficienciaComercial: {
        facturado,
        cobrado,
        pct: pct(cobrado, facturado),
        definicion: 'Monto cobrado entre monto facturado timbrado (PIGOO IP.14)',
      },
      eficienciaCobro: {
        recibosEmitidos,
        recibosPagados,
        pct: pct(recibosPagados, recibosEmitidos),
        definicion: 'Recibos con al menos un pago entre recibos emitidos (PIGOO IP.15)',
      },
      pagoATiempo: {
        pagosEvaluados: pagosConVencimiento.length,
        pagosATiempo,
        pct: pct(pagosATiempo, pagosConVencimiento.length),
        definicion: 'Pagos realizados en o antes del vencimiento del timbrado (PIGOO: usuarios con pago a tiempo)',
      },
      reclamaciones: {
        quejasPeriodo,
        por1000Tomas: contratosActivos > 0 ? Math.round((quejasPeriodo / contratosActivos) * 100000) / 100 : null,
        definicion: 'Quejas/aclaraciones por cada 1,000 tomas activas (PIGOO: reclamaciones)',
      },
      noDisponibles: {
        eficienciaFisica: 'Requiere macromedición (volumen producido) — sin fuente de datos',
        eficienciaGlobal: 'Derivada de eficiencia física × comercial',
      },
    };
  }
}
