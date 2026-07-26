import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupraApiError, SupraClientService, SupraObligation } from './supra-client.service';
import { pesosToMinor, supraRef } from './supra.config';

export type SupraEntidad =
  | 'contrato'
  | 'recibo'
  | 'pago'
  | 'convenio'
  | 'intento'
  | 'statement_source';

/**
 * Mapa bidireccional de identificadores Hydra ↔ SUPRA.
 *
 * Canónico financiero: IDs de SUPRA (cus_/obl_/pay_/pplan_…).
 * Canónico operativo: cuids de Hydra. El puente persistido es `supra_mapa`
 * más el `external_ref` (`hydra:<entidad>:<id>`) del lado SUPRA — la misma
 * convención que usa el conector de ingesta de SUPRA.
 */
@Injectable()
export class SupraMapService {
  private readonly logger = new Logger(SupraMapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SupraClientService,
  ) {}

  async get(entidad: SupraEntidad, hydraId: string): Promise<string | null> {
    const row = await this.prisma.supraMapa.findUnique({
      where: { entidad_hydraId: { entidad, hydraId } },
      select: { supraId: true },
    });
    return row?.supraId ?? null;
  }

  async reverse(entidad: SupraEntidad, supraId: string): Promise<string | null> {
    const row = await this.prisma.supraMapa.findUnique({
      where: { entidad_supraId: { entidad, supraId } },
      select: { hydraId: true },
    });
    return row?.hydraId ?? null;
  }

  /** Reverse masivo (una sola query): supraId → hydraId de los mapeados. */
  async reverseMany(entidad: SupraEntidad, supraIds: string[]): Promise<Map<string, string>> {
    if (supraIds.length === 0) return new Map();
    const rows = await this.prisma.supraMapa.findMany({
      where: { entidad, supraId: { in: supraIds } },
      select: { hydraId: true, supraId: true },
    });
    return new Map(rows.map((r) => [r.supraId, r.hydraId]));
  }

  async save(entidad: SupraEntidad, hydraId: string, supraId: string): Promise<void> {
    await this.prisma.supraMapa.upsert({
      where: { entidad_hydraId: { entidad, hydraId } },
      create: { entidad, hydraId, supraId },
      update: { supraId },
    });
  }

  /**
   * Contrato Hydra → EngineCustomer. Resolución en tres pasos:
   * mapa local → búsqueda por external_ref → creación idempotente.
   */
  async ensureCustomer(contratoId: string): Promise<string> {
    const cached = await this.get('contrato', contratoId);
    if (cached) return cached;

    const ref = supraRef.contrato(contratoId);
    const existing = await this.client.findCustomerByExternalRef(ref);
    if (existing) {
      await this.save('contrato', contratoId, existing.id);
      return existing.id;
    }

    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true, nombre: true, rfc: true, direccion: true, ceaNumContrato: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const created = await this.client.createCustomer({
      name: contrato.nombre || `Contrato ${contrato.ceaNumContrato ?? contratoId.slice(0, 8)}`,
      external_ref: ref,
      metadata: {
        rfc: contrato.rfc ?? undefined,
        direccion: contrato.direccion ?? undefined,
        numero_contrato: contrato.ceaNumContrato ?? undefined,
      },
    });
    await this.save('contrato', contratoId, created.id);
    return created.id;
  }

  /**
   * Recibo Hydra → EngineObligation. `external_ref` no es consultable en
   * obligations, así que: mapa local → creación idempotente → si 409
   * (ya la creó el conector de ingesta de SUPRA), se localiza recorriendo
   * las obligations del customer y comparando external_ref.
   */
  async ensureObligation(reciboId: string): Promise<string> {
    const cached = await this.get('recibo', reciboId);
    if (cached) return cached;

    const recibo = await this.prisma.recibo.findUnique({
      where: { id: reciboId },
      include: { timbrado: { select: { total: true } } },
    });
    if (!recibo) throw new NotFoundException('Recibo no encontrado');

    const customerId = await this.ensureCustomer(recibo.contratoId);
    const ref = supraRef.recibo(reciboId);
    const monto = recibo.timbrado?.total ?? recibo.saldoVigente;

    try {
      const created = await this.client.createObligation({
        customer: customerId,
        amount_due_minor: pesosToMinor(Number(monto)),
        type: 'hydra.recibo',
        due_at: recibo.fechaVencimiento ? new Date(recibo.fechaVencimiento).toISOString() : undefined,
        external_ref: ref,
        metadata: { contrato: supraRef.contrato(recibo.contratoId) },
      });
      await this.save('recibo', reciboId, created.id);
      return created.id;
    } catch (err) {
      if (err instanceof SupraApiError && err.status === 409) {
        const found = await this.findObligationByRef(customerId, ref);
        if (found) {
          await this.save('recibo', reciboId, found.id);
          return found.id;
        }
      }
      throw err;
    }
  }

  /** Busca una obligation por external_ref recorriendo las del customer. */
  async findObligationByRef(customerId: string, ref: string): Promise<SupraObligation | null> {
    const MAX_PAGINAS = 10;
    for (const status of ['issued', 'partially_settled', 'settled', 'canceled', 'written_off']) {
      let cursor: string | undefined;
      let agotado = false;
      // Cap defensivo de 10 páginas por estado (1000 obligations por contrato).
      for (let page = 0; page < MAX_PAGINAS; page++) {
        const res = await this.client.listObligations({
          customer: customerId,
          status,
          limit: 100,
          starting_after: cursor,
        });
        const hit = res.data.find((o) => o.external_ref === ref);
        if (hit) return hit;
        if (!res.has_more || !res.next_cursor) {
          agotado = true;
          break;
        }
        cursor = res.next_cursor;
      }
      if (!agotado) {
        this.logger.warn(
          `findObligationByRef(${ref}): cap de ${MAX_PAGINAS} páginas alcanzado en status=${status} ` +
            `del customer ${customerId} — la búsqueda quedó TRUNCADA y puede reportar un falso negativo`,
        );
      }
    }
    this.logger.warn(`Obligation con external_ref=${ref} no localizada en customer ${customerId}`);
    return null;
  }
}
