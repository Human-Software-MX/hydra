import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { evaluarLectura, UMBRALES_DEFAULT, UmbralesVee } from './vee-rules';

/**
 * Orquestación del pipeline VEE sobre las lecturas capturadas:
 *
 *   Validation  → analizarPeriodo() corre las reglas y llena la cola de excepciones
 *   Estimation  → la estimación por promedio ya ocurre en la carga (lecturas.service);
 *                 estimaciones_encadenadas vigila que no se vuelva permanente
 *   Editing     → corregir() edita la lectura con trazabilidad completa (el valor
 *                 original queda en datosRaw.veeOriginal y la excepción registra quién/cuándo)
 *
 * Umbrales configurables por env: VEE_FACTOR_SPIKE, VEE_FACTOR_CAIDA,
 * VEE_MIN_HISTORIAL, VEE_MAX_CEROS, VEE_MAX_ESTIMADAS.
 */
@Injectable()
export class VeeService {
  private readonly logger = new Logger(VeeService.name);

  constructor(private readonly prisma: PrismaService) {}

  private umbrales(): UmbralesVee {
    const num = (env: string | undefined, def: number) => {
      const n = env !== undefined ? Number(env) : NaN;
      return Number.isFinite(n) && n > 0 ? n : def;
    };
    return {
      factorSpike: num(process.env.VEE_FACTOR_SPIKE, UMBRALES_DEFAULT.factorSpike),
      factorCaida: num(process.env.VEE_FACTOR_CAIDA, UMBRALES_DEFAULT.factorCaida),
      minHistorial: num(process.env.VEE_MIN_HISTORIAL, UMBRALES_DEFAULT.minHistorial),
      maxCeros: num(process.env.VEE_MAX_CEROS, UMBRALES_DEFAULT.maxCeros),
      maxEstimadas: num(process.env.VEE_MAX_ESTIMADAS, UMBRALES_DEFAULT.maxEstimadas),
    };
  }

  // ─── Historial por contrato ───────────────────────────────────────────────

  private async historial(contratoId: string, periodoActual: string) {
    const previas = await this.prisma.lectura.findMany({
      where: { contratoId, periodo: { lt: periodoActual } },
      orderBy: { periodo: 'desc' },
      take: 12,
      select: { consumoReal: true, consumoEstimado: true, esEstimada: true },
    });

    const consumosPrevios = previas
      .map((l) => (l.esEstimada ? l.consumoEstimado : l.consumoReal))
      .filter((c): c is number => c !== null);

    let estimadasConsecutivasPrevias = 0;
    for (const l of previas) {
      if (l.esEstimada) estimadasConsecutivasPrevias++;
      else break;
    }

    return { consumosPrevios, estimadasConsecutivasPrevias };
  }

  // ─── Análisis (Validation) ────────────────────────────────────────────────

  /** Corre las reglas VEE sobre todas las lecturas de un periodo (idempotente). */
  async analizarPeriodo(params: { periodo: string; loteId?: string }) {
    const lecturas = await this.prisma.lectura.findMany({
      where: {
        periodo: params.periodo,
        ...(params.loteId && { loteId: params.loteId }),
        estado: { notIn: ['NoValida'] },
      },
      select: {
        id: true,
        contratoId: true,
        periodo: true,
        lecturaActual: true,
        lecturaAnterior: true,
        consumoReal: true,
        consumoEstimado: true,
        esEstimada: true,
        lecturaMinZona: true,
        lecturaMaxZona: true,
      },
    });

    const umbrales = this.umbrales();
    let nuevas = 0;
    let evaluadas = 0;
    const porRegla: Record<string, number> = {};

    for (const l of lecturas) {
      evaluadas++;
      const hist = await this.historial(l.contratoId, l.periodo);
      const excepciones = evaluarLectura(l, hist, umbrales);

      for (const e of excepciones) {
        porRegla[e.regla] = (porRegla[e.regla] ?? 0) + 1;
        // Idempotencia: una excepción por lectura+regla (unique en DB).
        const creada = await this.prisma.excepcionLectura
          .create({
            data: {
              lecturaId: l.id,
              contratoId: l.contratoId,
              periodo: l.periodo,
              regla: e.regla,
              severidad: e.severidad,
              detalle: e.detalle as any,
            },
          })
          .catch(() => null); // ya existía
        if (creada) nuevas++;
      }
    }

    this.logger.log(
      `VEE ${params.periodo}: ${evaluadas} lecturas, ${nuevas} excepciones nuevas (${JSON.stringify(porRegla)})`,
    );
    return { periodo: params.periodo, evaluadas, excepcionesNuevas: nuevas, porRegla };
  }

