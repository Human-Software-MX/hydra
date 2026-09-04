import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ActualizacionTarifariaDto,
  CategoriaTarifaDto,
  ClaseTarifaDto,
  CotizacionContratacionDto,
  FiltroTarifas,
  KardexDto,
  mapaAdministraciones,
  TarifaMovimientoDto,
  TarifaVigenteDto,
  toActualizacionDto,
  toCategoriaDto,
  toClaseDto,
  toMovimientoDto,
  toTarifaDto,
} from './tarifa-dto';
import {
  aplicarPorcentaje,
  cierreVigenciaAnterior,
  normalizarVigencia,
  redondear2,
  redondear4,
  SECCION_CONTRATACION,
  SECCION_PERIODICA,
  snapshotValores,
  TIPOS_MOVIMIENTO,
  TipoMovimiento,
  ValoresTarifa,
  valorReferencia,
} from './tarifa-valores';
import {
  calcularServicio,
  cantidadIncluidaDe,
  redondear,
  TarifaCalculo,
  tasaIva,
} from '../facturacion/billing-calculator';
import { filtrarMasEspecificas } from '../facturacion/tarifa-especificidad';
import { ActualizarTarifaDto } from './dto/actualizar-tarifa.dto';
import { AplicarMasivaDto, PreviewMasivaDto } from './dto/actualizacion-masiva.dto';
import { UpdateCategoriaTarifaDto, UpdateClaseTarifaDto } from './dto/catalogo-fiscal.dto';

/** Límites de cordura del ajuste porcentual masivo. */
const PORCENTAJE_MIN = -90;
const PORCENTAJE_MAX = 500;

/** Los lotes masivos pueden tocar cientos de linajes en una sola transacción. */
const TIMEOUT_TX_MS = 120_000;

const INCLUDE_CLASE = { claseTarifa: { include: { categoria: true } } };
/**
 * Los listados y el Kardex NO arrastran `precios` (una tabla son ~201 numeros por
 * fila y hay cientos de linajes): sólo lo cargan el detalle, el preview y el
 * versionado, que sí necesitan el valor.
 */
const SIN_PRECIOS = { precios: true } as const;
const INCLUDE_MOVIMIENTO = { tarifa: { include: { claseTarifa: true }, omit: SIN_PRECIOS } };

/** Usuario que firma la operación (del JWT: `userId ?? sub`, `email`). */
export interface UsuarioCtx {
  usuarioId?: string | null;
  usuarioEmail?: string | null;
}

/** Cambios que dan origen a una nueva versión de tarifa. */
export interface CambiosVersion {
  porcentaje?: number | null;
  cuotaFija?: number;
  precioUnitario?: number;
  precios?: number[];
  ivaPct?: number;
  /** Tratamiento «No objeto de IVA»: si es `true` fuerza `ivaPct = 0`. */
  ivaNoObjeto?: boolean;
  vigenciaDesde?: string | Date | null;
  motivo: string;
  /** Si se omite se deduce a partir de los cambios. */
  tipo?: TipoMovimiento;
  actualizacionId?: string;
}

/** Cliente Prisma o cliente de transacción (las escrituras se anidan en la misma tx). */
type ClientePrisma = Prisma.TransactionClient;

/**
 * Versionado de tarifas (Kardex), ajustes masivos y configurador fiscal.
 *
 * Vive aparte de `TarifasService` (cálculo y catálogos legados) porque toda esta
 * superficie comparte una sola invariante: **una tarifa nunca se edita en sitio**;
 * cada cambio de valor o de IVA crea una versión nueva del linaje (`codigo`) y su
 * movimiento en el Kardex. Contrato: `docs/tarifas-kardex-api.md`.
 */
