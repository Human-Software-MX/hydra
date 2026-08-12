import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EtlPagosService } from './etl-pagos.service';
import { conMonitoreo } from '../../common/monitoreo.helper';

@Injectable()
export class PagosExternosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly etl: EtlPagosService,
  ) {}

  async uploadArchivo(params: { recaudador: string; archivoNombre: string; contenido: string }) {
    const registros = this.etl.parseArchivo(params.recaudador, params.contenido);
    if (registros.length === 0) throw new BadRequestException('Archivo sin registros');

    return conMonitoreo(
      this.prisma,
      'ETL_PAGOS',
      async (ctx) => {
        const resultado = await this.procesarRegistros(params, registros);
        ctx.registros = resultado.total;
        ctx.errores = resultado.rechazados;
        ctx.detalle = {
          recaudador: params.recaudador,
          archivoNombre: params.archivoNombre,
          procesados: resultado.procesados,
          rechazados: resultado.rechazados,
        };
        return resultado;
      },
      { subTipo: params.recaudador },
    );
  }

  private async procesarRegistros(
    params: { recaudador: string; archivoNombre: string; contenido: string },
    registros: ReturnType<EtlPagosService['parseArchivo']>,
  ) {
    let procesados = 0;
    let rechazados = 0;
    const errores: string[] = [];

    for (const r of registros) {
      if (r.error || !r.monto || r.monto <= 0) {
        rechazados++;
        errores.push(r.error ?? 'Monto inválido');
        await this.prisma.pagoExterno.create({
          data: {
            recaudador: params.recaudador,
            archivoNombre: params.archivoNombre,
            contratoRaw: r.contratoRaw,
            monto: r.monto || 0,
            fechaPagoReal: r.fechaPagoReal,
            formaPago: r.formaPago ?? this.etl.formaPagoDefecto(params.recaudador),
            canal: r.canal,
            oficina: r.oficina,
            estado: 'rechazado',
            motivoRechazo: r.error ?? 'Validación fallida',
            datosRaw: r.datosRaw,
          },
        });
        continue;
      }

      let contratoId: string | null = null;
      if (r.contratoRaw) {
        const contrato = await this.prisma.contrato.findFirst({
          where: { id: { contains: r.contratoRaw } },
          select: { id: true },
        });
        contratoId = contrato?.id ?? null;
      }

      await this.prisma.pagoExterno.create({
        data: {
          recaudador: params.recaudador,
          archivoNombre: params.archivoNombre,
          referencia: r.referencia,
          contratoRaw: r.contratoRaw,
          contratoId,
          monto: r.monto,
          fechaPagoReal: r.fechaPagoReal,
          formaPago: r.formaPago ?? this.etl.formaPagoDefecto(params.recaudador),
          canal: r.canal,
          oficina: r.oficina,
          estado: 'pendiente_conciliar',
          datosRaw: r.datosRaw,
        },
      });
      procesados++;
    }

    return { procesados, rechazados, total: registros.length, errores };
  }

  async findAll(params: { estado?: string; recaudador?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const where = {
      ...(params.estado && { estado: params.estado }),
      ...(params.recaudador && { recaudador: params.recaudador }),
    };
    const [data, total] = await Promise.all([
      this.prisma.pagoExterno.findMany({
        where,
        orderBy: { fechaPagoReal: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pagoExterno.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async conciliar(id: string, contratoId: string, reciboId?: string) {
    const pago = await this.prisma.pagoExterno.findUnique({ where: { id } });
    if (!pago) throw new NotFoundException('Pago externo no encontrado');
    if (pago.estado !== 'pendiente_conciliar')
      throw new BadRequestException('El pago ya fue procesado');

    const pagoAplicado = await this.prisma.pago.create({
      data: {
        contratoId,
        reciboId: reciboId ?? null,
        monto: pago.monto,
        fecha: pago.fechaPagoReal.toISOString().split('T')[0],
        tipo: pago.formaPago ?? 'EFECTIVO',
        concepto: `Pago externo ${pago.recaudador} - Ref: ${pago.referencia ?? pago.id}`,
        origen: 'externo',
      },
    });

    await this.prisma.pagoExterno.update({
      where: { id },
      data: { estado: 'conciliado', contratoId, reciboId },
    });

    return { pagoExternoId: id, pagoAplicadoId: pagoAplicado.id };
  }

  async rechazar(id: string, motivo: string) {
    const pago = await this.prisma.pagoExterno.findUnique({ where: { id } });
    if (!pago) throw new NotFoundException('Pago externo no encontrado');
    return this.prisma.pagoExterno.update({
      where: { id },
      data: { estado: 'rechazado', motivoRechazo: motivo },
    });
  }
}
