import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TarifasService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findTarifaVigente(tipoServicio: string, fechaConsulta?: string) {
    const fecha = fechaConsulta ? new Date(fechaConsulta) : new Date();
    return this.prisma.tarifa.findMany({
      where: {
        tipoServicio,
        activo: true,
        vigenciaDesde: { lte: fecha },
        OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: fecha } }],
      },
      orderBy: [{ tipoCalculo: 'asc' }, { rangoMinM3: 'asc' }],
    });
  }

  async createTarifa(dto: {
    codigo: string;
    nombre: string;
    tipoServicio: string;
    tipoCalculo: string;
    rangoMinM3?: number;
    rangoMaxM3?: number;
    precioUnitario?: number;
    cuotaFija?: number;
    ivaPct?: number;
    vigenciaDesde: string;
    vigenciaHasta?: string;
  }) {
    return this.prisma.tarifa.create({
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
  }

  async updateTarifa(id: string, dto: Partial<{
    nombre: string;
    rangoMinM3: number;
    rangoMaxM3: number;
    precioUnitario: number;
    cuotaFija: number;
    ivaPct: number;
    vigenciaHasta: string;
    activo: boolean;
  }>) {
    await this.findOneTarifa(id);
    return this.prisma.tarifa.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.rangoMinM3 !== undefined && { rangoMinM3: dto.rangoMinM3 }),
        ...(dto.rangoMaxM3 !== undefined && { rangoMaxM3: dto.rangoMaxM3 }),
        ...(dto.precioUnitario !== undefined && { precioUnitario: dto.precioUnitario }),
        ...(dto.cuotaFija !== undefined && { cuotaFija: dto.cuotaFija }),
        ...(dto.ivaPct !== undefined && { ivaPct: dto.ivaPct }),
        ...(dto.vigenciaHasta !== undefined && { vigenciaHasta: new Date(dto.vigenciaHasta) }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
      },
    });
  }

  /**
   * Calcula el monto a facturar dada la tarifa escalonada vigente para un consumo en m3.
   * Soporta: escalonado (múltiples rangos), fijo (cuota fija) y variable (precio unitario).
   */
  async calcularMonto(params: { tipoServicio: string; consumoM3: number; fecha?: string }) {
    const tarifas = await this.findTarifaVigente(params.tipoServicio, params.fecha);
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

  async findActualizaciones(estado?: string) {
    return this.prisma.actualizacionTarifaria.findMany({
      where: { ...(estado && { estado }) },
      orderBy: { fechaAplicacion: 'desc' },
    });
  }

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
