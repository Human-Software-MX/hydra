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

describe('SupraClientService — reintentos (§E.1)', () => {
  it('GET reintenta ante 5xx y devuelve el éxito del segundo intento', async () => {
    fetchMock
      .mockResolvedValueOnce(respuesta(503, { code: 'unavailable', message: 'down' }))
      .mockResolvedValueOnce(respuesta(200, { object: 'customer_balance', receivable_balance: '0' }));
    const c = cliente();
    const balance = await c.getBalance('cus_1');
    expect(balance.receivable_balance).toBe('0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('POST idempotente reintenta con la MISMA Idempotency-Key', async () => {
    fetchMock
      .mockResolvedValueOnce(respuesta(500, { code: 'internal', message: 'boom' }))
      .mockResolvedValueOnce(respuesta(201, { object: 'payment', id: 'pay_1' }));
    const c = cliente();
    const pago = await c.recordPayment({ customer: 'cus_1', amount: '100', external_ref: 'hydra:pago:x' });
    expect(pago.id).toBe('pay_1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe('hydra:pago:x');
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe('hydra:pago:x');
  });

  it('POST SIN Idempotency-Key no se reintenta (un solo intento)', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(500, { code: 'internal', message: 'boom' }));
    const c = cliente();
    await expect(c.request('POST', '/v1/obligations/obl_1/cancel')).rejects.toMatchObject({
      status: 500,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('4xx de contrato NO se reintenta aunque sea GET', async () => {
    fetchMock.mockResolvedValueOnce(
      respuesta(404, { code: 'not_found', message: 'no existe', retryable: false }),
    );
    const c = cliente();
    await expect(c.getPayment('pay_x')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 se reintenta honrando Retry-After', async () => {
    const con429 = {
      ok: false,
      status: 429,
      headers: { get: (h: string) => (h === 'retry-after' ? '1' : null) },
      text: async () => JSON.stringify({ code: 'rate_limited', message: 'slow down' }),
    };
    fetchMock
      .mockResolvedValueOnce(con429)
      .mockResolvedValueOnce(respuesta(200, { object: 'payment', id: 'pay_1' }));
    const c = cliente();
    const inicio = Date.now();
    const pago = await c.getPayment('pay_1');
    expect(pago.id).toBe('pay_1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // esperó al menos ~1s (Retry-After: 1)
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(900);
  }, 10_000);

  it('circuit breaker: tras 5 fallos consecutivos de lectura, fail-fast sin tocar la red', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const c = cliente();
    // Estado previo: 4 fallos acumulados; el siguiente abre el breaker.
    (c as unknown as { fallosConsecutivosLectura: number }).fallosConsecutivosLectura = 4;
    await expect(c.getBalance('cus_1')).rejects.toMatchObject({ code: 'provider_unavailable' });
    const llamadas = fetchMock.mock.calls.length;
    await expect(c.getBalance('cus_1')).rejects.toMatchObject({ code: 'circuit_open' });
    expect(fetchMock.mock.calls.length).toBe(llamadas); // no salió a la red
  }, 10_000);

  it('el breaker NO bloquea escrituras (los POST siguen saliendo)', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(201, { object: 'payment', id: 'pay_1' }));
    const c = cliente();
    (c as unknown as { breakerAbiertoHasta: number }).breakerAbiertoHasta = Date.now() + 30_000;
    const pago = await c.recordPayment({ customer: 'cus_1', amount: '100', external_ref: 'hydra:pago:y' });
    expect(pago.id).toBe('pay_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
