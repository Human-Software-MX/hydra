import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hoyIso, round2 } from './cartera.util';
import {
  calcularPropensionPago,
  fechaLiquidacionDocumento,
  DocumentoPropension,
  ResultadoPropension,
  SegmentoPropension,
} from './propension-pago';

/**
 * Cobranza predictiva: score de propensión al pago por contrato y
 * segmentación de la cartera para dirigir campañas (SWAN etapa Proactiva).
 * Todo se deriva del libro de partida abierta ya materializado por
 * CarteraService — no introduce una verdad paralela.
 */
@Injectable()
export class PropensionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Documentos → entrada del calculador (fecha de liquidación desde aplicaciones). */
  private aDocumentosPropension(
    documentos: Array<{
      montoOriginal: unknown;
      saldo: unknown;
      fechaVencimiento: string;
      estado: string;
      aplicaciones: Array<{ monto: unknown; fecha: string }>;
    }>,
  ): DocumentoPropension[] {
    return documentos.map((d) => {
      const montoOriginal = Number(d.montoOriginal);
      return {
        montoOriginal,
        saldo: Number(d.saldo),
        fechaVencimiento: d.fechaVencimiento,
        estado: d.estado,
        fechaLiquidacion:
          Number(d.saldo) <= 0.01
            ? fechaLiquidacionDocumento(
                montoOriginal,
                d.aplicaciones.map((a) => ({ monto: Number(a.monto), fecha: a.fecha })),
              )
            : null,
      };
    });
  }

  private async calcularParaContratos(contratoIds: string[], hoy: string) {
    const [documentos, estados, convenios] = await Promise.all([
      this.prisma.documentoCartera.findMany({
        where: { contratoId: { in: contratoIds } },
        select: {
          contratoId: true,
          montoOriginal: true,
          saldo: true,
          fechaVencimiento: true,
          estado: true,
          aplicaciones: { select: { monto: true, fecha: true } },
        },
      }),
      this.prisma.estadoCuenta.findMany({
        where: { contratoId: { in: contratoIds } },
        select: { contratoId: true, diasMoraMax: true, enConvenio: true, saldoVencido: true },
      }),
      this.prisma.convenio.findMany({
        where: { contratoId: { in: contratoIds } },
        select: { contratoId: true, estado: true },
      }),
    ]);

    const docsPorContrato = new Map<string, typeof documentos>();
    for (const d of documentos) {
      const arr = docsPorContrato.get(d.contratoId) ?? [];
      arr.push(d);
      docsPorContrato.set(d.contratoId, arr);
    }
    const estadoPorContrato = new Map(estados.map((e) => [e.contratoId, e]));
    const conveniosPorContrato = new Map<string, { cancelados: number; completados: number }>();
    for (const c of convenios) {
      const agg = conveniosPorContrato.get(c.contratoId) ?? { cancelados: 0, completados: 0 };
      if (c.estado === 'Cancelado') agg.cancelados++;
      if (c.estado === 'Completado') agg.completados++;
      conveniosPorContrato.set(c.contratoId, agg);
    }

    const resultados = new Map<string, ResultadoPropension>();
    for (const contratoId of contratoIds) {
      const estado = estadoPorContrato.get(contratoId);
      const conv = conveniosPorContrato.get(contratoId) ?? { cancelados: 0, completados: 0 };
      resultados.set(
        contratoId,
        calcularPropensionPago({
          hoy,
          documentos: this.aDocumentosPropension(docsPorContrato.get(contratoId) ?? []),
          enConvenio: estado?.enConvenio ?? false,
          conveniosCancelados: conv.cancelados,
          conveniosCompletados: conv.completados,
          diasMoraMax: estado?.diasMoraMax ?? 0,
        }),
      );
    }
    return resultados;
  }

  /** Score de propensión al pago de un contrato, con desglose de factores. */
  async propensionContrato(contratoId: string) {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true, numeroContrato: true, nombre: true, estado: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const resultados = await this.calcularParaContratos([contratoId], hoyIso());
    return { contrato, propension: resultados.get(contratoId) };
  }

  /**
   * Segmentación predictiva de la cartera con saldo: score por contrato y
   * resumen por segmento para dirigir campañas de cobranza diferenciadas.
   */
  async segmentacion(params: {
    administracionId?: string;
    zonaId?: string;
    segmento?: string;
    limit?: number;
  }) {
    const limit = Math.min(params.limit ?? 500, 2000);
    const estados = await this.prisma.estadoCuenta.findMany({
      where: {
        saldoTotal: { gt: 0 },
        ...((params.zonaId || params.administracionId) && {
          contrato: {
            ...(params.zonaId && { zonaId: params.zonaId }),
            ...(params.administracionId && {
              zona: { administracionId: params.administracionId },
            }),
          },
        }),
      },
      orderBy: [{ saldoVencido: 'desc' }, { saldoTotal: 'desc' }],
      take: limit,
      select: {
        contratoId: true,
        saldoTotal: true,
        saldoVencido: true,
        diasMoraMax: true,
        contrato: { select: { numeroContrato: true, nombre: true } },
      },
    });

    const resultados = await this.calcularParaContratos(
      estados.map((e) => e.contratoId),
      hoyIso(),
    );

    const data = estados
      .map((e) => {
        const p = resultados.get(e.contratoId)!;
        return {
          contratoId: e.contratoId,
          numeroContrato: e.contrato.numeroContrato,
          nombre: e.contrato.nombre,
          saldoTotal: Number(e.saldoTotal),
          saldoVencido: Number(e.saldoVencido),
          diasMoraMax: e.diasMoraMax,
          score: p.score,
          segmento: p.segmento,
          accionRecomendada: p.accionRecomendada,
          sinHistorial: p.sinHistorial,
        };
      })
      .filter((d) => !params.segmento || d.segmento === params.segmento);

    const resumen = new Map<
      SegmentoPropension,
      { segmento: SegmentoPropension; accionRecomendada: string; contratos: number; saldoVencido: number }
    >();
    for (const d of data) {
      const agg =
        resumen.get(d.segmento) ??
        { segmento: d.segmento, accionRecomendada: d.accionRecomendada, contratos: 0, saldoVencido: 0 };
      agg.contratos++;
      agg.saldoVencido = round2(agg.saldoVencido + d.saldoVencido);
      resumen.set(d.segmento, agg);
    }

    return {
      evaluados: data.length,
      limit,
      resumen: [...resumen.values()].sort((a, b) => b.saldoVencido - a.saldoVencido),
      data,
    };
  }
}
