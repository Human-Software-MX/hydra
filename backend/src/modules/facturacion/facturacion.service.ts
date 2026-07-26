import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { SupraClientService } from '../supra/supra-client.service';
import { SupraMapService } from '../supra/supra-map.service';
import { SupraOutboxService } from '../supra/supra-outbox.service';
import { minorToPesos, supraRef } from '../supra/supra.config';
import {
  calcularFactura,
  redondear,
  ResultadoFactura,
  TarifaCalculo,
} from './billing-calculator';

/** Servicios que se facturan sobre el consumo periódico, en orden de aparición en el recibo. */
const SERVICIOS_FACTURABLES = ['agua', 'saneamiento', 'alcantarillado'];

/** Días naturales entre la emisión y el vencimiento del recibo (configurable a futuro por organismo). */
const DIAS_VENCIMIENTO = 20;

export interface FacturaConsumoResultado extends ResultadoFactura {
  consumoId: string;
  contratoId: string;
  contratoNombre: string;
  periodo: string;
  saldoVencido: number;
  saldoTotal: number;
  fechaEmision: string;
  fechaVencimiento: string;
}

@Injectable()
export class FacturacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly supraOutbox: SupraOutboxService,
    private readonly supraCliente: SupraClientService,
    private readonly supraMapa: SupraMapService,
  ) {}

  // ─── Resolución de tarifas vigentes ───────────────────────────────────────

  /**
   * Devuelve las tarifas vigentes agrupadas por tipoServicio, filtrando por
   * administración cuando la tarifa la especifica (las tarifas sin administración
   * aplican de forma global como fallback).
   */
  async tarifasVigentesPorServicio(
    fecha: Date,
    administracionId?: string | null,
  ): Promise<Record<string, TarifaCalculo[]>> {
    const tarifas = await this.prisma.tarifa.findMany({
      where: {
        activo: true,
        tipoServicio: { in: SERVICIOS_FACTURABLES },
        vigenciaDesde: { lte: fecha },
        AND: [
          { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: fecha } }] },
          // Aplican las tarifas de la administración del contrato y las globales (sin administración).
          { OR: [{ administracionId: administracionId ?? null }, { administracionId: null }] },
        ],
      },
      orderBy: [{ tipoServicio: 'asc' }, { rangoMinM3: 'asc' }],
    });

    const agrupadas: Record<string, TarifaCalculo[]> = {};
    for (const t of tarifas) {
      const linea: TarifaCalculo & { administracionId: string | null } = {
        tipoServicio: t.tipoServicio,
        tipoCalculo: t.tipoCalculo,
        rangoMinM3: t.rangoMinM3,
        rangoMaxM3: t.rangoMaxM3,
        precioUnitario: t.precioUnitario ? Number(t.precioUnitario) : null,
        cuotaFija: t.cuotaFija ? Number(t.cuotaFija) : null,
        ivaPct: Number(t.ivaPct ?? 0),
        administracionId: t.administracionId ?? null,
      };
      ((agrupadas as any)[t.tipoServicio] ??= []).push(linea);
    }

    // Deduplicación: si un servicio tiene tarifa específica de la administración,
    // descarta las globales de ese servicio (la específica manda).
    for (const servicio of Object.keys(agrupadas)) {
      const lineas = agrupadas[servicio] as Array<TarifaCalculo & { administracionId: string | null }>;
      const tieneEspecifica = administracionId
        ? lineas.some((l) => l.administracionId === administracionId)
        : false;
      agrupadas[servicio] = (tieneEspecifica
        ? lineas.filter((l) => l.administracionId === administracionId)
        : lineas
      ).map(({ administracionId: _omit, ...rest }) => rest);
    }

    return agrupadas;
  }

  // ─── Cálculo (dry-run) de un consumo ──────────────────────────────────────

  async calcularConsumo(consumoId: string): Promise<FacturaConsumoResultado> {
    const consumo = await this.prisma.consumo.findUnique({
      where: { id: consumoId },
      include: { contrato: { select: { id: true, nombre: true, zonaId: true } } },
    });
    if (!consumo) throw new NotFoundException('Consumo no encontrado');
    return this.calcularParaConsumo(consumo as any);
  }

  private async calcularParaConsumo(consumo: {
    id: string;
    contratoId: string;
    periodo: string;
    m3: any;
    contrato: { id: string; nombre: string; zonaId: string | null };
  }): Promise<FacturaConsumoResultado> {
    const fecha = this.finDePeriodo(consumo.periodo);
    const administracionId = await this.administracionDeZona(consumo.contrato.zonaId);
    const tarifasPorServicio = await this.tarifasVigentesPorServicio(fecha, administracionId);

    if (!Object.keys(tarifasPorServicio).length) {
      throw new BadRequestException(
        `No hay tarifas vigentes para el periodo ${consumo.periodo}`,
      );
    }

    const factura = calcularFactura({
      consumoM3: Number(consumo.m3),
      tarifasPorServicio,
    });

    const saldoVencido = await this.calcularSaldoVencido(consumo.contratoId, consumo.id);
    const fechaEmision = this.hoyISO();
    const fechaVencimiento = this.fechaVencimiento(fecha);

    return {
      ...factura,
      consumoId: consumo.id,
      contratoId: consumo.contratoId,
      contratoNombre: consumo.contrato.nombre,
      periodo: consumo.periodo,
      saldoVencido,
      saldoTotal: redondear(factura.total + saldoVencido),
      fechaEmision,
      fechaVencimiento,
    };
  }

  // ─── Facturación de un consumo (persistente) ──────────────────────────────

  async facturarConsumo(consumoId: string): Promise<{ timbradoId: string; reciboId: string; factura: FacturaConsumoResultado }> {
    const consumo = await this.prisma.consumo.findUnique({
      where: { id: consumoId },
      include: {
        contrato: { select: { id: true, nombre: true, zonaId: true, indicadorExentarFacturacion: true, estado: true } },
        timbrado: { select: { id: true } },
      },
    });
    if (!consumo) throw new NotFoundException('Consumo no encontrado');
    if (!consumo.confirmado) throw new BadRequestException('El consumo no está confirmado');
    if (consumo.timbrado) throw new BadRequestException('El consumo ya fue facturado');
    if (consumo.contrato.indicadorExentarFacturacion) {
      throw new BadRequestException('El contrato está exento de facturación');
    }

    const factura = await this.calcularParaConsumo(consumo as any);
    return this.persistirFactura(factura);
  }

  private async persistirFactura(factura: FacturaConsumoResultado, loteFacturacionId?: string) {
    const resultado = await this.prisma.$transaction(async (tx) => {
      const timbrado = await tx.timbrado.create({
        data: {
          contratoId: factura.contratoId,
          consumoId: factura.consumoId,
          estado: 'Pendiente', // pasa a "Timbrada OK" cuando el módulo CFDI la selle
          loteFacturacionId: loteFacturacionId ?? null,
          periodo: factura.periodo,
          subtotal: factura.subtotal,
          iva: factura.iva,
          total: factura.total,
          fechaEmision: factura.fechaEmision,
          fechaVencimiento: factura.fechaVencimiento,
        },
      });

      const recibo = await tx.recibo.create({
        data: {
          contratoId: factura.contratoId,
          timbradoId: timbrado.id,
          saldoVigente: factura.total,
          saldoVencido: factura.saldoVencido,
          fechaVencimiento: factura.fechaVencimiento,
        },
      });

      // SUPRA (fuente de verdad de la cuenta por cobrar): la obligation del
      // recibo se ENCOLA EN LA MISMA TRANSACCIÓN que el recibo — o existe el
      // recibo con su comando, o no existe ninguno; SUPRA caído nunca detiene
      // la facturación (el worker del outbox entrega con reintentos,
      // idempotente por hydra:recibo:<id>).
      await this.supraOutbox.encolar(
        'obligation.create',
        { reciboId: recibo.id },
        `${supraRef.recibo(recibo.id)}:create`,
        { tx },
      );

      return { timbradoId: timbrado.id, reciboId: recibo.id, factura };
    });

    // Evento para integraciones externas — fuera de la transacción y sin await
    // bloqueante: un webhook caído no afecta la facturación.
    void this.webhooks.emitir('recibo.emitido', {
      reciboId: resultado.reciboId,
      timbradoId: resultado.timbradoId,
      contratoId: factura.contratoId,
      periodo: factura.periodo,
      total: factura.total,
      fechaVencimiento: factura.fechaVencimiento,
    });

    return resultado;
  }

  // ─── Facturación masiva por periodo ───────────────────────────────────────

  private async consumosFacturables(params: {
    periodo: string;
    rutaId?: string;
    zonaId?: string;
    contratoId?: string;
  }) {
    return this.prisma.consumo.findMany({
      where: {
        periodo: params.periodo,
        confirmado: true,
        timbrado: { is: null },
        ...(params.contratoId && { contratoId: params.contratoId }),
        contrato: {
          indicadorExentarFacturacion: false,
          ...(params.rutaId && { rutaId: params.rutaId }),
          ...(params.zonaId && { zonaId: params.zonaId }),
        },
      },
      include: { contrato: { select: { id: true, nombre: true, zonaId: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Previsualiza la facturación de un periodo sin escribir nada. */
  async previsualizarPeriodo(params: {
    periodo: string;
    rutaId?: string;
    zonaId?: string;
    contratoId?: string;
  }) {
    const consumos = await this.consumosFacturables(params);
    const facturas: FacturaConsumoResultado[] = [];
    const errores: Array<{ consumoId: string; contratoId: string; error: string }> = [];

    for (const c of consumos) {
      try {
        facturas.push(await this.calcularParaConsumo(c as any));
      } catch (e: any) {
        errores.push({ consumoId: c.id, contratoId: c.contratoId, error: e?.message ?? 'Error' });
      }
    }

    return {
      periodo: params.periodo,
      totalConsumos: consumos.length,
      facturables: facturas.length,
      conError: errores.length,
      importeSubtotal: redondear(facturas.reduce((s, f) => s + f.subtotal, 0)),
      importeIva: redondear(facturas.reduce((s, f) => s + f.iva, 0)),
      importeTotal: redondear(facturas.reduce((s, f) => s + f.total, 0)),
      facturas,
      errores,
    };
  }

  /**
   * Ejecuta la facturación masiva de un periodo (crea Timbrado + Recibo por consumo),
   * agrupando la corrida en un LoteFacturacion que guarda los filtros usados para
   * poder auditar, cancelar o reprocesar la corrida completa.
   */
  async ejecutarPeriodo(
    params: {
      periodo: string;
      rutaId?: string;
      zonaId?: string;
      contratoId?: string;
    },
    loteOrigenId?: string,
  ) {
    const lote = await this.prisma.loteFacturacion.create({
      data: {
        periodo: params.periodo,
        filtros: {
          rutaId: params.rutaId ?? null,
          zonaId: params.zonaId ?? null,
          contratoId: params.contratoId ?? null,
        },
        loteOrigenId: loteOrigenId ?? null,
      },
    });

    const consumos = await this.consumosFacturables(params);
    const generados: Array<{ consumoId: string; timbradoId: string; reciboId: string; total: number }> = [];
    const errores: Array<{ consumoId: string; error: string }> = [];

    for (const c of consumos) {
      try {
        const factura = await this.calcularParaConsumo(c as any);
        const res = await this.persistirFactura(factura, lote.id);
        generados.push({
          consumoId: c.id,
          timbradoId: res.timbradoId,
          reciboId: res.reciboId,
          total: factura.total,
        });
      } catch (e: any) {
        errores.push({ consumoId: c.id, error: e?.message ?? 'Error' });
      }
    }

    const importeTotal = redondear(generados.reduce((s, g) => s + g.total, 0));
    await this.prisma.loteFacturacion.update({
      where: { id: lote.id },
      data: { generados: generados.length, conError: errores.length, importeTotal },
    });

    return {
      loteId: lote.id,
      periodo: params.periodo,
      procesados: consumos.length,
      generados: generados.length,
      conError: errores.length,
      importeTotal,
      detalle: generados,
      errores,
    };
  }

  // ─── Lotes de facturación: consulta, cancelación y reproceso ──────────────

  async listarLotes(params: { periodo?: string; estado?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      ...(params.periodo && { periodo: params.periodo }),
      ...(params.estado && { estado: params.estado }),
    };
    const [data, total] = await Promise.all([
      this.prisma.loteFacturacion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.loteFacturacion.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async obtenerLote(loteId: string) {
    const lote = await this.prisma.loteFacturacion.findUnique({ where: { id: loteId } });
    if (!lote) throw new NotFoundException('Lote de facturación no encontrado');

    const porEstado = await this.prisma.timbrado.groupBy({
      by: ['estado'],
      where: { loteFacturacionId: loteId },
      _count: { _all: true },
      _sum: { total: true },
    });

    return {
      ...lote,
      totales: {
        timbrados: porEstado.reduce((s, g) => s + g._count._all, 0),
        porEstado: porEstado.map((g) => ({
          estado: g.estado,
          cantidad: g._count._all,
          importe: Number(g._sum.total ?? 0),
        })),
      },
    };
  }

  /**
   * Valida que un lote pueda cancelarse:
   *  - existe y está en estado 'generado';
   *  - ningún timbrado del lote está sellado ('Timbrada OK' = CFDI vigente ante el SAT);
   *  - ningún recibo del lote tiene pagos aplicados (directos ni vía cartera).
   */
  private async validarLoteCancelable(loteId: string) {
    const lote = await this.prisma.loteFacturacion.findUnique({
      where: { id: loteId },
      include: {
        timbrados: {
          select: { id: true, estado: true, recibos: { select: { id: true } } },
        },
      },
    });
    if (!lote) throw new NotFoundException('Lote de facturación no encontrado');
    if (lote.estado !== 'generado') {
      throw new BadRequestException(
        `Solo se pueden cancelar lotes en estado "generado" (estado actual: "${lote.estado}")`,
      );
    }

    const sellados = lote.timbrados.filter((t) => t.estado === 'Timbrada OK').length;
    if (sellados > 0) {
      throw new BadRequestException(
        `El lote tiene ${sellados} factura(s) con CFDI sellado ("Timbrada OK"). ` +
          'Un CFDI sellado requiere cancelación fiscal ante el SAT, fuera del alcance de esta operación; ' +
          'cancele fiscalmente esos comprobantes antes de cancelar el lote.',
      );
    }

    const timbradoIds = lote.timbrados.map((t) => t.id);
    const reciboIds = lote.timbrados.flatMap((t) => t.recibos.map((r) => r.id));
    await this.verificarSinPagos(timbradoIds, reciboIds, 'El lote');

    return { lote, timbradoIds, reciboIds };
  }

  /** Rechaza la operación si hay pagos (directos o aplicados vía cartera) sobre los recibos/timbrados dados. */
  private async verificarSinPagos(timbradoIds: string[], reciboIds: string[], sujeto: string) {
    const [pagosDirectos, aplicaciones] = await Promise.all([
      this.prisma.pago.count({
        where: {
          OR: [{ timbradoId: { in: timbradoIds } }, { reciboId: { in: reciboIds } }],
        },
      }),
      this.prisma.aplicacionPago.count({
        where: { documento: { reciboId: { in: reciboIds } } },
      }),
    ]);
    if (pagosDirectos + aplicaciones > 0) {
      throw new BadRequestException(
        `${sujeto} tiene recibos con pagos aplicados (${pagosDirectos + aplicaciones}); no puede cancelarse. ` +
          'Revierta o reasigne los pagos antes de intentar la cancelación.',
      );
    }
  }

  /**
   * Cancela físicamente un lote ya validado: borra recibos (y sus documentos de
   * cartera huérfanos), marca los timbrados como 'Cancelado' conservándolos como
   * auditoría y libera los consumos (consumoId=null; el periodo queda en `periodo`).
   */
  private async cancelarLoteCore(
    ctx: { lote: { id: string; periodo: string; importeTotal: any; generados: number }; timbradoIds: string[]; reciboIds: string[] },
    dto: { motivo: string; canceladoPor?: string },
    estadoFinal: 'cancelado' | 'reprocesado',
  ) {
    const { lote, timbradoIds, reciboIds } = ctx;
    // Captura contratoId por recibo ANTES del borrado (los comandos de
    // cancelación en SUPRA lo necesitan para resolver la obligation).
    const recibosACancelar = await this.prisma.recibo.findMany({
      where: { id: { in: reciboIds } },
      select: { id: true, contratoId: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.documentoCartera.deleteMany({ where: { reciboId: { in: reciboIds } } });
      await tx.recibo.deleteMany({ where: { id: { in: reciboIds } } });
      await tx.timbrado.updateMany({
        where: { id: { in: timbradoIds } },
        data: { estado: 'Cancelado', consumoId: null },
      });
      await tx.loteFacturacion.update({
        where: { id: lote.id },
        data: {
          estado: estadoFinal,
          motivoCancelacion: dto.motivo,
          canceladoPor: dto.canceladoPor ?? null,
        },
      });
      // Cancela en SUPRA las obligations de los recibos eliminados — encolado
      // en la MISMA transacción del borrado (si nunca llegaron a SUPRA, el
      // comando termina en no-op).
      for (const r of recibosACancelar) {
        await this.supraOutbox.encolar(
          'obligation.cancel',
          { reciboId: r.id, contratoId: r.contratoId },
          `${supraRef.recibo(r.id)}:cancel`,
          { tx },
        );
      }
    });

    return {
      loteId: lote.id,
      periodo: lote.periodo,
      estado: estadoFinal,
      timbradosCancelados: timbradoIds.length,
      recibosEliminados: reciboIds.length,
      importeCancelado: Number(lote.importeTotal),
    };
  }

  /** Cancela un lote de facturación completo (recibos borrados, timbrados a 'Cancelado', consumos liberados). */
  async cancelarLote(loteId: string, dto: { motivo: string; canceladoPor?: string }) {
    return this.conLog(`cancelar-lote:${loteId}`, async () => {
      const ctx = await this.validarLoteCancelable(loteId);
      const res = await this.cancelarLoteCore(ctx, dto, 'cancelado');
      return { ...res, motivo: dto.motivo, registros: res.timbradosCancelados };
    });
  }

  /**
   * Reprocesa un lote: lo cancela (mismas validaciones duras) y vuelve a ejecutar
   * la facturación del periodo con los filtros originales guardados en el lote.
   * El lote nuevo queda ligado al anterior vía loteOrigenId.
   */
  async reprocesarLote(loteId: string, dto: { motivo: string; canceladoPor?: string }) {
    return this.conLog(`reprocesar-lote:${loteId}`, async () => {
      const ctx = await this.validarLoteCancelable(loteId);
      const cancelacion = await this.cancelarLoteCore(ctx, dto, 'reprocesado');

      const filtros = (ctx.lote.filtros ?? {}) as {
        rutaId?: string | null;
        zonaId?: string | null;
        contratoId?: string | null;
      };
      const nuevo = await this.ejecutarPeriodo(
        {
          periodo: ctx.lote.periodo,
          rutaId: filtros.rutaId ?? undefined,
          zonaId: filtros.zonaId ?? undefined,
          contratoId: filtros.contratoId ?? undefined,
        },
        loteId,
      );

      const importeAnterior = Number(ctx.lote.importeTotal);
      return {
        loteAnteriorId: loteId,
        loteNuevoId: nuevo.loteId,
        periodo: ctx.lote.periodo,
        motivo: dto.motivo,
        comparativo: {
          importeAnterior,
          importeNuevo: nuevo.importeTotal,
          diferencia: redondear(nuevo.importeTotal - importeAnterior),
          generadosAnterior: ctx.lote.generados,
          generadosNuevo: nuevo.generados,
        },
        cancelacion,
        resultado: nuevo,
        registros: nuevo.generados,
        errores: nuevo.conError,
      };
    });
  }

  /**
   * Refactura un consumo individual: cancela su timbrado previo (mismas guardas
   * que el lote: sin CFDI sellado y sin pagos) y vuelve a facturarlo con las
   * tarifas y saldos vigentes.
   */
  async refacturarConsumo(consumoId: string, dto: { motivo: string; canceladoPor?: string }) {
    return this.conLog(`refacturar-consumo:${consumoId}`, async () => {
      const consumo = await this.prisma.consumo.findUnique({
        where: { id: consumoId },
        include: {
          contrato: { select: { indicadorExentarFacturacion: true } },
          timbrado: { include: { recibos: { select: { id: true } } } },
        },
      });
      if (!consumo) throw new NotFoundException('Consumo no encontrado');
      if (!consumo.timbrado) {
        throw new BadRequestException(
          'El consumo no tiene factura previa; use la facturación normal (POST /facturacion/consumo/:id)',
        );
      }
      if (!consumo.confirmado) throw new BadRequestException('El consumo no está confirmado');
      if (consumo.contrato.indicadorExentarFacturacion) {
        throw new BadRequestException('El contrato está exento de facturación');
      }

      const timbrado = consumo.timbrado;
      if (timbrado.estado === 'Timbrada OK') {
        throw new BadRequestException(
          'La factura del consumo tiene CFDI sellado ("Timbrada OK"). ' +
            'Un CFDI sellado requiere cancelación fiscal ante el SAT, fuera del alcance de esta operación.',
        );
      }
      const reciboIds = timbrado.recibos.map((r) => r.id);
      await this.verificarSinPagos([timbrado.id], reciboIds, 'La factura del consumo');

      await this.prisma.$transaction(async (tx) => {
        await tx.documentoCartera.deleteMany({ where: { reciboId: { in: reciboIds } } });
        await tx.recibo.deleteMany({ where: { id: { in: reciboIds } } });
        await tx.timbrado.update({
          where: { id: timbrado.id },
          data: { estado: 'Cancelado', consumoId: null },
        });
        // Cancela en SUPRA las obligations de los recibos sustituidos —
        // encolado en la MISMA transacción del borrado.
        for (const reciboId of reciboIds) {
          await this.supraOutbox.encolar(
            'obligation.cancel',
            { reciboId, contratoId: consumo.contratoId },
            `${supraRef.recibo(reciboId)}:cancel`,
            { tx },
          );
        }
      });

      const nuevo = await this.facturarConsumo(consumoId);
      const importeAnterior = Number(timbrado.total);
      return {
        consumoId,
        motivo: dto.motivo,
        timbradoCanceladoId: timbrado.id,
        timbradoNuevoId: nuevo.timbradoId,
        reciboNuevoId: nuevo.reciboId,
        comparativo: {
          importeAnterior,
          importeNuevo: nuevo.factura.total,
          diferencia: redondear(nuevo.factura.total - importeAnterior),
        },
        registros: 1,
      };
    });
  }

  /**
   * Envuelve una operación con bitácora LogProceso (Iniciado → Completado/Error).
   * Copia local del patrón `conLog` de batch.service.ts, con tipo 'facturacion'.
   */
  private async conLog<T extends { registros?: number; errores?: number }>(
    subTipo: string,
    fn: () => Promise<T & Record<string, unknown>>,
  ): Promise<T> {
    const log = await this.prisma.logProceso.create({
      data: { tipo: 'facturacion', subTipo, estado: 'Iniciado' },
    });
    const inicio = Date.now();
    try {
      const resultado = await fn();
      await this.prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: 'Completado',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          registros: resultado.registros ?? 0,
          errores: resultado.errores ?? 0,
          detalle: JSON.parse(JSON.stringify(resultado)),
        },
      });
      return resultado;
    } catch (e: any) {
      await this.prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: 'Error',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          errores: 1,
          errorMsg: e?.message ?? 'Error',
        },
      });
      throw e;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Suma el saldo pendiente de recibos anteriores del contrato (arrastre de vencido).
   * Se calcula a nivel contrato — max(0, Σ saldoVigente anteriores − Σ pagos del
   * contrato) — y NO por recibo con `saldoVigente + saldoVencido`: `saldoVencido`
   * es a su vez el arrastre de los recibos previos, así que sumarlo por recibo
   * duplica (y compone) la deuda. Además `Pago.reciboId` es opcional: el nivel
   * contrato evita perder pagos hechos sobre el recibo más reciente.
   */
  /**
   * Arrastre (saldo pendiente de recibos anteriores) impreso en el recibo
   * nuevo. Con SUPRA activo, la verdad son sus obligations abiertas de recibo
   * (la del consumo actual aún no existe al momento del cálculo); el camino
   * legacy conserva el neto local facturado − pagado.
   */
  private async calcularSaldoVencido(contratoId: string, consumoIdActual: string): Promise<number> {
    if (this.supraCliente.enabled) {
      const customerId = await this.supraMapa.get('contrato', contratoId);
      if (customerId) {
        const abiertas = await this.supraCliente.listOpenObligations(customerId);
        const abiertoMinor = abiertas
          .filter((o) => o.external_ref?.startsWith('hydra:recibo:'))
          .reduce((s, o) => s + Number(o.amount_due_minor) - Number(o.amount_settled_minor), 0);
        return redondear(Math.max(0, minorToPesos(abiertoMinor)));
      }
    }
    const [facturadoAgg, pagadoAgg] = await Promise.all([
      this.prisma.recibo.aggregate({
        where: { contratoId, timbrado: { consumoId: { not: consumoIdActual } } },
        _sum: { saldoVigente: true },
      }),
      this.prisma.pago.aggregate({ where: { contratoId }, _sum: { monto: true } }),
    ]);
    const facturado = Number(facturadoAgg._sum.saldoVigente ?? 0);
    const pagado = Number(pagadoAgg._sum.monto ?? 0);
    return redondear(Math.max(0, facturado - pagado));
  }

  private async administracionDeZona(zonaId: string | null): Promise<string | null> {
    if (!zonaId) return null;
    const zona = await this.prisma.zona.findUnique({
      where: { id: zonaId },
      select: { administracionId: true },
    });
    return zona?.administracionId ?? null;
  }

  /** Último día del periodo "YYYY-MM" como Date (para resolver la tarifa vigente). */
  private finDePeriodo(periodo: string): Date {
    const [y, m] = periodo.split('-').map((n) => parseInt(n, 10));
    if (!y || !m) return new Date();
    return new Date(y, m, 0); // día 0 del mes siguiente = último día del mes m
  }

  private hoyISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private fechaVencimiento(finPeriodo: Date): string {
    const d = new Date(finPeriodo);
    d.setDate(d.getDate() + DIAS_VENCIMIENTO);
    return d.toISOString().slice(0, 10);
  }
}
