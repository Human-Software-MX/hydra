import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { calcularScoreReemplazo, PrioridadReemplazo } from './reemplazo-scorer';

/** Periodos a analizar hacia atrás (12 = un año de historia). */
const VENTANA_PERIODOS = 12;

/**
 * Ranking de reemplazo del parque de medidores: cruza edad del medidor,
 * excepciones VEE y % de lecturas estimadas de los últimos 12 periodos para
 * priorizar el presupuesto de reemplazo donde más ingreso recupera.
 */
@Injectable()
export class ReemplazoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Últimos n periodos YYYY-MM incluyendo el actual. */
  private periodosRecientes(n: number): string[] {
    const periodos: string[] = [];
    const d = new Date();
    for (let i = 0; i < n; i++) {
      periodos.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
      d.setUTCMonth(d.getUTCMonth() - 1);
    }
    return periodos;
  }

  async ranking(params: {
    zonaId?: string;
    administracionId?: string;
    prioridad?: PrioridadReemplazo;
    limit?: number;
  }) {
    const limit = Math.min(params.limit ?? 100, 1000);
    const periodos = this.periodosRecientes(VENTANA_PERIODOS);

    const medidores = await this.prisma.medidor.findMany({
      where: {
        ...((params.zonaId || params.administracionId) && {
          contrato: {
            ...(params.zonaId && { zonaId: params.zonaId }),
            ...(params.administracionId && {
              zona: { administracionId: params.administracionId },
            }),
          },
        }),
      },
      select: {
        id: true,
        contratoId: true,
        serie: true,
        estado: true,
        fechaInstalacion: true,
        marca: { select: { nombre: true } },
        modelo: { select: { nombre: true } },
        contrato: {
          select: { numeroContrato: true, nombre: true, zona: { select: { nombre: true } } },
        },
      },
    });
    if (medidores.length === 0) {
      return { evaluados: 0, ventanaPeriodos: VENTANA_PERIODOS, resumen: [], data: [] };
    }

    const contratoIds = medidores.map((m) => m.contratoId);
    const [excepciones, consumos, consumosEstimados] = await Promise.all([
      this.prisma.excepcionLectura.groupBy({
        by: ['contratoId', 'regla'],
        where: {
          contratoId: { in: contratoIds },
          periodo: { in: periodos },
          regla: { in: ['caida_drastica', 'consumo_cero_prolongado'] },
          estado: { not: 'descartada' },
        },
        _count: { _all: true },
      }),
      this.prisma.consumo.groupBy({
        by: ['contratoId'],
        where: { contratoId: { in: contratoIds }, periodo: { in: periodos } },
        _count: { _all: true },
        _avg: { m3: true },
      }),
      this.prisma.consumo.groupBy({
        by: ['contratoId'],
        where: { contratoId: { in: contratoIds }, periodo: { in: periodos }, tipo: { not: 'Real' } },
        _count: { _all: true },
      }),
    ]);

    const excPorContrato = new Map<string, { caida: number; cero: number }>();
    for (const e of excepciones) {
      const agg = excPorContrato.get(e.contratoId) ?? { caida: 0, cero: 0 };
      if (e.regla === 'caida_drastica') agg.caida = e._count._all;
      if (e.regla === 'consumo_cero_prolongado') agg.cero = e._count._all;
      excPorContrato.set(e.contratoId, agg);
    }
    const consumoPorContrato = new Map(consumos.map((c) => [c.contratoId, c]));
    const estimadosPorContrato = new Map(consumosEstimados.map((c) => [c.contratoId, c._count._all]));

    const ahora = Date.now();
    const data = medidores
      .map((m) => {
        const exc = excPorContrato.get(m.contratoId) ?? { caida: 0, cero: 0 };
        const cons = consumoPorContrato.get(m.contratoId);
        const resultado = calcularScoreReemplazo({
          edadAnios: m.fechaInstalacion
            ? (ahora - m.fechaInstalacion.getTime()) / (365.25 * 86_400_000)
            : null,
          excepcionesCaidaDrastica: exc.caida,
          excepcionesConsumoCero: exc.cero,
          lecturas: cons?._count._all ?? 0,
          lecturasEstimadas: estimadosPorContrato.get(m.contratoId) ?? 0,
          consumoPromedioM3: Number(cons?._avg.m3 ?? 0),
        });
        return {
          medidorId: m.id,
          serie: m.serie,
          estado: m.estado,
          marca: m.marca?.nombre ?? null,
          modelo: m.modelo?.nombre ?? null,
          fechaInstalacion: m.fechaInstalacion?.toISOString().slice(0, 10) ?? null,
          contratoId: m.contratoId,
          numeroContrato: m.contrato.numeroContrato,
          contratoNombre: m.contrato.nombre,
          zona: m.contrato.zona?.nombre ?? null,
          ...resultado,
        };
      })
      .filter((r) => !params.prioridad || r.prioridad === params.prioridad)
      .sort((a, b) => b.score - a.score);

    const resumen = (['critica', 'alta', 'media', 'baja'] as const).map((prioridad) => ({
      prioridad,
      medidores: data.filter((d) => d.prioridad === prioridad).length,
    }));

    return {
      evaluados: medidores.length,
      ventanaPeriodos: VENTANA_PERIODOS,
      resumen,
      data: data.slice(0, limit),
    };
  }
}
