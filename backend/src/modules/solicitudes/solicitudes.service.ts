import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DomiciliosService, type CreateDomicilioDto } from '../domicilios/domicilios.service';
import { PuntosServicioService } from '../puntos-servicio/puntos-servicio.service';
import { coordenadasPredio } from './predio-geo';

function optionalInegiFk(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function parseOptionalFloatForm(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseOptionalIntForm(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

@Injectable()
export class SolicitudesService {
  private readonly logger = new Logger(SolicitudesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domiciliosService: DomiciliosService,
    private readonly puntosServicioService: PuntosServicioService,
  ) {}

  /**
   * `formData.predioDir` (CEA-FUS01) → DTO de domicilio para crear el punto de servicio del predio.
   */
  private predioDirToCreateDomicilioDto(predioDir: unknown): CreateDomicilioDto | null {
    if (!predioDir || typeof predioDir !== 'object' || Array.isArray(predioDir)) return null;
    const o = predioDir as Record<string, unknown>;
    const calle = typeof o.calle === 'string' ? o.calle.trim() : '';
    if (!calle) return null;
    return {
      calle,
      numExterior: optionalInegiFk(o.numExterior),
      numInterior: optionalInegiFk(o.numInterior),
      coloniaINEGIId: optionalInegiFk(o.coloniaINEGIId),
      codigoPostal: optionalInegiFk(o.codigoPostal),
      localidadINEGIId: optionalInegiFk(o.localidadINEGIId),
      municipioINEGIId: optionalInegiFk(o.municipioINEGIId),
      estadoINEGIId: optionalInegiFk(o.estadoINEGIId),
      referencia: optionalInegiFk(o.referencia),
      // Ubicación seleccionada en el mapa del predio (opcional).
      ...coordenadasPredio(o),
    };
  }

  // ── Folio generation ──────────────────────────────────────────────────────
  private async generarFolio(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `SOL-${year}-`;
    const last = await this.prisma.solicitud.findFirst({
      where: { folio: { startsWith: prefix } },
      orderBy: { folio: 'desc' },
    });
    const seq = last
      ? parseInt(last.folio.replace(prefix, ''), 10) + 1
      : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async findAll(params: { estado?: string; page?: number; limit?: number; contratoId?: string }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const where = {
      ...(params.estado ? { estado: params.estado } : {}),
      ...(params.contratoId?.trim() ? { contratoId: params.contratoId.trim() } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.solicitud.findMany({
        where,
        include: { inspeccion: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.solicitud.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const s = await this.prisma.solicitud.findUnique({
      where: { id },
      include: { inspeccion: true },
    });
    if (!s) throw new NotFoundException('Solicitud no encontrada');
    return s;
  }

  async create(dto: {
    propTipoPersona: string;
    propNombreCompleto: string;
    propRfc?: string;
    propCorreo?: string;
    propTelefono?: string;
    predioResumen: string;
    claveCatastral?: string;
    adminId?: string;
    tipoContratacionId?: string;
    formData: object;
  }) {
    const folio = await this.generarFolio();

    // Determine initial state: skip inspection if tipo doesn't require it
    let estadoInicial = 'inspeccion_pendiente';
    if (dto.tipoContratacionId) {
      const tipo = await this.prisma.tipoContratacion.findUnique({
        where: { id: dto.tipoContratacionId },
        select: { requiereInspeccion: true },
      });
      if (tipo && !tipo.requiereInspeccion) {
        estadoInicial = 'en_cotizacion';
      }
    }

    return this.prisma.solicitud.create({
      data: {
        folio,
        propTipoPersona: dto.propTipoPersona,
        propNombreCompleto: dto.propNombreCompleto,
        propRfc: dto.propRfc ?? null,
        propCorreo: dto.propCorreo ?? null,
        propTelefono: dto.propTelefono ?? null,
        predioResumen: dto.predioResumen,
        claveCatastral: dto.claveCatastral ?? null,
        adminId: dto.adminId ?? null,
        tipoContratacionId: dto.tipoContratacionId ?? null,
        estado: estadoInicial,
        formData: dto.formData,
      },
      include: { inspeccion: true },
    });
  }

  async updateFormData(id: string, dto: {
    propNombreCompleto?: string;
    propTipoPersona?: string;
    propRfc?: string;
    propCorreo?: string;
    propTelefono?: string;
    predioResumen?: string;
    claveCatastral?: string;
    adminId?: string;
    tipoContratacionId?: string;
    formData?: object;
  }) {
    const existing = await this.findOne(id);
    const prevForm =
      existing.formData && typeof existing.formData === 'object' && !Array.isArray(existing.formData)
        ? (existing.formData as Record<string, unknown>)
        : {};
    const mergedForm =
      dto.formData && typeof dto.formData === 'object' && !Array.isArray(dto.formData)
        ? { ...prevForm, ...(dto.formData as Record<string, unknown>) }
        : undefined;

    return this.prisma.solicitud.update({
      where: { id },
      data: {
        ...(dto.propNombreCompleto && { propNombreCompleto: dto.propNombreCompleto }),
        ...(dto.propTipoPersona !== undefined &&
          dto.propTipoPersona.trim() !== '' && { propTipoPersona: dto.propTipoPersona.trim() }),
        ...(dto.propRfc !== undefined && { propRfc: dto.propRfc }),
        ...(dto.propCorreo !== undefined && { propCorreo: dto.propCorreo }),
        ...(dto.propTelefono !== undefined && { propTelefono: dto.propTelefono }),
        ...(dto.predioResumen && { predioResumen: dto.predioResumen }),
        ...(dto.claveCatastral !== undefined && { claveCatastral: dto.claveCatastral }),
        ...(dto.adminId !== undefined && { adminId: dto.adminId }),
        ...(dto.tipoContratacionId !== undefined && { tipoContratacionId: dto.tipoContratacionId }),
        ...(mergedForm !== undefined && { formData: mergedForm as Prisma.InputJsonValue }),
      },
      include: { inspeccion: true },
    });
  }

  // ── Inspection upsert ──────────────────────────────────────────────────────
  async upsertInspeccion(
    solicitudId: string,
    data: {
      estado?: string;
      fechaInspeccion?: string;
      numeroOficial?: string;
      tipoUso?: string;
      giro?: string;
      areaTerreno?: string;
      condicionToma?: string;
      condicionesPredio?: string;
      infraHidraulicaExterna?: string;
      infraSanitaria?: string;
      materialCalle?: string;
      materialBanqueta?: string;
      metrosRupturaAguaCalle?: string;
      metrosRupturaAguaBanqueta?: string;
      metrosRupturaDrenajeCalle?: string;
      metrosRupturaDrenajeBanqueta?: string;
      // Campos formales junta CEA 02-sep
      tieneMedidor?: boolean;
      diametroDescarga?: string;
      metrosLinealesToma?: number;
      metrosLinealesDescarga?: number;
      realizada?: boolean;
      motivoNoRealizada?: string;
      intentos?: number;
      observaciones?: string;
      evidencias?: string[];
      resultadoEjecucion?: string;
      resultadoInspeccion?: string;
      inspectorNumEmpleado?: string;
      inspectorNombre?: string;
      firmaInspector?: string;
      inspectoresAdicionales?: { noEmpleado: string; nombre: string; firma?: string }[];
      inicio?: string;
      fin?: string;
      tipoOrdenCorrecto?: string;
      // Legacy
      inspector?: string;
      diametroToma?: string;
      tomaExistente?: string;
      diametroTomaExistente?: string;
      estadoTomaExistente?: string;
      medidorExistente?: string;
      numMedidorExistente?: string;
      metrosRupturaCalle?: string;
      metrosRupturaBanqueta?: string;
      existeRed?: string;
      distanciaRed?: string;
      presionRed?: string;
      tipoMaterialRed?: string;
      profundidadRed?: string;
    },
  ) {
    const solicitud = await this.findOne(solicitudId);

    // Only advance estado when the solicitud is currently in an inspection state.
    // Solicitudes already at en_cotizacion/aceptada/contratado keep their estado.
    const INSPECTION_STATES = ['inspeccion_pendiente', 'inspeccion_en_proceso', 'borrador'];
    if (INSPECTION_STATES.includes(solicitud.estado)) {
      const nextEstado = data.estado === 'completada' ? 'en_cotizacion' : 'inspeccion_en_proceso';
      await this.prisma.solicitud.update({
        where: { id: solicitudId },
        data: { estado: nextEstado },
      });
    }

    await this.prisma.solicitudInspeccion.upsert({
      where: { solicitudId },
      create: { solicitudId, estado: data.estado ?? 'completada', ...data },
      update: data,
    });

    return this.prisma.solicitud.findUnique({
      where: { id: solicitudId },
      include: { inspeccion: true },
    });
  }

  /**
   * Reúne posibles referencias al tipo (columna, JSON del formulario, anidados).
   * Tras migraciones SIGE, el cuid guardado puede quedar huérfano; el **código** (`TCT-n`, stub, etc.) suele seguir siendo resoluble.
   */
  private collectTipoContratacionCandidates(sol: {
    tipoContratacionId: string | null;
    formData: unknown;
  }): string[] {
    const out: string[] = [];
    const push = (v: unknown) => {
      if (typeof v === 'string') {
        const t = v.trim();
        if (t) out.push(t);
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        out.push(String(v));
      }
    };
    push(sol.tipoContratacionId);
    const fd = sol.formData;
    if (fd && typeof fd === 'object') {
      const o = fd as Record<string, unknown>;
      push(o['tipoContratacionId']);
      push(o['tipoContratacionCodigo']);
      push(o['codigoTipoContratacion']);
      push(o['tipo_contratacion_id']);
      push(o['tipo_contratacion_codigo']);
      const nested = o['tipoContratacion'];
      if (nested && typeof nested === 'object') {
        const n = nested as Record<string, unknown>;
        push(n['id']);
        push(n['codigo']);
      }
    }
    return [...new Set(out)];
  }

  /** Igual que el catálogo: id, codigo exacto, codigo sin distinguir mayúsculas, o número SIGE → `TCT-{n}`. */
  private async lookupTipoContratacionByCandidate(candidate: string): Promise<string | null> {
    const exact = await this.prisma.tipoContratacion.findFirst({
      where: { OR: [{ id: candidate }, { codigo: candidate }] },
      select: { id: true },
    });
    if (exact) return exact.id;

    const ci = await this.prisma.tipoContratacion.findFirst({
      where: { codigo: { equals: candidate, mode: 'insensitive' } },
      select: { id: true },
    });
    if (ci) return ci.id;

    if (/^\d+$/.test(candidate)) {
      const codigo = `TCT-${candidate}`;
      const byTct = await this.prisma.tipoContratacion.findFirst({
        where: { codigo },
        select: { id: true },
      });
      if (byTct) return byTct.id;
    }
    return null;
  }

  /**
   * Resuelve el FK real de `tipos_contratacion.id` para el contrato.
   * Alineado con `TiposContratacionService.findOne` (id o codigo) y tolerante a desalineación columna vs `formData`.
   */
  private async resolveTipoContratacionIdForContrato(sol: {
    tipoContratacionId: string | null;
    formData: unknown;
  }): Promise<string | null> {
    const candidates = this.collectTipoContratacionCandidates(sol);
    if (candidates.length === 0) return null;
    for (const candidate of candidates) {
      const id = await this.lookupTipoContratacionByCandidate(candidate);
      if (id) return id;
    }
    this.logger.warn(
      `aceptar: no se resolvió tipo de contratación (candidatos=${JSON.stringify(candidates)})`,
    );
    throw new BadRequestException(
      'No se encontró el tipo de contratación indicado en la solicitud (ni por id ni por código en el catálogo). ' +
        'Revise que coincida con un tipo activo en el sistema o vuelva a seleccionarlo en el formulario.',
    );
  }

  // ── Accept — creates a Contrato and links it ──────────────────────────────
  async aceptar(id: string) {
    const sol = await this.findOne(id);

    // Create the contrato
    const formData = sol.formData as Record<string, unknown> | null;
    const tipoContratacionId = await this.resolveTipoContratacionIdForContrato(sol);

    const domicilioDto = this.predioDirToCreateDomicilioDto(formData?.predioDir);
    let domicilioId: string | null = null;
    if (domicilioDto) {
      try {
        const dom = await this.domiciliosService.create(domicilioDto);
        domicilioId = dom.id;
      } catch (e) {
        this.logger.warn(
          `aceptar: no se pudo crear domicilio del predio para solicitud ${id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      this.logger.warn(
        `aceptar: predioDir sin calle — no se crea punto de servicio automático (solicitud ${id})`,
      );
    }

    const contrato = await this.prisma.contrato.create({
      data: {
        tipoContrato: 'NORMAL',
        tipoServicio: 'AGUA_POTABLE',
        nombre: sol.propNombreCompleto,
        rfc: sol.propRfc || 'XAXX010101000',
        direccion: sol.predioResumen,
        contacto: sol.propTelefono || '',
        estado: 'Pendiente de alta',
        fecha: new Date().toISOString().split('T')[0],
        tipoContratacionId,
        domiciliado: false,
        domicilioId: domicilioId ?? undefined,
        superficiePredio: parseOptionalFloatForm(formData?.superficieTotal),
        superficieConstruida: parseOptionalFloatForm(formData?.superficieConstruida),
        personasHabitanVivienda: parseOptionalIntForm(formData?.personasVivienda),
      },
    });

    let puntoServicioId: string | null = null;
    if (domicilioId) {
      try {
        const ps = await this.puntosServicioService.create({
          codigo: `PS-${contrato.numeroContrato}`,
          domicilioId,
        });
        puntoServicioId = ps.id;
        await this.prisma.contrato.update({
          where: { id: contrato.id },
          data: { puntoServicioId },
        });
      } catch (e) {
        this.logger.error(
          `aceptar: no se pudo crear punto de servicio para contrato ${contrato.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Link contrato to solicitud and update estado
    await this.prisma.solicitud.update({
      where: { id },
      data: { estado: 'aceptada', contratoId: contrato.id },
    });

    return { solicitudId: id, contratoId: contrato.id, folio: contrato.id, puntoServicioId };
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  async rechazar(id: string) {
    await this.findOne(id);
    return this.prisma.solicitud.update({
      where: { id },
      data: { estado: 'rechazada' },
      include: { inspeccion: true },
    });
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  async cancelar(id: string) {
    await this.findOne(id);
    return this.prisma.solicitud.update({
      where: { id },
      data: { estado: 'cancelada' },
      include: { inspeccion: true },
    });
  }

  // ── Retomar (reactivate a cancelled solicitud) ────────────────────────────
  async retomar(id: string) {
    const sol = await this.findOne(id);

    let estadoRetomado = 'inspeccion_pendiente';
    const tipoId = sol.tipoContratacionId;
    if (tipoId) {
      const tipo = await this.prisma.tipoContratacion.findUnique({
        where: { id: tipoId },
        select: { requiereInspeccion: true },
      });
      if (tipo && !tipo.requiereInspeccion) {
        estadoRetomado = 'en_cotizacion';
      }
    }

    return this.prisma.solicitud.update({
      where: { id },
      data: { estado: estadoRetomado },
      include: { inspeccion: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.solicitud.delete({ where: { id } });
  }

  // ─── Documentos entregados ─────────────────────────────────────────────────

  async listDocumentos(solicitudId: string) {
    await this.findOne(solicitudId);
    return this.prisma.solicitudDocumento.findMany({
      where: { solicitudId },
      include: { documento: { select: { id: true, nombre: true, presentacion: true, clasificacion: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addDocumento(
    solicitudId: string,
    dto: {
      documentoId?: string;
      nombreDocumento?: string;
      archivoNombre: string;
      archivoPath: string;
      mimeType: string;
      tamanoBytes: number;
    },
  ) {
    await this.findOne(solicitudId);
    if (!dto.documentoId && !dto.nombreDocumento?.trim()) {
      throw new BadRequestException('Se requiere documentoId (catálogo) o nombreDocumento');
    }
    if (dto.documentoId) {
      const doc = await this.prisma.catalogoDocumento.findUnique({ where: { id: dto.documentoId } });
      if (!doc) throw new NotFoundException(`CatalogoDocumento '${dto.documentoId}' no encontrado`);
    }
    return this.prisma.solicitudDocumento.create({
      data: {
        solicitudId,
        documentoId: dto.documentoId ?? null,
        nombreDocumento: dto.nombreDocumento?.trim() || null,
        archivoNombre: dto.archivoNombre,
        archivoPath: dto.archivoPath,
        mimeType: dto.mimeType,
        tamanoBytes: dto.tamanoBytes,
      },
      include: { documento: { select: { id: true, nombre: true, presentacion: true, clasificacion: true } } },
    });
  }

  async getDocumento(solicitudId: string, docId: string) {
    const doc = await this.prisma.solicitudDocumento.findUnique({ where: { id: docId } });
    if (!doc || doc.solicitudId !== solicitudId) {
      throw new NotFoundException('Documento no encontrado en esta solicitud');
    }
    return doc;
  }

  async removeDocumento(solicitudId: string, docId: string) {
    const doc = await this.getDocumento(solicitudId, docId);
    await this.prisma.solicitudDocumento.delete({ where: { id: docId } });
    return doc; // el controller borra el archivo físico
  }
}
