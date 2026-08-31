import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContratoDto } from './dto/create-contrato.dto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { crearHitoInicialSolicitudCompletado } from '../procesos-contratacion/hito-inicial.util';
import { BillingEngineService } from './billing-engine.service';
import { SupraClientService } from '../supra/supra-client.service';
import { SupraMapService } from '../supra/supra-map.service';
import { minorToPesos } from '../supra/supra.config';

function isFeatureEnabled(flag: string): boolean {
  return process.env[flag]?.toLowerCase() === 'true';
}

type PersonaRelacionInput = {
  personaId?: string;
  nombre?: string;
  rfc?: string;
  curp?: string;
  email?: string;
  telefono?: string;
  razonSocial?: string;
  regimenFiscal?: string;
};

/** FK string fields: trim; empty string becomes null (avoids invalid "" references). */
function optionalFkId(value?: string | null): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t.length > 0 ? t : null;
}

function normalizeDocumentosRecibidos(raw?: string[] | null): string[] {
  return Array.from(
    new Set(
      (raw ?? [])
        .map((d) => String(d).trim())
        .filter((d) => d.length > 0),
    ),
  );
}

async function loadNombreDocumentosObligatorios(
  db: Pick<PrismaClient, 'documentoRequeridoTipoContratacion'>,
  tipoContratacionId: string,
): Promise<string[]> {
  const rows = await db.documentoRequeridoTipoContratacion.findMany({
    where: { tipoContratacionId, obligatorio: true },
    select: { nombreDocumento: true },
  });
  return [
    ...new Set(
      rows
        .map((r) => r.nombreDocumento.trim())
        .filter((n) => n.length > 0),
    ),
  ];
}

