import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CarteraService } from '../cartera/cartera.service';

const ESTADOS_CORTADOS = ['Cortado', 'cortado'];

@Injectable()
export class PagosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartera: CarteraService,
  ) {}

  async crear(dto: {
    contratoId: string;
    reciboId?: string;
    timbradoId?: string;
    convenioId?: string;
    monto: number;
    tipo: string;
    concepto?: string;
    fecha?: string;
  }) {
    const pago = await this.prisma.pago.create({
      data: {
        contratoId: dto.contratoId,
        reciboId: dto.reciboId ?? null,
        timbradoId: dto.timbradoId ?? null,
        convenioId: dto.convenioId ?? null,
        monto: dto.monto,
        fecha: dto.fecha ?? new Date().toISOString().substring(0, 10),
        tipo: dto.tipo,
        concepto: dto.concepto ?? 'Pago en caja',
        origen: 'nativo',
      },
      include: { recibo: true },
    });

    // After payment, check if reconexion order should be auto-generated
    await this.verificarAutoReconexion(dto.contratoId);
    // Aplica el pago a la cartera (FIFO) y refresca el estado de cuenta.
    await this.cartera.aplicarPago(pago.id);

    return pago;
  }

  /**
   * After any payment, if the contract is in "Cortado" state and the outstanding
   * balance is zero (or positive in favor), automatically create a Reconexion order.
   */
  async verificarAutoReconexion(contratoId: string): Promise<void> {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true, estado: true, bloqueadoJuridico: true },
    });
    if (!contrato) return;

    const esCortado = ESTADOS_CORTADOS.some(s =>
      (contrato.estado ?? '').toLowerCase().includes(s.toLowerCase()),
    );
    if (!esCortado || contrato.bloqueadoJuridico) return;

    // Calculate outstanding balance
    const [facturadoAgg, pagadoAgg] = await Promise.all([
      this.prisma.timbrado.aggregate({
        where: { contratoId, estado: 'Timbrada OK' },
        _sum: { total: true },
      }),
      this.prisma.pago.aggregate({
        where: { contratoId },
        _sum: { monto: true },
      }),
    ]);

    const saldo = Number(facturadoAgg._sum.total ?? 0) - Number(pagadoAgg._sum.monto ?? 0);
    if (saldo > 0.01) return; // still has outstanding balance

    // Avoid duplicate pending reconexion orders
    const ordenExistente = await this.prisma.orden.findFirst({
      where: { contratoId, tipo: 'Reconexion', estado: { in: ['Pendiente', 'En proceso'] } },
    });
    if (ordenExistente) return;

    const fechaProgramada = new Date();
    fechaProgramada.setDate(fechaProgramada.getDate() + 1); // next business day

    await this.prisma.$transaction([
      this.prisma.orden.create({
        data: {
          contratoId,
          tipo: 'Reconexion',
          prioridad: 'Alta',
          notas: 'Generada automáticamente al liquidar adeudo',
          fechaProgramada,
          seguimientos: {
            create: {
              estadoNuevo: 'Pendiente',
              nota: 'Orden de reconexión generada automáticamente por pago de adeudo completo',
              usuario: 'sistema',
            },
          },
        },
      }),
      this.prisma.contrato.update({
        where: { id: contratoId },
        data: { fechaReconexionPrevista: fechaProgramada.toISOString().substring(0, 10) },
      }),
    ]);
  }
}
