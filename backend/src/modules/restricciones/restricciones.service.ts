import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { SupraClientService } from '../supra/supra-client.service';
import { SupraMapService } from '../supra/supra-map.service';
import { minorToPesos } from '../supra/supra.config';

/**
 * Motor de mínimo vital — Ley General de Aguas (DOF 11-dic-2025).
 *
 * La LGA prohíbe la suspensión total del suministro por falta de pago: solo se
 * permite RESTRINGIR el flujo garantizando el mínimo vital (OMS: 50-100
 * l/persona/día). Este módulo modela esa restricción como estado de primera
 * clase con trazabilidad probatoria completa:
 *
 *   candidato (adeudo ≥ N recibos vencidos, sin convenio activo, cortable)
 *     → programada (orden de trabajo + aviso previo obligatorio al usuario)
 *     → aplicada  (dispositivo restrictor + evidencia de campo)
 *     → revertida (automática al regularizar pago o firmar convenio)
 *
 * Exclusiones duras: contratos con convenio de pago activo, bloqueo jurídico,
 * o punto de servicio marcado como no cortable (p. ej. hospitales, escuelas).
 */

/**
 * Adeudo vencido de un contrato aplicando los pagos FIFO (recibo más antiguo
 * primero). `Recibo.saldoVencido` NO participa: es un arrastre de los recibos
 * anteriores, que aquí ya se cuentan uno a uno — sumarlo duplicaría la deuda.
 * Como `Pago.reciboId` es opcional, la asignación real pago→recibo no es
 * confiable; FIFO garantiza que un pago hecho "sobre el recibo más reciente"
 * (que en el papel incluía el arrastre) sí liquide los recibos viejos.
 * Precondición: `recibos` ordenados por fechaVencimiento ascendente.
 */
export function adeudoFifo(
  recibos: Array<{ saldoVigente: unknown; fechaVencimiento: string }>,
  pagadoTotal: number,
): { monto: number; recibosVencidos: number } {
  let disponible = pagadoTotal;
  let monto = 0;
  let vencidos = 0;
  for (const r of recibos) {
    const vigente = Number(r.saldoVigente);
    const abono = Math.min(disponible, vigente);
    disponible -= abono;
    const pendiente = vigente - abono;
    if (pendiente > 0.01) {
      monto += pendiente;
      vencidos++;
    }
  }
  return { monto: Math.round(monto * 100) / 100, recibosVencidos: vencidos };
}

@Injectable()
export class RestriccionesService {
  private readonly logger = new Logger(RestriccionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
    private readonly supra: SupraClientService,
    private readonly supraMapa: SupraMapService,
  ) {}

  // ─── Adeudo de un contrato (recibos vencidos impagos) ─────────────────────

