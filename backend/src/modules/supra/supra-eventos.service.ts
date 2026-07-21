import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CarteraService } from '../cartera/cartera.service';
import { SupraClientService, SupraPayment, SupraPaymentLink, SupraPaymentPlan } from './supra-client.service';
import { SupraMapService } from './supra-map.service';
import { minorToPesos } from './supra.config';

const ESTADOS_CORTADOS = ['Cortado', 'cortado'];

interface SupraEvento {
  id: string;
  type: string;
  created: string;
  tenant_id: string;
  data: Record<string, unknown>;
  sequence?: number | string;
}

/**
 * Recepción y procesamiento de eventos de SUPRA (webhooks firmados).
 *
 * Entrega at-least-once → inbox idempotente por `Supra-Event-Id` y handlers
 * conmutativos (upsert). El estado financiero NO se recalcula aquí: SUPRA es
 * la verdad; estos handlers solo mantienen el espejo operativo local
 * (metadatos para joins de UI) y disparan workflows operativos (reconexión).
 */
@Injectable()
export class SupraEventosService {
  private readonly logger = new Logger(SupraEventosService.name);
  private procesando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SupraClientService,
    private readonly mapa: SupraMapService,
    private readonly cartera: CarteraService,
  ) {}

  // ── Verificación de firma (Supra-Signature: t=<unix>,v1=<hex hmac>) ─────────

  verificarFirma(header: string | undefined, rawBody: Buffer): void {
    const secret = this.client.config.webhookSecret;
    if (!secret) {
      throw new UnauthorizedException('SUPRA_WEBHOOK_SECRET no configurado');
    }
    if (!header) throw new UnauthorizedException('Falta header Supra-Signature');

    const parts = Object.fromEntries(
      header.split(',').map((p) => p.trim().split('=', 2) as [string, string]),
    );
    const t = Number(parts['t']);
    const v1 = parts['v1'];
    if (!Number.isFinite(t) || !v1) {
      throw new UnauthorizedException('Header Supra-Signature malformado');
    }
    const tolerance = this.client.config.webhookToleranceSec;
    if (Math.abs(Date.now() / 1000 - t) > tolerance) {
      throw new UnauthorizedException('Firma de webhook fuera de la ventana de tolerancia');
    }
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(v1, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Firma de webhook inválida');
    }
  }

  // ── Ingreso al inbox (idempotente) ──────────────────────────────────────────

  async recibir(evento: SupraEvento): Promise<{ ok: true; duplicado: boolean }> {
    try {
      await this.prisma.supraEventoInbox.create({
        data: {
          eventId: evento.id,
          tipo: evento.type,
          sequence: evento.sequence !== undefined ? BigInt(evento.sequence) : null,
          payload: evento as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // P2002 = eventId duplicado (redelivery at-least-once): confirmar sin reprocesar.
      if ((err as { code?: string }).code === 'P2002') {
        return { ok: true, duplicado: true };
      }
      throw err;
    }
    // Procesamiento inmediato fire-and-forget; el 200 al relay no espera handlers.
    void this.procesarPendientes().catch((e) =>
      this.logger.error(`Procesamiento de inbox falló: ${e instanceof Error ? e.message : e}`),
    );
    return { ok: true, duplicado: false };
  }

  // ── Procesador del inbox ────────────────────────────────────────────────────

  async procesarPendientes(): Promise<void> {
    if (this.procesando) return;
    this.procesando = true;
    try {
      const pendientes = await this.prisma.supraEventoInbox.findMany({
        where: { estado: 'pendiente' },
        orderBy: [{ sequence: 'asc' }, { recibidoEn: 'asc' }],
        take: 100,
      });
      for (const row of pendientes) {
        try {
          await this.procesarEvento(row.payload as unknown as SupraEvento);
          await this.prisma.supraEventoInbox.update({
            where: { id: row.id },
            data: { estado: 'procesado', procesadoEn: new Date(), error: null },
          });
        } catch (err) {
          const intentos = row.intentos + 1;
          const mensaje = err instanceof Error ? err.message : String(err);
          await this.prisma.supraEventoInbox.update({
            where: { id: row.id },
            data: {
              intentos,
              error: mensaje.slice(0, 1000),
              // 5 intentos → cuarentena (no bloquea el resto del inbox).
              estado: intentos >= 5 ? 'cuarentena' : 'error',
            },
          });
          this.logger.warn(`Evento ${row.eventId} (${row.tipo}) falló (${intentos}): ${mensaje}`);
        }
      }
      // Reintenta errores transitorios en la siguiente pasada.
      await this.prisma.supraEventoInbox.updateMany({
        where: { estado: 'error' },
        data: { estado: 'pendiente' },
      });
    } finally {
      this.procesando = false;
    }
  }

  private async procesarEvento(evento: SupraEvento): Promise<void> {
    switch (evento.type) {
      case 'payment.succeeded':
        return this.onPaymentSucceeded(evento.data as unknown as SupraPayment);
      case 'payment_link.completed':
        return this.onPaymentLink(evento.data as unknown as SupraPaymentLink, 'pagado');
      case 'payment_link.canceled':
        return this.onPaymentLink(evento.data as unknown as SupraPaymentLink, 'cancelado');
      case 'payment_plan.canceled':
        return this.onPlanEstado(evento.data as unknown as SupraPaymentPlan, 'Cancelado');
      case 'payment_plan.defaulted':
        return this.onPlanEstado(evento.data as unknown as SupraPaymentPlan, 'Vencido');
      case 'payment_plan.created':
        return this.reproyectarPorCustomer(evento.data as { customer?: string });
      // Cambios de estado de la cuenta por cobrar → reproyección de cartera
      // del contrato (la proyección local es el read-model del aging/dunning).
      case 'obligation.created':
      case 'obligation.updated':
      case 'obligation.canceled':
      case 'obligation.reopened':
      case 'obligation.settled':
      case 'obligation.partially_settled':
      case 'obligation.written_off':
        return this.reproyectarPorObligation(evento.data as { id?: string; customer?: string });
      case 'refund.succeeded':
        return this.onRefundSucceeded(
          evento.data as { id: string; payment: string; amount?: string | number },
        );
      default:
        // Evento informativo sin efecto local: las lecturas financieras van
        // directo a SUPRA.
        return;
    }
  }

  /** Reproyecta la cartera del contrato dueño del customer del evento. */
  private async reproyectarPorCustomer(data: { customer?: string }): Promise<void> {
    if (!data.customer) return;
    const contratoId = await this.mapa.reverse('contrato', data.customer);
    if (!contratoId) return;
    await this.cartera.recalcularContrato(contratoId);
  }

  /**
   * Los eventos de obligation traen `customer` en el payload serializado; si
   * el payload es la forma corta `{id, payment}` (settled/partially_settled),
   * se resuelve consultando la obligation en SUPRA.
   */
  private async reproyectarPorObligation(data: { id?: string; customer?: string }): Promise<void> {
    if (data.customer) return this.reproyectarPorCustomer(data);
    if (!data.id) return;
    try {
      const obligation = await this.client.request<{ customer: string }>(
        'GET',
        `/v1/obligations/${data.id}`,
      );
      await this.reproyectarPorCustomer({ customer: obligation.customer });
    } catch (e) {
      this.logger.warn(
        `No se pudo resolver la obligation ${data.id} para reproyección: ${e instanceof Error ? e.message : e}`,
      );
      throw e; // reintento por el inbox
    }
  }

  /**
   * refund.succeeded: espejo del reembolso como Pago negativo (reduce la
   * recaudación local) — la reapertura del adeudo llega por obligation.reopened.
   */
  private async onRefundSucceeded(data: {
    id: string;
    payment: string;
    amount?: string | number;
  }): Promise<void> {
    const yaMapeado = await this.mapa.reverse('pago', data.id);
    if (yaMapeado) return; // ya proyectado

    const pagoLocalId = await this.mapa.reverse('pago', data.payment);
    const pagoLocal = pagoLocalId
      ? await this.prisma.pago.findUnique({
          where: { id: pagoLocalId },
          select: { contratoId: true },
        })
      : null;
    if (!pagoLocal) {
      this.logger.warn(`refund.succeeded ${data.id}: payment ${data.payment} sin espejo local`);
      return;
    }

    const espejo = await this.prisma.pago.create({
      data: {
        contratoId: pagoLocal.contratoId,
        monto: -Math.abs(minorToPesos(data.amount ?? 0)),
        fecha: new Date().toISOString().substring(0, 10),
        tipo: 'DEVOLUCION',
        concepto: `Devolución SUPRA ${data.id}`,
        origen: 'supra',
        oficina: 'SUPRA',
      },
    });
    await this.mapa.save('pago', espejo.id, data.id);
    await this.cartera.recalcularContrato(pagoLocal.contratoId).catch((e) =>
      this.logger.warn(`recalculo tras refund: ${e instanceof Error ? e.message : e}`),
    );
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  /**
   * payment.succeeded: si el pago NO nació en Hydra (p. ej. checkout /pay/…
   * de SUPRA), materializa el espejo operativo y dispara reconexión.
   * Idempotente: upsert por mapa pago↔pay_.
   */
  private async onPaymentSucceeded(payment: SupraPayment): Promise<void> {
    const yaMapeado = await this.mapa.reverse('pago', payment.id);
    if (yaMapeado) return; // originado en Hydra (dual-write) o ya procesado

    const contratoId = await this.mapa.reverse('contrato', payment.customer);
    if (!contratoId) {
      this.logger.warn(`payment.succeeded ${payment.id}: customer ${payment.customer} sin contrato mapeado`);
      return;
    }

    const pago = await this.prisma.pago.create({
      data: {
        contratoId,
        monto: minorToPesos(payment.amount),
        fecha: (payment.received_at ?? payment.created_at ?? new Date().toISOString()).substring(0, 10),
        tipo: 'WEB',
        concepto: 'Pago en línea (SUPRA)',
        origen: 'supra',
        oficina: 'SUPRA',
      },
    });
    await this.mapa.save('pago', pago.id, payment.id);

    // Espejo consistente para los read-models legacy durante la transición.
    await this.cartera.aplicarPago(pago.id).catch((e) =>
      this.logger.warn(`aplicarPago espejo ${pago.id}: ${e instanceof Error ? e.message : e}`),
    );
    await this.verificarAutoReconexion(contratoId, payment.customer);
  }

  private async onPaymentLink(link: SupraPaymentLink, estado: string): Promise<void> {
    await this.prisma.intentoPago.updateMany({
      where: { referencia: link.token },
      data: { estado, webhookPayload: link as unknown as Prisma.InputJsonValue },
    });
  }

  private async onPlanEstado(plan: SupraPaymentPlan, estado: string): Promise<void> {
    const convenioId = await this.mapa.reverse('convenio', plan.id);
    if (!convenioId) return;
    await this.prisma.convenio.updateMany({ where: { id: convenioId }, data: { estado } });
  }

  /**
   * Workflow operativo: si el contrato está cortado y SUPRA reporta saldo por
   * cobrar en cero, genera la orden de reconexión (misma política que
   * PagosService.verificarAutoReconexion, pero con el saldo de SUPRA como
   * verdad en lugar del cálculo local).
   */
  private async verificarAutoReconexion(contratoId: string, customerId: string): Promise<void> {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true, estado: true, bloqueadoJuridico: true },
    });
    if (!contrato) return;
    const esCortado = ESTADOS_CORTADOS.some((s) =>
      (contrato.estado ?? '').toLowerCase().includes(s.toLowerCase()),
    );
    if (!esCortado || contrato.bloqueadoJuridico) return;

    const balance = await this.client.getBalance(customerId);
    if (Number(balance.receivable_balance) > 0) return;

    const ordenExistente = await this.prisma.orden.findFirst({
      where: { contratoId, tipo: 'Reconexion', estado: { in: ['Pendiente', 'En proceso'] } },
    });
    if (ordenExistente) return;

    const fechaProgramada = new Date();
    fechaProgramada.setDate(fechaProgramada.getDate() + 1);
    await this.prisma.$transaction([
      this.prisma.orden.create({
        data: {
          contratoId,
          tipo: 'Reconexion',
          prioridad: 'Alta',
          notas: 'Generada automáticamente al liquidar adeudo (evento SUPRA)',
          fechaProgramada,
          seguimientos: {
            create: {
              estadoNuevo: 'Pendiente',
              nota: 'Orden de reconexión generada por pago confirmado en SUPRA',
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
