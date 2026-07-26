import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CarteraService } from '../cartera/cartera.service';
import {
  SupraApiError,
  SupraClientService,
  SupraPaymentPlan,
} from '../supra/supra-client.service';
import { SupraMapService } from '../supra/supra-map.service';
import { minorToPesos, pesosToMinor, supraRef } from '../supra/supra.config';

const ESTADOS_CORTADOS = ['Cortado', 'cortado'];

const ESTADO_PLAN_A_CONVENIO: Record<SupraPaymentPlan['status'], string> = {
  active: 'Activo',
  completed: 'Completado',
  canceled: 'Cancelado',
  defaulted: 'Vencido',
};

/**
 * Convenios de pago. Con la integración SUPRA habilitada, el convenio vive en
 * SUPRA como payment plan: se crea una obligación consolidada
 * (`hydra:convenio:<id>`, type `hydra.convenio`) y sobre ella el plan con
 * calendario explícito (anticipo = down payment). SUPRA es la verdad de
 * parcialidades, saldos y estado; el registro local es un espejo operativo
 * (checklist documental, joins de UI). Las obligations de los recibos
 * consolidados se cancelan en SUPRA para no duplicar la cuenta por cobrar.
 */
@Injectable()
export class ConveniosService {
  private readonly logger = new Logger(ConveniosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartera: CarteraService,
    private readonly supra: SupraClientService,
    private readonly supraMapa: SupraMapService,
  ) {}

  // ── Lecturas ────────────────────────────────────────────────────────────────

