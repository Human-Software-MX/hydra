import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupraApiError, SupraClientService } from './supra-client.service';
import { SupraMapService } from './supra-map.service';
import { supraRef } from './supra.config';

/**
 * Outbox de comandos hacia SUPRA (`supra_comando_outbox`).
 *
 * Para operaciones donde SUPRA no debe estar en el camino crítico (facturación
 * masiva, cancelación de lotes, incobrables): el comando se ENCOLA en la misma
 * conversación que el cambio local y un worker lo entrega con reintentos y
 * backoff. La idempotencia extremo-a-extremo la garantizan la Idempotency-Key
 * determinista y los external_ref (`hydra:<entidad>:<id>`) del lado SUPRA.
 *
 * Comandos semánticos (payload mínimo; la resolución de IDs ocurre al procesar):
 *   obligation.create    { reciboId }
 *   obligation.cancel    { reciboId, contratoId }
 *   obligation.write_off { reciboId, contratoId, motivo }
 */
@Injectable()
export class SupraOutboxService {
  private readonly logger = new Logger(SupraOutboxService.name);
  private procesando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SupraClientService,
    private readonly mapa: SupraMapService,
  ) {}

  /** Encola un comando (idempotente por key) y dispara el worker sin bloquear. */
  async encolar(
    tipo: 'obligation.create' | 'obligation.cancel' | 'obligation.write_off',
    payload: Record<string, unknown>,
    idempotencyKey: string,
    correlationId?: string,
  ): Promise<void> {
    if (!this.client.enabled) return;
    try {
      await this.prisma.supraComandoOutbox.create({
        data: {
          tipo,
          metodo: 'POST',
          ruta: '/v1/obligations',
          payload: payload as Prisma.InputJsonValue,
          idempotencyKey,
          correlationId: correlationId ?? null,
        },
      });
    } catch (err) {
      // P2002 = comando ya encolado (reintento del caller): no duplicar.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      return;
    }
    void this.procesarPendientes().catch((e) =>
      this.logger.error(`Worker de outbox falló: ${e instanceof Error ? e.message : e}`),
    );
  }

  /** Worker: cada minuto entrega comandos pendientes/en reintento. */
  @Cron('*/1 * * * *', { name: 'supra-outbox' })
  async cronProcesar() {
    if (!this.client.enabled) return;
    await this.procesarPendientes();
  }

  async procesarPendientes(): Promise<void> {
    if (this.procesando || !this.client.enabled) return;
    this.procesando = true;
    try {
      const ahora = new Date();
      const pendientes = await this.prisma.supraComandoOutbox.findMany({
        where: {
          estado: { in: ['pendiente', 'error'] },
          OR: [{ proximoIntento: null }, { proximoIntento: { lte: ahora } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });

      for (const cmd of pendientes) {
        try {
          const respuesta = await this.ejecutar(
            cmd.tipo,
            (cmd.payload ?? {}) as Record<string, unknown>,
          );
          await this.prisma.supraComandoOutbox.update({
            where: { id: cmd.id },
            data: {
              estado: 'enviado',
              respuesta: (respuesta ?? {}) as Prisma.InputJsonValue,
              error: null,
            },
          });
        } catch (err) {
          await this.registrarFallo(cmd.id, cmd.intentos, err);
        }
      }
    } finally {
      this.procesando = false;
    }
  }

  private async registrarFallo(id: string, intentosPrevios: number, err: unknown): Promise<void> {
    const intentos = intentosPrevios + 1;
    const mensaje = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    // Errores de contrato (4xx no-retryables) no se reintentan: van a 'muerto'
    // para revisión manual. Transitorios: backoff exponencial, cap 1 h, 10 intentos.
    const esRetryable =
      !(err instanceof SupraApiError) ||
      err.retryable ||
      err.status === 0 ||
      err.status === 429 ||
      err.status >= 500;
    const muerto = !esRetryable || intentos >= 10;
    const backoffMs = Math.min(30_000 * 2 ** (intentos - 1), 3_600_000);
    await this.prisma.supraComandoOutbox.update({
      where: { id },
      data: {
        intentos,
        error: mensaje,
        estado: muerto ? 'muerto' : 'error',
        proximoIntento: muerto ? null : new Date(Date.now() + backoffMs),
      },
    });
    if (muerto) {
      this.logger.error(`Comando SUPRA ${id} muerto tras ${intentos} intento(s): ${mensaje}`);
    }
  }

  // ── Dispatch semántico ───────────────────────────────────────────────────────

  private async ejecutar(tipo: string, payload: Record<string, unknown>): Promise<unknown> {
    switch (tipo) {
      case 'obligation.create': {
        // ensureObligation es idempotente (mapa → create con Idempotency-Key →
        // adopción por external_ref si el conector de ingesta ya la creó).
        const obligationId = await this.mapa.ensureObligation(String(payload.reciboId));
        return { obligationId };
      }
      case 'obligation.cancel': {
        const supraId = await this.resolverObligation(payload);
        if (!supraId) return { skipped: 'obligation inexistente en SUPRA' };
        try {
          await this.client.cancelObligation(supraId);
        } catch (err) {
          // 409 = tiene abonos o ya está en estado terminal: se deja constancia
          // sin reintentar (la conciliación periódica lo detectará).
          if (err instanceof SupraApiError && err.status === 409) {
            return { skipped: `no cancelable: ${err.message}` };
          }
          throw err;
        }
        return { canceled: supraId };
      }
      case 'obligation.write_off': {
        const supraId = await this.resolverObligation(payload);
        if (!supraId) return { skipped: 'obligation inexistente en SUPRA' };
        return this.client.request('POST', `/v1/obligations/${supraId}/write_off`, {
          reason: payload.motivo ?? 'incobrable',
        });
      }
      default:
        throw new Error(`Tipo de comando desconocido: ${tipo}`);
    }
  }

  /**
   * Resuelve la obligation de un recibo que puede YA NO existir localmente
   * (lotes cancelados borran recibos): mapa → búsqueda por external_ref en las
   * obligations del customer del contrato.
   */
  private async resolverObligation(payload: Record<string, unknown>): Promise<string | null> {
    const reciboId = String(payload.reciboId);
    const cached = await this.mapa.get('recibo', reciboId);
    if (cached) return cached;

    const contratoId = payload.contratoId ? String(payload.contratoId) : null;
    if (!contratoId) return null;
    const customerId = await this.mapa.get('contrato', contratoId);
    if (!customerId) return null;

    const found = await this.mapa.findObligationByRef(customerId, supraRef.recibo(reciboId));
    if (found) await this.mapa.save('recibo', reciboId, found.id);
    return found?.id ?? null;
  }
}
