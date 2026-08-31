import { BadGatewayException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupraClientService } from '../supra/supra-client.service';
import { PagosService } from './pagos.service';

/**
 * Flujo SUPRA-first de PagosService.crear: el pago va PRIMERO a
 * `POST /v1/payments` (fetch mockeado); solo si SUPRA acepta se materializa el
 * espejo local. Si SUPRA rechaza, NO existe pago local.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  process.env.SUPRA_INTEGRACION_ENABLED = 'true';
  process.env.SUPRA_API_KEY = 'sk_test_abc';
  process.env.SUPRA_BASE_URL = 'https://supra.test';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function respuesta(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function armar() {
  const prisma = {
    pago: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        createdAt: new Date(),
        recibo: null,
      })),
    },
    // contrato activo → verificarAutoReconexion corta temprano
    contrato: { findUnique: vi.fn(async () => ({ id: 'ctr_1', estado: 'Activo', bloqueadoJuridico: false })) },
    sesionCaja: { findFirst: vi.fn(async () => null) },
  };
  const cartera = { aplicarPago: vi.fn(async () => null) };
  const supra = new SupraClientService();
  const supraMapa = {
    ensureCustomer: vi.fn(async () => 'cus_1'),
    ensureObligation: vi.fn(async () => 'obl_1'),
    save: vi.fn(async () => undefined),
    get: vi.fn(),
    reverse: vi.fn(),
  };
  const svc = new PagosService(prisma as never, cartera as never, supra, supraMapa as never);
  return { svc, prisma, cartera, supraMapa };
}

describe('PagosService.crear (SUPRA-first)', () => {
  it('registra primero en SUPRA y luego materializa el espejo local', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(201, { object: 'payment', id: 'pay_1' }));
    const { svc, prisma, cartera, supraMapa } = armar();

    const res = await svc.crear({ contratoId: 'ctr_1', monto: 150.5, tipo: 'Efectivo' });

    // 1) Comando a SUPRA con idempotencia determinista y centavos.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://supra.test/v1/payments');
    const body = JSON.parse(init.body);
    expect(body.amount).toBe('15050');
    expect(body.customer).toBe('cus_1');
    expect(init.headers['Idempotency-Key']).toMatch(/^hydra:pago:/);
    expect(body.external_ref).toBe(init.headers['Idempotency-Key']);

    // 2) Espejo local + mapeo + proyección.
    expect(prisma.pago.create).toHaveBeenCalledOnce();
    expect(supraMapa.save).toHaveBeenCalledWith('pago', expect.any(String), 'pay_1');
    expect(cartera.aplicarPago).toHaveBeenCalledOnce();
    expect((res as { supraPaymentId: string }).supraPaymentId).toBe('pay_1');
  });

  it('con reciboId el pago viaja con allocation a la obligation del recibo', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(201, { object: 'payment', id: 'pay_2' }));
    const { svc, supraMapa } = armar();

    await svc.crear({ contratoId: 'ctr_1', reciboId: 'rec_1', monto: 100, tipo: 'Efectivo' });

    expect(supraMapa.ensureObligation).toHaveBeenCalledWith('rec_1');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.allocations).toEqual([{ obligation: 'obl_1', amount: '10000' }]);
  });

  it('si SUPRA rechaza el pago NO se crea espejo local (nunca hay dinero que SUPRA desconozca)', async () => {
    fetchMock.mockResolvedValueOnce(
      respuesta(422, { type: 'error', code: 'invalid_amount', message: 'monto inválido', retryable: false }),
    );
    const { svc, prisma, cartera } = armar();

    await expect(
      svc.crear({ contratoId: 'ctr_1', monto: -5, tipo: 'Efectivo' }),
    ).rejects.toThrow(BadGatewayException);
    expect(prisma.pago.create).not.toHaveBeenCalled();
    expect(cartera.aplicarPago).not.toHaveBeenCalled();
  });

  it('con la integración apagada usa el camino legacy local (kill-switch)', async () => {
    process.env.SUPRA_INTEGRACION_ENABLED = 'false';
    const { svc, prisma } = armar();

    await svc.crear({ contratoId: 'ctr_1', monto: 100, tipo: 'Efectivo' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.pago.create).toHaveBeenCalledOnce();
  });
});