@Injectable()
export class TarifaVersionesService {
  private readonly logger = new Logger(TarifaVersionesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Consultas ────────────────────────────────────────────────────────────

  /** Tarifas vigentes a una fecha (default hoy) con la clasificación resuelta. */
  async listarVigentes(filtro: FiltroTarifas, fecha?: string): Promise<TarifaVigenteDto[]> {
    const ref = fecha ? this.vigencia(fecha) : new Date();
    const [tarifas, admins] = await Promise.all([
      this.prisma.tarifa.findMany({
        where: this.whereVigentes(filtro, ref),
        include: INCLUDE_CLASE,
        omit: SIN_PRECIOS,
        orderBy: [{ tipoServicio: 'asc' }, { nombre: 'asc' }, { rangoMinM3: 'asc' }],
      }),
      this.nombresAdministracion(),
    ]);
    return tarifas.map((t) =>
      toTarifaDto(t, { administracionNombre: this.nombreAdmin(admins, t.administracionId) }),
    );
  }

  /** Servicios/conceptos distintos presentes entre las tarifas vigentes hoy, por catálogo. */
  async listarServicios(
    filtro: FiltroTarifas = {},
  ): Promise<Array<{ tipoServicio: string; concepto: string | null; seccion: string; total: number }>> {
    const filas = await this.prisma.tarifa.groupBy({
      by: ['tipoServicio', 'concepto', 'seccion'],
      where: this.whereVigentes(filtro, new Date()),
      _count: { _all: true },
    });
    return filas
      .map((f) => ({
        tipoServicio: f.tipoServicio,
        concepto: f.concepto,
        seccion: f.seccion,
        total: f._count._all,
      }))
      .sort(
        (a, b) =>
          a.tipoServicio.localeCompare(b.tipoServicio) ||
          (a.concepto ?? '').localeCompare(b.concepto ?? '') ||
          a.seccion.localeCompare(b.seccion),
      );
  }

  // ─── Cotización de cargos de contratación ─────────────────────────────────

  /**
   * `GET /tarifas/contratacion/cotizar` — resuelve la tarifa de contratación
   * vigente hoy para (administración, servicio[, clase][, variante]) y calcula
   * el cargo único para `cantidad` unidades.
   *
   * Usa la MISMA preferencia por especificidad que la facturación periódica
   * ((admin, clase) > (admin, sin clase) > (global, clase) > (global, sin clase))
   * y el mismo motor de cálculo: la cotización que ve el cliente y el cargo que
   * se factura al contratar no pueden diferir. No escribe nada.
   */
  async cotizarContratacion(params: {
    administracionId: string;
    tipoServicio: string;
    claseTarifaId?: string;
    variante?: string;
    cantidad?: number;
  }): Promise<CotizacionContratacionDto> {
    const fecha = new Date();
    const cantidad = params.cantidad ?? 0;
    const and: Prisma.TarifaWhereInput[] = [
      { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: fecha } }] },
      // Las tarifas sin administración son el fallback global.
      { OR: [{ administracionId: params.administracionId }, { administracionId: null }] },
    ];
    if (params.claseTarifaId) {
      and.push({ OR: [{ claseTarifaId: params.claseTarifaId }, { claseTarifaId: null }] });
    }

    const todas = await this.prisma.tarifa.findMany({
      where: {
        seccion: SECCION_CONTRATACION,
        activo: true,
        tipoServicio: { equals: params.tipoServicio, mode: 'insensitive' },
        vigenciaDesde: { lte: fecha },
        AND: and,
      },
      include: INCLUDE_CLASE,
      omit: SIN_PRECIOS,
      // La versión vigente más reciente del linaje primero.
      orderBy: [{ vigenciaDesde: 'desc' }, { version: 'desc' }],
    });
    // La variante se compara sin acentos ni mayúsculas: el Excel origen mezcla
    // «TERRACERÍA» y «TERRACERIA» y el cliente no debe adivinar la grafía exacta.
    const candidatas = params.variante
      ? todas.filter((t) => normalizarVariante(t.variante) === normalizarVariante(params.variante))
      : todas;
    const [tarifa] = filtrarMasEspecificas(candidatas, {
      administracionId: params.administracionId,
      claseTarifaId: params.claseTarifaId ?? null,
    });
    if (!tarifa) {
      throw new NotFoundException(
        `No hay tarifa de contratación vigente para ${params.tipoServicio}` +
          ` (administración ${params.administracionId}` +
          `${params.claseTarifaId ? `, clase ${params.claseTarifaId}` : ''}` +
          `${params.variante ? `, variante ${params.variante}` : ''})`,
      );
    }

    const calculo: TarifaCalculo = {
      tipoServicio: tarifa.tipoServicio,
      tipoCalculo: tarifa.tipoCalculo,
      rangoMinM3: tarifa.rangoMinM3,
      rangoMaxM3: tarifa.rangoMaxM3,
      precioUnitario: tarifa.precioUnitario === null ? null : Number(tarifa.precioUnitario),
      cuotaFija: tarifa.cuotaFija === null ? null : Number(tarifa.cuotaFija),
      cantidadIncluida: cantidadIncluidaDe(tarifa.parametros),
      ivaNoObjeto: tarifa.ivaNoObjeto,
      ivaPct: Number(tarifa.ivaPct ?? 0),
    };
    const lineas = calcularServicio(tarifa.tipoServicio, [calculo], cantidad);
    const importe = redondear(lineas.reduce((acc, l) => acc + l.importe, 0));
    const iva = redondear(lineas.reduce((acc, l) => acc + l.iva, 0));
    const admins = await this.nombresAdministracion();

    return {
      tarifa: toTarifaDto(tarifa, {
        administracionNombre: this.nombreAdmin(admins, tarifa.administracionId),
      }),
      cantidad,
      importe,
      ivaPct: tasaIva(calculo),
      iva,
      total: redondear(importe + iva),
      ivaNoObjeto: tarifa.ivaNoObjeto,
    };
  }

  /** Kardex paginado (todos los linajes o uno solo). */
  async listarMovimientos(params: {
    codigo?: string;
    actualizacionId?: string;
    tipo?: string;
    seccion?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: TarifaMovimientoDto[]; total: number; page: number; limit: number }> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 50;
    const where: Prisma.TarifaMovimientoWhereInput = {
      ...(params.codigo && { codigo: params.codigo }),
      ...(params.actualizacionId && { actualizacionId: params.actualizacionId }),
      ...(params.tipo && { tipo: params.tipo }),
      // El Kardex de un catálogo: la sección vive en la tarifa, no en el movimiento.
      ...(params.seccion && { tarifa: { seccion: params.seccion } }),
    };
    const [movimientos, total, admins] = await Promise.all([
      this.prisma.tarifaMovimiento.findMany({
        where,
        include: INCLUDE_MOVIMIENTO,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tarifaMovimiento.count({ where }),
      this.nombresAdministracion(),
    ]);
    return {
      data: movimientos.map((m) => toMovimientoDto(m, this.nombreAdmin(admins, m.tarifa.administracionId))),
      total,
      page,
      limit,
    };
  }

  /** Detalle de una versión concreta (incluye la tabla de precios). */
  async getTarifaDetalle(id: string): Promise<TarifaVigenteDto> {
    const tarifa = await this.prisma.tarifa.findUnique({ where: { id }, include: INCLUDE_CLASE });
    if (!tarifa) throw new NotFoundException('Tarifa no encontrada');
    const admins = await this.nombresAdministracion();
    return toTarifaDto(tarifa, {
      administracionNombre: this.nombreAdmin(admins, tarifa.administracionId),
      incluirPrecios: true,
    });
  }

  /** Historia completa del linaje al que pertenece la tarifa indicada. */
  async getKardex(tarifaId: string): Promise<KardexDto> {
    const tarifa = await this.prisma.tarifa.findUnique({ where: { id: tarifaId }, select: { codigo: true } });
    if (!tarifa) throw new NotFoundException('Tarifa no encontrada');
    const [versiones, movimientos, admins] = await Promise.all([
      this.prisma.tarifa.findMany({
        where: { codigo: tarifa.codigo },
        include: INCLUDE_CLASE,
        omit: SIN_PRECIOS,
        orderBy: { version: 'desc' },
      }),
      this.prisma.tarifaMovimiento.findMany({
        where: { codigo: tarifa.codigo },
        include: INCLUDE_MOVIMIENTO,
        orderBy: { createdAt: 'desc' },
      }),
      this.nombresAdministracion(),
    ]);

    const hoy = Date.now();
    const vigente = versiones.find(
      (v) =>
        v.activo &&
        v.vigenciaDesde.getTime() <= hoy &&
        (v.vigenciaHasta === null || v.vigenciaHasta.getTime() >= hoy),
    );

    return {
      codigo: tarifa.codigo,
      tarifaVigente: vigente
        ? toTarifaDto(vigente, { administracionNombre: this.nombreAdmin(admins, vigente.administracionId) })
        : null,
      versiones: versiones.map((v) =>
        toTarifaDto(v, { administracionNombre: this.nombreAdmin(admins, v.administracionId) }),
      ),
      movimientos: movimientos.map((m) =>
        toMovimientoDto(m, this.nombreAdmin(admins, m.tarifa.administracionId)),
      ),
    };
  }

  /** Lotes de actualización tarifaria (cabeceras). */
  async listarActualizaciones(estado?: string): Promise<ActualizacionTarifariaDto[]> {
    const filas = await this.prisma.actualizacionTarifaria.findMany({
      where: { ...(estado && { estado }) },
      orderBy: [{ fechaAplicacion: 'desc' }, { createdAt: 'desc' }],
    });
    return filas.map((a) => toActualizacionDto(a));
  }

  /** Lote con el detalle de los movimientos que generó. */
  async getActualizacion(id: string): Promise<ActualizacionTarifariaDto> {
    const actualizacion = await this.prisma.actualizacionTarifaria.findUnique({ where: { id } });
    if (!actualizacion) throw new NotFoundException('Actualización no encontrada');
    const [movimientos, admins] = await Promise.all([
      this.prisma.tarifaMovimiento.findMany({
        where: { actualizacionId: id },
        include: INCLUDE_MOVIMIENTO,
        orderBy: { createdAt: 'asc' },
      }),
      this.nombresAdministracion(),
    ]);
    return toActualizacionDto(
      actualizacion,
      movimientos.map((m) => toMovimientoDto(m, this.nombreAdmin(admins, m.tarifa.administracionId))),
    );
  }

  // ─── Versionado ───────────────────────────────────────────────────────────

  /**
   * Crea la siguiente versión del linaje de `tarifaActualId`: cierra la vigencia
   * de la versión actual 1 ms antes del inicio de la nueva, crea la nueva versión,
   * registra el movimiento del Kardex y re-apunta las correcciones activas.
   *
   * Si se recibe `tx` se ejecuta dentro de esa transacción (lotes masivos y
   * cambios fiscales que tocan muchos linajes a la vez).
   */
  async crearVersion(
    tarifaActualId: string,
    cambios: CambiosVersion,
    ctx: UsuarioCtx,
    tx?: ClientePrisma,
  ) {
    if (tx) return this.crearVersionEnTx(tx, tarifaActualId, cambios, ctx);
    return this.prisma.$transaction((t) => this.crearVersionEnTx(t, tarifaActualId, cambios, ctx));
  }

  private async crearVersionEnTx(
    tx: ClientePrisma,
    tarifaActualId: string,
    cambios: CambiosVersion,
    ctx: UsuarioCtx,
  ) {
    const actual = await tx.tarifa.findUnique({ where: { id: tarifaActualId }, include: INCLUDE_CLASE });
    if (!actual) throw new NotFoundException('Tarifa no encontrada');

    // Regla 1: sólo se versiona la última versión del linaje.
    const posterior = await tx.tarifa.findFirst({
      where: { codigo: actual.codigo, version: { gt: actual.version } },
      select: { version: true },
      orderBy: { version: 'desc' },
    });
    if (posterior) {
      throw new ConflictException(
        `La tarifa ${actual.codigo} ya tiene la versión ${posterior.version}; actualice la última versión del linaje`,
      );
    }

    // Regla 2: la nueva vigencia no puede ser anterior al inicio de la versión actual.
    const vigenciaDesde = this.vigencia(cambios.vigenciaDesde);
    if (vigenciaDesde.getTime() < actual.vigenciaDesde.getTime()) {
      throw new BadRequestException(
        `vigenciaDesde (${vigenciaDesde.toISOString().slice(0, 10)}) es anterior al inicio de la versión ` +
          `${actual.version} (${actual.vigenciaDesde.toISOString().slice(0, 10)})`,
      );
    }

    const anteriores = snapshotValores(actual);
    const nuevos = this.aplicarCambios(anteriores, cambios);
    const tipo = cambios.tipo ?? this.deducirTipo(cambios, anteriores, nuevos);

    try {
      // Regla 3: cerrar → crear → registrar → re-apuntar correcciones.
      await tx.tarifa.update({
        where: { id: actual.id },
        data: { vigenciaHasta: cierreVigenciaAnterior(vigenciaDesde) },
      });

      const nueva = await tx.tarifa.create({
        data: {
          codigo: actual.codigo,
          nombre: actual.nombre,
          tipoServicio: actual.tipoServicio,
          tipoCalculo: nuevos.tipoCalculo,
          administracionId: actual.administracionId,
          tipoContratacionCodigo: actual.tipoContratacionCodigo,
          claseTarifaId: actual.claseTarifaId,
          concepto: actual.concepto,
          // Clasificación y parámetros del concepto: son propiedades del linaje,
          // no valores económicos, así que se arrastran a cada nueva versión.
          seccion: actual.seccion,
          variante: actual.variante,
          parametros: actual.parametros ?? Prisma.DbNull,
          ivaNoObjeto: cambios.ivaNoObjeto ?? actual.ivaNoObjeto,
          rangoMinM3: nuevos.rangoMinM3,
          rangoMaxM3: nuevos.rangoMaxM3,
          cuotaFija: nuevos.cuotaFija,
          precioUnitario: nuevos.precioUnitario,
          precios: nuevos.precios ?? Prisma.DbNull,
          valorReferencia: valorReferencia(nuevos),
          ivaPct: nuevos.ivaPct,
          vigenciaDesde,
          vigenciaHasta: null,
          activo: true,
          version: actual.version + 1,
          tarifaAnteriorId: actual.id,
          motivo: cambios.motivo,
          creadoPor: ctx.usuarioEmail ?? ctx.usuarioId ?? null,
        },
        include: INCLUDE_CLASE,
      });

      const movimiento = await tx.tarifaMovimiento.create({
        data: {
          codigo: actual.codigo,
          tarifaId: nueva.id,
          tarifaAnteriorId: actual.id,
          tipo,
          porcentaje: cambios.porcentaje ?? null,
          valoresAnteriores: anteriores as unknown as Prisma.InputJsonValue,
          valoresNuevos: nuevos as unknown as Prisma.InputJsonValue,
          vigenciaDesde,
          motivo: cambios.motivo,
          actualizacionId: cambios.actualizacionId ?? null,
          usuarioId: ctx.usuarioId ?? null,
          usuarioEmail: ctx.usuarioEmail ?? null,
        },
        include: INCLUDE_MOVIMIENTO,
      });

      // Las correcciones (descuentos, recargos) siguen a la versión vigente.
      await tx.correccionTarifaria.updateMany({
        where: { tarifaId: actual.id, activo: true },
        data: { tarifaId: nueva.id },
      });

      return { tarifa: nueva, movimiento };
    } catch (error) {
      // UNIQUE (codigo, version) / (tarifa_anterior_id): otra operación versionó
      // el mismo linaje entre la lectura y la escritura de esta transacción.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `Versionado concurrente del linaje ${actual.codigo}: otra operación creó la versión ` +
          `${actual.version + 1}. Recargue la tarifa y reintente sobre la última versión`,
        );
      }
      throw error;
    }
  }

  /** `POST /tarifas/:id/actualizar` — versión manual (valores, porcentaje o IVA). */
  async actualizarTarifa(
    id: string,
    dto: ActualizarTarifaDto,
    ctx: UsuarioCtx,
  ): Promise<{ tarifa: TarifaVigenteDto; movimiento: TarifaMovimientoDto }> {
    const tieneValores =
      dto.cuotaFija !== undefined || dto.precioUnitario !== undefined || dto.precios !== undefined;
    if (dto.porcentaje != null && tieneValores) {
      throw new BadRequestException('Indique porcentaje O valores directos (cuotaFija/precioUnitario/precios), no ambos');
    }
    if (dto.porcentaje == null && !tieneValores && dto.ivaPct === undefined && dto.ivaNoObjeto === undefined) {
      throw new BadRequestException(
        'No hay cambios: indique porcentaje, valores directos, ivaPct o ivaNoObjeto',
      );
    }
    if (dto.porcentaje != null) this.validarPorcentaje(dto.porcentaje);

    const { tarifa, movimiento } = await this.crearVersion(
      id,
      {
        porcentaje: dto.porcentaje ?? null,
        cuotaFija: dto.cuotaFija,
        precioUnitario: dto.precioUnitario,
        precios: dto.precios,
        ivaPct: dto.ivaPct,
        ivaNoObjeto: dto.ivaNoObjeto,
        vigenciaDesde: dto.vigenciaDesde,
        motivo: dto.motivo,
      },
      ctx,
    );

    const admins = await this.nombresAdministracion();
    return {
      tarifa: toTarifaDto(tarifa, {
        administracionNombre: this.nombreAdmin(admins, tarifa.administracionId),
        incluirPrecios: true,
      }),
      movimiento: toMovimientoDto(movimiento, this.nombreAdmin(admins, movimiento.tarifa.administracionId)),
    };
  }

  // ─── Ajuste porcentual masivo ─────────────────────────────────────────────

  /**
   * Selección de tarifas de un lote: últimas versiones del linaje vigentes a la
   * fecha indicada. Preview y aplicación usan esta misma función para que lo que
   * se muestra sea exactamente lo que se escribe. Sin `precios` (el preview los
   * pide aparte para las filas mostradas; el versionado relee la fila completa).
   */
  async seleccionarVigentes(filtro: FiltroTarifas, fecha: Date, cliente: ClientePrisma = this.prisma) {
    return cliente.tarifa.findMany({
      where: { ...this.whereVigentes(filtro, fecha), tarifaSiguiente: { is: null } },
      include: INCLUDE_CLASE,
      omit: SIN_PRECIOS,
      orderBy: [{ tipoServicio: 'asc' }, { nombre: 'asc' }, { codigo: 'asc' }],
    });
  }

  /**
   * Linajes que el lote NO puede tocar porque ya tienen una versión programada
   * (la vigente de hoy tiene sucesora): versionarlos rompería la cadena, así que
   * se informan para que el operador decida (regla 1 del contrato).
   */
  private async programadosExcluidos(filtro: FiltroTarifas, fecha: Date, cliente: ClientePrisma = this.prisma) {
    const filas = await cliente.tarifa.findMany({
      where: { ...this.whereVigentes(filtro, fecha), tarifaSiguiente: { isNot: null } },
      select: {
        codigo: true,
        nombre: true,
        tarifaSiguiente: { select: { vigenciaDesde: true } },
      },
      orderBy: [{ tipoServicio: 'asc' }, { nombre: 'asc' }],
    });
    return filas.map((f) => ({
      codigo: f.codigo,
      nombre: f.nombre,
      vigenciaDesdeProgramada: f.tarifaSiguiente?.vigenciaDesde?.toISOString() ?? null,
    }));
  }

  /** Añade la tabla de precios a filas ya seleccionadas (sólo el preview la necesita). */
  private async conPrecios<T extends { id: string }>(
    filas: T[],
    cliente: ClientePrisma = this.prisma,
  ): Promise<Array<T & { precios: unknown }>> {
    if (!filas.length) return [];
    const tablas = await cliente.tarifa.findMany({
      where: { id: { in: filas.map((f) => f.id) } },
      select: { id: true, precios: true },
    });
    const porId = new Map(tablas.map((t) => [t.id, t.precios]));
    return filas.map((f) => ({ ...f, precios: porId.get(f.id) ?? null }));
  }

  /** `POST /tarifas/actualizaciones/preview` — no escribe nada. */
  async previewMasiva(dto: PreviewMasivaDto) {
    const porcentaje = this.validarPorcentaje(dto.porcentaje);
    const vigenciaDesde = this.vigencia(dto.vigenciaDesde);
    const filtro: FiltroTarifas = dto.filtro ?? {};

    const [seleccion, excluidos, admins] = await Promise.all([
      this.seleccionarVigentes(filtro, vigenciaDesde),
      this.programadosExcluidos(filtro, vigenciaDesde),
      this.nombresAdministracion(),
    ]);
    if (!seleccion.length) {
      throw new BadRequestException('El filtro no seleccionó ninguna tarifa vigente');
    }
    // La tabla sólo se carga para las filas que se muestran: `valorReferencia`
    // de una tarifa de tabla es su importe a 10 m³.
    const tarifas = await this.conPrecios(seleccion);

    return {
      total: tarifas.length,
      porcentaje,
      vigenciaDesde: vigenciaDesde.toISOString(),
      excluidosProgramados: excluidos.length,
      excluidos,
      tarifas: tarifas.map((t) => {
        const actual = snapshotValores(t);
        const nuevo = aplicarPorcentaje(actual, porcentaje);
        return {
          id: t.id,
          codigo: t.codigo,
          nombre: t.nombre,
          administracionNombre: this.nombreAdmin(admins, t.administracionId),
          claseNombre: t.claseTarifa?.nombre ?? null,
          categoriaNombre: t.claseTarifa?.categoria?.nombre ?? null,
          tipoServicio: t.tipoServicio,
          concepto: t.concepto,
          tipoCalculo: t.tipoCalculo,
          seccion: t.seccion,
          variante: t.variante,
          ivaNoObjeto: t.ivaNoObjeto,
          ivaPct: actual.ivaPct,
          actual: {
            cuotaFija: actual.cuotaFija,
            precioUnitario: actual.precioUnitario,
            valorReferencia: valorReferencia(actual),
          },
          nuevo: {
            cuotaFija: nuevo.cuotaFija,
            precioUnitario: nuevo.precioUnitario,
            valorReferencia: valorReferencia(nuevo),
          },
        };
      }),
    };
  }

  /**
   * `POST /tarifas/actualizaciones/aplicar` — lote + una versión y un movimiento por tarifa.
   *
   * `excluidosProgramados` viaja SÓLO en la respuesta (no se persiste en la
   * cabecera): son los linajes que ya tenían una versión futura y que el lote
   * dejó intactos, para que el operador los revise.
   */
  async aplicarMasiva(
    dto: AplicarMasivaDto,
    ctx: UsuarioCtx,
  ): Promise<ActualizacionTarifariaDto & { excluidosProgramados: number }> {
    const porcentaje = this.validarPorcentaje(dto.porcentaje);
    const vigenciaDesde = this.vigencia(dto.vigenciaDesde);
    const filtro: FiltroTarifas = dto.filtro ?? {};

    const [preseleccion, excluidos] = await Promise.all([
      this.seleccionarVigentes(filtro, vigenciaDesde),
      this.programadosExcluidos(filtro, vigenciaDesde),
    ]);
    if (!preseleccion.length) {
      throw new BadRequestException('El filtro no seleccionó ninguna tarifa vigente');
    }
    if (excluidos.length) {
      this.logger.warn(
        `Ajuste masivo (${porcentaje} %): ${excluidos.length} linaje(s) omitido(s) por tener una ` +
          `versión programada: ${excluidos.map((e) => e.codigo).join(', ')}`,
      );
    }

    const actualizacion = await this.prisma.$transaction(
      async (tx) => {
        const seleccion = await this.seleccionarVigentes(filtro, vigenciaDesde, tx);
        if (!seleccion.length) {
          throw new BadRequestException('El filtro no seleccionó ninguna tarifa vigente');
        }

        const cabecera = await tx.actualizacionTarifaria.create({
          data: {
            descripcion: dto.motivo,
            fechaPublicacion: new Date(),
            fechaAplicacion: vigenciaDesde,
            fuenteOficial: dto.fuenteOficial ?? null,
            estado: 'aplicada',
            porcentaje,
            filtro: filtro as unknown as Prisma.InputJsonValue,
            totalTarifas: seleccion.length,
            aplicadoPor: ctx.usuarioEmail ?? ctx.usuarioId ?? null,
          },
        });

        for (const t of seleccion) {
          await this.crearVersion(
            t.id,
            {
              porcentaje,
              vigenciaDesde,
              motivo: dto.motivo,
              tipo: TIPOS_MOVIMIENTO.AJUSTE_MASIVO,
              actualizacionId: cabecera.id,
            },
            ctx,
            tx,
          );
        }

        return cabecera;
      },
      { timeout: TIMEOUT_TX_MS, maxWait: 15_000 },
    );

    const lote = await this.getActualizacion(actualizacion.id);
    return { ...lote, excluidosProgramados: excluidos.length };
  }

  // ─── Configurador fiscal ──────────────────────────────────────────────────

  async listarCategorias(): Promise<CategoriaTarifaDto[]> {
    const [categorias, totales] = await Promise.all([
      this.prisma.categoriaTarifa.findMany({
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
        include: { clases: { orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] } },
      }),
      this.totalesPorClase(),
    ]);
    return categorias.map((c) => toCategoriaDto(c, totales));
  }

  /** `PATCH /tarifas/catalogo/categorias/:id`. El cambio de IVA se propaga a las clases sin override. */
  async actualizarCategoria(
    id: string,
    dto: UpdateCategoriaTarifaDto,
    ctx: UsuarioCtx,
  ): Promise<CategoriaTarifaDto> {
    const categoria = await this.prisma.categoriaTarifa.findUnique({
      where: { id },
      include: { clases: { select: { id: true, ivaPct: true } } },
    });
    if (!categoria) throw new NotFoundException('Categoría de tarifa no encontrada');

    const ivaNuevo = dto.ivaPct !== undefined ? redondear2(dto.ivaPct) : null;
    const cambiaIva = ivaNuevo !== null && ivaNuevo !== Number(categoria.ivaPct);
    const nombre = dto.nombre ?? categoria.nombre;
    const motivo = dto.motivo ?? `Cambio de configuración fiscal: ${nombre} IVA a ${ivaNuevo}%`;
    const vigenciaDesde = this.vigencia(dto.vigenciaDesde);

    await this.prisma.$transaction(
      async (tx) => {
        await tx.categoriaTarifa.update({
          where: { id },
          data: {
            ...(dto.nombre !== undefined && { nombre: dto.nombre }),
            ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
            ...(ivaNuevo !== null && { ivaPct: ivaNuevo }),
            ...(dto.activo !== undefined && { activo: dto.activo }),
          },
        });

        if (cambiaIva) {
          // Las clases con `ivaPct` propio conservan su tratamiento fiscal.
          const clasesSinOverride = categoria.clases.filter((c) => c.ivaPct === null).map((c) => c.id);
          if (clasesSinOverride.length) {
            await this.propagarIva(tx, clasesSinOverride, ivaNuevo, { motivo, vigenciaDesde }, ctx);
          }
        }
      },
      { timeout: TIMEOUT_TX_MS, maxWait: 15_000 },
    );

    const [actualizada, totales] = await Promise.all([
      this.prisma.categoriaTarifa.findUniqueOrThrow({
        where: { id },
        include: { clases: { orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] } },
      }),
      this.totalesPorClase(),
    ]);
    return toCategoriaDto(actualizada, totales);
  }

  /** `PATCH /tarifas/catalogo/clases/:id`. Si cambia el IVA efectivo se propaga a sus tarifas vigentes. */
  async actualizarClase(id: string, dto: UpdateClaseTarifaDto, ctx: UsuarioCtx): Promise<ClaseTarifaDto> {
    const clase = await this.prisma.claseTarifa.findUnique({ where: { id }, include: { categoria: true } });
    if (!clase) throw new NotFoundException('Clase de tarifa no encontrada');

    let categoria = clase.categoria;
    if (dto.categoriaId && dto.categoriaId !== clase.categoriaId) {
      const destino = await this.prisma.categoriaTarifa.findUnique({ where: { id: dto.categoriaId } });
      if (!destino) throw new BadRequestException('La categoría indicada no existe');
      categoria = destino;
    }

    const ivaClaseNuevo =
      dto.ivaPct !== undefined
        ? dto.ivaPct === null
          ? null
          : redondear2(dto.ivaPct)
        : clase.ivaPct === null
          ? null
          : Number(clase.ivaPct);
    const ivaAntes = clase.ivaPct === null ? Number(clase.categoria.ivaPct) : Number(clase.ivaPct);
    const ivaDespues = ivaClaseNuevo ?? Number(categoria.ivaPct);
    const nombre = dto.nombre ?? clase.nombre;
    const motivo = dto.motivo ?? `Cambio de configuración fiscal: ${nombre} IVA a ${ivaDespues}%`;
    const vigenciaDesde = this.vigencia(dto.vigenciaDesde);

    await this.prisma.$transaction(
      async (tx) => {
        await tx.claseTarifa.update({
          where: { id },
          data: {
            ...(dto.nombre !== undefined && { nombre: dto.nombre }),
            ...(dto.ivaPct !== undefined && { ivaPct: ivaClaseNuevo }),
            ...(dto.categoriaId !== undefined && { categoriaId: categoria.id }),
            ...(dto.activo !== undefined && { activo: dto.activo }),
          },
        });
        if (ivaDespues !== ivaAntes) {
          await this.propagarIva(tx, [id], ivaDespues, { motivo, vigenciaDesde }, ctx);
        }
      },
      { timeout: TIMEOUT_TX_MS, maxWait: 15_000 },
    );

    const [actualizada, totales] = await Promise.all([
      this.prisma.claseTarifa.findUniqueOrThrow({ where: { id }, include: { categoria: true } }),
      this.totalesPorClase(),
    ]);
    return toClaseDto(actualizada, totales.get(id) ?? 0);
  }

  /**
   * Crea una versión CAMBIO_FISCAL (mismo valor económico, IVA nuevo) en cada
   * tarifa de las clases indicadas vigente a `vigenciaDesde` cuyo IVA difiera.
   */
  private async propagarIva(
    tx: ClientePrisma,
    claseIds: string[],
    ivaEfectivo: number,
    opciones: { motivo: string; vigenciaDesde: Date },
    ctx: UsuarioCtx,
  ): Promise<number> {
    // Referencia = la vigencia pedida para el cambio fiscal (no "hoy"): si se
    // programa a futuro deben versionarse las tarifas vigentes en ESA fecha.
    const referencia = opciones.vigenciaDesde;
    const tarifas = await tx.tarifa.findMany({
      where: {
        claseTarifaId: { in: claseIds },
        activo: true,
        // El IVA de las tarifas de contratación es por concepto (AGUA (CONTRATACIÓN)
        // doméstica 0 %, derechos 16 %), no se hereda de la clase: quedan fuera.
        seccion: SECCION_PERIODICA,
        // «No objeto de IVA» (multas, recargos) no cambia por configuración fiscal.
        ivaNoObjeto: false,
        vigenciaDesde: { lte: referencia },
        tarifaSiguiente: { is: null },
        OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: referencia } }],
      },
      select: { id: true, ivaPct: true },
    });

    let versiones = 0;
    for (const t of tarifas) {
      if (Number(t.ivaPct) === ivaEfectivo) continue;
      await this.crearVersion(
        t.id,
        {
          ivaPct: ivaEfectivo,
          motivo: opciones.motivo,
          vigenciaDesde: opciones.vigenciaDesde,
          tipo: TIPOS_MOVIMIENTO.CAMBIO_FISCAL,
        },
        ctx,
        tx,
      );
      versiones++;
    }
    return versiones;
  }

  // ─── Internos ─────────────────────────────────────────────────────────────

  /** Tarifas vigentes a `fecha` que cumplen el filtro (sin restringir a última versión). */
  private whereVigentes(filtro: FiltroTarifas, fecha: Date): Prisma.TarifaWhereInput {
    const and: Prisma.TarifaWhereInput[] = [
      { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: fecha } }] },
    ];
    const buscar = filtro.buscar?.trim();
    if (buscar) {
      and.push({
        OR: [
          { nombre: { contains: buscar, mode: 'insensitive' } },
          { codigo: { contains: buscar, mode: 'insensitive' } },
          { concepto: { contains: buscar, mode: 'insensitive' } },
        ],
      });
    }
    return {
      activo: true,
      vigenciaDesde: { lte: fecha },
      ...(filtro.tipoServicio && { tipoServicio: filtro.tipoServicio }),
      ...(filtro.concepto && { concepto: filtro.concepto }),
      ...(filtro.administracionId && { administracionId: filtro.administracionId }),
      ...(filtro.claseTarifaId && { claseTarifaId: filtro.claseTarifaId }),
      ...(filtro.categoriaId && { claseTarifa: { categoriaId: filtro.categoriaId } }),
      ...(filtro.seccion && { seccion: filtro.seccion }),
      ...(filtro.variante && { variante: filtro.variante }),
      AND: and,
    };
  }

  /** Tarifas vigentes hoy (última versión) por clase, para el configurador fiscal. */
  private async totalesPorClase(): Promise<Map<string, number>> {
    const filas = await this.prisma.tarifa.groupBy({
      by: ['claseTarifaId'],
      // Sólo las tarifas a las que el configurador fiscal realmente propaga (periódicas y objeto de IVA).
      where: { ...this.whereVigentes({ seccion: 'PERIODICA' }, new Date()), tarifaSiguiente: { is: null }, ivaNoObjeto: false },
      _count: { _all: true },
    });
    const totales = new Map<string, number>();
    for (const f of filas) {
      if (f.claseTarifaId) totales.set(f.claseTarifaId, f._count._all);
    }
    return totales;
  }

  /** Aplica porcentaje y/o valores directos sobre el snapshot actual. */
  private aplicarCambios(anteriores: ValoresTarifa, cambios: CambiosVersion): ValoresTarifa {
    let nuevos = anteriores;
    if (cambios.porcentaje != null) {
      nuevos = aplicarPorcentaje(nuevos, this.validarPorcentaje(cambios.porcentaje));
    }
    if (cambios.cuotaFija !== undefined) nuevos = { ...nuevos, cuotaFija: redondear4(cambios.cuotaFija) };
    if (cambios.precioUnitario !== undefined) {
      nuevos = { ...nuevos, precioUnitario: redondear4(cambios.precioUnitario) };
    }
    if (cambios.precios !== undefined) {
      nuevos = { ...nuevos, precios: cambios.precios.map(redondear4) };
    }
    if (cambios.ivaPct !== undefined) nuevos = { ...nuevos, ivaPct: redondear2(cambios.ivaPct) };
    // «No objeto de IVA» (multas, recargos): no hay traslado que calcular.
    if (cambios.ivaNoObjeto === true) nuevos = { ...nuevos, ivaPct: 0 };
    return nuevos;
  }

  /** Deduce el tipo de movimiento cuando el llamador no lo fija. */
  private deducirTipo(
    cambios: CambiosVersion,
    anteriores: ValoresTarifa,
    nuevos: ValoresTarifa,
  ): TipoMovimiento {
    if (cambios.porcentaje != null) return TIPOS_MOVIMIENTO.AJUSTE_PORCENTUAL;
    const mismosValores =
      anteriores.cuotaFija === nuevos.cuotaFija &&
      anteriores.precioUnitario === nuevos.precioUnitario &&
      JSON.stringify(anteriores.precios) === JSON.stringify(nuevos.precios);
    const cambioFiscal = anteriores.ivaPct !== nuevos.ivaPct || cambios.ivaNoObjeto !== undefined;
    if (mismosValores && cambioFiscal) return TIPOS_MOVIMIENTO.CAMBIO_FISCAL;
    return TIPOS_MOVIMIENTO.CAMBIO_VALOR;
  }

  /** `normalizarVigencia` lanza Error plano; en la API debe ser un 400. */
  private vigencia(v?: string | Date | null): Date {
    try {
      return normalizarVigencia(v ?? undefined);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private validarPorcentaje(porcentaje: number): number {
    if (!Number.isFinite(porcentaje) || porcentaje === 0) {
      throw new BadRequestException('porcentaje debe ser un número distinto de 0');
    }
    if (porcentaje < PORCENTAJE_MIN || porcentaje > PORCENTAJE_MAX) {
      throw new BadRequestException(`porcentaje debe estar entre ${PORCENTAJE_MIN} y ${PORCENTAJE_MAX}`);
    }
    return porcentaje;
  }

  /** Tarifa no tiene relación Prisma con Administracion: se resuelve el nombre en bloque. */
  private async nombresAdministracion(): Promise<Map<string, string>> {
    const admins = await this.prisma.administracion.findMany({ select: { id: true, nombre: true } });
    return mapaAdministraciones(admins);
  }

  private nombreAdmin(admins: Map<string, string>, administracionId: string | null): string | null {
    return administracionId ? admins.get(administracionId) ?? null : null;
  }
}

/** Normaliza una variante para comparación: sin acentos, mayúsculas, espacios colapsados. */
function normalizarVariante(v: string | null | undefined): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
