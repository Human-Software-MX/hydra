import { BadRequestException } from '@nestjs/common';
import { TarifasService } from './tarifas.service';

/**
 * C2 — cobertura de la ruta de dinero `TarifasService.calcularMonto`.
 *
 * `calcularMonto` obtiene las tarifas vigentes vía `findTarifaVigente`
 * (que consulta `prisma.tarifa.findMany`) y aplica el cálculo escalonado.
 * Mockeamos únicamente esa consulta para ejercitar el motor real de tramos:
 * bloques escalonados, cuota fija y sus fronteras exactas.
 */
type TarifaRow = {
  tipoCalculo: 'escalonado' | 'variable' | 'fijo';
  rangoMinM3?: number | null;
  rangoMaxM3?: number | null;
  precioUnitario?: number | null;
  cuotaFija?: number | null;
  ivaPct?: number | null;
};

function makeService(rows: TarifaRow[]) {
  const prisma = {
    tarifa: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  // calcularMonto no usa FacturacionService (solo simularImpacto lo requiere).
  return new TarifasService(prisma as never, {} as never);
}

// Escala de 3 tramos usada en varios casos:
//   [0, 10)  → 5/m3
//   [10, 20) → 8/m3
//   [20, ∞)  → 12/m3
const ESCALA_3_TRAMOS: TarifaRow[] = [
  { tipoCalculo: 'escalonado', rangoMinM3: 0, rangoMaxM3: 10, precioUnitario: 5, ivaPct: 16 },
  { tipoCalculo: 'escalonado', rangoMinM3: 10, rangoMaxM3: 20, precioUnitario: 8, ivaPct: 16 },
  { tipoCalculo: 'escalonado', rangoMinM3: 20, rangoMaxM3: null, precioUnitario: 12, ivaPct: 16 },
];

describe('TarifasService.calcularMonto (C2 money path)', () => {
  it('lanza si no hay tarifa vigente', async () => {
    const svc = makeService([]);
    await expect(
      svc.calcularMonto({ tipoServicio: 'AGUA', consumoM3: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tramo único: consumo * precio unitario', async () => {
    const svc = makeService([
      { tipoCalculo: 'escalonado', rangoMinM3: 0, rangoMaxM3: null, precioUnitario: 15, ivaPct: 16 },
    ]);
    const r = await svc.calcularMonto({ tipoServicio: 'AGUA', consumoM3: 4 });
    expect(r.subtotal).toBe(60); // 4 * 15
    expect(r.iva).toBeCloseTo(9.6, 5); // 60 * 0.16
    expect(r.total).toBeCloseTo(69.6, 5);
  });

  it('consumo cero: subtotal, IVA y total en cero (ningún tramo aplica)', async () => {
    const svc = makeService(ESCALA_3_TRAMOS);
    const r = await svc.calcularMonto({ tipoServicio: 'AGUA', consumoM3: 0 });
    expect(r.subtotal).toBe(0);
    expect(r.iva).toBe(0);
    expect(r.total).toBe(0);
    expect(r.desglose).toHaveLength(0);
  });

  describe('fronteras del escalonado', () => {
    it('justo por debajo de la frontera del primer tramo (9 m3)', async () => {
      const svc = makeService(ESCALA_3_TRAMOS);
      const r = await svc.calcularMonto({ tipoServicio: 'AGUA', consumoM3: 9 });
      expect(r.subtotal).toBe(45); // 9 * 5, sólo tramo A
      expect(r.desglose).toHaveLength(1);
    });

    it('exactamente en la frontera (10 m3): el segundo tramo aún no aporta', async () => {
      // El tramo B exige consumo > 10 (min excluyente), así que a 10 m3 sólo cobra el tramo A.
      const svc = makeService(ESCALA_3_TRAMOS);
      const r = await svc.calcularMonto({ tipoServicio: 'AGUA', consumoM3: 10 });
      expect(r.subtotal).toBe(50); // 10 * 5
      expect(r.desglose).toHaveLength(1);
    });

    it('justo por encima de la frontera (11 m3): 1 m3 entra al segundo tramo', async () => {
      const svc = makeService(ESCALA_3_TRAMOS);
      const r = await svc.calcularMonto({ tipoServicio: 'AGUA', consumoM3: 11 });
      // A: 10*5=50 ; B: (11-10)*8=8
      expect(r.subtotal).toBe(58);
      expect(r.desglose).toHaveLength(2);
    });

    it('multi-tramo con el tramo abierto superior (25 m3)', async () => {
      const svc = makeService(ESCALA_3_TRAMOS);
      const r = await svc.calcularMonto({ tipoServicio: 'AGUA', consumoM3: 25 });
      // A: 10*5=50 ; B: 10*8=80 ; C: (25-20)*12=60
      expect(r.subtotal).toBe(190);
      expect(r.iva).toBeCloseTo(30.4, 5);
      expect(r.total).toBeCloseTo(220.4, 5);
      expect(r.desglose).toHaveLength(3);
    });
  });

  it('cuota fija: cobra la cuota independientemente del consumo', async () => {
    const svc = makeService([{ tipoCalculo: 'fijo', cuotaFija: 150, ivaPct: 16 }]);
    const r = await svc.calcularMonto({ tipoServicio: 'ALCANTARILLADO', consumoM3: 999 });
    expect(r.subtotal).toBe(150);
    expect(r.iva).toBeCloseTo(24, 5);
    expect(r.total).toBeCloseTo(174, 5);
    expect(r.desglose).toEqual([{ rango: 'fijo', m3: 0, precio: 150, subtotal: 150 }]);
  });

  it('mezcla cuota fija + escalonado: suma ambos componentes', async () => {
    const svc = makeService([
      { tipoCalculo: 'fijo', cuotaFija: 50, ivaPct: 16 },
      { tipoCalculo: 'escalonado', rangoMinM3: 0, rangoMaxM3: null, precioUnitario: 10, ivaPct: 16 },
    ]);
    const r = await svc.calcularMonto({ tipoServicio: 'AGUA', consumoM3: 6 });
    expect(r.subtotal).toBe(110); // 50 fijo + 6*10
  });
});
