import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CajaService {
  constructor(private readonly prisma: PrismaService) {}

  async abrir(usuarioId: string, montoInicial: number = 0) {
    const sesionAbierta = await this.prisma.sesionCaja.findFirst({
      where: { usuarioId, estado: 'Abierta' },
    });
    if (sesionAbierta) throw new BadRequestException('Ya tienes una sesión de caja abierta');

    return this.prisma.sesionCaja.create({
      data: { usuarioId, montoInicial },
    });
  }

  async cerrar(sesionId: string) {
    const sesion = await this.prisma.sesionCaja.findUnique({ where: { id: sesionId } });
    if (!sesion) throw new NotFoundException('Sesión no encontrada');
    if (sesion.estado === 'Cerrada') throw new BadRequestException('La sesión ya está cerrada');

    // Corte por SESIÓN: pagos ligados explícitamente a esta sesión, más los
    // del mismo cajero dentro del turno que aún no traían vínculo (transición).
    // Nunca pagos de otros usuarios ni posteriores al cierre.
    const ahora = new Date();
    const pagos = await this.prisma.pago.findMany({
      where: {
        origen: 'nativo',
        OR: [
          { sesionCajaId: sesionId },
          {
            sesionCajaId: null,
            usuarioId: sesion.usuarioId,
            createdAt: { gte: sesion.apertura, lte: ahora },
          },
        ],
      },
      select: { monto: true, tipo: true },
    });

    const totales = pagos.reduce(
      (acc, p) => {
        const monto = Number(p.monto);
        acc.totalCobrado += monto;
        if (p.tipo === 'Efectivo') acc.totalEfectivo += monto;
        else if (['Transferencia', 'SPEI'].includes(p.tipo)) acc.totalTransf += monto;
        else if (p.tipo === 'Tarjeta') acc.totalTarjeta += monto;
        return acc;
      },
      { totalCobrado: 0, totalEfectivo: 0, totalTransf: 0, totalTarjeta: 0 },
    );

    const anticiposAplicados = await this.prisma.anticipo.aggregate({
      where: { sesionId, aplicado: true },
      _sum: { monto: true },
    });

    return this.prisma.sesionCaja.update({
      where: { id: sesionId },
      data: {
        estado: 'Cerrada',
        cierre: new Date(),
        ...totales,
        totalAnticipo: Number(anticiposAplicados._sum.monto ?? 0),
        resumen: {
          totalPagos: pagos.length,
          desglose: pagos.reduce(
            (acc, p) => {
              acc[p.tipo] = (acc[p.tipo] ?? 0) + Number(p.monto);
              return acc;
            },
            {} as Record<string, number>,
          ),
        },
      },
    });
  }

  async getSesionActiva(usuarioId: string) {
    return this.prisma.sesionCaja.findFirst({
      where: { usuarioId, estado: 'Abierta' },
      include: {
        anticipos: {
          where: { aplicado: false },
          select: { id: true, contratoId: true, monto: true },
        },
      },
    });
  }

  async getHistorial(params: { page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [data, total] = await Promise.all([
      this.prisma.sesionCaja.findMany({
        orderBy: { apertura: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sesionCaja.count(),
    ]);
    return { data, total, page, limit };
  }
}
