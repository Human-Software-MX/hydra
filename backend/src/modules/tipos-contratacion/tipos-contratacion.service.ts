import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CatalogoSatTipo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface CreateTipoContratacionDto {
  codigo: string;
  nombre: string;
  descripcion?: string;
  requiereMedidor?: boolean;
  // P1/P6 configuración del proceso
  claseProceso?: string;
  esContratoFormal?: boolean;
  requiereSolicitudPrevia?: boolean;
  diasCaducidadSolicitud?: number;
  organismoAprobacion?: string;
  diasPlazoAprobacion?: number;
  periodicidadesPermitidas?: string;
  tiposClientePermitidos?: string;
}

interface UpdateTipoContratacionDto {
  nombre?: string;
  descripcion?: string;
  requiereMedidor?: boolean;
  activo?: boolean;
  // P1/P6 configuración del proceso
  claseProceso?: string | null;
  esContratoFormal?: boolean;
  requiereSolicitudPrevia?: boolean;
  diasCaducidadSolicitud?: number | null;
  organismoAprobacion?: string | null;
  diasPlazoAprobacion?: number | null;
  periodicidadesPermitidas?: string | null;
  tiposClientePermitidos?: string | null;
}

function parseAplicaUso(v?: string): string | null {
  const x = v?.trim().toLowerCase();
  if (!x) return null;
  if (x === 'domestico' || x === 'doméstico') return 'domestico';
  if (x === 'no_domestico' || x === 'no-domestico') return 'no_domestico';
  throw new BadRequestException(`aplicaUso '${v}' inválido: use 'domestico', 'no_domestico' u omita`);
}

