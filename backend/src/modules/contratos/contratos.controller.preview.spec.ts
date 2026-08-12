import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import { ContratosController } from './contratos.controller';
import type { BillingEngineService } from './billing-engine.service';
import type { ContratosService } from './contratos.service';
import type { TiposContratacionService } from '../tipos-contratacion/tipos-contratacion.service';

/**
 * FIX 4 (B3 caller): el endpoint de preview debe devolver el mensaje de tarifa
 * descriptivo como 4xx — NUNCA un 500 enmascarado.
 */
describe('ContratosController.previewFacturacion (B3 caller)', () => {
  function makeController(billing: Partial<BillingEngineService>) {
    return new ContratosController(
      {} as ContratosService,
      {} as TiposContratacionService,
      billing as BillingEngineService,
    );
  }

  it('devuelve el preview cuando la tarifa es válida', async () => {
    const preview = { items: [], subtotal: 0, totalIva: 0, total: 0 };
    const controller = makeController({ calcular: jest.fn().mockResolvedValue(preview) });

    await expect(
      controller.previewFacturacion({ tipoContratacionId: 't1', variables: {} }),
    ).resolves.toBe(preview);
  });

  it('mapea un Error de tarifa a UnprocessableEntity (4xx) con el mensaje ofensivo', async () => {
    const msg = 'Expresión de tarifa inválida: "5*("';
    const controller = makeController({
      calcular: jest.fn().mockRejectedValue(new Error(msg)),
    });

    const call = controller.previewFacturacion({ tipoContratacionId: 't1', variables: {} });
    await expect(call).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(call).rejects.toThrow('5*(');
  });

  it('no re-envuelve una HttpException que ya venga del engine', async () => {
    const httpErr = new HttpException('ya-mapeado', 400);
    const controller = makeController({
      calcular: jest.fn().mockRejectedValue(httpErr),
    });

    await expect(
      controller.previewFacturacion({ tipoContratacionId: 't1', variables: {} }),
    ).rejects.toBe(httpErr);
  });
});
