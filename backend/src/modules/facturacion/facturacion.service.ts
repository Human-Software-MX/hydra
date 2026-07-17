import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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

  private async persistirFactura(factura: FacturaConsumoResultado) {
    return this.prisma.$transaction(async (tx) => {
      const timbrado = await tx.timbrado.create({
        data: {
          contratoId: factura.contratoId,
          consumoId: factura.consumoId,
          estado: 'Pendiente', // pasa a "Timbrada OK" cuando el módulo CFDI la selle
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

      return { timbradoId: timbrado.id, reciboId: recibo.id, factura };
    });
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

  /** Ejecuta la facturación masiva de un periodo (crea Timbrado + Recibo por consumo). */
  async ejecutarPeriodo(params: {
    periodo: string;
    rutaId?: string;
    zonaId?: string;
    contratoId?: string;
  }) {
    const consumos = await this.consumosFacturables(params);
    const generados: Array<{ consumoId: string; timbradoId: string; reciboId: string; total: number }> = [];
    const errores: Array<{ consumoId: string; error: string }> = [];

    for (const c of consumos) {
      try {
        const factura = await this.calcularParaConsumo(c as any);
        const res = await this.persistirFactura(factura);
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

    return {
      periodo: params.periodo,
      procesados: consumos.length,
      generados: generados.length,
      conError: errores.length,
      importeTotal: redondear(generados.reduce((s, g) => s + g.total, 0)),
      detalle: generados,
      errores,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Suma el saldo pendiente de recibos anteriores del contrato (arrastre de vencido).
   * Pendiente por recibo = saldoVigente + saldoVencido - pagos aplicados, con piso en 0.
   */
  private async calcularSaldoVencido(contratoId: string, consumoIdActual: string): Promise<number> {
    const recibos = await this.prisma.recibo.findMany({
      where: { contratoId, timbrado: { consumoId: { not: consumoIdActual } } },
      include: { pagos: { select: { monto: true } } },
    });
    let vencido = 0;
    for (const r of recibos) {
      const pagado = r.pagos.reduce((s, p) => s + Number(p.monto), 0);
      const pendiente = Number(r.saldoVigente) + Number(r.saldoVencido) - pagado;
      if (pendiente > 0) vencido += pendiente;
    }
    return redondear(vencido);
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