@Injectable()
export class TiposContratacionService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD TipoContratacion ─────────────────────────────────────────────────

  async findAll(params: {
    activo?: string;
    page?: number;
    limit?: number;
    administracionId?: string;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const adminId = params.administracionId?.trim();
    // Tipos sin administración (NULL) son catálogo global y deben ofrecerse en cualquier administración;
    // los que tienen administración restringen a esa sede.
    const where: Record<string, unknown> = {
      ...(params.activo !== undefined && { activo: params.activo === 'true' }),
      ...(adminId
        ? {
            OR: [{ administracionId: adminId }, { administracionId: null }],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.tipoContratacion.findMany({
        where,
        include: {
          _count: { select: { contratos: true, conceptos: true, clausulas: true, documentos: true } },
        },
        orderBy: { codigo: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tipoContratacion.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const tipo = await this.prisma.tipoContratacion.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: {
        _count: { select: { contratos: true } },
      },
    });
    if (!tipo) throw new NotFoundException(`TipoContratacion '${id}' no encontrado`);
    return tipo;
  }

  async create(dto: CreateTipoContratacionDto) {
    const existing = await this.prisma.tipoContratacion.findUnique({
      where: { codigo: dto.codigo },
    });
    if (existing) throw new ConflictException(`Código '${dto.codigo}' ya existe`);

    return this.prisma.tipoContratacion.create({
      data: {
        codigo: dto.codigo,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        requiereMedidor: dto.requiereMedidor ?? true,
        claseProceso: dto.claseProceso ?? null,
        esContratoFormal: dto.esContratoFormal ?? true,
        requiereSolicitudPrevia: dto.requiereSolicitudPrevia ?? false,
        diasCaducidadSolicitud: dto.diasCaducidadSolicitud ?? null,
        organismoAprobacion: dto.organismoAprobacion ?? null,
        diasPlazoAprobacion: dto.diasPlazoAprobacion ?? null,
        periodicidadesPermitidas: dto.periodicidadesPermitidas ?? null,
        tiposClientePermitidos: dto.tiposClientePermitidos ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateTipoContratacionDto) {
    const tipo = await this.findOne(id);
    return this.prisma.tipoContratacion.update({
      where: { id: tipo.id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
        ...(dto.requiereMedidor !== undefined && { requiereMedidor: dto.requiereMedidor }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
        ...(dto.claseProceso !== undefined && { claseProceso: dto.claseProceso }),
        ...(dto.esContratoFormal !== undefined && { esContratoFormal: dto.esContratoFormal }),
        ...(dto.requiereSolicitudPrevia !== undefined && { requiereSolicitudPrevia: dto.requiereSolicitudPrevia }),
        ...(dto.diasCaducidadSolicitud !== undefined && { diasCaducidadSolicitud: dto.diasCaducidadSolicitud }),
        ...(dto.organismoAprobacion !== undefined && { organismoAprobacion: dto.organismoAprobacion }),
        ...(dto.diasPlazoAprobacion !== undefined && { diasPlazoAprobacion: dto.diasPlazoAprobacion }),
        ...(dto.periodicidadesPermitidas !== undefined && { periodicidadesPermitidas: dto.periodicidadesPermitidas }),
        ...(dto.tiposClientePermitidos !== undefined && { tiposClientePermitidos: dto.tiposClientePermitidos }),
      },
    });
  }

  // ─── Configuración (conceptos + cláusulas + documentos) ───────────────────

  async getConfiguracion(id: string) {
    const tipo = await this.prisma.tipoContratacion.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: {
        conceptos: {
          include: { conceptoCobro: true },
          orderBy: { orden: 'asc' },
        },
        clausulas: {
          include: { clausula: true },
          orderBy: { orden: 'asc' },
        },
        documentos: {
          include: { documento: true },
          orderBy: [{ orden: 'asc' }, { obligatorio: 'desc' }, { createdAt: 'asc' }],
        },
        variables: {
          include: { tipoVariable: true },
          orderBy: { orden: 'asc' },
        },
      },
    });
    if (!tipo) throw new NotFoundException(`TipoContratacion '${id}' no encontrado`);
    return tipo;
  }

  // ─── Asociaciones: Conceptos ───────────────────────────────────────────────

  async agregarConcepto(tipoId: string, dto: { conceptoCobroId: string; obligatorio?: boolean; orden?: number }) {
    const tipo = await this.findOne(tipoId);
    const concepto = await this.prisma.conceptoCobro.findUnique({ where: { id: dto.conceptoCobroId } });
    if (!concepto) throw new NotFoundException(`ConceptoCobro '${dto.conceptoCobroId}' no encontrado`);

    const exists = await this.prisma.conceptoCobroTipoContratacion.findUnique({
      where: { tipoContratacionId_conceptoCobroId: { tipoContratacionId: tipo.id, conceptoCobroId: dto.conceptoCobroId } },
    });
    if (exists) throw new ConflictException('Este concepto ya está asociado al tipo de contratación');

    return this.prisma.conceptoCobroTipoContratacion.create({
      data: {
        tipoContratacionId: tipo.id,
        conceptoCobroId: dto.conceptoCobroId,
        obligatorio: dto.obligatorio ?? true,
        orden: dto.orden ?? 0,
      },
      include: { conceptoCobro: true },
    });
  }

  async removerConcepto(tipoId: string, conceptoCobroId: string) {
    const tipo = await this.findOne(tipoId);
    const assoc = await this.prisma.conceptoCobroTipoContratacion.findUnique({
      where: { tipoContratacionId_conceptoCobroId: { tipoContratacionId: tipo.id, conceptoCobroId } },
    });
    if (!assoc) throw new NotFoundException('Asociación no encontrada');
    return this.prisma.conceptoCobroTipoContratacion.delete({
      where: { tipoContratacionId_conceptoCobroId: { tipoContratacionId: tipo.id, conceptoCobroId } },
    });
  }

  // ─── Asociaciones: Cláusulas ───────────────────────────────────────────────

  async agregarClausula(tipoId: string, dto: { clausulaId: string; obligatorio?: boolean; orden?: number }) {
    const tipo = await this.findOne(tipoId);
    const clausula = await this.prisma.clausulaContractual.findUnique({ where: { id: dto.clausulaId } });
    if (!clausula) throw new NotFoundException(`ClausulaContractual '${dto.clausulaId}' no encontrada`);

    const exists = await this.prisma.clausulaTipoContratacion.findUnique({
      where: { tipoContratacionId_clausulaId: { tipoContratacionId: tipo.id, clausulaId: dto.clausulaId } },
    });
    if (exists) throw new ConflictException('Esta cláusula ya está asociada al tipo de contratación');

    return this.prisma.clausulaTipoContratacion.create({
      data: {
        tipoContratacionId: tipo.id,
        clausulaId: dto.clausulaId,
        obligatorio: dto.obligatorio ?? true,
        orden: dto.orden ?? 0,
      },
      include: { clausula: true },
    });
  }

  async removerClausula(tipoId: string, clausulaId: string) {
    const tipo = await this.findOne(tipoId);
    const assoc = await this.prisma.clausulaTipoContratacion.findUnique({
      where: { tipoContratacionId_clausulaId: { tipoContratacionId: tipo.id, clausulaId } },
    });
    if (!assoc) throw new NotFoundException('Asociación no encontrada');
    return this.prisma.clausulaTipoContratacion.delete({
      where: { tipoContratacionId_clausulaId: { tipoContratacionId: tipo.id, clausulaId } },
    });
  }

  // ─── Asociaciones: Documentos Requeridos ──────────────────────────────────

  async agregarDocumento(
    tipoId: string,
    dto: {
      documentoId?: string;
      nombreDocumento?: string;
      descripcion?: string;
      obligatorio?: boolean;
      aplicaUso?: string;
      orden?: number;
    },
  ) {
    const tipo = await this.findOne(tipoId);
    if (!dto.documentoId && !dto.nombreDocumento?.trim()) {
      throw new BadRequestException('Se requiere documentoId (catálogo) o nombreDocumento');
    }
    const aplicaUso = parseAplicaUso(dto.aplicaUso);
    if (dto.documentoId) {
      const doc = await this.prisma.catalogoDocumento.findUnique({ where: { id: dto.documentoId } });
      if (!doc) throw new NotFoundException(`CatalogoDocumento '${dto.documentoId}' no encontrado`);
      const exists = await this.prisma.documentoRequeridoTipoContratacion.findUnique({
        where: {
          tipoContratacionId_documentoId: { tipoContratacionId: tipo.id, documentoId: dto.documentoId },
        },
      });
      if (exists) throw new ConflictException('Este documento ya está asociado al tipo de contratación');
    }
    return this.prisma.documentoRequeridoTipoContratacion.create({
      data: {
        tipoContratacionId: tipo.id,
        documentoId: dto.documentoId ?? null,
        nombreDocumento: dto.nombreDocumento?.trim() || null,
        descripcion: dto.descripcion ?? null,
        obligatorio: dto.obligatorio ?? true,
        aplicaUso,
        orden: dto.orden ?? 0,
      },
      include: { documento: true },
    });
  }

  // ─── Catálogo de Documentos ────────────────────────────────────────────────

  async findCatalogoDocumentos(params: { activo?: string; clasificacion?: string }) {
    return this.prisma.catalogoDocumento.findMany({
      where: {
        ...(params.activo !== undefined && { activo: params.activo === 'true' }),
        ...(params.clasificacion ? { clasificacion: params.clasificacion } : {}),
      },
      orderBy: [{ clasificacion: 'asc' }, { nombre: 'asc' }],
    });
  }

  async createCatalogoDocumento(dto: {
    nombre: string;
    presentacion?: string;
    clasificacion?: string;
  }) {
    if (!dto.nombre?.trim()) throw new BadRequestException('nombre es requerido');
    return this.prisma.catalogoDocumento.create({
      data: {
        nombre: dto.nombre.trim(),
        presentacion: dto.presentacion ?? null,
        clasificacion: dto.clasificacion ?? null,
      },
    });
  }

  async updateCatalogoDocumento(
    id: string,
    dto: { nombre?: string; presentacion?: string | null; clasificacion?: string | null; activo?: boolean },
  ) {
    const doc = await this.prisma.catalogoDocumento.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`CatalogoDocumento '${id}' no encontrado`);
    return this.prisma.catalogoDocumento.update({ where: { id }, data: dto });
  }

  /**
   * Asignación masiva: asocia un documento del catálogo a muchos tipos de contratación
   * en una sola operación (por ids explícitos o por filtro de administración).
   * Es la operación de elasticidad: "este documento aplica a todos los ALTA NUEVA
   * COMERCIAL" es una llamada, no 13 capturas.
   */
  async asignarDocumentoMasivo(dto: {
    documentoId: string;
    tipoContratacionIds?: string[];
    filtro?: { administracionId?: string; nombreContiene?: string };
    obligatorio?: boolean;
    aplicaUso?: string;
  }) {
    const doc = await this.prisma.catalogoDocumento.findUnique({ where: { id: dto.documentoId } });
    if (!doc) throw new NotFoundException(`CatalogoDocumento '${dto.documentoId}' no encontrado`);
    const aplicaUso = parseAplicaUso(dto.aplicaUso);

    let tipoIds = dto.tipoContratacionIds ?? [];
    if (tipoIds.length === 0 && dto.filtro) {
      const tipos = await this.prisma.tipoContratacion.findMany({
        where: {
          activo: true,
          ...(dto.filtro.administracionId ? { administracionId: dto.filtro.administracionId } : {}),
          ...(dto.filtro.nombreContiene
            ? { nombre: { contains: dto.filtro.nombreContiene, mode: 'insensitive' } }
            : {}),
        },
        select: { id: true },
      });
      tipoIds = tipos.map((t) => t.id);
    }
    if (tipoIds.length === 0) {
      throw new BadRequestException('Sin tipos destino: pase tipoContratacionIds o un filtro');
    }

    const result = await this.prisma.documentoRequeridoTipoContratacion.createMany({
      data: tipoIds.map((tipoContratacionId) => ({
        tipoContratacionId,
        documentoId: dto.documentoId,
        obligatorio: dto.obligatorio ?? true,
        aplicaUso,
      })),
      skipDuplicates: true,
    });
    return { asignados: result.count, tiposDestino: tipoIds.length };
  }

  async removerDocumento(tipoId: string, documentoId: string) {
    await this.findOne(tipoId);
    const doc = await this.prisma.documentoRequeridoTipoContratacion.findUnique({
      where: { id: documentoId },
    });
    if (!doc || doc.tipoContratacionId !== (await this.findOne(tipoId)).id) {
      throw new NotFoundException('Documento no encontrado');
    }
    return this.prisma.documentoRequeridoTipoContratacion.delete({ where: { id: documentoId } });
  }

  // ─── Cambio de tipo de contrato (req 24) ──────────────────────────────────

  async cambiarTipoContrato(
    contratoId: string,
    nuevoTipoId: string,
    motivo: string,
    usuario?: string,
  ) {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true, tipoContratacionId: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const nuevoTipo = await this.findOne(nuevoTipoId);

    if (contrato.tipoContratacionId === nuevoTipo.id) {
      throw new BadRequestException('El contrato ya tiene este tipo de contratación');
    }

    const [updated] = await this.prisma.$transaction([
      // Actualizar el tipo en el contrato
      this.prisma.contrato.update({
        where: { id: contratoId },
        data: { tipoContratacionId: nuevoTipo.id },
      }),
      // Registrar el cambio en el histórico
      this.prisma.historicoContrato.create({
        data: {
          contratoId,
          campo: 'tipoContratacionId',
          valorAnterior: contrato.tipoContratacionId ?? null,
          valorNuevo: nuevoTipo.id,
          motivo,
          usuario: usuario ?? null,
        },
      }),
    ]);

    // Retornar la nueva configuración asociada al tipo
    const nuevaConfig = await this.getConfiguracion(nuevoTipo.id);
    return {
      contrato: updated,
      configuracion: nuevaConfig,
      advertencia:
        'El cambio aplica a períodos futuros. Pagos y pólizas previas no se modifican.',
    };
  }

  // ─── Catálogos: ConceptoCobro ──────────────────────────────────────────────

  async findConceptosCobro(params: { activo?: string } = {}) {
    return this.prisma.conceptoCobro.findMany({
      where: params.activo !== undefined ? { activo: params.activo === 'true' } : undefined,
      orderBy: { codigo: 'asc' },
    });
  }

  async createConceptoCobro(dto: {
    codigo: string;
    nombre: string;
    tipo: string;
    montoBase?: number;
    ivaPct?: number;
    formula?: string;
    variablesFormula?: object;
  }) {
    return this.prisma.conceptoCobro.create({ data: dto });
  }

  async updateConceptoCobro(
    id: string,
    dto: Partial<{ nombre: string; tipo: string; montoBase: number; ivaPct: number; formula: string; variablesFormula: object; activo: boolean }>,
  ) {
    return this.prisma.conceptoCobro.update({ where: { id }, data: dto });
  }

  // ─── Catálogos: ClausulaContractual ───────────────────────────────────────

  async findClausulas(params: { activo?: string } = {}) {
    return this.prisma.clausulaContractual.findMany({
      where: params.activo !== undefined ? { activo: params.activo === 'true' } : undefined,
      orderBy: { codigo: 'asc' },
    });
  }

  async createClausula(dto: { codigo: string; titulo: string; contenido: string; version?: string }) {
    return this.prisma.clausulaContractual.create({
      data: { ...dto, version: dto.version ?? '1.0' },
    });
  }

  async updateClausula(id: string, dto: Partial<{ titulo: string; contenido: string; version: string; activo: boolean }>) {
    return this.prisma.clausulaContractual.update({ where: { id }, data: dto });
  }

  // ─── Catálogos CIG2018 (actividad, categoría, relación PS) ─────────────────

  async findCatalogoActividades(params: { activo?: string } = {}) {
    const activoWhere =
      params.activo !== undefined ? { activo: params.activo === 'true' } : {};
    // Solo catálogo operativo SIGE (hoja Actividad — `ACTIPOL_{actipolid}` en seed).
    // Excluye filas legacy/demo con otros códigos que no existen en el Excel SIGE.
    return this.prisma.catalogoActividad.findMany({
      where: {
        ...activoWhere,
        codigo: { startsWith: 'ACTIPOL_' },
      },
      include: { grupo: true },
      orderBy: { codigo: 'asc' },
    });
  }

  async findCatalogoGruposActividad(params: { activo?: string } = {}) {
    return this.prisma.catalogoGrupoActividad.findMany({
      where: params.activo !== undefined ? { activo: params.activo === 'true' } : undefined,
      orderBy: { codigo: 'asc' },
    });
  }

  async findCatalogoCategorias(params: { activo?: string } = {}) {
    return this.prisma.catalogoCategoria.findMany({
      where: params.activo !== undefined ? { activo: params.activo === 'true' } : undefined,
      orderBy: { codigo: 'asc' },
    });
  }

  async findCatalogoTiposRelacionPS(params: { activo?: string } = {}) {
    return this.prisma.catalogoTipoRelacionPS.findMany({
      where: params.activo !== undefined ? { activo: params.activo === 'true' } : undefined,
      orderBy: { codigo: 'asc' },
    });
  }

  /** Catálogo SAT (Anexo 20): c_RegimenFiscal, c_UsoCFDI — ver `GET /catalogos/sat` */
  async findCatalogoSat(params: { tipo?: string; activo?: string } = {}) {
    const where: { tipo?: CatalogoSatTipo; activo?: boolean } = {};
    if (params.tipo === 'REGIMEN_FISCAL' || params.tipo === 'USO_CFDI') {
      where.tipo = params.tipo as CatalogoSatTipo;
    }
    if (params.activo !== undefined) {
      where.activo = params.activo === 'true';
    }
    return this.prisma.catalogoSat.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: [{ tipo: 'asc' }, { orden: 'asc' }, { clave: 'asc' }],
    });
  }
}
