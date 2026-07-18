import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { adeudoFifo } from '../restricciones/restricciones.service';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? r2((num / den) * 100) : null);

export interface IndicadoresPigoo {
  periodo: string;
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
  // Cartera
  carteraVencida: number;
  usuariosConAdeudo: number;
  rezagoPctPadron: number | null;
  // Servicio
  restriccionesVigentes: number;
  conveniosActivos: number;
  quejasAbiertas: number;
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

  async pigoo(periodo: string): Promise<IndicadoresPigoo> {
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      throw new BadRequestException('periodo debe tener formato YYYY-MM');
    }
    const hoy = new Date().toISOString().slice(0, 10);

    const [
      padronContratos,
      contratosActivos,
      contratosConMedidor,
      volumenProducido,
      consumosPeriodo,
      timbradosPeriodo,
      pagosPeriodo,
      recibosVencidos,
      pagosPorContrato,
      restriccionesVigentes,
      conveniosActivos,
      quejasAbiertas,
    ] = await Promise.all([
      this.prisma.contrato.count(),
      this.prisma.contrato.count({ where: { estado: { in: ['Activo', 'activo'] } } }),
      this.prisma.contrato.count({
        where: { estado: { in: ['Activo', 'activo'] }, medidorId: { not: null } },
      }),
      this.prisma.volumenProducido.aggregate({ where: { periodo }, _sum: { m3: true } }),
      this.prisma.consumo.aggregate({
        where: { periodo, confirmado: true },
        _sum: { m3: true },
        _count: true,
      }),
      this.prisma.timbrado.aggregate({ where: { periodo }, _sum: { total: true } }),
      this.prisma.pago.aggregate({
        where: { fecha: { startsWith: periodo } },
        _sum: { monto: true },
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

    return {
      periodo,
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
      carteraVencida: r2(carteraVencida),
      usuariosConAdeudo: contratosConAdeudo.size,
      rezagoPctPadron: pct(contratosConAdeudo.size, contratosActivos),
      restriccionesVigentes,
      conveniosActivos,
      quejasAbiertas,
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
      ['periodo', (i) => i.periodo],
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
      ['cartera_vencida', (i) => i.carteraVencida],
      ['usuarios_con_adeudo', (i) => i.usuariosConAdeudo],
      ['rezago_pct_padron', (i) => i.rezagoPctPadron ?? ''],
      ['restricciones_vigentes', (i) => i.restriccionesVigentes],
      ['convenios_activos', (i) => i.conveniosActivos],
      ['quejas_abiertas', (i) => i.quejasAbiertas],
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
