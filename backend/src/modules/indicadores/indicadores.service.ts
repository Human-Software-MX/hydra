import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { adeudoFifo } from '../restricciones/restricciones.service';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? r2((num / den) * 100) : null);

export interface IndicadoresPigoo {
  /** Periodo YYYY-MM, o null cuando el cálculo es el acumulado histórico. */
  periodo: string | null;
  // Padrón
  padronContratos: number;
  contratosActivos: number;
  contratosConMedidor: number;
  micromedicionPct: number | null;
  // Volúmenes
  volumenProducidoM3: number | null;
  volumenFacturadoM3: number;
  eficienciaFisicaPct: number | null;
  consumoPromedioPorContratoM3: number | null;
  // Comercial
  importeFacturado: number;
  importeRecaudado: number;
  eficienciaComercialPct: number | null;
  eficienciaGlobalPct: number | null;
  // Cobro (PIGOO IP.15)
  recibosEmitidos: number;
  recibosPagados: number;
  eficienciaCobroPct: number | null;
  // Pago a tiempo
  pagosEvaluados: number;
  pagosATiempo: number;
  pagoATiempoPct: number | null;
  // Cartera
  carteraVencida: number;
  usuariosConAdeudo: number;
  rezagoPctPadron: number | null;
  // Servicio
  restriccionesVigentes: number;
  conveniosActivos: number;
  quejasAbiertas: number;
  // Reclamaciones (PIGOO: quejas por cada 1,000 tomas)
  quejasPeriodo: number;
  reclamacionesPor1000Tomas: number | null;
}

/**
 * Indicadores de gestión estilo PIGOO (IMTA) calculados automáticamente desde
 * los datos operativos del sistema — hoy los organismos los arman a mano para
 * reportar. La eficiencia física requiere capturar el volumen producido
 * (macromedición) por periodo en `volumenes_producidos`.
 *
 * Referencia: pigoo.imta.gob.mx — eficiencia física, eficiencia comercial,
 * eficiencia global, micromedición, padrón, rezago.
 */
