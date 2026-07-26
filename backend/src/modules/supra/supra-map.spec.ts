import { describe, expect, it, vi } from 'vitest';
import { SupraApiError } from './supra-client.service';
import { SupraMapService } from './supra-map.service';

/**
 * ensureObligation: creación idempotente y ADOPCIÓN por external_ref cuando
 * SUPRA responde 409 (la obligation ya la creó el conector de ingesta).
 */

function armar() {
  const prisma = {
    supraMapa: {
      findUnique: vi.fn(async (args: { where: { entidad_hydraId?: { entidad: string } } }) => {
        // recibo sin mapear; contrato ya mapeado a cus_1 (ensureCustomer cacheado).
        if (args.where.entidad_hydraId?.entidad === 'contrato') return { supraId: 'cus_1' };
        return null;
      }),
      upsert: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    recibo: {
      findUnique: vi.fn(async () => ({
        id: 'rec_1',
        contratoId: 'ctr_1',
        saldoVigente: 100,
        fechaVencimiento: '2026-08-01',
        timbrado: { total: 150 },
      })),
    },
    contrato: { findUnique: vi.fn() },
  };
  const client = {
    createObligation: vi.fn(),
    listObligations: vi.fn(),
    findCustomerByExternalRef: vi.fn(),
    createCustomer: vi.fn(),
  };
  const svc = new SupraMapService(prisma as never, client as never);
  return { svc, prisma, client };
}

describe('SupraMapService.ensureObligation', () => {
  it('camino feliz: crea la obligation y guarda el mapeo', async () => {
    const { svc, prisma, client } = armar();
    client.createObligation.mockResolvedValueOnce({ id: 'obl_9' });

    const id = await svc.ensureObligation('rec_1');

    expect(id).toBe('obl_9');
    expect(client.createObligation).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        external_ref: 'hydra:recibo:rec_1',
        amount_due_minor: '15000', // usa el total del timbrado
      }),
    );
    expect(prisma.supraMapa.upsert).toHaveBeenCalled();
  });

  it('409 → adopta la obligation existente localizándola por external_ref', async () => {
    const { svc, prisma, client } = armar();
    client.createObligation.mockRejectedValueOnce(
      new SupraApiError(409, 'idempotency_key_reused', 'ya existe'),
    );
    client.listObligations.mockImplementation(async ({ status }: { status: string }) => ({
      object: 'list',
      data:
        status === 'issued'
          ? [
              { id: 'obl_ajena', external_ref: 'hydra:recibo:otro' },
              { id: 'obl_adoptada', external_ref: 'hydra:recibo:rec_1' },
            ]
          : [],
      has_more: false,
      next_cursor: null,
    }));

    const id = await svc.ensureObligation('rec_1');

    expect(id).toBe('obl_adoptada');
    expect(prisma.supraMapa.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ entidad: 'recibo', hydraId: 'rec_1', supraId: 'obl_adoptada' }),
      }),
    );
  });

  it('409 sin obligation localizable re-lanza el error original', async () => {
    const { svc, client } = armar();
    const err409 = new SupraApiError(409, 'idempotency_key_reused', 'ya existe');
    client.createObligation.mockRejectedValueOnce(err409);
    client.listObligations.mockResolvedValue({
      object: 'list',
      data: [],
      has_more: false,
      next_cursor: null,
    });

    await expect(svc.ensureObligation('rec_1')).rejects.toBe(err409);
  });

  it('errores que no son 409 se propagan sin buscar por ref', async () => {
    const { svc, client } = armar();
    client.createObligation.mockRejectedValueOnce(new SupraApiError(422, 'invalid', 'monto'));
    await expect(svc.ensureObligation('rec_1')).rejects.toMatchObject({ status: 422 });
    expect(client.listObligations).not.toHaveBeenCalled();
  });
});