function assertDocsRecibidosCubrenObligatorios(
  required: string[],
  docsRecibidos: string[],
): void {
  const received = new Set(docsRecibidos);
  const missing = required.filter((n) => !received.has(n));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Faltan documentos obligatorios marcados como recibidos: ${missing.join(', ')}`,
    );
  }
}

// Estados que implican servicio activo
const ESTADOS_ACTIVOS = ['Activo', 'activo'];
// Estados cortados que pueden reconectarse
const ESTADOS_CORTADOS = ['Cortado', 'cortado'];
// Estados de baja que bloquean la mayoria de tramites
const ESTADOS_BAJA = ['BajaTemp', 'BajaDef', 'Baja Temporal', 'Baja Definitiva'];

/** Domicilio con catálogos INEGI incluidos (PDF / impresión). */
type DomicilioInegiRelationPdf = {
  direccionConcatenada: string | null;
  calle: string;
  numExterior: string | null;
  numInterior: string | null;
  entreCalle1: string | null;
  entreCalle2: string | null;
  codigoPostal: string | null;
  referencia: string | null;
  coloniaINEGI: { nombre: string } | null;
  localidadINEGI: { nombre: string } | null;
  municipioINEGI: { nombre: string; estado: { nombre: string } } | null;
  estadoINEGI: { nombre: string } | null;
};

@Injectable()
export class ContratosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingEngine: BillingEngineService,
    private readonly supra: SupraClientService,
    private readonly supraMapa: SupraMapService,
  ) {}

  /**
   * Saldo por cobrar del contrato. Con SUPRA activo y contrato sincronizado,
   * la verdad es `GET /v1/customers/:id/balance`; si no, el cálculo local
   * (Σ timbrado − Σ pago). Alimenta candados de trámites y contexto 360.
   */
  private async saldoPorCobrar(contratoId: string): Promise<number> {
    if (this.supra.enabled) {
      const customerId = await this.supraMapa.get('contrato', contratoId);
      if (customerId) {
        const balance = await this.supra.getBalance(customerId);
        return minorToPesos(balance.receivable_balance);
      }
    }
    const [facturadoAgg, pagadoAgg] = await Promise.all([
      this.prisma.timbrado.aggregate({
        where: { contratoId, estado: 'Timbrada OK' },
        _sum: { total: true },
      }),
      this.prisma.pago.aggregate({ where: { contratoId }, _sum: { monto: true } }),
    ]);
    return Number(facturadoAgg._sum.total ?? 0) - Number(pagadoAgg._sum.monto ?? 0);
  }

  async findAll() {
    return this.prisma.contrato.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Listado paginado con filtro incremental para integradores (conector de
   * ingesta de SUPRA): orden estable ascendente + `updatedSince` server-side.
   * El GET sin `page` conserva la respuesta legacy (array completo).
   */
  async findAllPaginado(params: { page: number; limit: number; updatedSince?: string }) {
    const where = params.updatedSince
      ? { updatedAt: { gte: new Date(params.updatedSince) } }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.contrato.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.contrato.count({ where }),
    ]);
    return { data, total, page: params.page, limit: params.limit };
  }

  async findOne(id: string) {
    const c = await this.prisma.contrato.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contrato no encontrado');
    return c;
  }

  async update(
    id: string,
    dto: {
      ceaNumContrato?: string | null;
      estado?: string;
      domiciliado?: boolean;
      fechaReconexionPrevista?: string | null;
      bloqueadoJuridico?: boolean;
      razonSocial?: string | null;
      regimenFiscal?: string | null;
      constanciaFiscalUrl?: string | null;
      domicilioId?: string | null;
      puntoServicioId?: string | null;
      tipoContratacionId?: string | null;
      // P1 campos adicionales
      fechaBaja?: string | null;
      actividadId?: string | null;
      categoriaId?: string | null;
      referenciaContratoAnterior?: string | null;
      observaciones?: string | null;
      tipoEnvioFactura?: string | null;
      indicadorEmisionRecibo?: boolean;
      indicadorExentarFacturacion?: boolean;
      indicadorContactoCorreo?: boolean;
      cicloFacturacion?: string | null;
      superficiePredio?: number | null;
      superficieConstruida?: number | null;
      mesesAdeudo?: number | null;
      unidadesServidas?: number | null;
      personasHabitanVivienda?: number | null;
      zonaId?: string | null;
      rutaId?: string | null;
      textoContratoSnapshot?: string | null;
    },
  ) {
    await this.findOne(id);
    const prev = await this.prisma.contrato.findUnique({
      where: { id },
      select: { estado: true, zonaId: true, rutaId: true },
    });
    if (!prev) throw new NotFoundException('Contrato no encontrado');

    const mergedZona = dto.zonaId !== undefined ? dto.zonaId : prev.zonaId;
    const mergedRuta = dto.rutaId !== undefined ? dto.rutaId : prev.rutaId;
    const shouldAutoActivo =
      dto.estado === undefined &&
      !!mergedZona &&
      !!mergedRuta &&
      ['Pendiente de zona', 'Pendiente de alta', 'Pendiente de toma'].includes(
        prev.estado ?? '',
      );

    return this.prisma.contrato.update({
      where: { id },
      data: {
        ...(dto.ceaNumContrato !== undefined && { ceaNumContrato: dto.ceaNumContrato }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(shouldAutoActivo && { estado: 'Activo' }),
        ...(dto.domiciliado !== undefined && { domiciliado: dto.domiciliado }),
        ...(dto.fechaReconexionPrevista !== undefined && { fechaReconexionPrevista: dto.fechaReconexionPrevista }),
        ...(dto.bloqueadoJuridico !== undefined && { bloqueadoJuridico: dto.bloqueadoJuridico }),
        ...(dto.razonSocial !== undefined && { razonSocial: dto.razonSocial }),
        ...(dto.regimenFiscal !== undefined && { regimenFiscal: dto.regimenFiscal }),
        ...(dto.constanciaFiscalUrl !== undefined && { constanciaFiscalUrl: dto.constanciaFiscalUrl }),
        ...(dto.domicilioId !== undefined && { domicilioId: dto.domicilioId }),
        ...(dto.puntoServicioId !== undefined && { puntoServicioId: dto.puntoServicioId }),
        ...(dto.tipoContratacionId !== undefined && { tipoContratacionId: dto.tipoContratacionId }),
        ...(dto.fechaBaja !== undefined && { fechaBaja: dto.fechaBaja }),
        ...(dto.actividadId !== undefined && { actividadId: dto.actividadId }),
        ...(dto.categoriaId !== undefined && { categoriaId: dto.categoriaId }),
        ...(dto.referenciaContratoAnterior !== undefined && { referenciaContratoAnterior: dto.referenciaContratoAnterior }),
        ...(dto.observaciones !== undefined && { observaciones: dto.observaciones }),
        ...(dto.tipoEnvioFactura !== undefined && { tipoEnvioFactura: dto.tipoEnvioFactura }),
        ...(dto.indicadorEmisionRecibo !== undefined && { indicadorEmisionRecibo: dto.indicadorEmisionRecibo }),
        ...(dto.indicadorExentarFacturacion !== undefined && { indicadorExentarFacturacion: dto.indicadorExentarFacturacion }),
        ...(dto.indicadorContactoCorreo !== undefined && { indicadorContactoCorreo: dto.indicadorContactoCorreo }),
        ...(dto.cicloFacturacion !== undefined && { cicloFacturacion: dto.cicloFacturacion }),
        ...(dto.superficiePredio !== undefined && { superficiePredio: dto.superficiePredio }),
        ...(dto.superficieConstruida !== undefined && { superficieConstruida: dto.superficieConstruida }),
        ...(dto.mesesAdeudo !== undefined && { mesesAdeudo: dto.mesesAdeudo }),
        ...(dto.unidadesServidas !== undefined && { unidadesServidas: dto.unidadesServidas }),
        ...(dto.personasHabitanVivienda !== undefined && { personasHabitanVivienda: dto.personasHabitanVivienda }),
        ...(dto.zonaId !== undefined && { zonaId: dto.zonaId }),
        ...(dto.rutaId !== undefined && { rutaId: dto.rutaId }),
        ...(dto.textoContratoSnapshot !== undefined && {
          textoContratoSnapshot: dto.textoContratoSnapshot,
        }),
      },
    });
  }

  async getEstadoOperativo(contratoId: string) {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: {
        id: true,
        nombre: true,
        estado: true,
        bloqueadoJuridico: true,
        fechaReconexionPrevista: true,
      },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const [saldo, convenioActivo] = await Promise.all([
      this.saldoPorCobrar(contratoId),
      this.prisma.convenio.findFirst({
        where: { contratoId, estado: 'Activo' },
        select: { id: true, estado: true },
      }),
    ]);

    const montoAdeudo = Math.max(0, saldo);
    const tieneAdeudo = montoAdeudo > 0.01;

    const estadoNorm = contrato.estado ?? '';
    const esCortado = ESTADOS_CORTADOS.some(s => estadoNorm.toLowerCase().includes(s.toLowerCase()));
    const esActivo = ESTADOS_ACTIVOS.some(s => estadoNorm.toLowerCase() === s.toLowerCase());
    const esBaja = ESTADOS_BAJA.some(s => estadoNorm.toLowerCase().includes(s.toLowerCase()));
    const bloqueadoJuridico = contrato.bloqueadoJuridico;

    const alertas: string[] = [];

    if (bloqueadoJuridico) {
      alertas.push('Contrato con bloqueo jurídico. Comuníquese con el área legal antes de realizar cualquier trámite.');
    }
    if (tieneAdeudo && !bloqueadoJuridico) {
      alertas.push(`Adeudo pendiente de $${montoAdeudo.toFixed(2)} MXN. Algunos trámites requieren saldo en cero.`);
    }
    if (esCortado) {
      alertas.push('Servicio actualmente cortado. Para reconexión realice el pago total o convenga parcialidades.');
    }
    if (esBaja) {
      alertas.push('Contrato en proceso de baja. Las operaciones disponibles son limitadas.');
    }

    // Candado: solo puede tramitar alta/cambios de datos si no está bloqueado jurídicamente
    const canTramitar = !bloqueadoJuridico;
    // Reconexión: solo si está cortado (o tiene adeudo pero quiere convenio)
    const canReconectar = !bloqueadoJuridico && (esCortado || tieneAdeudo);
    // Baja temporal/definitiva: requiere adeudo cero
    const canBaja = !tieneAdeudo && !bloqueadoJuridico && !esBaja;
    // Convenios: solo si no está bloqueado jurídicamente
    const canConvenio = !bloqueadoJuridico && tieneAdeudo;

    return {
      contratoId: contrato.id,
      nombre: contrato.nombre,
      estado: contrato.estado,
      bloqueadoJuridico,
      tieneAdeudo,
      montoAdeudo,
      tieneConvenioActivo: !!convenioActivo,
      fechaReconexionPrevista: contrato.fechaReconexionPrevista,
      canTramitar,
      canReconectar,
      canBaja,
      canConvenio,
      alertas,
    };
  }

  async search(query: string, limit = 10) {
    return this.prisma.contrato.findMany({
      where: {
        OR: [
          { nombre: { contains: query, mode: Prisma.QueryMode.insensitive } },
          { id: { contains: query } },
          { rfc: { contains: query } },
          { direccion: { contains: query, mode: Prisma.QueryMode.insensitive } },
        ],
      },
      select: {
        id: true,
        nombre: true,
        rfc: true,
        estado: true,
        tipoServicio: true,
        direccion: true,
      },
      take: limit,
      orderBy: { nombre: 'asc' },
    });
  }

  async getHistorial(contratoId: string) {
    await this.findOne(contratoId);
    return this.prisma.historicoContrato.findMany({
      where: { contratoId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getContextoAtencion(contratoId: string) {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: {
        id: true,
        nombre: true,
        rfc: true,
        tipoServicio: true,
        estado: true,
        contacto: true,
        direccion: true,
      },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const [saldoSupra, ultimosPagos, ultimasFacturas, quejasAbiertas] =
      await Promise.all([
        this.saldoPorCobrar(contratoId),
        this.prisma.pago.findMany({
          where: { contratoId },
          orderBy: { fecha: 'desc' },
          take: 5,
          select: { id: true, monto: true, fecha: true, tipo: true, concepto: true },
        }),
        this.prisma.timbrado.findMany({
          where: { contratoId },
          orderBy: { fechaEmision: 'desc' },
          take: 3,
          select: { id: true, uuid: true, total: true, estado: true, fechaEmision: true },
        }),
        this.prisma.quejaAclaracion.findMany({
          where: {
            contratoId,
            estado: { notIn: ['Cerrada', 'Cancelada', 'Resuelta'] },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            tipo: true,
            descripcion: true,
            estado: true,
            prioridad: true,
            createdAt: true,
            canal: true,
          },
        }),
      ]);

    // Totales de presentación desde el espejo local (proyección completa);
    // el saldo autoritativo viene de saldoPorCobrar (SUPRA cuando aplica).
    const [totalFacturadoAgg, totalPagadoAgg] = await Promise.all([
      this.prisma.timbrado.aggregate({
        where: { contratoId, estado: 'Timbrada OK' },
        _sum: { total: true },
      }),
      this.prisma.pago.aggregate({ where: { contratoId }, _sum: { monto: true } }),
    ]);
    const totalFacturado = Number(totalFacturadoAgg._sum.total ?? 0);
    const totalPagado = Number(totalPagadoAgg._sum.monto ?? 0);
    const saldo = saldoSupra;

    return {
      contrato,
      saldo,
      ultimosPagos,
      ultimasFacturas,
      quejasAbiertas,
      resumen: {
        totalPagado,
        totalFacturado,
        quejasAbiertas: quejasAbiertas.length,
      },
    };
  }

  async create(dto: CreateContratoDto) {
    const tomaId = optionalFkId(dto.tomaId);
    const puntoServicioId = optionalFkId(dto.puntoServicioId);
    const domicilioId = optionalFkId(dto.domicilioId);
    const tipoContratacionId = optionalFkId(dto.tipoContratacionId);
    const medidorId = optionalFkId(dto.medidorId);
    const rutaId = optionalFkId(dto.rutaId);
    let zonaId = optionalFkId(dto.zonaId);
    if (!zonaId && dto.variablesCapturadas && typeof dto.variablesCapturadas === 'object') {
      const vc = dto.variablesCapturadas as Record<string, unknown>;
      const rawDistrito = vc.distritoId;
      const distritoId =
        typeof rawDistrito === 'string' ? optionalFkId(rawDistrito) : null;
      if (distritoId) {
        const distrito = await this.prisma.distrito.findUnique({
          where: { id: distritoId },
          select: { zonaId: true },
        });
        if (distrito?.zonaId) {
          zonaId = distrito.zonaId;
        }
      }
    }
    const actividadId = optionalFkId(dto.actividadId);
    const categoriaId = optionalFkId(dto.categoriaId);
    const plantillaContratacionId = optionalFkId(dto.plantillaContratacionId);

    const refChecks: Promise<void>[] = [];

    if (tomaId) {
      refChecks.push(
        this.prisma.toma
          .findUnique({ where: { id: tomaId }, select: { id: true } })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `La toma indicada no existe (tomaId: ${tomaId}).`,
              );
            }
          }),
      );
    }
    if (puntoServicioId) {
      refChecks.push(
        this.prisma.puntoServicio
          .findUnique({ where: { id: puntoServicioId }, select: { id: true } })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `El punto de servicio indicado no existe (puntoServicioId: ${puntoServicioId}).`,
              );
            }
          }),
      );
    }
    if (domicilioId) {
      refChecks.push(
        this.prisma.domicilio
          .findUnique({ where: { id: domicilioId }, select: { id: true } })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `El domicilio indicado no existe (domicilioId: ${domicilioId}).`,
              );
            }
          }),
      );
    }
    if (tipoContratacionId) {
      refChecks.push(
        this.prisma.tipoContratacion
          .findUnique({
            where: { id: tipoContratacionId },
            select: { id: true },
          })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `El tipo de contratación indicado no existe (tipoContratacionId: ${tipoContratacionId}).`,
              );
            }
          }),
      );
    }
    if (medidorId) {
      refChecks.push(
        this.prisma.medidor
          .findUnique({ where: { id: medidorId }, select: { id: true } })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `El medidor indicado no existe (medidorId: ${medidorId}).`,
              );
            }
          }),
      );
    }
    if (rutaId) {
      refChecks.push(
        this.prisma.ruta
          .findUnique({ where: { id: rutaId }, select: { id: true } })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `La ruta indicada no existe (rutaId: ${rutaId}).`,
              );
            }
          }),
      );
    }
    if (zonaId) {
      refChecks.push(
        this.prisma.zona
          .findUnique({ where: { id: zonaId }, select: { id: true } })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `La zona indicada no existe (zonaId: ${zonaId}).`,
              );
            }
          }),
      );
    }
    if (actividadId) {
      refChecks.push(
        this.prisma.catalogoActividad
          .findUnique({ where: { id: actividadId }, select: { id: true } })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `La actividad del catálogo indicada no existe (actividadId: ${actividadId}).`,
              );
            }
          }),
      );
    }
    if (categoriaId) {
      refChecks.push(
        this.prisma.catalogoCategoria
          .findUnique({ where: { id: categoriaId }, select: { id: true } })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `La categoría del catálogo indicada no existe (categoriaId: ${categoriaId}).`,
              );
            }
          }),
      );
    }
    if (plantillaContratacionId) {
      refChecks.push(
        this.prisma.plantillaContrato
          .findUnique({
            where: { id: plantillaContratacionId },
            select: { id: true },
          })
          .then((row) => {
            if (!row) {
              throw new BadRequestException(
                `La plantilla de contratación indicada no existe (plantillaContratacionId: ${plantillaContratacionId}).`,
              );
            }
          }),
      );
    }

    await Promise.all(refChecks);

    const docsRecibidos = normalizeDocumentosRecibidos(dto.documentosRecibidos);
    if (plantillaContratacionId && docsRecibidos.length === 0) {
      throw new BadRequestException(
        'plantillaContratacionId solo aplica cuando documentosRecibidos incluye al menos un documento.',
      );
    }

    let estadoInicial = dto.estado;
    if (dto.generarOrdenInstalacionToma === true) {
      estadoInicial = 'Pendiente de toma';
    } else if (dto.generarOrdenInstalacionMedidor === true) {
      estadoInicial = 'Pendiente de zona';
    }

    const omitirPersona = dto.omitirRegistroPersonaTitular === true;

    // B3 — Pre-valida las tarifas ANTES de abrir la transacción de alta.
    // `billingEngine.calcular` es solo-lectura; si una expresión de tarifa es
    // inválida, `safeEvalArithmetic` lanza con la expresión ofensiva. Aquí lo
    // convertimos en un 4xx descriptivo de forma que un tipo mal configurado
    // NO haga trabajo parcial (rollback del contrato completo) ni facture cero.
    if (
      dto.generarFacturaContratacion &&
      isFeatureEnabled('FEATURE_FACTURACION_CONTRATACION') &&
      tipoContratacionId
    ) {
      try {
        await this.billingEngine.calcular(
          tipoContratacionId,
          (dto.variablesCapturadas as Record<string, string | number | boolean>) ?? {},
        );
      } catch (err: unknown) {
        if (err instanceof HttpException) throw err;
        throw new UnprocessableEntityException(
          `No se puede crear el contrato: tarifa inválida — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let procesoGestionadoEnAlta = false;

      if (tipoContratacionId) {
        const required = await loadNombreDocumentosObligatorios(
          tx,
          tipoContratacionId,
        );
        assertDocsRecibidosCubrenObligatorios(required, docsRecibidos);
      }

      const findOrCreatePersona = async (
        input: PersonaRelacionInput,
      ): Promise<{ id: string }> => {
        const personaId = optionalFkId(input.personaId);
        if (personaId) {
          const existente = await tx.persona.findUnique({
            where: { id: personaId },
            select: { id: true },
          });
          if (!existente) {
            throw new BadRequestException(
              `La persona indicada no existe (personaId: ${personaId}).`,
            );
          }
          return existente;
        }

        const nombre = (input.nombre ?? '').trim();
        const rfc = (input.rfc ?? '').trim();
        if (!nombre || !rfc) {
          throw new BadRequestException(
            'Para registrar una persona relacionada se requiere personaId o nombre+rfc.',
          );
        }

        const porRfc = await tx.persona.findFirst({
          where: { rfc },
          select: { id: true },
        });
        if (porRfc) return porRfc;

        return tx.persona.create({
          data: {
            nombre,
            rfc,
            curp: (input.curp ?? '').trim() || null,
            tipo: (input.razonSocial ?? '').trim() ? 'Moral' : 'Fisica',
            email: (input.email ?? '').trim() || null,
            telefono: (input.telefono ?? '').trim() || null,
            razonSocial: (input.razonSocial ?? '').trim() || null,
            regimenFiscal: (input.regimenFiscal ?? '').trim() || null,
          },
          select: { id: true },
        });
      };

      const upsertRolPersona = async (
        contratoId: string,
        rol: 'PROPIETARIO' | 'FISCAL' | 'CONTACTO',
        input?: PersonaRelacionInput,
      ) => {
        if (!input) return;
        const persona = await findOrCreatePersona(input);
        await tx.rolPersonaContrato.upsert({
          where: {
            personaId_contratoId_rol: {
              personaId: persona.id,
              contratoId,
              rol,
            },
          },
          create: {
            personaId: persona.id,
            contratoId,
            rol,
          },
          update: { activo: true, fechaHasta: null },
        });
      };

      const contrato = await tx.contrato.create({
        data: {
          tomaId,
          puntoServicioId,
          domicilioId,
          tipoContratacionId,
          tipoContrato: dto.tipoContrato,
          tipoServicio: dto.tipoServicio,
          nombre: dto.nombre,
          rfc: dto.rfc,
          razonSocial: dto.razonSocial ?? null,
          regimenFiscal: dto.regimenFiscal ?? null,
          direccion: dto.direccion ?? '',
          contacto: dto.contacto ?? '',
          estado: estadoInicial,
          fecha: dto.fecha,
          medidorId,
          rutaId,
          zonaId,
          domiciliado: dto.domiciliado ?? false,
          fechaReconexionPrevista: dto.fechaReconexionPrevista ?? null,
          ceaNumContrato: dto.ceaNumContrato ?? null,
          fechaBaja: dto.fechaBaja ?? null,
          actividadId,
          categoriaId,
          referenciaContratoAnterior: dto.referenciaContratoAnterior ?? null,
          observaciones: dto.observaciones ?? null,
          tipoEnvioFactura: dto.tipoEnvioFactura ?? null,
          indicadorEmisionRecibo: dto.indicadorEmisionRecibo ?? true,
          indicadorExentarFacturacion: dto.indicadorExentarFacturacion ?? false,
          indicadorContactoCorreo: dto.indicadorContactoCorreo ?? false,
          cicloFacturacion: dto.cicloFacturacion ?? null,
          superficiePredio: dto.superficiePredio ?? null,
          superficieConstruida: dto.superficieConstruida ?? null,
          mesesAdeudo: dto.mesesAdeudo ?? null,
          unidadesServidas: dto.unidadesServidas ?? null,
          personasHabitanVivienda: dto.personasHabitanVivienda ?? null,
          variablesCapturadas: dto.variablesCapturadas ?? Prisma.JsonNull,
        },
      });

      if (!omitirPersona) {
        let persona = await tx.persona.findFirst({
          where: { rfc: dto.rfc },
        });
        if (!persona) {
          persona = await tx.persona.create({
            data: {
              nombre: dto.nombre,
              rfc: dto.rfc,
              tipo: 'Fisica',
              telefono: (dto.contacto ?? '').trim() || null,
            },
          });
        }
        await tx.rolPersonaContrato.upsert({
          where: {
            personaId_contratoId_rol: {
              personaId: persona.id,
              contratoId: contrato.id,
              rol: 'PROPIETARIO',
            },
          },
          create: {
            personaId: persona.id,
            contratoId: contrato.id,
            rol: 'PROPIETARIO',
          },
          update: { activo: true },
        });
      }

      if (dto.personaFiscal) {
        await upsertRolPersona(contrato.id, 'FISCAL', dto.personaFiscal);
      }
      if (dto.personaContacto) {
        await upsertRolPersona(contrato.id, 'CONTACTO', dto.personaContacto);
      }

      if (dto.generarOrdenInstalacionToma === true) {
        await tx.orden.create({
          data: {
            contratoId: contrato.id,
            tipo: 'InstalacionToma',
            prioridad: 'Normal',
            notas: 'Generada en alta de contrato',
            origenAutomatico: true,
            eventoOrigen: 'contrato.create',
          },
        });
      } else if (dto.generarOrdenInstalacionMedidor === true) {
        await tx.orden.create({
          data: {
            contratoId: contrato.id,
            tipo: 'InstalacionMedidor',
            prioridad: 'Normal',
            notas: 'Generada en alta de contrato',
            origenAutomatico: true,
            eventoOrigen: 'contrato.create',
          },
        });
      }

      // Siempre crear/actualizar el ProcesoContratacion al dar de alta un contrato
      {
        const procesoReciente = await tx.procesoContratacion.findFirst({
          where: { contratoId: contrato.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true, datosAdicionales: true, plantillaId: true },
        });

        const plantillaParaProceso = plantillaContratacionId;

        if (procesoReciente) {
          const prev =
            procesoReciente.datosAdicionales &&
            typeof procesoReciente.datosAdicionales === 'object' &&
            !Array.isArray(procesoReciente.datosAdicionales)
              ? (procesoReciente.datosAdicionales as Record<string, unknown>)
              : {};

          await tx.procesoContratacion.update({
            where: { id: procesoReciente.id },
            data: {
              ...(plantillaParaProceso && !procesoReciente.plantillaId
                ? { plantillaId: plantillaParaProceso }
                : {}),
              ...(docsRecibidos.length > 0 && {
                datosAdicionales: {
                  ...prev,
                  documentosRecibidos: docsRecibidos,
                  checklistCapturadoEnAlta: true,
                },
              }),
            },
          });
          const nHitos = await tx.hitoContratacion.count({
            where: { procesoId: procesoReciente.id },
          });
          if (nHitos === 0) {
            await crearHitoInicialSolicitudCompletado(tx, procesoReciente.id, null);
          }
        } else {
          const nuevoProceso = await tx.procesoContratacion.create({
            data: {
              contratoId: contrato.id,
              etapa: 'solicitud',
              estado: 'en_progreso',
              plantillaId: plantillaParaProceso ?? null,
              ...(docsRecibidos.length > 0 && {
                datosAdicionales: {
                  documentosRecibidos: docsRecibidos,
                  checklistCapturadoEnAlta: true,
                },
              }),
            },
          });
          await crearHitoInicialSolicitudCompletado(tx, nuevoProceso.id, null);
        }
        procesoGestionadoEnAlta = true;
      }

      // ── Snapshot del texto contractual al momento del alta ──
      const snapshot = await this.buildTextoSnapshot(
        tx,
        contrato.id,
        this.mergeTemplateInterpolationVars(
          {
            nombre: contrato.nombre,
            rfc: contrato.rfc,
            direccion: contrato.direccion ?? '',
            contacto: contrato.contacto ?? '',
            razonSocial: contrato.razonSocial,
            regimenFiscal: contrato.regimenFiscal,
            fecha: contrato.fecha,
          },
          contrato.variablesCapturadas,
        ),
        tipoContratacionId,
      );
      if (snapshot) {
        await tx.contrato.update({
          where: { id: contrato.id },
          data: { textoContratoSnapshot: snapshot },
        });
      }

      // ── Factura de contratación (detrás de feature flag) ──
      let facturaContratacion: {
        timbradoId: string;
        costos: { concepto: string; monto: number }[];
        total: number;
      } | null = null;
      if (
        dto.generarFacturaContratacion &&
        isFeatureEnabled('FEATURE_FACTURACION_CONTRATACION') &&
        tipoContratacionId
      ) {
        facturaContratacion = await this.crearFacturaContratacionTx(
          tx,
          contrato.id,
          tipoContratacionId,
          contrato.fecha,
          (dto.variablesCapturadas as Record<string, string | number | boolean>) ?? {},
          dto.conceptosOverride,
        );
      }

      return {
        ...contrato,
        procesoGestionadoEnAlta,
        ...(facturaContratacion ? { facturaContratacion } : {}),
      };
    });
  }

  /** Flujo completo del contrato: personas, domicilio, tipo contratación, órdenes, trámites, procesos e historial */
  async getFlujoCompleto(contratoId: string) {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      include: {
        domicilio: {
          include: {
            coloniaINEGI: true,
            municipioINEGI: true,
            estadoINEGI: true,
          },
        },
        tipoContratacion: {
          include: {
            conceptos: { include: { conceptoCobro: true } },
            clausulas: { include: { clausula: true } },
            documentos: true,
          },
        },
        personas: {
          where: { activo: true },
          include: {
            persona: {
              select: {
                id: true,
                nombre: true,
                apellidoPaterno: true,
                apellidoMaterno: true,
                rfc: true,
                curp: true,
                tipo: true,
                email: true,
                telefono: true,
              },
            },
          },
        },
        ordenes: {
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            tipo: true,
            estado: true,
            prioridad: true,
            fechaSolicitud: true,
            fechaProgramada: true,
            fechaEjecucion: true,
            notas: true,
            origenAutomatico: true,
            eventoOrigen: true,
          },
        },
        tramites: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            folio: true,
            tipo: true,
            estado: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        procesosContratacion: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            hitos: { orderBy: { createdAt: 'asc' } },
            plantilla: { select: { id: true, nombre: true, version: true } },
          },
        },
        historico: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    return contrato;
  }

  /** Vista previa de texto contractual (plantilla del proceso o cláusulas del tipo), con sustitución básica de variables. */
  async getTextoContratoPreview(contratoId: string) {
    const c = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      include: {
        tipoContratacion: {
          include: {
            clausulas: {
              orderBy: { orden: 'asc' },
              include: { clausula: true },
            },
          },
        },
      },
    });
    if (!c) throw new NotFoundException('Contrato no encontrado');

    const proceso = await this.prisma.procesoContratacion.findFirst({
      where: { contratoId },
      orderBy: { createdAt: 'desc' },
      include: { plantilla: true },
    });

    let base = (proceso?.plantilla?.contenido ?? '').trim();
    let fuente: 'plantilla' | 'clausulas' | 'vacío' = 'vacío';
    if (base.length > 0) {
      fuente = 'plantilla';
    } else if (c.tipoContratacion?.clausulas?.length) {
      base = c.tipoContratacion.clausulas
        .map((row) => row.clausula.contenido)
        .join('\n\n');
      fuente = 'clausulas';
    }

    const merged = this.mergeTemplateInterpolationVars(
      {
        nombre: c.nombre,
        rfc: c.rfc,
        direccion: c.direccion,
        contacto: c.contacto,
        razonSocial: c.razonSocial ?? '',
        regimenFiscal: c.regimenFiscal ?? '',
        fecha: c.fecha,
      },
      c.variablesCapturadas,
    );
    let texto = base;
    for (const [k, v] of Object.entries(merged)) {
      texto = texto.split(`{{${k}}}`).join(v);
    }

    return { texto, fuente, contratoId: c.id };
  }

  /** Genera el HTML del contrato para impresión/PDF (usa snapshot si existe). */
  async getContratoPdf(contratoId: string): Promise<string> {
    const domicilioInclude = {
      coloniaINEGI: true,
      localidadINEGI: true,
      municipioINEGI: { include: { estado: true } },
      estadoINEGI: true,
    } as const;

    const c = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      include: {
        domicilio: { include: domicilioInclude },
        puntoServicio: { include: { domicilio: { include: domicilioInclude } } },
        actividad: true,
      },
    });
    if (!c) throw new NotFoundException('Contrato no encontrado');

    let body: string;
    if (c.textoContratoSnapshot) {
      body = c.textoContratoSnapshot;
    } else {
      const preview = await this.getTextoContratoPreview(contratoId);
      body = preview.texto;
    }

    const calibreId = this.readVariablesCapturadasString(
      c.variablesCapturadas,
      'calibreMedidorId',
    );
    let calibreDescripcion = '';
    if (calibreId.length > 0) {
      const cal = await this.prisma.catalogoCalibre.findUnique({
        where: { id: calibreId },
        select: { descripcion: true, codigo: true },
      });
      calibreDescripcion =
        cal?.descripcion?.trim() || cal?.codigo?.trim() || calibreId;
    }

    const numeroContrato = c.ceaNumContrato?.trim() || c.id;
    const bloqueDatosInstalacionHtml = this.buildDatosInstalacionHtml(c, {
      calibreMedidorLabel: calibreDescripcion,
    });

    return this.wrapTextoHtml(body, c.nombre, c.fecha, {
      numeroContrato,
      incluirSegundaCopia: true,
      bloqueDatosInstalacionHtml,
    });
  }

  /** Genera la factura de contratación para un contrato ya existente (endpoint standalone). */
  async crearFacturaContratacion(
    contratoId: string,
  ): Promise<{
    timbradoId: string;
    costos: { concepto: string; monto: number }[];
    total: number;
  }> {
    if (!isFeatureEnabled('FEATURE_FACTURACION_CONTRATACION')) {
      throw new BadRequestException(
        'Feature FEATURE_FACTURACION_CONTRATACION no habilitada',
      );
    }
    const c = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true, tipoContratacionId: true, fecha: true },
    });
    if (!c) throw new NotFoundException('Contrato no encontrado');
    if (!c.tipoContratacionId) {
      throw new BadRequestException(
        'Contrato sin tipo de contratación asignado',
      );
    }
    return this.prisma.$transaction((tx) =>
      this.crearFacturaContratacionTx(
        tx,
        c.id,
        c.tipoContratacionId!,
        c.fecha,
      ),
    );
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private readVariablesCapturadasString(
    captured: Prisma.JsonValue | null | undefined,
    key: string,
  ): string {
    if (
      !captured ||
      typeof captured !== 'object' ||
      Array.isArray(captured)
    ) {
      return '';
    }
    const v = (captured as Record<string, unknown>)[key];
    if (v == null) return '';
    const s = String(v).trim();
    return s;
  }

  private formatDomicilioForPdf(d: DomicilioInegiRelationPdf | null): string {
    if (!d) return '';
    const dc = d.direccionConcatenada?.trim();
    if (dc) return dc;
    const parts: string[] = [];
    const line1 = [d.calle?.trim(), d.numExterior?.trim(), d.numInterior?.trim()]
      .filter(Boolean)
      .join(' ');
    if (line1) parts.push(line1);
    const e1 = d.entreCalle1?.trim();
    const e2 = d.entreCalle2?.trim();
    if (e1 || e2) {
      parts.push(
        `Entre calles: ${[e1, e2].filter(Boolean).join(' y ')}`.trim(),
      );
    }
    if (d.coloniaINEGI?.nombre?.trim()) {
      parts.push(`Col. ${d.coloniaINEGI.nombre.trim()}`);
    }
    if (d.localidadINEGI?.nombre?.trim()) {
      parts.push(d.localidadINEGI.nombre.trim());
    }
    const mun = d.municipioINEGI?.nombre?.trim();
    const edo =
      d.estadoINEGI?.nombre?.trim() ??
      d.municipioINEGI?.estado?.nombre?.trim();
    if (mun && edo) parts.push(`${mun}, ${edo}`);
    else if (mun) parts.push(mun);
    else if (edo) parts.push(edo);
    if (d.codigoPostal?.trim()) parts.push(`C.P. ${d.codigoPostal.trim()}`);
    if (d.referencia?.trim()) parts.push(`Ref.: ${d.referencia.trim()}`);
    return parts.join(', ').trim();
  }

  /** Separa el párrafo inicial (partes) del resto (transición + cláusulas) como en el impreso oficial. */
  private splitCuerpoContratoParaPdf(body: string): { antes: string; resto: string } {
    const b = body.trim();
    const marker = '\n\nEl presente Contrato se sujetará';
    const idx = b.toLowerCase().indexOf(marker.toLowerCase());
    if (idx >= 0) {
      return {
        antes: b.slice(0, idx).trim(),
        resto: b.slice(idx + 2).trim(),
      };
    }
    const pars = b.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    if (pars.length >= 2) {
      return { antes: pars[0].trim(), resto: pars.slice(1).join('\n\n').trim() };
    }
    return { antes: b, resto: '' };
  }

  private formatDiametroTomaMm(raw: string): string {
    const t = raw.trim();
    if (!t) return '';
    if (/\bmm\b/i.test(t)) return t;
    return `${t} mm`;
  }

  private escapeHtmlBodyForPdf(body: string): string {
    const escaped = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
    const parts = escaped.split(/<br\s*\/?>/i);
    const merged = parts.map((p) =>
      p.trim() === 'CLÁUSULAS'
        ? '<span class="titulo-clausulas">CLÁUSULAS</span>'
        : p,
    );
    return merged.join('<br/>');
  }

  private buildDatosInstalacionHtml(
    c: {
      direccion: string;
      tipoContrato: string;
      tipoServicio: string;
      rfc: string;
      unidadesServidas: number | null;
      variablesCapturadas: Prisma.JsonValue | null;
      domicilio: DomicilioInegiRelationPdf | null;
      puntoServicio: {
        diametroToma: string | null;
        domicilio: DomicilioInegiRelationPdf | null;
      } | null;
      actividad: { descripcion: string } | null;
    },
    opts: { calibreMedidorLabel: string },
  ): string {
    const dirServ =
      this.formatDomicilioForPdf(c.puntoServicio?.domicilio ?? null) ||
      this.formatDomicilioForPdf(c.domicilio) ||
      c.direccion?.trim() ||
      '';

    const diametroPunto = c.puntoServicio?.diametroToma?.trim() ?? '';
    const diametro =
      diametroPunto.length > 0
        ? diametroPunto
        : opts.calibreMedidorLabel.trim();

    const tipoUsuario = String(c.tipoContrato ?? '').trim();
    const uso = String(c.tipoServicio ?? '').trim();
    const giro = c.actividad?.descripcion?.trim() ?? '';
    const unidades =
      c.unidadesServidas != null && c.unidadesServidas >= 0
        ? String(c.unidadesServidas)
        : '';
    const gasto =
      this.readVariablesCapturadasString(c.variablesCapturadas, 'gasto') ||
      this.readVariablesCapturadasString(
        c.variablesCapturadas,
        'gastoMaximoInstantaneo',
      );

    const diametroFmt = this.formatDiametroTomaMm(diametro);
    const any =
      dirServ.length > 0 ||
      diametroFmt.length > 0 ||
      tipoUsuario.length > 0 ||
      uso.length > 0 ||
      giro.length > 0 ||
      unidades.length > 0 ||
      gasto.length > 0;
    if (!any) return '';

    const lineaDir = `<p class="inst-linea"><span class="inst-k">Dirección de servicio:</span> ${dirServ.length > 0 ? this.escapeHtmlPlain(dirServ) : '—'}</p>`;
    const lineaDiam = `<p class="inst-linea"><span class="inst-k">Diámetro de la toma:</span> ${diametroFmt.length > 0 ? this.escapeHtmlPlain(diametroFmt) : '—'}</p>`;
    const lineaTipoGiro = `<div class="inst-row-dos">
      <span><span class="inst-k">Tipo de usuario:</span> ${tipoUsuario.length > 0 ? this.escapeHtmlPlain(tipoUsuario) : '—'}</span>
      <span class="inst-derecha"><span class="inst-k">Giro:</span> ${giro.length > 0 ? this.escapeHtmlPlain(giro) : '—'}</span>
    </div>`;
    const lineaUsoGastoUnd = `<div class="inst-row-tres">
      <span><span class="inst-k">Uso:</span> ${uso.length > 0 ? this.escapeHtmlPlain(uso) : '—'}</span>
      <span class="inst-centro"><span class="inst-k">Gasto:</span>${gasto.length > 0 ? ` ${this.escapeHtmlPlain(gasto)}` : ''}</span>
      <span class="inst-derecha"><span class="inst-k">Unidades</span> ${unidades.length > 0 ? this.escapeHtmlPlain(unidades) : '—'}</span>
    </div>`;

    const inner = [lineaDir, lineaDiam, lineaTipoGiro, lineaUsoGastoUnd].join('');
    return `<div class="datos-instalacion"><h2>Datos de instalación</h2>${inner}</div>`;
  }

  /**
   * Variables fijas del contrato + `variablesCapturadas` (plantilla/cláusulas pueden usar `{{clave}}`).
   * En colisión de clave, ganan los campos fijos (nombre, rfc, etc.).
   */
  private mergeTemplateInterpolationVars(
    fixed: Record<string, string | null | undefined>,
    captured: Prisma.JsonValue | null | undefined,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    if (
      captured &&
      typeof captured === 'object' &&
      !Array.isArray(captured)
    ) {
      for (const [k, v] of Object.entries(captured as Record<string, unknown>)) {
        out[k] = this.stringifyInterpolationValue(v);
      }
    }
    for (const [k, v] of Object.entries(fixed)) {
      out[k] = v == null ? '' : String(v);
    }
    return out;
  }

  private stringifyInterpolationValue(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      return String(v);
    }
    return JSON.stringify(v);
  }

  private async buildTextoSnapshot(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    contratoId: string,
    vars: Record<string, string>,
    tipoContratacionId: string | null | undefined,
  ): Promise<string | null> {
    const proceso = await tx.procesoContratacion.findFirst({
      where: { contratoId },
      orderBy: { createdAt: 'desc' },
      include: { plantilla: true },
    });

    let base = (proceso?.plantilla?.contenido ?? '').trim();
    if (!base && tipoContratacionId) {
      const tipo = await tx.tipoContratacion.findUnique({
        where: { id: tipoContratacionId },
        include: {
          clausulas: {
            orderBy: { orden: 'asc' },
            include: { clausula: true },
          },
        },
      });
      base =
        tipo?.clausulas?.map((r) => r.clausula.contenido).join('\n\n') ?? '';
    }
    if (!base) return null;

    let texto = base;
    for (const [k, v] of Object.entries(vars)) {
      texto = texto.split(`{{${k}}}`).join(v);
    }
    return texto;
  }

  private async crearFacturaContratacionTx(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    contratoId: string,
    tipoContratacionId: string,
    fecha: string,
    variables: Record<string, string | number | boolean> = {},
    conceptosOverride?: { conceptoCobroId: string; cantidad: number }[],
  ): Promise<{
    timbradoId: string;
    costos: { concepto: string; monto: number }[];
    total: number;
  }> {
    const preview = await this.billingEngine.calcular(tipoContratacionId, variables);
    const overrideMap = new Map(
      (conceptosOverride ?? []).map((o) => [o.conceptoCobroId, o.cantidad]),
    );

    let subtotal = 0;
    let totalIva = 0;

    for (const item of preview.items) {
      const qty = overrideMap.get(item.conceptoCobroId) ?? item.cantidad;
      const importe = item.tipo === 'fijo'
        ? item.importe
        : Math.round((qty * item.precioProporcional + item.precioBase) * 100) / 100;
      const iva = Math.round(importe * (item.ivaPct / 100) * 100) / 100;

      await tx.contratoConcepto.create({
        data: {
          contratoId,
          conceptoCobroId: item.conceptoCobroId,
          nombre: item.nombre,
          tipo: item.tipo,
          cantidad: qty,
          precioBase: item.precioBase,
          precioProporcional: item.precioProporcional,
          importe,
          ivaPct: item.ivaPct,
          ivaImporte: iva,
          obligatorio: item.obligatorio,
          orden: item.orden,
        },
      });

      await tx.costoContrato.create({
        data: {
          contratoId,
          concepto: item.nombre,
          monto: importe,
        },
      });

      subtotal += importe;
      totalIva += iva;
    }

    const total = Math.round((subtotal + totalIva) * 100) / 100;

    const timbrado = await tx.timbrado.create({
      data: {
        contratoId,
        estado: 'Pendiente',
        periodo: fecha,
        subtotal,
        iva: totalIva,
        total,
        fechaEmision: fecha,
        fechaVencimiento: fecha,
      },
    });

    return {
      timbradoId: timbrado.id,
      costos: preview.items.map((i) => ({ concepto: i.nombre, monto: i.importe })),
      total,
    };
  }

  private escapeHtmlPlain(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private contratoPrintSignaturesHtml(): string {
    return `
  <div class="duplicado">
    <p>Se extiende el presente contrato por duplicado. Un ejemplar para el usuario, quien declara estar conforme con todas sus partes y haber entendido su significado y alcance legal.</p>
  </div>
  <table class="firmas" role="presentation">
    <tr>
      <td class="firma-col">
        <div class="firma-titulo">LA COMISIÓN</div>
        <div class="firma-linea"></div>
        <div class="firma-sub">Nombre y firma del funcionario</div>
      </td>
      <td class="firma-col">
        <div class="firma-titulo">EL USUARIO</div>
        <div class="firma-linea"></div>
        <div class="firma-sub">Nombre y firma del usuario y/o representante legal</div>
      </td>
    </tr>
  </table>`;
  }

  /**
   * HTML para impresión / PDF del contrato (navegador).
   * Orden alineado al formato impreso: número de contrato, párrafo de partes (plantilla),
   * bloque «Datos de instalación», transición + CLÁUSULAS + cuerpo, firmas y segunda copia.
   */
  private wrapTextoHtml(
    body: string,
    nombre: string,
    _fecha: string,
    opts?: {
      numeroContrato?: string | null;
      incluirSegundaCopia?: boolean;
      /** HTML ya escapado (solo etiquetas seguras generadas en servidor). */
      bloqueDatosInstalacionHtml?: string;
    },
  ): string {
    const safeNombre = this.escapeHtmlPlain(String(nombre ?? ''));
    const rawNum = (opts?.numeroContrato ?? '').toString().trim();
    const safeNum = this.escapeHtmlPlain(rawNum.length > 0 ? rawNum : '—');
    const incluir2 = opts?.incluirSegundaCopia !== false;
    const sig = this.contratoPrintSignaturesHtml();
    const datosInst = opts?.bloqueDatosInstalacionHtml ?? '';

    const { antes, resto } = this.splitCuerpoContratoParaPdf(body);
    const htmlApertura = this.escapeHtmlBodyForPdf(antes);
    const htmlResto = resto.length > 0 ? this.escapeHtmlBodyForPdf(resto) : '';

    const contractSection = (copyLabel: string | null) => `
  <section class="hoja-contrato">
    ${copyLabel ? `<p class="hoja-etiqueta">${this.escapeHtmlPlain(copyLabel)}</p>` : ''}
    <p class="num-contrato-top">Número de contrato: <strong>${safeNum}</strong></p>
    <div class="apertura-contrato body-text">${htmlApertura}</div>
    ${datosInst}
    ${htmlResto.length > 0 ? `<div class="cuerpo-contrato body-text">${htmlResto}</div>` : ''}
    ${sig}
  </section>`;

    const cuerpoPrincipal = contractSection(null);
    const cuerpoCopia = incluir2
      ? '<div class="salto-hoja"></div>' + contractSection('Copia')
      : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Contrato – ${safeNombre}</title>
  <style>
    @page { size: letter; margin: 1.8cm; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.45; color: #111; }
    .num-contrato-top { text-align: left; font-size: 11pt; margin: 0 0 0.65em; }
    .apertura-contrato { text-align: justify; margin: 0 0 0.5em; }
    .cuerpo-contrato { text-align: justify; margin-top: 0.35em; }
    .titulo-clausulas { display: block; text-align: center; font-weight: bold; margin: 0.65em 0 0.5em; font-size: 11pt; }
    .datos-instalacion { margin: 0.75em 0; padding: 0; border: none; background: transparent; page-break-inside: avoid; }
    .datos-instalacion h2 { font-size: 11pt; margin: 0 0 0.4em; text-align: left; font-weight: bold; }
    .inst-linea { margin: 0.15em 0; font-size: 10.5pt; text-align: justify; }
    .inst-k { font-weight: bold; color: #111; }
    .inst-row-dos { display: flex; justify-content: space-between; gap: 1em; font-size: 10.5pt; margin: 0.2em 0; flex-wrap: wrap; }
    .inst-row-tres { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; font-size: 10.5pt; margin: 0.2em 0; flex-wrap: wrap; }
    .inst-derecha { margin-left: auto; text-align: right; }
    .inst-centro { flex: 1; text-align: center; min-width: 6em; }
    .body-text { text-align: justify; }
    .duplicado { margin-top: 1.25em; font-size: 10pt; font-style: italic; text-align: justify; }
    table.firmas { width: 100%; margin-top: 2.5em; border-collapse: collapse; }
    .firma-col { width: 50%; vertical-align: top; padding: 0.5em 1em 0 0; }
    .firma-titulo { font-weight: bold; font-size: 10.5pt; margin-bottom: 2.5em; }
    .firma-linea { border-bottom: 1px solid #000; height: 1px; margin-bottom: 0.35em; width: 92%; }
    .firma-sub { font-size: 9pt; color: #333; }
    .hoja-etiqueta { font-size: 10pt; font-weight: bold; margin: 0 0 0.5em; text-transform: uppercase; }
    .salto-hoja { page-break-before: always; break-before: page; height: 0; margin: 0; padding: 0; }
    .hoja-contrato { page-break-inside: avoid; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
${cuerpoPrincipal}${cuerpoCopia}
</body>
</html>`;
  }
}
