import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupraEventosService } from './supra-eventos.service';

/**
 * Procesador del inbox: claim atómico multi-réplica, reintentos y cuarentena.
 * Prisma/cliente/mapa/cartera mockeados — se ejercita la máquina de estados.
 */

type Fila = {
  id: string;
  eventId: string;
  tipo: string;
  intentos: number;
  payload: unknown;
};

function armar(fila: Fila | null, opts?: { claimGanado?: boolean }) {
  const inbox = {
    updateMany: vi.fn(async (args: { where: { id?: string } }) => ({
      // El claim (where.id) lo gana esta réplica salvo que el test diga lo contrario.
      count: args.where.id ? (opts?.claimGanado === false ? 0 : 1) : 0,
    })),
    findMany: vi.fn(async () => (fila ? [{ id: fila.id }] : [])),
    findUnique: vi.fn(async () => fila),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
  };
  const prisma = {
    supraEventoInbox: inbox,
    intentoPago: { updateMany: vi.fn(async () => ({ count: 1 })) },
    pago: { create: vi.fn(), findUnique: vi.fn() },
  };
  const client = { enabled: true, config: {}, request: vi.fn(), getBalance: vi.fn() };
  const mapa = { reverse: vi.fn(async () => 'ctr_1'), save: vi.fn() };
  const cartera = { recalcularContrato: vi.fn(async () => ({})), aplicarPago: vi.fn(async () => null) };
  const svc = new SupraEventosService(
    prisma as never,
    client as never,
    mapa as never,
    cartera as never,
  );
  return { svc, prisma, inbox, mapa, cartera };
}

describe('SupraEventosService.procesarPendientes', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('procesa un evento pendiente y lo marca procesado', async () => {
    const { svc, prisma, inbox } = armar({
      id: 'r1',
      eventId: 'evt_1',
      tipo: 'payment_link.completed',
      intentos: 0,
      payload: { id: 'evt_1', type: 'payment_link.completed', data: { token: 'tok_1' } },
    });
    await svc.procesarPendientes();

    expect(prisma.intentoPago.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referencia: 'tok_1' } }),
    );
    expect(inbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'procesado' }) }),
    );
  });

  it('si otra réplica ganó el claim, no procesa la fila', async () => {
    const { svc, inbox } = armar(
      {
        id: 'r1',
        eventId: 'evt_1',
        tipo: 'payment_link.completed',
        intentos: 0,
        payload: { id: 'evt_1', type: 'payment_link.completed', data: { token: 'tok_1' } },
      },
      { claimGanado: false },
    );
    await svc.procesarPendientes();
    expect(inbox.findUnique).not.toHaveBeenCalled();
    expect(inbox.update).not.toHaveBeenCalled();
  });

  it('un handler que falla deja la fila en error con intentos+1', async () => {
    const { svc, inbox, cartera } = armar({
      id: 'r1',
      eventId: 'evt_1',
      tipo: 'obligation.created',
      intentos: 0,
      payload: { id: 'evt_1', type: 'obligation.created', data: { customer: 'cus_1' } },
    });
    cartera.recalcularContrato.mockRejectedValueOnce(new Error('BD caída'));
    await svc.procesarPendientes();

    expect(inbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'error', intentos: 1 }),
      }),
    );
  });

  it('al 5º fallo el evento va a cuarentena (no bloquea el resto del inbox)', async () => {
    const { svc, inbox, cartera } = armar({
      id: 'r1',
      eventId: 'evt_1',
      tipo: 'obligation.created',
      intentos: 4,
      payload: { id: 'evt_1', type: 'obligation.created', data: { customer: 'cus_1' } },
    });
    cartera.recalcularContrato.mockRejectedValueOnce(new Error('BD caída'));
    await svc.procesarPendientes();

    expect(inbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'cuarentena', intentos: 5 }),
      }),
    );
  });

  it('payload que no pasa la validación zod falla ANTES de tocar dinero', async () => {
    const { svc, prisma, inbox } = armar({
      id: 'r1',
      eventId: 'evt_1',
      tipo: 'payment.succeeded',
      intentos: 0,
      // sin id/customer/amount → inválido
      payload: { id: 'evt_1', type: 'payment.succeeded', data: { foo: 'bar' } },
    });
    await svc.procesarPendientes();

    expect(prisma.pago.create).not.toHaveBeenCalled();
    expect(inbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'error',
          error: expect.stringContaining('Payload inválido'),
        }),
      }),
    );
  });

  it('replayCuarentena resetea intentos y regresa el evento a pendiente', async () => {
    const { svc, inbox } = armar(null);
    inbox.findUnique.mockResolvedValueOnce({ id: 'r9', estado: 'cuarentena' } as never);
    const res = await svc.replayCuarentena('r9');
    expect(res).toEqual({ id: 'r9', estado: 'pendiente' });
    expect(inbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r9' },
        data: expect.objectContaining({ estado: 'pendiente', intentos: 0 }),
      }),
    );
  });
});