  /**
   * Adeudo vencido del contrato. Con SUPRA activo es la decisión de
   * restringir/revertir sobre la VERDAD financiera (obligations abiertas
   * vencidas en SUPRA); el cálculo FIFO local queda para el camino legacy.
   */
  private async adeudoContrato(contratoId: string): Promise<{ monto: number; recibosVencidos: number }> {
    if (this.supra.enabled) {
      const customerId = await this.supraMapa.get('contrato', contratoId);
      if (customerId) {
        const abiertas = await this.supra.listOpenObligations(customerId);
        const ahora = Date.now();
        let monto = 0;
        let vencidos = 0;
        for (const o of abiertas) {
          const abierto = Number(o.amount_due_minor) - Number(o.amount_settled_minor);
          if (abierto <= 0) continue;
          if (o.due_at && new Date(o.due_at).getTime() < ahora) {
            monto += abierto;
            vencidos++;
          }
        }
        return { monto: minorToPesos(monto), recibosVencidos: vencidos };
      }
      // Contrato sin sincronizar a SUPRA: sin verdad financiera allá — cae al
      // cálculo local (mismo criterio que la proyección de cartera).
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const [recibos, pagadoAgg] = await Promise.all([
      this.prisma.recibo.findMany({
        where: { contratoId, fechaVencimiento: { lt: hoy } },
        select: { saldoVigente: true, fechaVencimiento: true },
        orderBy: { fechaVencimiento: 'asc' },
      }),
      this.prisma.pago.aggregate({ where: { contratoId }, _sum: { monto: true } }),
    ]);
    return adeudoFifo(recibos, Number(pagadoAgg._sum.monto ?? 0));
  }

  private async tieneConvenioActivo(contratoId: string): Promise<boolean> {
    const c = await this.prisma.convenio.findFirst({
      where: { contratoId, estado: 'Activo' },
      select: { id: true },
    });
    return Boolean(c);
  }

  private async tieneRestriccionActiva(contratoId: string): Promise<boolean> {
    const r = await this.prisma.restriccionServicio.findFirst({
      where: { contratoId, estado: { in: ['programada', 'aplicada'] } },
      select: { id: true },
    });
    return Boolean(r);
  }

  // ─── Candidatos a restricción ─────────────────────────────────────────────

  /**
   * Contratos con ≥ minRecibosVencidos impagos, sin convenio activo, sin
   * restricción vigente, no bloqueados jurídicamente y con punto de servicio
   * cortable. Devuelve el detalle del adeudo para autorización humana.
   */
  async candidatos(params: { minRecibosVencidos?: number; limit?: number } = {}) {
    const minVencidos = params.minRecibosVencidos ?? 2;
    const limit = params.limit ?? 50;

    // Con SUPRA activo, los candidatos salen de la PROYECCIÓN (EstadoCuenta,
    // alimentado por eventos de SUPRA): elimina el scan global Recibo+Pago y
    // la tercera implementación FIFO. Las exclusiones duras se conservan.
    if (this.supra.enabled) {
      const estados = await this.prisma.estadoCuenta.findMany({
        where: { saldoVencido: { gt: 0.01 }, docsVencidos: { gte: minVencidos }, enConvenio: false, restringido: false },
        orderBy: { saldoVencido: 'desc' },
        take: limit * 3, // margen para las exclusiones por contrato
        select: {
          contratoId: true,
          saldoVencido: true,
          docsVencidos: true,
          contrato: {
            select: {
              numeroContrato: true,
              nombre: true,
              bloqueadoJuridico: true,
              puntoServicio: { select: { cortable: true } },
            },
          },
        },
      });
      const resultado: Array<{
        contratoId: string;
        numeroContrato: number;
        nombre: string;
        adeudo: number;
        recibosVencidos: number;
      }> = [];
      for (const e of estados) {
        if (resultado.length >= limit) break;
        if (e.contrato.bloqueadoJuridico) continue;
        if (e.contrato.puntoServicio?.cortable === false) continue; // usuario protegido
        resultado.push({
          contratoId: e.contratoId,
          numeroContrato: e.contrato.numeroContrato,
          nombre: e.contrato.nombre,
          adeudo: Number(e.saldoVencido),
          recibosVencidos: e.docsVencidos,
        });
      }
      return resultado;
    }

    const hoy = new Date().toISOString().slice(0, 10);

    const [recibosVencidos, pagosPorContrato] = await Promise.all([
      this.prisma.recibo.findMany({
        where: { fechaVencimiento: { lt: hoy } },
        select: {
          contratoId: true,
          saldoVigente: true,
          fechaVencimiento: true,
          contrato: {
            select: {
              id: true,
              numeroContrato: true,
              nombre: true,
              estado: true,
              bloqueadoJuridico: true,
              puntoServicio: { select: { cortable: true } },
            },
          },
        },
        orderBy: { fechaVencimiento: 'asc' },
      }),
      this.prisma.pago.groupBy({ by: ['contratoId'], _sum: { monto: true } }),
    ]);

    const pagadoPorContrato = new Map(
      pagosPorContrato.map((p) => [p.contratoId, Number(p._sum.monto ?? 0)]),
    );

    // Agrupa los recibos vencidos por contrato (conservan el orden asc de vencimiento).
    const recibosPorContrato = new Map<
      string,
      {
        contrato: (typeof recibosVencidos)[0]['contrato'];
        recibos: Array<{ saldoVigente: unknown; fechaVencimiento: string }>;
      }
    >();
    for (const r of recibosVencidos) {
      const g = recibosPorContrato.get(r.contratoId) ?? { contrato: r.contrato, recibos: [] };
      g.recibos.push(r);
      recibosPorContrato.set(r.contratoId, g);
    }

    const porContrato = new Map<
      string,
      { contrato: (typeof recibosVencidos)[0]['contrato']; monto: number; vencidos: number }
    >();
    for (const [contratoId, g] of recibosPorContrato) {
      const adeudo = adeudoFifo(g.recibos, pagadoPorContrato.get(contratoId) ?? 0);
      if (adeudo.monto <= 0.01) continue;
      porContrato.set(contratoId, {
        contrato: g.contrato,
        monto: adeudo.monto,
        vencidos: adeudo.recibosVencidos,
      });
    }

    const resultado: Array<{
      contratoId: string;
      numeroContrato: number;
      nombre: string;
      adeudo: number;
      recibosVencidos: number;
    }> = [];

    for (const [contratoId, info] of porContrato) {
      if (resultado.length >= limit) break;
      if (info.vencidos < minVencidos) continue;
      if (info.contrato.bloqueadoJuridico) continue;
      if (info.contrato.puntoServicio?.cortable === false) continue; // usuario protegido
      if (await this.tieneConvenioActivo(contratoId)) continue;
      if (await this.tieneRestriccionActiva(contratoId)) continue;
      resultado.push({
        contratoId,
        numeroContrato: info.contrato.numeroContrato,
        nombre: info.contrato.nombre,
        adeudo: Math.round(info.monto * 100) / 100,
        recibosVencidos: info.vencidos,
      });
    }

    return resultado.sort((a, b) => b.adeudo - a.adeudo);
  }

  // ─── Programar restricción (con aviso previo obligatorio) ─────────────────

  async programar(params: {
    contratoId: string;
    fechaProgramada?: string; // default: hoy + 5 días naturales (plazo de aviso)
    autorizadoPor?: string;
    personasVivienda?: number;
    notas?: string;
  }) {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: params.contratoId },
      select: {
        id: true,
        bloqueadoJuridico: true,
        personasHabitanVivienda: true,
        puntoServicio: { select: { cortable: true } },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    if (contrato.bloqueadoJuridico) throw new BadRequestException('Contrato con bloqueo jurídico');
    if (contrato.puntoServicio?.cortable === false) {
      throw new BadRequestException('El punto de servicio está marcado como no restringible');
    }
    if (await this.tieneConvenioActivo(params.contratoId)) {
      throw new BadRequestException('El contrato tiene un convenio de pago activo');
    }
    if (await this.tieneRestriccionActiva(params.contratoId)) {
      throw new BadRequestException('Ya existe una restricción vigente para el contrato');
    }

    const { monto, recibosVencidos } = await this.adeudoContrato(params.contratoId);
    if (monto <= 0) throw new BadRequestException('El contrato no tiene adeudo vencido');

    const fecha = params.fechaProgramada
      ? new Date(`${params.fechaProgramada}T12:00:00`)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() + 5);
          return d;
        })();

    const restriccion = await this.prisma.$transaction(async (tx) => {
      const orden = await tx.orden.create({
        data: {
          contratoId: params.contratoId,
          tipo: 'Restricción de servicio',
          estado: 'Pendiente',
          prioridad: 'Alta',
          origenAutomatico: false,
          eventoOrigen: 'adeudo_vencido',
          fechaProgramada: fecha,
          notas: `Restricción a mínimo vital (LGA). Adeudo: $${monto.toFixed(2)} · ${recibosVencidos} recibos vencidos.`,
        },
      });
      return tx.restriccionServicio.create({
        data: {
          contratoId: params.contratoId,
          estado: 'programada',
          motivo: 'adeudo',
          personasVivienda: params.personasVivienda ?? contrato.personasHabitanVivienda ?? null,
          adeudoAlMomento: monto,
          recibosVencidos,
          ordenRestriccionId: orden.id,
          fechaProgramada: fecha,
          autorizadoPor: params.autorizadoPor ?? null,
          notas: params.notas ?? null,
        },
      });
    });

    // Aviso previo obligatorio al usuario (LGA: notificación antes de restringir).
    const aviso = await this.notificaciones.notificarRestriccionProgramada({
      contratoId: params.contratoId,
      fechaProgramada: fecha.toISOString().slice(0, 10),
      adeudo: monto,
    });

    return { restriccion, aviso };
  }

  // ─── Aplicar (cuadrilla en campo, con evidencia probatoria) ───────────────

  async aplicar(
    id: string,
    params: { dispositivo: string; evidencia?: object; aplicadoPor?: string },
  ) {
    const r = await this.prisma.restriccionServicio.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Restricción no encontrada');
    if (r.estado !== 'programada') {
      throw new BadRequestException(`Solo se puede aplicar una restricción programada (estado: ${r.estado})`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (r.ordenRestriccionId) {
        await tx.orden.update({
          where: { id: r.ordenRestriccionId },
          data: { estado: 'Ejecutada', fechaEjecucion: new Date(), datosCampo: (params.evidencia as any) ?? undefined },
        });
      }
      return tx.restriccionServicio.update({
        where: { id },
        data: {
          estado: 'aplicada',
          dispositivo: params.dispositivo,
          evidencia: (params.evidencia as any) ?? undefined,
          fechaAplicacion: new Date(),
          aplicadoPor: params.aplicadoPor ?? null,
        },
      });
    });
  }

  // ─── Revertir (reconexión a flujo pleno) ──────────────────────────────────

  async revertir(id: string, params: { motivo?: string; evidencia?: object } = {}) {
    const r = await this.prisma.restriccionServicio.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Restricción no encontrada');
    if (r.estado !== 'aplicada' && r.estado !== 'programada') {
      throw new BadRequestException(`La restricción no está vigente (estado: ${r.estado})`);
    }

    // Programada y aún no aplicada → basta cancelarla.
    if (r.estado === 'programada') {
      return this.cancelar(id, params.motivo ?? 'Regularización antes de aplicar');
    }

    return this.prisma.$transaction(async (tx) => {
      const orden = await tx.orden.create({
        data: {
          contratoId: r.contratoId,
          tipo: 'Reversa de restricción',
          estado: 'Pendiente',
          prioridad: 'Alta',
          origenAutomatico: true,
          eventoOrigen: params.motivo ?? 'regularizacion_pago',
          fechaProgramada: new Date(),
          notas: 'Retiro de restrictor y restablecimiento de flujo pleno.',
        },
      });
      return tx.restriccionServicio.update({
        where: { id },
        data: {
          estado: 'revertida',
          ordenReversaId: orden.id,
          evidenciaReversa: (params.evidencia as any) ?? undefined,
          fechaReversa: new Date(),
          notas: params.motivo ? `${r.notas ?? ''}\nReversa: ${params.motivo}`.trim() : r.notas,
        },
      });
    });
  }

  async cancelar(id: string, motivo: string) {
    const r = await this.prisma.restriccionServicio.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Restricción no encontrada');
    if (r.estado !== 'programada') {
      throw new BadRequestException('Solo se puede cancelar una restricción programada');
    }
    return this.prisma.$transaction(async (tx) => {
      if (r.ordenRestriccionId) {
        await tx.orden.update({
          where: { id: r.ordenRestriccionId },
          data: { estado: 'Cancelada', notas: `Cancelada: ${motivo}` },
        });
      }
      return tx.restriccionServicio.update({
        where: { id },
        data: { estado: 'cancelada', notas: `${r.notas ?? ''}\nCancelada: ${motivo}`.trim() },
      });
    });
  }

  // ─── Reversa automática al regularizar ────────────────────────────────────

  /**
   * Revisa restricciones vigentes cuyo contrato ya no tiene adeudo (pagó) o
   * firmó un convenio activo, y las revierte/cancela automáticamente.
   * Corre a diario vía cron (mismo master switch que los demás jobs).
   */
  @Cron(process.env.JOB_REVERSAS_CRON ?? '0 10 * * *', { name: 'reversas-restriccion' })
  async cronReversas() {
    if ((process.env.HYDRA_JOBS_ENABLED ?? 'false').toLowerCase() !== 'true') return;
    await this.verificarReversas();
  }

  async verificarReversas() {
    const vigentes = await this.prisma.restriccionServicio.findMany({
      where: { estado: { in: ['programada', 'aplicada'] } },
      select: { id: true, contratoId: true, estado: true },
    });

    let revertidas = 0;
    const detalle: Array<{ restriccionId: string; accion: string }> = [];
    for (const r of vigentes) {
      const { monto } = await this.adeudoContrato(r.contratoId);
      const convenio = await this.tieneConvenioActivo(r.contratoId);
      if (monto <= 0.01 || convenio) {
        const motivo = convenio ? 'convenio_activo' : 'adeudo_liquidado';
        await this.revertir(r.id, { motivo });
        revertidas++;
        detalle.push({ restriccionId: r.id, accion: `revertida (${motivo})` });
      }
    }

    this.logger.log(`Reversas automáticas: ${revertidas}/${vigentes.length}`);
    return { revisadas: vigentes.length, revertidas, detalle };
  }

  // ─── Consulta ─────────────────────────────────────────────────────────────

  async listar(params: { estado?: string; contratoId?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const where = {
      ...(params.estado && { estado: params.estado }),
      ...(params.contratoId && { contratoId: params.contratoId }),
    };
    const [data, total] = await Promise.all([
      this.prisma.restriccionServicio.findMany({
        where,
        include: { contrato: { select: { numeroContrato: true, nombre: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.restriccionServicio.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
