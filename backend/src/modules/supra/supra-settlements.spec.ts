import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SupraSettlementsService } from './supra-settlements.service';
import { SettlementDto } from './supra-settlements.dto';

/**
 * Settlement write-back (POST /api/integraciones/supra/settlements):
 * idempotencia por paymentId, 404 con detalle y aplicación espejo SIN llamar
 * a SUPRA de vuelta (anti-bucle).
 */

const DTO: SettlementDto = {
  paymentId: 'pay_123',
  folio: 'supra:pay_123',
  paidAt: '2026-07-25T12:00:00Z',
  totalCentavos: 15000,
  allocations: [{ reciboId: 'rec_1', montoCentavos: 15000 }],
};

function armar(opts?: { yaMapeado?: boolean; recibos?: { id: string; contratoId: string }[] }) {
  let pagoSeq = 0;
  const tx = {
    pago: { create: vi.fn(async () => ({ id: `pago_${++pagoSeq}` })) },
    supraMapa: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    supraMapa: {
      findUnique: vi.fn(async () => (opts?.yaMapeado ? { hydraId: 'pago_previo' } : null)),
    },
    recibo: {
      findMany: vi.fn(async () => opts?.recibos ?? [{ id: 'rec_1', contratoId: 'ctr_1' }]),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const cartera = { aplicarPago: vi.fn(async () => null) };
  const client = {
    assertEnabled: vi.fn(),
    // vigía anti-bucle: el servicio JAMÁS debe llamar a SUPRA
    request: vi.fn(() => {
      throw new Error('el settlement no debe llamar a SUPRA de vuelta');
    }),
  };
  const svc = new SupraSettlementsService(prisma as never, cartera as never, client as never);
  return { svc, prisma, tx, cartera, client };
}

describe('SupraSettlementsService.aplicar', () => {
  it('aplica el settlement: pago espejo por allocation + mapeo + recálculo de cartera', async () => {
    const { svc, tx, cartera, client } = armar();
    const res = await svc.aplicar(DTO);

    expect(res.status).toBe('applied');
    expect(tx.pago.create).toHaveBeenCalledTimes(1);
    expect(tx.pago.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contratoId: 'ctr_1',
          reciboId: 'rec_1',
          monto: 150, // 15000 centavos
          origen: 'supra',
          concepto: expect.stringContaining('supra:pay_123'),
        }),
      }),
    );
    expect(tx.supraMapa.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entidad: 'pago', supraId: 'pay_123' }),
      }),
    );
    expect(cartera.aplicarPago).toHaveBeenCalledTimes(1);
    expect(client.request).not.toHaveBeenCalled(); // anti-bucle
  });

  it('es idempotente: el mismo paymentId dos veces responde already_applied sin recrear nada', async () => {
    const { svc, tx, cartera } = armar({ yaMapeado: true });
    const res = await svc.aplicar(DTO);

    expect(res).toEqual({ status: 'already_applied', paymentId: 'pay_123', folio: 'supra:pay_123' });
    expect(tx.pago.create).not.toHaveBeenCalled();
    expect(cartera.aplicarPago).not.toHaveBeenCalled();
  });

  it('reciboId inexistente → 404 con el detalle de los faltantes', async () => {
    const { svc, tx } = armar({ recibos: [] });
    await expect(svc.aplicar(DTO)).rejects.toThrow(NotFoundException);
    await expect(svc.aplicar(DTO)).rejects.toThrow('rec_1');
    expect(tx.pago.create).not.toHaveBeenCalled();
  });

  it('varias allocations del mismo contrato recalculan cartera UNA sola vez', async () => {
    const { svc, tx, cartera } = armar({
      recibos: [
        { id: 'rec_1', contratoId: 'ctr_1' },
        { id: 'rec_2', contratoId: 'ctr_1' },
      ],
    });
    const res = await svc.aplicar({
      ...DTO,
      totalCentavos: 25000,
      allocations: [
        { reciboId: 'rec_1', montoCentavos: 15000 },
        { reciboId: 'rec_2', montoCentavos: 10000 },
      ],
    });
    expect(res.status).toBe('applied');
    expect(tx.pago.create).toHaveBeenCalledTimes(2);
    expect(cartera.aplicarPago).toHaveBeenCalledTimes(1);
  });

  it('entrega concurrente: P2002 en el mapeo → already_applied sin recálculo de cartera', async () => {
    const { svc, tx, cartera } = armar();
    tx.supraMapa.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const res = await svc.aplicar(DTO);

    expect(res).toEqual({ status: 'already_applied', paymentId: 'pay_123', folio: 'supra:pay_123' });
    expect(cartera.aplicarPago).not.toHaveBeenCalled();
  });

  it('respeta el kill-switch: integración apagada → 503', async () => {
    const { svc, client } = armar();
    client.assertEnabled.mockImplementationOnce(() => {
      throw new ServiceUnavailableException('apagada');
    });
    await expect(svc.aplicar(DTO)).rejects.toThrow(ServiceUnavailableException);
  });
});
