import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CarteraService } from '../cartera/cartera.service';
import { SupraClientService } from './supra-client.service';
import { minorToPesos } from './supra.config';
import { SettlementDto } from './supra-settlements.dto';

export interface ResultadoSettlement {
  status: 'applied' | 'already_applied';
  paymentId: string;
  folio: string;
  pagoIds?: string[];
}

/**
 * Settlement write-back: SUPRA (vía su conector de ingesta, pushSettlement)
 * notifica que un pago quedó liquidado y a qué recibos de Hydra se aplicó.
 *
 * Semántica: marca cada recibo como pagado/abonado creando el Pago espejo
 * (origen `supra`, folio en el concepto) y refresca cartera/EstadoCuenta como
 * lo haría un pago normal — pero SIN el flujo SUPRA-first: aquí NUNCA se llama
 * `POST /v1/payments` de vuelta (el pago ya existe en SUPRA; hacerlo cerraría
 * un bucle settlement→payment→settlement).
 *
 * Idempotente por paymentId: los pagos espejo y el mapeo pago↔pay_ se crean en
 * UNA transacción, así que la existencia del mapeo implica settlement aplicado
 * completo → `already_applied`.
 */
@Injectable()
export class SupraSettlementsService {
  private readonly logger = new Logger(SupraSettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartera: CarteraService,
    private readonly client: SupraClientService,
  ) {}

  async aplicar(dto: SettlementDto): Promise<ResultadoSettlement> {
    this.client.assertEnabled();

    // Idempotencia: el payment ya fue espejado (por este endpoint o por el
    // handler de payment.succeeded del webhook) → no volver a aplicar.
    const yaMapeado = await this.prisma.supraMapa.findUnique({
      where: { entidad_supraId: { entidad: 'pago', supraId: dto.paymentId } },
      select: { hydraId: true },
    });
    if (yaMapeado) {
      return { status: 'already_applied', paymentId: dto.paymentId, folio: dto.folio };
    }

    // Todos los recibos deben existir ANTES de aplicar nada.
    const reciboIds = dto.allocations.map((a) => a.reciboId);
    const recibos = await this.prisma.recibo.findMany({
      where: { id: { in: reciboIds } },
      select: { id: true, contratoId: true },
    });
    const porId = new Map(recibos.map((r) => [r.id, r]));
    const faltantes = reciboIds.filter((id) => !porId.has(id));
    if (faltantes.length > 0) {
      throw new NotFoundException(
        `Recibo(s) no encontrado(s) en Hydra: ${faltantes.join(', ')}`,
      );
    }

    const sumaAllocations = dto.allocations.reduce((s, a) => s + a.montoCentavos, 0);
    if (sumaAllocations !== dto.totalCentavos) {
      // El excedente (pago mayor al adeudo) es legítimo en SUPRA; solo bitácora.
      this.logger.warn(
        `Settlement ${dto.paymentId}: Σ allocations (${sumaAllocations}) ≠ totalCentavos (${dto.totalCentavos})`,
      );
    }

    const fecha = dto.paidAt.substring(0, 10);
    let pagoIds: string[];
    try {
      pagoIds = await this.prisma.$transaction(async (tx) => {
        const ids: string[] = [];
        for (const alloc of dto.allocations) {
          const recibo = porId.get(alloc.reciboId)!;
          const pago = await tx.pago.create({
            data: {
              contratoId: recibo.contratoId,
              reciboId: recibo.id,
              monto: minorToPesos(alloc.montoCentavos),
              fecha,
              tipo: 'WEB',
              concepto: `Liquidación SUPRA ${dto.folio}`,
              origen: 'supra',
              oficina: 'SUPRA',
            },
          });
          ids.push(pago.id);
        }
        // Mapeo pago↔payment en la MISMA transacción: es la marca de idempotencia
        // y evita que el webhook payment.succeeded duplique el espejo. `create` a
        // propósito (no upsert): si otra entrega concurrente ganó el mapeo entre
        // el check inicial y esta tx, el UNIQUE aborta y revierte los espejos.
        await tx.supraMapa.create({
          data: { entidad: 'pago', hydraId: ids[0], supraId: dto.paymentId },
        });
        return ids;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        this.logger.warn(
          `Settlement ${dto.paymentId}: entrega concurrente detectada (P2002); tratada como already_applied`,
        );
        return { status: 'already_applied', paymentId: dto.paymentId, folio: dto.folio };
      }
      throw error;
    }

    // Refresca cartera/EstadoCuenta por contrato como lo haría un pago normal
    // (aplicarPago nunca lanza; el recálculo nocturno es la red de seguridad).
    const contratosVistos = new Set<string>();
    for (let i = 0; i < dto.allocations.length; i++) {
      const contratoId = porId.get(dto.allocations[i].reciboId)!.contratoId;
      if (contratosVistos.has(contratoId)) continue;
      contratosVistos.add(contratoId);
      await this.cartera.aplicarPago(pagoIds[i]);
    }

    this.logger.log(
      `Settlement ${dto.paymentId} (${dto.folio}) aplicado: ${pagoIds.length} pago(s) espejo en ${contratosVistos.size} contrato(s)`,
    );
    return { status: 'applied', paymentId: dto.paymentId, folio: dto.folio, pagoIds };
  }
}
