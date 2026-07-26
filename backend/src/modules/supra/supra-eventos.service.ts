import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { CarteraService } from '../cartera/cartera.service';
import { SupraClientService } from './supra-client.service';
import { SupraMapService } from './supra-map.service';
import { minorToPesos } from './supra.config';

const ESTADOS_CORTADOS = ['Cortado', 'cortado'];

/** Claims en `procesando` más viejos que esto se consideran huérfanos (réplica caída). */
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
/** Un hueco de sequence solo se rellena si el evento posterior lleva ≥ este tiempo recibido. */
const GAP_EDAD_MINIMA_MS = 15 * 60 * 1000;

interface SupraEvento {
  id: string;
  type: string;
  created: string;
  tenant_id: string;
  data: Record<string, unknown>;
  sequence?: number | string;
}

// ── Schemas de payloads (validación antes de convertir dinero) ───────────────
// Solo se declara lo que los handlers usan; el resto del payload pasa passthrough.

const pagoSchema = z
  .object({
    id: z.string(),
    customer: z.string(),
    amount: z.union([z.string(), z.number()]),
    received_at: z.string().nullish(),
    created_at: z.string().nullish(),
  })
  .passthrough();

const refundSchema = z
  .object({
    id: z.string(),
    payment: z.string(),
    amount: z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough();

const paymentLinkSchema = z
  .object({
    token: z.string(),
  })
  .passthrough();

const planSchema = z
  .object({
    id: z.string(),
    customer: z.string().nullish(),
  })
  .passthrough();

const installmentSchema = z
  .object({
    id: z.string().nullish(),
    plan: z.string().nullish(),
    payment_plan: z.string().nullish(),
    customer: z.string().nullish(),
  })
  .passthrough();

function parsear<T>(schema: z.ZodType<T>, data: unknown, tipo: string): T {
  const res = schema.safeParse(data);
  if (!res.success) {
    throw new Error(`Payload inválido para ${tipo}: ${res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return res.data;
}

/**
 * Recepción y procesamiento de eventos de SUPRA (webhooks firmados).
 *
 * Entrega at-least-once → inbox idempotente por `Supra-Event-Id` y handlers
 * conmutativos (upsert). El estado financiero NO se recalcula aquí: SUPRA es
 * la verdad; estos handlers solo mantienen el espejo operativo local
 * (metadatos para joins de UI) y disparan workflows operativos (reconexión).
 *
 * Concurrencia multi-réplica: el claim de cada evento es atómico en BD
 * (updateMany condicionado por estado → `procesando`); los claims huérfanos
 * de una réplica caída se recuperan por timeout. `procesadoEn` funciona como
 * timestamp del claim mientras la fila está `procesando`.
 */
@Injectable()
export class SupraEventosService {
  private readonly logger = new Logger(SupraEventosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SupraClientService,
    private readonly mapa: SupraMapService,
    private readonly cartera: CarteraService,
  ) {}

  // ── Verificación de firma (Supra-Signature: t=<unix>,v1=<hex hmac>) ─────────

  verificarFirma(header: string | undefined, rawBody: Buffer): void {
    // Doble secreto para rotación sin ventana: se acepta el vigente y, si está
    // configurado, el siguiente (SUPRA_WEBHOOK_SECRET_NEXT).
    const secrets = [this.client.config.webhookSecret, this.client.config.webhookSecretNext].filter(
      Boolean,
    );
    if (secrets.length === 0) {
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
    const b = Buffer.from(v1, 'hex');
    const valida = secrets.some((secret) => {
      const expected = createHmac('sha256', secret)
        .update(`${t}.${rawBody.toString('utf8')}`)
        .digest('hex');
      const a = Buffer.from(expected, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (!valida) {
      throw new UnauthorizedException('Firma de webhook inválida');
    }
  }

  // ── Ingreso al inbox (idempotente) ──────────────────────────────────────────

  async recibir(evento: SupraEvento): Promise<{ ok: true; duplicado: boolean }> {
    const duplicado = !(await this.insertarEnInbox(evento));
    if (duplicado) return { ok: true, duplicado: true };
    // Procesamiento inmediato fire-and-forget; el 200 al relay no espera handlers.
    void this.procesarPendientes().catch((e) =>
      this.logger.error(`Procesamiento de inbox falló: ${e instanceof Error ? e.message : e}`),
    );
    return { ok: true, duplicado: false };
  }

  /** Inserta un evento en el inbox. `false` si ya existía (idempotente por eventId). */
  private async insertarEnInbox(evento: SupraEvento): Promise<boolean> {
    try {
      await this.prisma.supraEventoInbox.create({
        data: {
          eventId: evento.id,
          tipo: evento.type,
          sequence: evento.sequence !== undefined ? BigInt(evento.sequence) : null,
          payload: evento as unknown as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err) {
      // P2002 = eventId duplicado (redelivery at-least-once): confirmar sin reprocesar.
      if ((err as { code?: string }).code === 'P2002') return false;
      throw err;
    }
  }

  // ── Procesador del inbox ────────────────────────────────────────────────────

  /** Worker: además del disparo por webhook, una pasada por minuto (drena
   *  errores transitorios y eventos backfilleados aunque no llegue tráfico). */
  @Cron('*/1 * * * *', { name: 'supra-inbox' })
  async cronProcesar() {
    if (!this.client.enabled) return;
    await this.procesarPendientes();
  }

  async procesarPendientes(): Promise<void> {
    // Recupera claims huérfanos de réplicas caídas (procesando desde hace >10 min).
    await this.prisma.supraEventoInbox.updateMany({
      where: { estado: 'procesando', procesadoEn: { lt: new Date(Date.now() - CLAIM_TIMEOUT_MS) } },
      data: { estado: 'pendiente', procesadoEn: null },
    });

    const candidatos = await this.prisma.supraEventoInbox.findMany({
      where: { estado: 'pendiente' },
      orderBy: [{ sequence: 'asc' }, { recibidoEn: 'asc' }],
      take: 100,
      select: { id: true },
    });

    for (const { id } of candidatos) {
      // Claim atómico: solo una réplica gana la fila.
      const claim = await this.prisma.supraEventoInbox.updateMany({
        where: { id, estado: 'pendiente' },
        data: { estado: 'procesando', procesadoEn: new Date() },
      });
      if (claim.count === 0) continue; // otra réplica lo tomó

      const row = await this.prisma.supraEventoInbox.findUnique({ where: { id } });
      if (!row) continue;
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
            procesadoEn: null,
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
  }

  /** Saca un evento de cuarentena (admin): reset de intentos y a `pendiente`. */
  async replayCuarentena(id: string): Promise<{ id: string; estado: string }> {
    const row = await this.prisma.supraEventoInbox.findUnique({ where: { id }, select: { id: true, estado: true } });
    if (!row) throw new NotFoundException('Evento de inbox no encontrado');
    if (row.estado !== 'cuarentena') {
      throw new NotFoundException(`El evento ${id} no está en cuarentena (estado: ${row.estado})`);
    }
    await this.prisma.supraEventoInbox.update({
      where: { id },
      data: { estado: 'pendiente', intentos: 0, error: null, procesadoEn: null },
    });
    void this.procesarPendientes().catch(() => undefined);
    return { id, estado: 'pendiente' };
  }

  // ── Gap detection del sequence (§F.3.5: log replayable como red de respaldo) ─

  /**
   * Detecta huecos en `sequence` y los rellena con `GET /v1/events?after=`
   * insertando en el inbox como si hubieran llegado por webhook (idempotente
   * por event_id). Corre cada hora; solo considera huecos cuyo evento
   * posterior lleva ≥15 min recibido (un hueco reciente suele ser un webhook
   * en vuelo o un reintento del relay).
   */
  @Cron('30 * * * *', { name: 'supra-inbox-gaps' })
  async cronDetectarHuecos() {
    if (!this.client.enabled) return;
    await this.detectarYRellenarHuecos().catch((e) =>
      this.logger.error(`Gap detection de inbox falló: ${e instanceof Error ? e.message : e}`),
    );
  }

  async detectarYRellenarHuecos(): Promise<{ huecos: number; recuperados: number }> {
    const corte = new Date(Date.now() - GAP_EDAD_MINIMA_MS);
    const huecos = await this.prisma.$queryRaw<
      { gap_desde: bigint; gap_hasta: bigint }[]
    >`
      SELECT sequence + 1 AS gap_desde, next_seq - 1 AS gap_hasta
      FROM (
        SELECT sequence,
               LEAD(sequence)   OVER (ORDER BY sequence) AS next_seq,
               LEAD(recibido_en) OVER (ORDER BY sequence) AS next_recibido
        FROM supra_evento_inbox
        WHERE sequence IS NOT NULL
      ) t
      WHERE next_seq - sequence > 1 AND next_recibido <= ${corte}
      ORDER BY gap_desde
      LIMIT 20
    `;
    if (huecos.length === 0) return { huecos: 0, recuperados: 0 };

    this.logger.warn(
      `Inbox SUPRA con ${huecos.length} hueco(s) de sequence: ` +
        huecos.map((h) => `${h.gap_desde}..${h.gap_hasta}`).join(', '),
    );

    let recuperados = 0;
    for (const hueco of huecos) {
      recuperados += await this.rellenarHueco(hueco.gap_desde, hueco.gap_hasta);
    }
    if (recuperados > 0) {
      this.logger.log(`Gap detection: ${recuperados} evento(s) backfilleados vía GET /v1/events`);
      void this.procesarPendientes().catch(() => undefined);
    }
    return { huecos: huecos.length, recuperados };
  }

  /** Rellena un rango [desde..hasta] de sequences faltantes desde el log de SUPRA. */
  private async rellenarHueco(desde: bigint, hasta: bigint): Promise<number> {
    let recuperados = 0;
    let after = desde - 1n;
    // Cap defensivo: nunca más de 50 páginas por hueco.
    for (let pagina = 0; pagina < 50; pagina++) {
      const res = await this.client.listEvents({ after, limit: 100 });
      if (res.data.length === 0) break;
      let ultimo = after;
      for (const evento of res.data) {
        const seq = evento.sequence !== undefined ? BigInt(evento.sequence) : null;
        if (seq === null) continue;
        ultimo = seq > ultimo ? seq : ultimo;
        if (seq > hasta) return recuperados; // hueco cubierto
        if (seq < desde) continue;
        const insertado = await this.insertarEnInbox(evento as SupraEvento);
        if (insertado) recuperados++;
      }
      if (!res.has_more) break;
      if (ultimo <= after) break; // sin avance: evita loop infinito
      after = ultimo;
    }
    return recuperados;
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────

  private async procesarEvento(evento: SupraEvento): Promise<void> {
    switch (evento.type) {
      case 'payment.succeeded':
        return this.onPaymentSucceeded(parsear(pagoSchema, evento.data, evento.type));
      case 'payment_link.completed':
        return this.onPaymentLink(parsear(paymentLinkSchema, evento.data, evento.type), 'pagado');
      case 'payment_link.canceled':
        return this.onPaymentLink(parsear(paymentLinkSchema, evento.data, evento.type), 'cancelado');
      case 'payment_plan.canceled':
        return this.onPlanEstado(parsear(planSchema, evento.data, evento.type), 'Cancelado');
      case 'payment_plan.defaulted':
        return this.onPlanEstado(parsear(planSchema, evento.data, evento.type), 'Vencido');
      case 'payment_plan.completed':
        return this.onPlanCompleted(parsear(planSchema, evento.data, evento.type));
      case 'installment_paid':
      case 'installment.paid':
        return this.onInstallmentPaid(parsear(installmentSchema, evento.data, evento.type));
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
        return this.onRefundSucceeded(parsear(refundSchema, evento.data, evento.type));
      default:
        // Evento informativo sin efecto local: las lecturas financieras van
        // directo a SUPRA.
        return;
    }
  }

  /** Reproyecta la cartera del contrato dueño del customer del evento. */
  private async reproyectarPorCustomer(data: { customer?: string | null }): Promise<void> {
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
  private async onRefundSucceeded(data: z.infer<typeof refundSchema>): Promise<void> {
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
  private async onPaymentSucceeded(payment: z.infer<typeof pagoSchema>): Promise<void> {
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

  private async onPaymentLink(link: z.infer<typeof paymentLinkSchema>, estado: string): Promise<void> {
    await this.prisma.intentoPago.updateMany({
      where: { referencia: link.token },
      data: { estado, webhookPayload: link as unknown as Prisma.InputJsonValue },
    });
  }

  private async onPlanEstado(plan: z.infer<typeof planSchema>, estado: string): Promise<void> {
    const convenioId = await this.mapa.reverse('convenio', plan.id);
    if (!convenioId) return;
    await this.prisma.convenio.updateMany({ where: { id: convenioId }, data: { estado } });
  }

  /**
   * payment_plan.completed: el convenio quedó liquidado en SUPRA. Se marca el
   * espejo como Completado, se reproyecta la cartera y —si el contrato está
   * cortado— se dispara la orden de reconexión (misma política que
   * ConveniosService.verificarAutoReconexionPorConvenio, con el saldo de
   * SUPRA como verdad).
   */
  private async onPlanCompleted(plan: z.infer<typeof planSchema>): Promise<void> {
    await this.onPlanEstado(plan, 'Completado');

    const customer =
      plan.customer ?? (await this.client.getPaymentPlan(plan.id).then((p) => p.customer).catch(() => null));
    if (!customer) {
      this.logger.warn(`payment_plan.completed ${plan.id}: sin customer resoluble; espejo actualizado, sin reconexión`);
      return;
    }
    await this.reproyectarPorCustomer({ customer });
    const contratoId = await this.mapa.reverse('contrato', customer);
    if (contratoId) await this.verificarAutoReconexion(contratoId, customer);
  }

  /**
   * installment_paid: avance de parcialidad. Se sincroniza el espejo del
   * convenio (estado + parcialidades restantes) desde el plan de SUPRA y se
   * reproyecta la cartera. Si el plan no está mapeado localmente solo se deja
   * bitácora (el read-model financiero vive en SUPRA).
   */
  private async onInstallmentPaid(data: z.infer<typeof installmentSchema>): Promise<void> {
    const planId = data.plan ?? data.payment_plan ?? null;
    if (!planId) {
      if (data.customer) return this.reproyectarPorCustomer({ customer: data.customer });
      this.logger.warn(`installment_paid sin plan ni customer en el payload; sin efecto local`);
      return;
    }

    const convenioId = await this.mapa.reverse('convenio', planId);
    const plan = await this.client.getPaymentPlan(planId);

    if (convenioId) {
      const abiertas = (plan.installments ?? []).filter(
        (i) => i.status === 'issued' || i.status === 'partially_settled',
      ).length;
      const estado =
        plan.status === 'completed'
          ? 'Completado'
          : plan.status === 'canceled'
            ? 'Cancelado'
            : plan.status === 'defaulted'
              ? 'Vencido'
              : 'Activo';
      await this.prisma.convenio.updateMany({
        where: { id: convenioId },
        data: { parcialidadesRestantes: abiertas, estado },
      });
    } else {
      this.logger.log(`installment_paid: plan ${planId} sin convenio espejo; solo reproyección de cartera`);
    }

    await this.reproyectarPorCustomer({ customer: plan.customer });
    // Un installment puede ser el último: mismo workflow que plan completado.
    if (plan.status === 'completed') {
      const contratoId = await this.mapa.reverse('contrato', plan.customer);
      if (contratoId) await this.verificarAutoReconexion(contratoId, plan.customer);
    }
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
