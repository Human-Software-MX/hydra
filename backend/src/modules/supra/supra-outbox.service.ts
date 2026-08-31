import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupraApiError, SupraClientService } from './supra-client.service';
import { SupraMapService } from './supra-map.service';
import { supraRef } from './supra.config';

/** Claims en `procesando` más viejos que esto se consideran huérfanos (réplica caída). */
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Outbox de comandos hacia SUPRA (`supra_comando_outbox`).
 *
 * Para operaciones donde SUPRA no debe estar en el camino crítico (facturación
 * masiva, cancelación de lotes, incobrables): el comando se ENCOLA en la misma
 * transacción que el cambio local (pasando el TransactionClient a `encolar`) y
 * un worker lo entrega con reintentos y backoff. La idempotencia
 * extremo-a-extremo la garantizan la Idempotency-Key determinista y los
 * external_ref (`hydra:<entidad>:<id>`) del lado SUPRA.
 *
 * Concurrencia multi-réplica: el claim de cada comando es atómico en BD
 * (updateMany condicionado por estado → `procesando`); los claims huérfanos
 * se recuperan por timeout usando `updatedAt`.
 *
 * Comandos semánticos (payload mínimo; la resolución de IDs ocurre al procesar):
 *   obligation.create    { reciboId }
 *   obligation.cancel    { reciboId, contratoId }
 *   obligation.write_off { reciboId, contratoId, motivo }
 */
@Injectable()
export class SupraOutboxService {
  private readonly logger = new Logger(SupraOutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SupraClientService,
    private readonly mapa: SupraMapService,
  ) {}

  /**
   * Encola un comando (idempotente por key). Con `opts.tx` el INSERT ocurre en
   * la MISMA transacción del cambio local (atomicidad cambio+comando); sin tx,
   * además dispara el worker sin bloquear.
   */
  async encolar(
    tipo: 'obligation.create' | 'obligation.cancel' | 'obligation.write_off',
    payload: Record<string, unknown>,
    idempotencyKey: string,
    opts?: { correlationId?: string; tx?: Prisma.TransactionClient },
  ): Promise<void> {
    if (!this.client.enabled) return;
    const db = opts?.tx ?? this.prisma;
    try {
      await db.supraComandoOutbox.create({
        data: {
          tipo,
          metodo: 'POST',
          ruta: '/v1/obligations',
          payload: payload as Prisma.InputJsonValue,
          idempotencyKey,
          correlationId: opts?.correlationId ?? null,
        },
      });
    } catch (err) {
      // P2002 = comando ya encolado (reintento del caller): no duplicar.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      return;
    }
    // Dentro de una transacción el comando aún no es visible para el worker;
    // lo recoge el cron (≤1 min tras el commit).
    if (!opts?.tx) {
      void this.procesarPendientes().catch((e) =>
        this.logger.error(`Worker de outbox falló: ${e instanceof Error ? e.message : e}`),
      );
    }
  }

  /** Worker: cada minuto entrega comandos pendientes/en reintento. */
  @Cron('*/1 * * * *', { name: 'supra-outbox' })
  async cronProcesar() {
    if (!this.client.enabled) return;
    await this.procesarPendientes();
  }

  async procesarPendientes(): Promise<void> {
    if (!this.client.enabled) return;

    // Recupera claims huérfanos de réplicas caídas (procesando desde hace >10 min).
    await this.prisma.supraComandoOutbox.updateMany({
      where: { estado: 'procesando', updatedAt: { lt: new Date(Date.now() - CLAIM_TIMEOUT_MS) } },
      data: { estado: 'pendiente', proximoIntento: null },
    });

    const ahora = new Date();
    const candidatos = await this.prisma.supraComandoOutbox.findMany({
      where: {
        estado: { in: ['pendiente', 'error'] },
        OR: [{ proximoIntento: null }, { proximoIntento: { lte: ahora } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true },
    });

    for (const { id } of candidatos) {
      // Claim atómico: solo una réplica gana el comando.
      const claim = await this.prisma.supraComandoOutbox.updateMany({
        where: { id, estado: { in: ['pendiente', 'error'] } },
        data: { estado: 'procesando' },
      });
      if (claim.count === 0) continue; // otra réplica lo tomó

      const cmd = await this.prisma.supraComandoOutbox.findUnique({ where: { id } });
      if (!cmd) continue;
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
  }

  /** Revive un comando `muerto` (admin): reset de intentos/estado. */
  async replayMuerto(id: string): Promise<{ id: string; estado: string }> {
    const cmd = await this.prisma.supraComandoOutbox.findUnique({
      where: { id },
      select: { id: true, estado: true },
    });
    if (!cmd) throw new NotFoundException('Comando de outbox no encontrado');
    if (cmd.estado !== 'muerto') {
      throw new NotFoundException(`El comando ${id} no está muerto (estado: ${cmd.estado})`);
    }
    await this.prisma.supraComandoOutbox.update({
      where: { id },
      data: { estado: 'pendiente', intentos: 0, proximoIntento: null, error: null },
    });
    void this.procesarPendientes().catch(() => undefined);
    return { id, estado: 'pendiente' };
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
