import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CarteraService } from '../cartera/cartera.service';
import { SupraApiError, SupraClientService } from '../supra/supra-client.service';
import { SupraMapService } from '../supra/supra-map.service';
import { minorToPesos, pesosToMinor, supraRef } from '../supra/supra.config';

const ESTADOS_CORTADOS = ['Cortado', 'cortado'];

/**
 * Pagos. Con la integración SUPRA habilitada, SUPRA es la fuente de verdad:
 * el registro va PRIMERO a `POST /v1/payments` (idempotente por
 * `hydra:pago:<id>`); solo si SUPRA acepta se materializa el espejo local
 * (metadatos operativos: tipo/concepto/oficina, que el contrato de SUPRA no
 * modela) y las lecturas listan `GET /v1/payments`. Si un pago no puede
 * registrarse en SUPRA, NO se registra en Hydra (nunca hay estado financiero
 * local que SUPRA desconozca). Con la integración apagada opera el camino
 * legacy local completo.
 */
@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartera: CarteraService,
    private readonly supra: SupraClientService,
    private readonly supraMapa: SupraMapService,
  ) {}

  /** Sesión de caja abierta del usuario (vínculo operativo del corte). */
  private async sesionCajaActiva(usuarioId?: string): Promise<string | null> {
    if (!usuarioId) return null;
    const sesion = await this.prisma.sesionCaja.findFirst({
      where: { usuarioId, estado: 'Abierta' },
      select: { id: true },
    });
    return sesion?.id ?? null;
  }

  async crear(dto: {
    contratoId: string;
    reciboId?: string;
    timbradoId?: string;
    convenioId?: string;
    monto: number;
    tipo: string;
    concepto?: string;
    fecha?: string;
    usuarioId?: string;
  }) {
    if (!this.supra.enabled) return this.crearLegacy(dto);

    // 1) Comando a SUPRA (fuente de verdad). Id local pre-generado para que la
    //    Idempotency-Key y el external_ref sean deterministas ante reintentos.
    const pagoId = randomUUID();
    const externalRef = supraRef.pago(pagoId);
    const customerId = await this.supraMapa.ensureCustomer(dto.contratoId);

    let allocations: { obligation: string; amount: string }[] | undefined;
    if (dto.reciboId) {
      const obligationId = await this.supraMapa.ensureObligation(dto.reciboId);
      allocations = [{ obligation: obligationId, amount: pesosToMinor(dto.monto) }];
    }

    let supraPayment;
    try {
      supraPayment = await this.supra.recordPayment({
        customer: customerId,
        amount: pesosToMinor(dto.monto),
        received_at: dto.fecha ? new Date(dto.fecha).toISOString() : undefined,
        external_ref: externalRef,
        allocations,
      });
    } catch (err) {
      if (err instanceof SupraApiError) {
        this.logger.error(`SUPRA rechazó el pago (${err.code}): ${err.message}`);
        throw new BadGatewayException(`SUPRA rechazó el pago: ${err.message}`);
      }
      throw err;
    }

    // 2) Espejo operativo local (misma forma que el DTO legacy para la UI).
    const pago = await this.prisma.pago.create({
      data: {
        id: pagoId,
        contratoId: dto.contratoId,
        reciboId: dto.reciboId ?? null,
        timbradoId: dto.timbradoId ?? null,
        convenioId: dto.convenioId ?? null,
        monto: dto.monto,
        fecha: dto.fecha ?? new Date().toISOString().substring(0, 10),
        tipo: dto.tipo,
        concepto: dto.concepto ?? 'Pago en caja',
        origen: 'nativo',
        usuarioId: dto.usuarioId ?? null,
        sesionCajaId: await this.sesionCajaActiva(dto.usuarioId),
      },
      include: { recibo: true },
    });
    await this.supraMapa.save('pago', pagoId, supraPayment.id);

    // 3) Workflows/proyecciones (el saldo de verdad ya vive en SUPRA).
    await this.verificarAutoReconexion(dto.contratoId);
    await this.cartera.aplicarPago(pago.id);

    return { ...pago, supraPaymentId: supraPayment.id };
  }

  /** Camino legacy (SUPRA_INTEGRACION_ENABLED=false). */
  private async crearLegacy(dto: {
    contratoId: string;
    reciboId?: string;
    timbradoId?: string;
    convenioId?: string;
    monto: number;
    tipo: string;
    concepto?: string;
    fecha?: string;
    usuarioId?: string;
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
        usuarioId: dto.usuarioId ?? null,
        sesionCajaId: await this.sesionCajaActiva(dto.usuarioId),
      },
      include: { recibo: true },
    });

    await this.verificarAutoReconexion(dto.contratoId);
    await this.cartera.aplicarPago(pago.id);
    return pago;
  }

  /**
   * Listado con SUPRA como fuente de verdad. Con contrato, el filtro es
   * server-side (`GET /v1/payments?customer=`); sin contrato se recorren
   * páginas del tenant (cap defensivo con warning). Cada pago se enriquece
   * con el espejo local (tipo/concepto/contrato) vía external_ref. Pagos aún
   * no espejados (p. ej. checkout SUPRA recién confirmado) se muestran con
   * metadatos mínimos.
   */
  async listar(params: { contratoId?: string; origen?: string; page: number; limit: number }) {
    const { contratoId, origen, page, limit } = params;
    const objetivo = page * limit;
    const supraCustomerId = contratoId
      ? await this.supraMapa.get('contrato', contratoId)
      : null;
    // Contrato jamás sincronizado a SUPRA → no puede tener pagos allá.
    if (contratoId && !supraCustomerId) return { data: [], total: 0, page, limit };

    const recolectados: {
      supra: Awaited<ReturnType<SupraClientService['listPayments']>>['data'][number];
      contratoId: string | null;
    }[] = [];
    let cursor: string | undefined;
    const MAX_PAGINAS = 20;
    let agotado = false;
    for (let i = 0; i < MAX_PAGINAS && recolectados.length < objetivo + 1; i++) {
      const res = await this.supra.listPayments({
        customer: supraCustomerId ?? undefined,
        limit: 100,
        starting_after: cursor,
      });
      for (const p of res.data) {
        // Defensa en profundidad: el filtro real ya es server-side.
        if (supraCustomerId && p.customer !== supraCustomerId) continue;
        const ctr = supraCustomerId
          ? contratoId!
          : await this.supraMapa.reverse('contrato', p.customer);
        recolectados.push({ supra: p, contratoId: ctr });
      }
      if (!res.has_more || !res.next_cursor) {
        agotado = true;
        break;
      }
      cursor = res.next_cursor;
    }
    // Solo el cap duro es truncación real; parar por tener la página completa
    // es la paginación esperada.
    if (!agotado && recolectados.length < objetivo + 1) {
      this.logger.warn(
        `listar(contratoId=${contratoId ?? '-'}, page=${page}): cap de ${MAX_PAGINAS} páginas alcanzado ` +
          `con has_more=true (${recolectados.length} pagos) — el total reportado está TRUNCADO`,
      );
    }

    // Enriquecimiento con el espejo local por external_ref (hydra:pago:<id>).
    const idsLocales = recolectados
      .map((r) => r.supra.external_ref)
      .filter((ref): ref is string => Boolean(ref?.startsWith('hydra:pago:')))
      .map((ref) => ref.slice('hydra:pago:'.length));
    const espejos = await this.prisma.pago.findMany({
      where: { id: { in: idsLocales } },
      include: {
        contrato: { select: { nombre: true } },
        recibo: { select: { id: true, saldoVigente: true } },
      },
    });
    const porId = new Map(espejos.map((e) => [e.id, e]));

    const mapeados = recolectados.map(({ supra, contratoId: ctr }) => {
      const localId = supra.external_ref?.startsWith('hydra:pago:')
        ? supra.external_ref.slice('hydra:pago:'.length)
        : null;
      const espejo = localId ? porId.get(localId) : undefined;
      return {
        id: espejo?.id ?? supra.id,
        supraPaymentId: supra.id,
        contratoId: espejo?.contratoId ?? ctr,
        reciboId: espejo?.reciboId ?? null,
        convenioId: espejo?.convenioId ?? null,
        monto: espejo ? Number(espejo.monto) : minorToPesos(supra.amount),
        fecha: espejo?.fecha ?? supra.received_at?.substring(0, 10),
        tipo: espejo?.tipo ?? 'WEB',
        concepto: espejo?.concepto ?? 'Pago registrado en SUPRA',
        origen: espejo?.origen ?? 'supra',
        oficina: espejo?.oficina ?? null,
        estado: supra.status,
        createdAt: espejo?.createdAt ?? supra.created_at,
        contrato: espejo?.contrato ?? null,
        recibo: espejo?.recibo ?? null,
      };
    });

    const filtrados = origen ? mapeados.filter((m) => m.origen === origen) : mapeados;
    const data = filtrados.slice((page - 1) * limit, page * limit);
    return { data, total: filtrados.length, page, limit };
  }

  /**
   * Devolución de un pago vía SUPRA (dueño de refunds). Idempotente por
   * `hydra:refund:<uuid>`. Puede quedar pendiente de aprobación maker-checker
   * (202 en SUPRA) — el espejo local (Pago negativo) lo materializa el evento
   * `refund.succeeded`, no este método.
   */
  async devolver(pagoId: string, dto: { monto?: number; motivo?: string }) {
    this.supra.assertEnabled();
    const pago = await this.prisma.pago.findUnique({
      where: { id: pagoId },
      select: { id: true, contratoId: true, monto: true },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');

    const supraPaymentId = await this.supraMapa.get('pago', pagoId);
    if (!supraPaymentId) {
      throw new BadRequestException('El pago no está sincronizado con SUPRA; no puede devolverse');
    }
    if (dto.monto !== undefined && !(dto.monto > 0 && dto.monto <= Number(pago.monto))) {
      throw new BadRequestException('Monto de devolución inválido');
    }

    const refUuid = randomUUID();
    try {
      const resultado = await this.supra.createRefund(supraPaymentId, {
        amount: dto.monto !== undefined ? pesosToMinor(dto.monto) : undefined,
        reason: dto.motivo,
        external_ref: `hydra:refund:${refUuid}`,
      });
      if (resultado.object === 'approval_request') {
        return {
          estado: 'pendiente_aprobacion',
          approvalId: resultado.id,
          mensaje:
            'La devolución supera el umbral del tenant y quedó pendiente de aprobación maker-checker en SUPRA',
        };
      }
      return {
        estado: 'devuelto',
        refundId: resultado.id,
        supraPaymentId,
        monto: dto.monto ?? Number(pago.monto),
      };
    } catch (err) {
      if (err instanceof SupraApiError) {
        this.logger.error(`SUPRA rechazó la devolución (${err.code}): ${err.message}`);
        throw new BadGatewayException(`SUPRA rechazó la devolución: ${err.message}`);
      }
      throw err;
    }
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

    // Saldo: SUPRA cuando la integración está activa; cálculo local si no.
    let saldo: number;
    if (this.supra.enabled) {
      const customerId = await this.supraMapa.get('contrato', contratoId);
      if (!customerId) return;
      const balance = await this.supra.getBalance(customerId);
      saldo = minorToPesos(balance.receivable_balance);
    } else {
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
      saldo = Number(facturadoAgg._sum.total ?? 0) - Number(pagadoAgg._sum.monto ?? 0);
    }
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