  async findAll(params: { contratoId?: string; estado?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    if (this.supra.enabled) {
      const customerId = params.contratoId
        ? await this.supraMapa.get('contrato', params.contratoId)
        : undefined;
      if (params.contratoId && !customerId) return { data: [], total: 0, page, limit };

      const planes: SupraPaymentPlan[] = [];
      let cursor: string | undefined;
      const MAX_PAGINAS = 20;
      let agotado = false;
      for (let i = 0; i < MAX_PAGINAS; i++) {
        const res = await this.supra.listPaymentPlans({
          customer: customerId ?? undefined,
          limit: 100,
          starting_after: cursor,
        });
        planes.push(...res.data);
        if (!res.has_more || !res.next_cursor) {
          agotado = true;
          break;
        }
        cursor = res.next_cursor;
      }
      if (!agotado) {
        this.logger.warn(
          `findAll convenios: cap de ${MAX_PAGINAS} páginas de payment plans alcanzado con has_more=true — listado TRUNCADO`,
        );
      }

      const mapeados = await Promise.all(planes.map((p) => this.planADto(p)));
      const filtrados = params.estado
        ? mapeados.filter((c) => c.estado === params.estado)
        : mapeados;
      const data = filtrados.slice((page - 1) * limit, page * limit);
      return { data, total: filtrados.length, page, limit };
    }

    const where = {
      ...(params.contratoId && { contratoId: params.contratoId }),
      ...(params.estado && { estado: params.estado }),
    };
    const [data, total] = await Promise.all([
      this.prisma.convenio.findMany({
        where,
        include: {
          contrato: { select: { nombre: true, estado: true } },
          pagos: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.convenio.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    if (this.supra.enabled) {
      const planId = (await this.supraMapa.get('convenio', id)) ?? id;
      let plan: SupraPaymentPlan;
      try {
        plan = await this.supra.getPaymentPlan(planId);
      } catch (err) {
        if (err instanceof SupraApiError && err.status === 404) {
          throw new NotFoundException('Convenio no encontrado');
        }
        throw err;
      }
      return this.planADto(plan, { conParcialidades: true });
    }

    const c = await this.prisma.convenio.findUnique({
      where: { id },
      include: {
        contrato: { select: { nombre: true, estado: true } },
        pagos: { orderBy: { fecha: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('Convenio no encontrado');
    return c;
  }

  /** Payment plan de SUPRA → DTO con la forma del Convenio de Hydra. */
  private async planADto(plan: SupraPaymentPlan, opts?: { conParcialidades?: boolean }) {
    const convenioId = (await this.supraMapa.reverse('convenio', plan.id)) ?? plan.id;
    const espejo = await this.prisma.convenio.findUnique({
      where: { id: convenioId },
      include: {
        contrato: { select: { nombre: true, estado: true } },
        pagos: opts?.conParcialidades ? { orderBy: { fecha: 'desc' } } : false,
      },
    });

    const installments = plan.installments ?? [];
    const abiertas = installments.filter(
      (i) => i.status === 'issued' || i.status === 'partially_settled',
    ).length;
    const pagadoMinor = installments
      .filter((i) => i.status === 'settled')
      .reduce((s, i) => s + Number(i.amount), 0);

    return {
      id: convenioId,
      supraPlanId: plan.id,
      contratoId: espejo?.contratoId ?? (await this.supraMapa.reverse('contrato', plan.customer)),
      tipo: espejo?.tipo ?? 'Parcialidades',
      numParcialidades: plan.installment_count,
      montoTotal: minorToPesos(plan.total_amount),
      montoPagado: espejo && !plan.installments ? Number(espejo.montoPagado) : minorToPesos(pagadoMinor),
      montoParcialidad: espejo ? Number(espejo.montoParcialidad) : 0,
      porcentajeAnticipo: espejo?.porcentajeAnticipo ?? null,
      montoAnticipo: espejo?.montoAnticipo ?? null,
      anticipoPagado: installments.some((i) => i.is_down_payment && i.status === 'settled'),
      estado: ESTADO_PLAN_A_CONVENIO[plan.status] ?? plan.status,
      parcialidadesRestantes: plan.installments ? abiertas : espejo?.parcialidadesRestantes ?? 0,
      saldoAFavor: espejo ? Number(espejo.saldoAFavor) : 0,
      facturas: espejo?.facturas ?? [],
      checklistInterna: espejo?.checklistInterna ?? null,
      datosConvenio: espejo?.datosConvenio ?? null,
      fechaInicio: espejo?.fechaInicio ?? plan.created_at,
      fechaVencimiento: espejo?.fechaVencimiento ?? null,
      createdAt: espejo?.createdAt ?? plan.created_at,
      contrato: espejo?.contrato ?? null,
      pagos: (espejo as { pagos?: unknown[] } | null)?.pagos ?? [],
      parcialidades: opts?.conParcialidades
        ? installments.map((i) => ({
            id: i.id,
            secuencia: i.sequence,
            monto: minorToPesos(i.amount),
            fechaVencimiento: i.due_at,
            estado: i.status,
            esAnticipo: i.is_down_payment,
          }))
        : undefined,
    };
  }

  // ── Alta ────────────────────────────────────────────────────────────────────

  async create(dto: {
    contratoId: string;
    tipo?: string;
    numParcialidades: number;
    porcentajeAnticipo?: number;
    facturas: { timbradoId: string; monto: number }[];
    fechaVencimiento?: string;
    datosConvenio?: Record<string, unknown>;
    checklistInterna?: Record<string, boolean>;
  }) {
    const montoTotal = dto.facturas.reduce((s, f) => s + f.monto, 0);
    const porcentaje = dto.porcentajeAnticipo ?? 0;
    const montoAnticipo = porcentaje > 0 ? Math.round(montoTotal * porcentaje) / 100 : 0;
    const montoAFinanciar = montoTotal - montoAnticipo;
    const numParc = dto.numParcialidades;
    const montoParcialidad = numParc > 0 ? Math.ceil((montoAFinanciar / numParc) * 100) / 100 : 0;

    if (!this.supra.enabled) {
      return this.prisma.convenio.create({
        data: {
          contratoId: dto.contratoId,
          tipo: dto.tipo ?? 'Parcialidades',
          numParcialidades: numParc,
          montoParcialidad,
          montoTotal,
          porcentajeAnticipo: porcentaje > 0 ? porcentaje : null,
          montoAnticipo: montoAnticipo > 0 ? montoAnticipo : null,
          parcialidadesRestantes: numParc,
          facturas: dto.facturas,
          fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null,
          datosConvenio: dto.datosConvenio ? (dto.datosConvenio as Prisma.InputJsonValue) : Prisma.JsonNull,
          checklistInterna: dto.checklistInterna ? (dto.checklistInterna as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
        include: { contrato: { select: { nombre: true } } },
      });
    }

    if (!(numParc > 0)) throw new BadRequestException('numParcialidades debe ser mayor a cero');
    if (!(montoTotal > 0)) throw new BadRequestException('El monto total debe ser mayor a cero');

    const convenioId = randomUUID();
    const customerId = await this.supraMapa.ensureCustomer(dto.contratoId);

    // 1) Obligación consolidada del convenio (idempotente por external_ref).
    const totalMinor = BigInt(pesosToMinor(montoTotal));
    const anticipoMinor = BigInt(pesosToMinor(montoAnticipo));
    let obligation;
    try {
      obligation = await this.supra.createObligation({
        customer: customerId,
        amount_due_minor: totalMinor.toString(),
        type: 'hydra.convenio',
        external_ref: supraRef.convenio(convenioId),
        metadata: {
          contrato: supraRef.contrato(dto.contratoId),
          facturas: dto.facturas.map((f) => f.timbradoId),
        },
      });
    } catch (err) {
      if (err instanceof SupraApiError) {
        throw new BadGatewayException(`SUPRA rechazó la obligación del convenio: ${err.message}`);
      }
      throw err;
    }

    // 2) Calendario explícito: anticipo como down payment + N parcialidades.
    //    La suma debe cuadrar EXACTAMENTE con la obligación (residuo → última).
    const financiarMinor = totalMinor - anticipoMinor;
    const base = financiarMinor / BigInt(numParc);
    const residuo = financiarMinor - base * BigInt(numParc);
    const primerVencimiento = dto.fechaVencimiento
      ? new Date(dto.fechaVencimiento)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const schedule: { amount: string; due_at: string; down_payment?: boolean }[] = [];
    if (anticipoMinor > 0n) {
      schedule.push({
        amount: anticipoMinor.toString(),
        due_at: new Date().toISOString(),
        down_payment: true,
      });
    }
    for (let i = 0; i < numParc; i++) {
      const monto = i === numParc - 1 ? base + residuo : base;
      const dueAt = new Date(primerVencimiento.getTime() + i * 30 * 24 * 60 * 60 * 1000);
      schedule.push({ amount: monto.toString(), due_at: dueAt.toISOString() });
    }

    let plan: SupraPaymentPlan;
    try {
      plan = await this.supra.createPaymentPlan(
        obligation.id,
        { schedule, grace_days: 5, default_after_missed: 2 },
        `${supraRef.convenio(convenioId)}:plan`,
      );
    } catch (err) {
      if (err instanceof SupraApiError) {
        throw new BadGatewayException(`SUPRA rechazó el plan de pagos: ${err.message}`);
      }
      throw err;
    }

    // 3) Cancela en SUPRA las obligations de los recibos consolidados para no
    //    duplicar la cuenta por cobrar (best-effort: si alguna tiene abonos,
    //    SUPRA responde 409 y se deja registro).
    await this.cancelarObligationsDeFacturas(dto.facturas.map((f) => f.timbradoId));

    // 4) Espejo operativo local + mapeo.
    const convenio = await this.prisma.convenio.create({
      data: {
        id: convenioId,
        contratoId: dto.contratoId,
        tipo: dto.tipo ?? 'Parcialidades',
        numParcialidades: numParc,
        montoParcialidad,
        montoTotal,
        porcentajeAnticipo: porcentaje > 0 ? porcentaje : null,
        montoAnticipo: montoAnticipo > 0 ? montoAnticipo : null,
        parcialidadesRestantes: numParc,
        facturas: dto.facturas,
        fechaVencimiento: dto.fechaVencimiento ? new Date(dto.fechaVencimiento) : null,
        datosConvenio: dto.datosConvenio ? (dto.datosConvenio as Prisma.InputJsonValue) : Prisma.JsonNull,
        checklistInterna: dto.checklistInterna ? (dto.checklistInterna as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
      include: { contrato: { select: { nombre: true } } },
    });
    await this.supraMapa.save('convenio', convenioId, plan.id);

    return { ...convenio, supraPlanId: plan.id, supraObligationId: obligation.id };
  }

  /** Cancela las obligations SUPRA de los recibos de los timbrados dados. */
  private async cancelarObligationsDeFacturas(timbradoIds: string[]): Promise<void> {
    const recibos = await this.prisma.recibo.findMany({
      where: { timbradoId: { in: timbradoIds } },
      select: { id: true },
    });
    for (const recibo of recibos) {
      try {
        const obligationId = await this.supraMapa.ensureObligation(recibo.id);
        await this.supra.cancelObligation(obligationId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`No se canceló la obligation del recibo ${recibo.id}: ${msg}`);
      }
    }
  }

  // ── Operaciones ─────────────────────────────────────────────────────────────

  async updateChecklist(convenioId: string, checklist: Record<string, boolean>) {
    const convenio = await this.prisma.convenio.findUnique({ where: { id: convenioId } });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');
    return this.prisma.convenio.update({
      where: { id: convenioId },
      data: { checklistInterna: checklist },
    });
  }

  async aplicarParcialidad(convenioId: string, monto: number, tipo: string) {
    const convenio = await this.prisma.convenio.findUnique({ where: { id: convenioId } });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');

    if (this.supra.enabled) {
      return this.aplicarParcialidadSupra(convenioId, convenio.contratoId, monto, tipo);
    }

    if (convenio.estado !== 'Activo') throw new BadRequestException('El convenio no está activo');

    const pago = await this.prisma.pago.create({
      data: {
        contratoId: convenio.contratoId,
        convenioId,
        monto,
        fecha: new Date().toISOString().substring(0, 10),
        tipo,
        concepto: `Parcialidad convenio ${convenioId.substring(0, 8)}`,
        origen: 'nativo',
      },
    });

    const nuevoPagado = Number(convenio.montoPagado) + monto;
    const nuevasRestantes = convenio.parcialidadesRestantes - 1;
    const saldoAFavor = Math.max(0, nuevoPagado - Number(convenio.montoTotal));
    const nuevoEstado =
      nuevasRestantes <= 0 || nuevoPagado >= Number(convenio.montoTotal)
        ? 'Completado'
        : 'Activo';

    await this.prisma.convenio.update({
      where: { id: convenioId },
      data: {
        montoPagado: nuevoPagado,
        parcialidadesRestantes: Math.max(0, nuevasRestantes),
        saldoAFavor,
        estado: nuevoEstado,
      },
    });

    if (nuevoEstado === 'Completado') {
      await this.verificarAutoReconexionPorConvenio(convenio.contratoId);
    }

    await this.cartera.aplicarPago(pago.id);

    return {
      pagoId: pago.id,
      estado: nuevoEstado,
      saldoAFavor,
      parcialidadesRestantes: Math.max(0, nuevasRestantes),
    };
  }

  /**
   * Parcialidad vía SUPRA: pago asignado a la primera parcialidad abierta del
   * plan (SUPRA transiciona installments/plan; aquí solo se refleja el espejo).
   */
  private async aplicarParcialidadSupra(
    convenioId: string,
    contratoId: string,
    monto: number,
    tipo: string,
  ) {
    const planId = await this.supraMapa.get('convenio', convenioId);
    if (!planId) throw new BadRequestException('El convenio no está sincronizado con SUPRA');

    const plan = await this.supra.getPaymentPlan(planId);
    if (plan.status !== 'active') {
      throw new BadRequestException(`El convenio no está activo en SUPRA (${plan.status})`);
    }
    const abierta = (plan.installments ?? []).find(
      (i) => i.status === 'issued' || i.status === 'partially_settled',
    );
    if (!abierta) throw new BadRequestException('El convenio no tiene parcialidades abiertas');

    const pagoId = randomUUID();
    const customerId = await this.supraMapa.ensureCustomer(contratoId);
    let supraPayment;
    try {
      supraPayment = await this.supra.recordPayment({
        customer: customerId,
        amount: pesosToMinor(monto),
        external_ref: supraRef.pago(pagoId),
        allocations: [{ obligation: abierta.obligation, amount: pesosToMinor(monto) }],
      });
    } catch (err) {
      if (err instanceof SupraApiError) {
        throw new BadGatewayException(`SUPRA rechazó la parcialidad: ${err.message}`);
      }
      throw err;
    }

    // Espejo local del pago y del avance del convenio.
    await this.prisma.pago.create({
      data: {
        id: pagoId,
        contratoId,
        convenioId,
        monto,
        fecha: new Date().toISOString().substring(0, 10),
        tipo,
        concepto: `Parcialidad convenio ${convenioId.substring(0, 8)}`,
        origen: 'nativo',
      },
    });
    await this.supraMapa.save('pago', pagoId, supraPayment.id);

    const actualizado = await this.supra.getPaymentPlan(planId);
    const abiertas = (actualizado.installments ?? []).filter(
      (i) => i.status === 'issued' || i.status === 'partially_settled',
    ).length;
    const estado = ESTADO_PLAN_A_CONVENIO[actualizado.status] ?? actualizado.status;

    await this.prisma.convenio.updateMany({
      where: { id: convenioId },
      data: {
        montoPagado: { increment: monto },
        parcialidadesRestantes: abiertas,
        estado,
      },
    });

    if (actualizado.status === 'completed') {
      await this.verificarAutoReconexionPorConvenio(contratoId);
    }
    await this.cartera.aplicarPago(pagoId).catch((e) =>
      this.logger.warn(`aplicarPago espejo ${pagoId}: ${e instanceof Error ? e.message : e}`),
    );

    return {
      pagoId,
      supraPaymentId: supraPayment.id,
      estado,
      saldoAFavor: minorToPesos(supraPayment.excess ?? '0'),
      parcialidadesRestantes: abiertas,
    };
  }

  private async verificarAutoReconexionPorConvenio(contratoId: string): Promise<void> {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { estado: true, bloqueadoJuridico: true },
    });
    if (!contrato) return;

    const esCortado = ESTADOS_CORTADOS.some(s =>
      (contrato.estado ?? '').toLowerCase().includes(s.toLowerCase()),
    );
    if (!esCortado || contrato.bloqueadoJuridico) return;

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
          notas: 'Generada automáticamente al completar convenio de pago',
          fechaProgramada,
          seguimientos: {
            create: {
              estadoNuevo: 'Pendiente',
              nota: 'Orden de reconexión generada por cumplimiento de convenio',
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

  async cancelar(convenioId: string) {
    const convenio = await this.prisma.convenio.findUnique({ where: { id: convenioId } });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');
    if (convenio.estado === 'Completado')
      throw new BadRequestException('No se puede cancelar un convenio completado');

    if (this.supra.enabled) {
      const planId = await this.supraMapa.get('convenio', convenioId);
      if (planId) {
        try {
          await this.supra.cancelPaymentPlan(planId);
        } catch (err) {
          if (err instanceof SupraApiError && err.status !== 404) {
            throw new BadGatewayException(`SUPRA rechazó la cancelación: ${err.message}`);
          }
        }
      }
    }

    return this.prisma.convenio.update({
      where: { id: convenioId },
      data: { estado: 'Cancelado' },
    });
  }
}
