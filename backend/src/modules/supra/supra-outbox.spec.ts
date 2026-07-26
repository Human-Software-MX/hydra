import { describe, expect, it, vi } from 'vitest';
import { SupraApiError } from './supra-client.service';
import { SupraOutboxService } from './supra-outbox.service';

/**
 * Outbox de comandos: clasificación de errores (muerto vs backoff), claim
 * multi-réplica y encolado transaccional. Prisma/cliente/mapa mockeados.
 */

type Cmd = { id: string; tipo: string; intentos: number; payload: unknown };

function armar(cmd: Cmd | null, opts?: { claimGanado?: boolean }) {
  const outbox = {
    updateMany: vi.fn(async (args: { where: { id?: string } }) => ({
      count: args.where.id ? (opts?.claimGanado === false ? 0 : 1) : 0,
    })),
    findMany: vi.fn(async () => (cmd ? [{ id: cmd.id }] : [])),
    findUnique: vi.fn(async () => cmd),
    update: vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => ({})),
    create: vi.fn(async () => ({})),
  };
  const prisma = { supraComandoOutbox: outbox };
  const client = { enabled: true, cancelObligation: vi.fn(), request: vi.fn() };
  const mapa = {
    ensureObligation: vi.fn(async () => 'obl_1'),
    get: vi.fn(),
    findObligationByRef: vi.fn(),
    save: vi.fn(),
  };
  const svc = new SupraOutboxService(prisma as never, client as never, mapa as never);
  return { svc, outbox, client, mapa };
}

describe('SupraOutboxService', () => {
  it('comando exitoso queda enviado con la respuesta', async () => {
    const { svc, outbox } = armar({ id: 'c1', tipo: 'obligation.create', intentos: 0, payload: { reciboId: 'rec_1' } });
    await svc.procesarPendientes();
    expect(outbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'enviado' }) }),
    );
  });

  it('si otra réplica ganó el claim, no ejecuta el comando', async () => {
    const { svc, outbox, mapa } = armar(
      { id: 'c1', tipo: 'obligation.create', intentos: 0, payload: { reciboId: 'rec_1' } },
      { claimGanado: false },
    );
    await svc.procesarPendientes();
    expect(mapa.ensureObligation).not.toHaveBeenCalled();
    expect(outbox.update).not.toHaveBeenCalled();
  });

  it('4xx de contrato (no retryable) → muerto sin próximo intento', async () => {
    const { svc, outbox, mapa } = armar({ id: 'c1', tipo: 'obligation.create', intentos: 0, payload: { reciboId: 'rec_1' } });
    mapa.ensureObligation.mockRejectedValueOnce(
      new SupraApiError(422, 'invalid_amount', 'monto inválido', undefined, false),
    );
    await svc.procesarPendientes();
    expect(outbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'muerto', intentos: 1, proximoIntento: null }),
      }),
    );
  });

  it('5xx → error con backoff exponencial (30s × 2^(n-1))', async () => {
    const { svc, outbox, mapa } = armar({ id: 'c1', tipo: 'obligation.create', intentos: 2, payload: { reciboId: 'rec_1' } });
    mapa.ensureObligation.mockRejectedValueOnce(
      new SupraApiError(500, 'internal', 'boom', undefined, true),
    );
    const antes = Date.now();
    await svc.procesarPendientes();
    const llamada = outbox.update.mock.calls.find(([args]) => args.data.estado === 'error');
    expect(llamada).toBeDefined();
    const data = llamada![0].data as { intentos: number; proximoIntento: Date };
    expect(data.intentos).toBe(3);
    // intento 3 → 30s × 2² = 120s
    const esperaMs = data.proximoIntento.getTime() - antes;
    expect(esperaMs).toBeGreaterThanOrEqual(115_000);
    expect(esperaMs).toBeLessThanOrEqual(125_000);
  });

  it('al 10º intento el comando muere aunque el error sea transitorio', async () => {
    const { svc, outbox, mapa } = armar({ id: 'c1', tipo: 'obligation.create', intentos: 9, payload: { reciboId: 'rec_1' } });
    mapa.ensureObligation.mockRejectedValueOnce(
      new SupraApiError(0, 'provider_unavailable', 'down', undefined, true),
    );
    await svc.procesarPendientes();
    expect(outbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'muerto', intentos: 10 }),
      }),
    );
  });

  it('encolar con tx inserta vía el TransactionClient y NO dispara el worker', async () => {
    const { svc, outbox } = armar(null);
    const tx = { supraComandoOutbox: { create: vi.fn(async () => ({})) } };
    const worker = vi.spyOn(svc, 'procesarPendientes').mockResolvedValue();

    await svc.encolar('obligation.create', { reciboId: 'rec_1' }, 'hydra:recibo:rec_1:create', {
      tx: tx as never,
    });

    expect(tx.supraComandoOutbox.create).toHaveBeenCalledOnce();
    expect(outbox.create).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
  });

  it('encolar duplicado (P2002) es un no-op silencioso', async () => {
    const { svc, outbox } = armar(null);
    outbox.create.mockRejectedValueOnce({ code: 'P2002' });
    vi.spyOn(svc, 'procesarPendientes').mockResolvedValue();
    await expect(
      svc.encolar('obligation.create', { reciboId: 'rec_1' }, 'hydra:recibo:rec_1:create'),
    ).resolves.toBeUndefined();
  });

  it('replayMuerto resetea el comando a pendiente', async () => {
    const { svc, outbox } = armar(null);
    outbox.findUnique.mockResolvedValueOnce({ id: 'c9', estado: 'muerto' } as never);
    vi.spyOn(svc, 'procesarPendientes').mockResolvedValue();
    const res = await svc.replayMuerto('c9');
    expect(res).toEqual({ id: 'c9', estado: 'pendiente' });
    expect(outbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'pendiente', intentos: 0, proximoIntento: null }),
      }),
    );
  });
});