  // ─── Cola de excepciones ──────────────────────────────────────────────────

  async listar(params: {
    estado?: string;
    regla?: string;
    severidad?: string;
    periodo?: string;
    contratoId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const where = {
      ...(params.estado && { estado: params.estado }),
      ...(params.regla && { regla: params.regla }),
      ...(params.severidad && { severidad: params.severidad }),
      ...(params.periodo && { periodo: params.periodo }),
      ...(params.contratoId && { contratoId: params.contratoId }),
    };
    const [data, total] = await Promise.all([
      this.prisma.excepcionLectura.findMany({
        where,
        orderBy: [{ severidad: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.excepcionLectura.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async resumen(periodo?: string) {
    const where = { estado: 'pendiente', ...(periodo && { periodo }) };
    const grupos = await this.prisma.excepcionLectura.groupBy({
      by: ['regla', 'severidad'],
      where,
      _count: true,
    });
    return grupos.map((g) => ({ regla: g.regla, severidad: g.severidad, pendientes: g._count }));
  }

  // ─── Resolución (Editing) ─────────────────────────────────────────────────

  /** Acepta la lectura como válida pese a la excepción (falso positivo). */
  async aceptar(id: string, params: { resueltoPor?: string; motivo?: string }) {
    return this.cerrarExcepcion(id, 'aceptada', params.motivo ?? 'Lectura confirmada como válida', params.resueltoPor);
  }

  /** Descarta la excepción sin acción (p. ej. evento conocido: llenado de cisterna). */
  async descartar(id: string, params: { resueltoPor?: string; motivo: string }) {
    return this.cerrarExcepcion(id, 'descartada', params.motivo, params.resueltoPor);
  }

  /**
   * Edición VEE: corrige la lectura (valor de campo mal capturado). El valor
   * original se preserva en datosRaw.veeOriginal y la lectura queda en estado
   * "Corregida" con el consumo recalculado.
   */
  async corregir(
    id: string,
    params: { lecturaActual: number; resueltoPor?: string; motivo: string },
  ) {
    const exc = await this.prisma.excepcionLectura.findUnique({ where: { id } });
    if (!exc) throw new NotFoundException('Excepción no encontrada');
    if (exc.estado !== 'pendiente') throw new BadRequestException('La excepción ya fue resuelta');

    const lectura = await this.prisma.lectura.findUnique({ where: { id: exc.lecturaId } });
    if (!lectura) throw new NotFoundException('Lectura no encontrada');
    if (params.lecturaActual < 0) throw new BadRequestException('La lectura no puede ser negativa');

    const consumoReal =
      lectura.lecturaAnterior !== null ? params.lecturaActual - lectura.lecturaAnterior : null;
    if (consumoReal !== null && consumoReal < 0) {
      throw new BadRequestException('La corrección produce consumo negativo; revise la lectura anterior');
    }

    const raw = (lectura.datosRaw as Record<string, unknown> | null) ?? {};
    await this.prisma.lectura.update({
      where: { id: lectura.id },
      data: {
        lecturaActual: params.lecturaActual,
        consumoReal,
        esEstimada: false,
        estado: 'Corregida',
        datosRaw: {
          ...raw,
          veeOriginal: {
            lecturaActual: lectura.lecturaActual,
            consumoReal: lectura.consumoReal,
            estado: lectura.estado,
            corregidaEn: new Date().toISOString(),
            corregidaPor: params.resueltoPor ?? null,
          },
        } as any,
      },
    });

    return this.cerrarExcepcion(id, 'corregida', params.motivo, params.resueltoPor);
  }

  private async cerrarExcepcion(id: string, estado: string, resolucion: string, resueltoPor?: string) {
    const exc = await this.prisma.excepcionLectura.findUnique({ where: { id } });
    if (!exc) throw new NotFoundException('Excepción no encontrada');
    if (exc.estado !== 'pendiente') throw new BadRequestException('La excepción ya fue resuelta');
    return this.prisma.excepcionLectura.update({
      where: { id },
      data: { estado, resolucion, resueltoPor: resueltoPor ?? null, resueltaEn: new Date() },
    });
  }
}