@Injectable()
export class IndicadoresService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Captura de volumen producido (macromedición) ─────────────────────────

  async registrarVolumenProducido(dto: {
    periodo: string;
    m3: number;
    administracionId?: string;
    fuente?: string;
    notas?: string;
  }) {
    if (!/^\d{4}-\d{2}$/.test(dto.periodo)) {
      throw new BadRequestException('periodo debe tener formato YYYY-MM');
    }
    // Upsert manual: el unique compuesto no aplica cuando administracionId es NULL
    // (Postgres trata cada NULL como distinto), así que se resuelve por búsqueda.
    const existente = await this.prisma.volumenProducido.findFirst({
      where: { periodo: dto.periodo, administracionId: dto.administracionId ?? null },
    });
    const datos = {
      m3: dto.m3,
      fuente: dto.fuente ?? 'macromedidor',
      notas: dto.notas ?? null,
    };
    if (existente) {
      return this.prisma.volumenProducido.update({ where: { id: existente.id }, data: datos });
    }
    return this.prisma.volumenProducido.create({
      data: { periodo: dto.periodo, administracionId: dto.administracionId ?? null, ...datos },
    });
  }

  async listarVolumenes(periodo?: string) {
    return this.prisma.volumenProducido.findMany({
      where: periodo ? { periodo } : undefined,
      orderBy: { periodo: 'desc' },
      take: 36,
    });
  }

  // ─── Cálculo PIGOO del periodo ────────────────────────────────────────────

  /**
   * Con `periodo` (YYYY-MM) calcula los indicadores del mes; sin él calcula el
   * acumulado histórico sobre todos los datos disponibles.
   */
  async pigoo(periodo?: string): Promise<IndicadoresPigoo> {
    if (periodo !== undefined && !/^\d{4}-\d{2}$/.test(periodo)) {
      throw new BadRequestException('periodo debe tener formato YYYY-MM');
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const pagoFechaWhere = periodo ? { fecha: { startsWith: periodo } } : {};

    // Rango de fechas del periodo para modelos con DateTime (quejas del mes).
    let quejaPeriodoWhere = {};
    if (periodo) {
      const desde = new Date(`${periodo}-01T00:00:00.000Z`);
      const hasta = new Date(desde);
      hasta.setUTCMonth(hasta.getUTCMonth() + 1);
      quejaPeriodoWhere = { fecha: { gte: desde, lt: hasta } };
    }

    const [
      padronContratos,
      contratosActivos,
      contratosConMedidor,
      volumenProducido,
      consumosPeriodo,
      timbradosPeriodo,
      pagosPeriodo,
      recibosEmitidos,
      recibosPagadosRows,
      pagosConVencimiento,
      recibosVencidos,
      pagosPorContrato,
      restriccionesVigentes,
      conveniosActivos,
      quejasAbiertas,
      quejasPeriodo,
    ] = await Promise.all([
      this.prisma.contrato.count(),
      this.prisma.contrato.count({ where: { estado: { in: ['Activo', 'activo'] } } }),
      this.prisma.contrato.count({
        where: { estado: { in: ['Activo', 'activo'] }, medidorId: { not: null } },
      }),
      this.prisma.volumenProducido.aggregate({
        where: periodo ? { periodo } : undefined,
        _sum: { m3: true },
      }),
      this.prisma.consumo.aggregate({
        where: { ...(periodo && { periodo }), confirmado: true },
        _sum: { m3: true },
        _count: true,
      }),
      this.prisma.timbrado.aggregate({
        where: periodo ? { periodo } : undefined,
        _sum: { total: true },
      }),
      this.prisma.pago.aggregate({
        where: pagoFechaWhere,
        _sum: { monto: true },
      }),
      this.prisma.recibo.count({ where: periodo ? { timbrado: { periodo } } : {} }),
      this.prisma.pago.findMany({
        where: { reciboId: { not: null }, ...pagoFechaWhere },
        distinct: ['reciboId'],
        select: { reciboId: true },
      }),
      this.prisma.pago.findMany({
        where: { timbradoId: { not: null }, ...pagoFechaWhere },
        select: { fecha: true, timbrado: { select: { fechaVencimiento: true } } },
      }),
      this.prisma.recibo.findMany({
        where: { fechaVencimiento: { lt: hoy } },
        select: { contratoId: true, saldoVigente: true, fechaVencimiento: true },
        orderBy: { fechaVencimiento: 'asc' },
      }),
      this.prisma.pago.groupBy({ by: ['contratoId'], _sum: { monto: true } }),
      this.prisma.restriccionServicio.count({ where: { estado: { in: ['programada', 'aplicada'] } } }),
      this.prisma.convenio.count({ where: { estado: 'Activo' } }),
      this.prisma.quejaAclaracion.count({ where: { estado: { notIn: ['Cerrada', 'Resuelta', 'cerrada', 'resuelta'] } } }),
      this.prisma.quejaAclaracion.count({ where: quejaPeriodoWhere }),
    ]);

    // Cartera vencida: pagos del contrato aplicados FIFO sobre los recibos
    // vencidos (el arrastre Recibo.saldoVencido NO se suma: duplicaría deuda).
    const pagadoPorContrato = new Map(
      pagosPorContrato.map((p) => [p.contratoId, Number(p._sum.monto ?? 0)]),
    );
    const recibosPorContrato = new Map<string, typeof recibosVencidos>();
    for (const r of recibosVencidos) {
      const lista = recibosPorContrato.get(r.contratoId) ?? [];
      lista.push(r);
      recibosPorContrato.set(r.contratoId, lista);
    }
    let carteraVencida = 0;
    const contratosConAdeudo = new Set<string>();
    for (const [contratoId, lista] of recibosPorContrato) {
      const { monto } = adeudoFifo(lista, pagadoPorContrato.get(contratoId) ?? 0);
      if (monto > 0.01) {
        carteraVencida += monto;
        contratosConAdeudo.add(contratoId);
      }
    }

    const volumenProducidoM3 = volumenProducido._sum.m3 ? Number(volumenProducido._sum.m3) : null;
    const volumenFacturadoM3 = r2(Number(consumosPeriodo._sum.m3 ?? 0));
    const importeFacturado = r2(Number(timbradosPeriodo._sum.total ?? 0));
    const importeRecaudado = r2(Number(pagosPeriodo._sum.monto ?? 0));

    const eficienciaFisicaPct = volumenProducidoM3 ? pct(volumenFacturadoM3, volumenProducidoM3) : null;
    const eficienciaComercialPct = pct(importeRecaudado, importeFacturado);
    const eficienciaGlobalPct =
      eficienciaFisicaPct !== null && eficienciaComercialPct !== null
        ? r2((eficienciaFisicaPct * eficienciaComercialPct) / 100)
        : null;

    // Eficiencia de cobro (IP.15) y puntualidad de pago.
    const recibosPagados = recibosPagadosRows.length;
    const pagosATiempo = pagosConVencimiento.filter(
      (p) => p.timbrado?.fechaVencimiento && p.fecha <= p.timbrado.fechaVencimiento,
    ).length;

    return {
      periodo: periodo ?? null,
      padronContratos,
      contratosActivos,
      contratosConMedidor,
      micromedicionPct: pct(contratosConMedidor, contratosActivos),
      volumenProducidoM3,
      volumenFacturadoM3,
      eficienciaFisicaPct,
      consumoPromedioPorContratoM3:
        consumosPeriodo._count > 0 ? r2(volumenFacturadoM3 / consumosPeriodo._count) : null,
      importeFacturado,
      importeRecaudado,
      eficienciaComercialPct,
      eficienciaGlobalPct,
      recibosEmitidos,
      recibosPagados,
      eficienciaCobroPct: pct(recibosPagados, recibosEmitidos),
      pagosEvaluados: pagosConVencimiento.length,
      pagosATiempo,
      pagoATiempoPct: pct(pagosATiempo, pagosConVencimiento.length),
      carteraVencida: r2(carteraVencida),
      usuariosConAdeudo: contratosConAdeudo.size,
      rezagoPctPadron: pct(contratosConAdeudo.size, contratosActivos),
      restriccionesVigentes,
      conveniosActivos,
      quejasAbiertas,
      quejasPeriodo,
      reclamacionesPor1000Tomas:
        contratosActivos > 0 ? r2((quejasPeriodo / contratosActivos) * 1000) : null,
    };
  }

  /** Serie histórica de indicadores para los últimos N periodos. */
  async serie(desde: string, hasta: string): Promise<IndicadoresPigoo[]> {
    const periodos = this.rangoPeriodos(desde, hasta);
    if (periodos.length > 24) throw new BadRequestException('Máximo 24 periodos por consulta');
    return Promise.all(periodos.map((p) => this.pigoo(p)));
  }

  /** Export CSV (compatible con la carga manual que hoy piden PIGOO/CONAGUA). */
  async csv(desde: string, hasta: string): Promise<string> {
    const serie = await this.serie(desde, hasta);
    const cols: Array<[string, (i: IndicadoresPigoo) => string | number]> = [
      ['periodo', (i) => i.periodo ?? ''],
      ['padron_contratos', (i) => i.padronContratos],
      ['contratos_activos', (i) => i.contratosActivos],
      ['micromedicion_pct', (i) => i.micromedicionPct ?? ''],
      ['volumen_producido_m3', (i) => i.volumenProducidoM3 ?? ''],
      ['volumen_facturado_m3', (i) => i.volumenFacturadoM3],
      ['eficiencia_fisica_pct', (i) => i.eficienciaFisicaPct ?? ''],
      ['importe_facturado', (i) => i.importeFacturado],
      ['importe_recaudado', (i) => i.importeRecaudado],
      ['eficiencia_comercial_pct', (i) => i.eficienciaComercialPct ?? ''],
      ['eficiencia_global_pct', (i) => i.eficienciaGlobalPct ?? ''],
      ['recibos_emitidos', (i) => i.recibosEmitidos],
      ['recibos_pagados', (i) => i.recibosPagados],
      ['eficiencia_cobro_pct', (i) => i.eficienciaCobroPct ?? ''],
      ['pagos_evaluados', (i) => i.pagosEvaluados],
      ['pagos_a_tiempo', (i) => i.pagosATiempo],
      ['pago_a_tiempo_pct', (i) => i.pagoATiempoPct ?? ''],
      ['cartera_vencida', (i) => i.carteraVencida],
      ['usuarios_con_adeudo', (i) => i.usuariosConAdeudo],
      ['rezago_pct_padron', (i) => i.rezagoPctPadron ?? ''],
      ['restricciones_vigentes', (i) => i.restriccionesVigentes],
      ['convenios_activos', (i) => i.conveniosActivos],
      ['quejas_abiertas', (i) => i.quejasAbiertas],
      ['quejas_periodo', (i) => i.quejasPeriodo],
      ['reclamaciones_por_1000_tomas', (i) => i.reclamacionesPor1000Tomas ?? ''],
    ];
    const header = cols.map(([n]) => n).join(',');
    const filas = serie.map((i) => cols.map(([, f]) => f(i)).join(','));
    return [header, ...filas].join('\n');
  }

  private rangoPeriodos(desde: string, hasta: string): string[] {
    if (!/^\d{4}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}$/.test(hasta)) {
      throw new BadRequestException('desde/hasta deben tener formato YYYY-MM');
    }
    const [y1, m1] = desde.split('-').map(Number);
    const [y2, m2] = hasta.split('-').map(Number);
    const out: string[] = [];
    let y = y1;
    let m = m1;
    while (y < y2 || (y === y2 && m <= m2)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }
}
