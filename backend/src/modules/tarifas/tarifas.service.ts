import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FacturacionService } from '../facturacion/facturacion.service';
import {
  calcularFactura,
  m3Facturables,
  redondear,
  TarifaCalculo,
} from '../facturacion/billing-calculator';
import { filtrarMasEspecificas } from '../facturacion/tarifa-especificidad';
import { SimularImpactoDto, CambioTarifaSimulacionDto } from './dto/simular-impacto.dto';
import { CreateTarifaDto } from './dto/create-tarifa.dto';
import { UpdateTarifaMetadatosDto } from './dto/update-tarifa-metadatos.dto';

/** Tope de consumos evaluados por simulación para acotar tiempo/memoria. */
const MAX_CONSUMOS_SIMULACION = 5000;

@Injectable()
export class TarifasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facturacion: FacturacionService,
  ) {}

  // ─── Tarifa ───────────────────────────────────────────────────────────────

  async findAllTarifas(params: {
    tipoServicio?: string;
    tipoCalculo?: string;
    soloActivas?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      ...(params.tipoServicio && { tipoServicio: params.tipoServicio }),
      ...(params.tipoCalculo && { tipoCalculo: params.tipoCalculo }),
      ...(params.soloActivas && { activo: true }),
    };
    const [data, total] = await Promise.all([
      this.prisma.tarifa.findMany({
        where,
        orderBy: [{ tipoServicio: 'asc' }, { vigenciaDesde: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tarifa.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOneTarifa(id: string) {
    const t = await this.prisma.tarifa.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tarifa no encontrada');
    return t;
  }

  /**
   * Tarifas vigentes de un servicio para el calculo puntual.
   *
   * `tipoServicio` se compara sin distinguir mayusculas (hay llamadores y seeds
   * heredados que usan 'AGUA'). Cuando se indica administracion y/o clase se
   * aplica la MISMA especificidad que la facturacion real
   * ((admin, clase) > (admin, sin clase) > (global, clase) > (global, sin clase));
   * sin ellas devuelve todo lo vigente del servicio (comportamiento historico).
   */
  async findTarifaVigente(
    tipoServicio: string,
    fechaConsulta?: string,
    filtros?: { administracionId?: string | null; claseTarifaId?: string | null },
  ) {
    const fecha = fechaConsulta ? new Date(fechaConsulta) : new Date();
    const and: Prisma.TarifaWhereInput[] = [
      { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: fecha } }] },
    ];
    // Las tarifas sin administracion / sin clase son el fallback global.
    if (filtros?.administracionId) {
      and.push({ OR: [{ administracionId: filtros.administracionId }, { administracionId: null }] });
    }
    if (filtros?.claseTarifaId) {
      and.push({ OR: [{ claseTarifaId: filtros.claseTarifaId }, { claseTarifaId: null }] });
    }

    const tarifas = await this.prisma.tarifa.findMany({
      where: {
        tipoServicio: { equals: tipoServicio, mode: 'insensitive' },
        activo: true,
        vigenciaDesde: { lte: fecha },
        AND: and,
      },
      orderBy: [{ tipoCalculo: 'asc' }, { rangoMinM3: 'asc' }],
    });

    if (!filtros?.administracionId && !filtros?.claseTarifaId) return tarifas;
    return filtrarMasEspecificas(tarifas, {
      administracionId: filtros.administracionId,
      claseTarifaId: filtros.claseTarifaId,
    });
  }

  async createTarifa(dto: CreateTarifaDto) {
    try {
      return await this.prisma.tarifa.create({
        data: {
          codigo: dto.codigo,
          nombre: dto.nombre,
          tipoServicio: dto.tipoServicio,
          tipoCalculo: dto.tipoCalculo,
          rangoMinM3: dto.rangoMinM3 ?? null,
          rangoMaxM3: dto.rangoMaxM3 ?? null,
          precioUnitario: dto.precioUnitario ?? null,
          cuotaFija: dto.cuotaFija ?? null,
          ivaPct: dto.ivaPct ?? 16,
          vigenciaDesde: new Date(dto.vigenciaDesde),
          vigenciaHasta: dto.vigenciaHasta ? new Date(dto.vigenciaHasta) : null,
        },
      });
    } catch (error) {
      // UNIQUE (codigo, version): el linaje ya existe; sus cambios van por
      // POST /tarifas/:id/actualizar (nueva version), no por un alta nueva.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `Ya existe una tarifa con codigo ${dto.codigo}; use POST /tarifas/:id/actualizar para versionarla`,
        );
      }
      throw error;
    }
  }

  /**
   * Metadatos de la tarifa. Los valores economicos y el IVA NO se editan aqui:
   * van por `POST /tarifas/:id/actualizar`, que versiona y deja rastro en el Kardex.
   */
  async updateTarifa(id: string, dto: UpdateTarifaMetadatosDto) {
    await this.findOneTarifa(id);
    return this.prisma.tarifa.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.vigenciaHasta !== undefined && { vigenciaHasta: new Date(dto.vigenciaHasta) }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
      },
    });
  }

  /**
   * Calcula el monto a facturar dada la tarifa escalonada vigente para un consumo en m3.
   * Soporta: escalonado (múltiples rangos), fijo (cuota fija) y variable (precio unitario).
   */
  async calcularMonto(params: {
    tipoServicio: string;
    consumoM3: number;
    fecha?: string;
    administracionId?: string;
    claseTarifaId?: string;
  }) {
    const tarifas = await this.findTarifaVigente(params.tipoServicio, params.fecha, {
      administracionId: params.administracionId,
      claseTarifaId: params.claseTarifaId,
    });
    if (!tarifas.length) throw new BadRequestException('No hay tarifas vigentes para el servicio indicado');
    return this.computeMonto(tarifas, params.consumoM3);
  }

  /**
   * Cálculo puro sobre un set de tarifas ya cargado. Permite a otros módulos
   * (p. ej. prefacturas) calcular montos en lote sin una query por registro.
   */
  computeMonto(
    tarifas: Awaited<ReturnType<TarifasService['findTarifaVigente']>>,
    consumoM3: number,
  ) {
    let subtotal = 0;
    const desglose: Array<{ rango: string; m3: number; precio: number; subtotal: number }> = [];

    for (const t of tarifas) {
      if (t.tipoCalculo === 'fijo') {
        subtotal += Number(t.cuotaFija ?? 0);
        desglose.push({ rango: 'fijo', m3: 0, precio: Number(t.cuotaFija ?? 0), subtotal: Number(t.cuotaFija ?? 0) });
        continue;
      }
      if (t.tipoCalculo === 'escalonado' || t.tipoCalculo === 'variable') {
        const min = t.rangoMinM3 ?? 0;
        const max = t.rangoMaxM3 ?? Infinity;
        if (consumoM3 > min) {
          const m3EnRango = Math.min(consumoM3, max) - min;
          const sub = m3EnRango * Number(t.precioUnitario ?? 0);
          subtotal += sub;
          desglose.push({
            rango: `${min}-${max === Infinity ? '∞' : max} m3`,
            m3: m3EnRango,
            precio: Number(t.precioUnitario ?? 0),
            subtotal: sub,
          });
        }
        continue;
      }
      if (t.tipoCalculo === 'tabla') {
        // Mismo criterio que billing-calculator: m³ redondeados (fracción > 0.5 sube),
        // importe acumulado de la tabla y, por encima del tope, cuota + unitario × m³.
        const precios = Array.isArray(t.precios) ? (t.precios as unknown[]).map((p) => Number(p)) : null;
        const m3 = Math.max(0, m3Facturables(consumoM3));
        const tope = t.rangoMaxM3 ?? (precios?.length ? precios.length - 1 : 0);
        const sub =
          precios?.length && m3 <= tope
            ? Number(precios[Math.min(m3, precios.length - 1)] ?? 0)
            : Number(t.cuotaFija ?? 0) + Number(t.precioUnitario ?? 0) * m3;
        subtotal += sub;
        desglose.push({ rango: `tabla ${m3} m3`, m3, precio: m3 > 0 ? sub / m3 : sub, subtotal: sub });
        continue;
      }
      if (t.tipoCalculo === 'lineal') {
        const sub = Number(t.cuotaFija ?? 0) + Number(t.precioUnitario ?? 0) * consumoM3;
        subtotal += sub;
        desglose.push({
          rango: 'lineal',
          m3: consumoM3,
          precio: Number(t.precioUnitario ?? 0),
          subtotal: sub,
        });
      }
    }

    const ivaPct = Number(tarifas[0]?.ivaPct ?? 16) / 100;
    const iva = subtotal * ivaPct;
    return { consumoM3, subtotal, iva, total: subtotal + iva, desglose };
  }

  // ─── Corrección Tarifaria ─────────────────────────────────────────────────

  async findCorrecciones(tarifaId?: string) {
    return this.prisma.correccionTarifaria.findMany({
      where: {
        activo: true,
        ...(tarifaId && { tarifaId }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCorreccion(dto: {
    tarifaId: string;
    tipo: string;
    descripcion: string;
    formula?: string;
    porcentaje?: number;
    montoFijo?: number;
    condiciones?: object;
  }) {
    return this.prisma.correccionTarifaria.create({
      data: {
        tarifaId: dto.tarifaId,
        tipo: dto.tipo,
        descripcion: dto.descripcion,
        formula: dto.formula ?? null,
        porcentaje: dto.porcentaje ?? null,
        montoFijo: dto.montoFijo ?? null,
        condiciones: dto.condiciones ?? Prisma.DbNull,
      },
    });
  }

  async updateCorreccion(id: string, dto: Partial<{ descripcion: string; activo: boolean; porcentaje: number; montoFijo: number }>) {
    return this.prisma.correccionTarifaria.update({ where: { id }, data: dto });
  }

  // ─── Ajuste Manual ────────────────────────────────────────────────────────

  async findAjustes(contratoId?: string) {
    return this.prisma.ajusteTarifario.findMany({
      where: { ...(contratoId && { contratoId }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAjuste(dto: {
    contratoId: string;
    periodo: string;
    tipo: string;
    concepto: string;
    montoOriginal: number;
    montoAjustado: number;
    motivo: string;
    aprobadoPor?: string;
  }) {
    return this.prisma.ajusteTarifario.create({
      data: {
        contratoId: dto.contratoId,
        periodo: dto.periodo,
        tipo: dto.tipo,
        concepto: dto.concepto,
        montoOriginal: dto.montoOriginal,
        montoAjustado: dto.montoAjustado,
        motivo: dto.motivo,
        aprobadoPor: dto.aprobadoPor ?? null,
      },
    });
  }

  // ─── Actualización Tarifaria (trimestral) ─────────────────────────────────

  async createActualizacion(dto: {
    descripcion: string;
    fechaPublicacion: string;
    fechaAplicacion: string;
    fuenteOficial?: string;
    tarifasAfectadas?: object;
  }) {
    return this.prisma.actualizacionTarifaria.create({
      data: {
        descripcion: dto.descripcion,
        fechaPublicacion: new Date(dto.fechaPublicacion),
        fechaAplicacion: new Date(dto.fechaAplicacion),
        fuenteOficial: dto.fuenteOficial ?? null,
        tarifasAfectadas: dto.tarifasAfectadas ?? Prisma.DbNull,
        estado: 'pendiente',
      },
    });
  }

  // ─── Simulador de impacto tarifario ───────────────────────────────────────

  /**
   * Simula el impacto de un cambio tarifario re-facturando (en memoria, sin
   * escribir nada) los consumos confirmados de un periodo base con las tarifas
   * vigentes y con las tarifas propuestas, y compara ambos escenarios.
   */
  async simularImpacto(dto: SimularImpactoDto) {
    for (const cambio of dto.cambios) {
      if (cambio.factorAjuste == null && !cambio.tarifasNuevas?.length) {
        throw new BadRequestException(
          `El cambio para "${cambio.tipoServicio}" debe indicar factorAjuste o tarifasNuevas`,
        );
      }
      if (cambio.factorAjuste != null && cambio.tarifasNuevas?.length) {
        throw new BadRequestException(
          `El cambio para "${cambio.tipoServicio}" debe indicar factorAjuste O tarifasNuevas, no ambos`,
        );
      }
    }

    const where: Prisma.ConsumoWhereInput = {
      periodo: dto.periodoBase,
      confirmado: true,
      ...(dto.administracionId && {
        contrato: { zona: { administracionId: dto.administracionId } },
      }),
    };

    const totalConsumos = await this.prisma.consumo.count({ where });
    if (totalConsumos === 0) {
      throw new BadRequestException(
        `No hay consumos confirmados para el periodo ${dto.periodoBase}` +
          (dto.administracionId ? ' en la administración indicada' : ''),
      );
    }

    const consumos = await this.prisma.consumo.findMany({
      where,
      take: MAX_CONSUMOS_SIMULACION,
      orderBy: { createdAt: 'asc' },
      include: {
        contrato: {
          select: {
            id: true,
            nombre: true,
            zonaId: true,
            tipoContratacion: { select: { claseTarifaId: true } },
          },
        },
      },
    });

    const advertencias: string[] = [];
    if (totalConsumos > MAX_CONSUMOS_SIMULACION) {
      advertencias.push(
        `El periodo tiene ${totalConsumos} consumos confirmados; la simulación se limitó a los primeros ` +
          `${MAX_CONSUMOS_SIMULACION}. Acote con administracionId para una muestra representativa por zona.`,
      );
    }

    // Resolución zona → administración en bloque (las tarifas dependen de la administración).
    const zonaIds = [...new Set(consumos.map((c) => c.contrato.zonaId).filter((z): z is string => !!z))];
    const zonas = await this.prisma.zona.findMany({
      where: { id: { in: zonaIds } },
      select: { id: true, administracionId: true },
    });
    const adminPorZona = new Map(zonas.map((z) => [z.id, z.administracionId]));

    // Fecha de referencia para tarifas vigentes: último día del periodo base.
    const [y, m] = dto.periodoBase.split('-').map((n) => parseInt(n, 10));
    const fecha = new Date(y, m, 0);

    // Cache de tarifas (actuales y propuestas) por administración + clase tarifaria.
    const cacheTarifas = new Map<
      string,
      { actuales: Record<string, TarifaCalculo[]>; propuestas: Record<string, TarifaCalculo[]> }
    >();
    const tarifasDe = async (administracionId: string | null, claseTarifaId: string | null) => {
      const key = `${administracionId ?? '__global__'}|${claseTarifaId ?? '__sinClase__'}`;
      let entry = cacheTarifas.get(key);
      if (!entry) {
        const actuales = await this.facturacion.tarifasVigentesPorServicio(
          fecha,
          administracionId,
          claseTarifaId,
        );
        entry = { actuales, propuestas: this.aplicarCambios(actuales, dto.cambios, advertencias) };
        cacheTarifas.set(key, entry);
      }
      return entry;
    };

    // Escenarios por consumo, agregados por contrato y por tipo de servicio.
    const porContrato = new Map<
      string,
      { contratoId: string; contrato: string; importeActual: number; importePropuesto: number }
    >();
    const porServicio = new Map<string, { importeActual: number; importePropuesto: number }>();
    let sinTarifa = 0;

    for (const c of consumos) {
      const administracionId = c.contrato.zonaId ? adminPorZona.get(c.contrato.zonaId) ?? null : null;
      const { actuales, propuestas } = await tarifasDe(
        administracionId,
        c.contrato.tipoContratacion?.claseTarifaId ?? null,
      );
      if (!Object.keys(actuales).length) {
        sinTarifa++;
        continue;
      }

      const consumoM3 = Number(c.m3);
      const actual = calcularFactura({ consumoM3, tarifasPorServicio: actuales });
      const propuesto = calcularFactura({ consumoM3, tarifasPorServicio: propuestas });

      const acc = porContrato.get(c.contratoId) ?? {
        contratoId: c.contratoId,
        contrato: c.contrato.nombre,
        importeActual: 0,
        importePropuesto: 0,
      };
      acc.importeActual = redondear(acc.importeActual + actual.total);
      acc.importePropuesto = redondear(acc.importePropuesto + propuesto.total);
      porContrato.set(c.contratoId, acc);

      for (const [lineas, campo] of [
        [actual.lineas, 'importeActual'],
        [propuesto.lineas, 'importePropuesto'],
      ] as const) {
        for (const l of lineas) {
          const s = porServicio.get(l.tipoServicio) ?? { importeActual: 0, importePropuesto: 0 };
          s[campo] = redondear(s[campo] + l.importe + l.iva);
          porServicio.set(l.tipoServicio, s);
        }
      }
    }

    if (sinTarifa > 0) {
      advertencias.push(`${sinTarifa} consumo(s) omitidos por no tener tarifas vigentes en el periodo base.`);
    }

    const contratos = [...porContrato.values()].map((c) => ({
      ...c,
      deltaMonto: redondear(c.importePropuesto - c.importeActual),
      deltaPct:
        c.importeActual > 0
          ? redondear(((c.importePropuesto - c.importeActual) / c.importeActual) * 100)
          : null,
    }));

    const importeTotalActual = redondear(contratos.reduce((s, c) => s + c.importeActual, 0));
    const importeTotalPropuesto = redondear(contratos.reduce((s, c) => s + c.importePropuesto, 0));
    const deltaMontos = contratos.map((c) => c.deltaMonto);
    const deltaPcts = contratos.filter((c) => c.deltaPct !== null).map((c) => c.deltaPct as number);

    return {
      periodoBase: dto.periodoBase,
      administracionId: dto.administracionId ?? null,
      consumosEvaluados: consumos.length - sinTarifa,
      consumosTotales: totalConsumos,
      contratosEvaluados: contratos.length,
      cambios: dto.cambios,
      resumen: {
        importeTotalActual,
        importeTotalPropuesto,
        deltaMonto: redondear(importeTotalPropuesto - importeTotalActual),
        deltaPctGlobal:
          importeTotalActual > 0
            ? redondear(((importeTotalPropuesto - importeTotalActual) / importeTotalActual) * 100)
            : null,
      },
      distribucionImpacto: {
        deltaMonto: this.percentiles(deltaMontos),
        deltaPct: this.percentiles(deltaPcts),
      },
      topImpactados: [...contratos]
        .sort((a, b) => Math.abs(b.deltaMonto) - Math.abs(a.deltaMonto))
        .slice(0, 20),
      desglosePorServicio: [...porServicio.entries()].map(([tipoServicio, s]) => ({
        tipoServicio,
        importeActual: s.importeActual,
        importePropuesto: s.importePropuesto,
        deltaMonto: redondear(s.importePropuesto - s.importeActual),
        deltaPct:
          s.importeActual > 0
            ? redondear(((s.importePropuesto - s.importeActual) / s.importeActual) * 100)
            : null,
      })),
      advertencias,
    };
  }

  /** Construye el escenario propuesto aplicando factorAjuste o tarifasNuevas por tipoServicio. */
  private aplicarCambios(
    actuales: Record<string, TarifaCalculo[]>,
    cambios: CambioTarifaSimulacionDto[],
    advertencias: string[],
  ): Record<string, TarifaCalculo[]> {
    const propuestas: Record<string, TarifaCalculo[]> = {};
    for (const [servicio, lineas] of Object.entries(actuales)) {
      propuestas[servicio] = lineas.map((l) => ({ ...l }));
    }

    for (const cambio of cambios) {
      if (cambio.tarifasNuevas?.length) {
        propuestas[cambio.tipoServicio] = cambio.tarifasNuevas.map((t) => ({
          tipoServicio: cambio.tipoServicio,
          tipoCalculo: t.tipoCalculo,
          rangoMinM3: t.rangoMinM3 ?? null,
          rangoMaxM3: t.rangoMaxM3 ?? null,
          precioUnitario: t.precioUnitario ?? null,
          cuotaFija: t.cuotaFija ?? null,
          ivaPct: t.ivaPct ?? 16,
        }));
        continue;
      }
      const factor = cambio.factorAjuste!;
      const lineas = propuestas[cambio.tipoServicio];
      if (!lineas?.length) {
        const aviso = `El servicio "${cambio.tipoServicio}" no tiene tarifas vigentes; el factorAjuste no tuvo efecto.`;
        if (!advertencias.includes(aviso)) advertencias.push(aviso);
        continue;
      }
      propuestas[cambio.tipoServicio] = lineas.map((l) => ({
        ...l,
        precioUnitario: l.precioUnitario == null ? null : l.precioUnitario * factor,
        cuotaFija: l.cuotaFija == null ? null : l.cuotaFija * factor,
      }));
    }

    return propuestas;
  }

  private percentiles(valores: number[]): { p50: number | null; p90: number | null; max: number | null } {
    if (!valores.length) return { p50: null, p90: null, max: null };
    const orden = [...valores].sort((a, b) => a - b);
    const at = (p: number) => orden[Math.min(orden.length - 1, Math.max(0, Math.ceil((p / 100) * orden.length) - 1))];
    return { p50: at(50), p90: at(90), max: orden[orden.length - 1] };
  }

  // ─── Actualización tarifaria: aplicar ─────────────────────────────────────

  async aplicarActualizacion(id: string, aplicadoPor: string) {
    const act = await this.prisma.actualizacionTarifaria.findUnique({ where: { id } });
    if (!act) throw new NotFoundException('Actualización no encontrada');
    if (act.estado !== 'pendiente') throw new BadRequestException('Solo se pueden aplicar actualizaciones pendientes');
    return this.prisma.actualizacionTarifaria.update({
      where: { id },
      data: { estado: 'aplicada', aplicadoPor },
    });
  }
}
