import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupraApiError, SupraClientService } from './supra-client.service';

/** Cliente con fetch mockeado — verifica headers, idempotencia y errores. */
function cliente(): SupraClientService {
  process.env.SUPRA_INTEGRACION_ENABLED = 'true';
  process.env.SUPRA_API_KEY = 'sk_test_abc';
  process.env.SUPRA_BASE_URL = 'https://supra.test';
  return new SupraClientService();
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
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

describe('SupraClientService.request', () => {
  it('manda Bearer sk_ e Idempotency-Key en los POST', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(201, { object: 'payment', id: 'pay_1' }));
    const c = cliente();
    await c.recordPayment({
      customer: 'cus_1',
      amount: '15050',
      external_ref: 'hydra:pago:abc',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://supra.test/v1/payments');
    expect(init.headers.Authorization).toBe('Bearer sk_test_abc');
    expect(init.headers['Idempotency-Key']).toBe('hydra:pago:abc');
    const body = JSON.parse(init.body);
    expect(body.currency).toBe('MXN');
    expect(body.amount).toBe('15050');
  });

  it('normaliza el envelope de error plano de SUPRA a SupraApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      respuesta(409, {
        type: 'error',
        code: 'idempotency_key_reused',
        message: 'key reused',
        retryable: false,
      }),
    );
    const c = cliente();
    await expect(c.createCustomer({ name: 'X', external_ref: 'hydra:contrato:1' })).rejects.toMatchObject({
      name: 'SupraApiError',
      status: 409,
      code: 'idempotency_key_reused',
      retryable: false,
    });
  });

  it('red caída → SupraApiError retryable con code provider_unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const c = cliente();
    const err: unknown = await c.getBalance('cus_1').catch((e) => e);
    expect(err).toBeInstanceOf(SupraApiError);
    const apiErr = err as SupraApiError;
    expect(apiErr.code).toBe('provider_unavailable');
    expect(apiErr.retryable).toBe(true);
    expect(apiErr.status).toBe(0);
  });

  it('listOpenObligations une issued + partially_settled', async () => {
    fetchMock
      .mockResolvedValueOnce(
        respuesta(200, { object: 'list', data: [{ id: 'obl_1', status: 'issued' }], has_more: false, next_cursor: null }),
      )
      .mockResolvedValueOnce(
        respuesta(200, { object: 'list', data: [{ id: 'obl_2', status: 'partially_settled' }], has_more: false, next_cursor: null }),
      );
    const c = cliente();
    const res = await c.listOpenObligations('cus_1');
    expect(res.map((o) => o.id).sort()).toEqual(['obl_1', 'obl_2']);
    expect(fetchMock.mock.calls[0][0]).toContain('status=issued');
    expect(fetchMock.mock.calls[1][0]).toContain('status=partially_settled');
  });

  it('assertEnabled lanza 503 con la integración apagada', () => {
    process.env.SUPRA_INTEGRACION_ENABLED = 'false';
    const c = new SupraClientService();
    expect(() => c.assertEnabled()).toThrow('SUPRA');
  });
});
