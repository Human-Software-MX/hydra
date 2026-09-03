import { BadRequestException, ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TarifasService } from './tarifas.service';
import { TarifaVersionesService } from './tarifa-versiones.service';
import { calcularServicio, TarifaCalculo } from '../facturacion/billing-calculator';
import { aplicarPorcentaje, TIPOS_MOVIMIENTO, ValoresTarifa } from './tarifa-valores';
import { filtrarMasEspecificas } from '../facturacion/tarifa-especificidad';
import { ActualizarTarifaDto } from './dto/actualizar-tarifa.dto';
import { UpdateCategoriaTarifaDto, UpdateClaseTarifaDto } from './dto/catalogo-fiscal.dto';
import { PreviewMasivaDto } from './dto/actualizacion-masiva.dto';

/**
 * C2 — cobertura de la ruta de dinero `TarifasService.calcularMonto`.
 *
 * `calcularMonto` obtiene las tarifas vigentes vía `findTarifaVigente`
 * (que consulta `prisma.tarifa.findMany`) y aplica el cálculo escalonado.
 * Mockeamos únicamente esa consulta para ejercitar el motor real de tramos:
 * bloques escalonados, cuota fija y sus fronteras exactas.
 */
type TarifaRow = {
  tipoCalculo: 'escalonado' | 'variable' | 'fijo' | 'tabla' | 'lineal';
  rangoMinM3?: number | null;
  rangoMaxM3?: number | null;
  precioUnitario?: number | null;
  cuotaFija?: number | null;
  precios?: number[] | null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Kardex: helpers puros, motor (tabla / lineal) y reglas de versionado.
// ─────────────────────────────────────────────────────────────────────────────

describe('aplicarPorcentaje', () => {
  it('redondea los precios a 4 decimales y no toca el IVA', () => {
    const valores: ValoresTarifa = {
      tipoCalculo: 'lineal',
      rangoMinM3: null,
      rangoMaxM3: null,
      cuotaFija: 221.9556,
      precioUnitario: 10,
      precios: null,
      ivaPct: 16,
    };
    const nuevo = aplicarPorcentaje(valores, 4.5);
    expect(nuevo.cuotaFija).toBe(231.9436); // 221.9556 * 1.045 = 231.943602
    expect(nuevo.precioUnitario).toBe(10.45);
    expect(nuevo.ivaPct).toBe(16); // el IVA es configuración fiscal, no valor económico
  });

  it('recalcula la tabla elemento a elemento y respeta los nulos', () => {
    const valores: ValoresTarifa = {
      tipoCalculo: 'tabla',
      rangoMinM3: 0,
      rangoMaxM3: 2,
      cuotaFija: null,
      precioUnitario: null,
      precios: [0, 10.1111, 20.2222],
      ivaPct: 0,
    };
    const nuevo = aplicarPorcentaje(valores, -2);
    expect(nuevo.precios).toEqual([0, 9.9089, 19.8178]);
    expect(nuevo.cuotaFija).toBeNull();
    expect(nuevo.precioUnitario).toBeNull();
  });
});

describe('calcularServicio tipoCalculo=tabla', () => {
  // precios[m3] = 5 * m3 para 0..200 m³; por encima: 100 + 3 × m³.
  const tabla: TarifaCalculo[] = [
    {
      tipoServicio: 'agua',
      tipoCalculo: 'tabla',
      rangoMinM3: 0,
      rangoMaxM3: 200,
      precioUnitario: 3,
      cuotaFija: 100,
      precios: Array.from({ length: 201 }, (_, i) => i * 5),
      ivaPct: 0,
    },
  ];

  it('lee el importe acumulado de la tabla (10 m³)', () => {
    const lineas = calcularServicio('agua', tabla, 10);
    expect(lineas).toHaveLength(1);
    expect(lineas[0].importe).toBe(50); // precios[10]
    expect(lineas[0].m3).toBe(10);
    expect(lineas[0].precioUnitario).toBe(5); // 50 / 10
  });

  it('redondea los m³: 10.6 sube a 11 y 10.5 se queda en 10', () => {
    expect(calcularServicio('agua', tabla, 10.6)[0].importe).toBe(55); // precios[11]
    expect(calcularServicio('agua', tabla, 10.5)[0].importe).toBe(50); // precios[10]
  });

  it('por encima del rango cobra cuotaFija + precioUnitario × m³ (250 m³)', () => {
    const linea = calcularServicio('agua', tabla, 250)[0];
    expect(linea.importe).toBe(850); // 100 + 3 * 250
    expect(linea.m3).toBe(250);
  });

  it('consumo 0: cobra el mínimo de la tabla y omite la línea si es cero', () => {
    const conMinimo: TarifaCalculo[] = [{ ...tabla[0], rangoMaxM3: 2, precios: [80, 85, 90] }];
    expect(calcularServicio('agua', conMinimo, 0)[0].importe).toBe(80);
    expect(calcularServicio('agua', tabla, 0)).toHaveLength(0);
  });
});

describe('calcularServicio tipoCalculo=lineal', () => {
  const lineal: TarifaCalculo[] = [
    {
      tipoServicio: 'agua_tratada',
      tipoCalculo: 'lineal',
      rangoMinM3: null,
      rangoMaxM3: null,
      precioUnitario: 12.5,
      cuotaFija: 30,
      precios: null,
      ivaPct: 16,
    },
  ];

  it('cobra cuotaFija + precioUnitario × consumo', () => {
    const linea = calcularServicio('agua_tratada', lineal, 8)[0];
    expect(linea.importe).toBe(130); // 30 + 12.5 * 8
    expect(linea.iva).toBeCloseTo(20.8, 5);
    expect(linea.concepto).toContain('cargo lineal');
  });

  it('sin consumo cobra sólo la cuota fija', () => {
    expect(calcularServicio('agua_tratada', lineal, 0)[0].importe).toBe(30);
  });
});

describe('TarifasService.computeMonto (tabla / lineal)', () => {
  it('tabla: importe acumulado con m³ redondeados e IVA de la tarifa', async () => {
    const svc = makeService([
      {
        tipoCalculo: 'tabla',
        rangoMinM3: 0,
        rangoMaxM3: 2,
        precios: [0, 100, 200],
        cuotaFija: 50,
        precioUnitario: 10,
        ivaPct: 16,
      },
    ]);
    const r = await svc.calcularMonto({ tipoServicio: 'agua', consumoM3: 1.4 });
    expect(r.subtotal).toBe(100); // 1.4 -> 1 m³ -> precios[1]
    expect(r.total).toBeCloseTo(116, 5);
  });

  it('lineal: cuota fija más precio por m³', async () => {
    const svc = makeService([{ tipoCalculo: 'lineal', cuotaFija: 30, precioUnitario: 2, ivaPct: 0 }]);
    const r = await svc.calcularMonto({ tipoServicio: 'agua_tratada', consumoM3: 5 });
    expect(r.subtotal).toBe(40); // 30 + 2 * 5
    expect(r.desglose).toEqual([{ rango: 'lineal', m3: 5, precio: 2, subtotal: 40 }]);
  });
});

// ─── Versionado (TarifaVersionesService) ─────────────────────────────────────

/** Fila de tarifa como la devuelve Prisma con `claseTarifa.categoria` incluida. */
function filaTarifa(over: Record<string, unknown> = {}) {
  return {
    id: 'T1',
    codigo: 'ADM1:agua:DOM_MEDIO',
    nombre: 'Agua DOMÉSTICA MEDIO',
    tipoServicio: 'agua',
    tipoCalculo: 'tabla',
    concepto: null,
    administracionId: 'ADM1',
    tipoContratacionCodigo: null,
    claseTarifaId: 'CL1',
    rangoMinM3: 0,
    rangoMaxM3: 2,
    cuotaFija: 100,
    precioUnitario: 5,
    precios: [0, 10, 20],
    ivaPct: 0,
    vigenciaDesde: new Date(2026, 1, 1),
    vigenciaHasta: null,
    activo: true,
    version: 1,
    tarifaAnteriorId: null,
    motivo: 'Carga inicial',
    creadoPor: 'seed',
    createdAt: new Date(2026, 1, 1),
    claseTarifa: {
      id: 'CL1',
      codigo: 'DOM_MEDIO',
      nombre: 'DOMÉSTICA MEDIO',
      categoriaId: 'CAT1',
      categoria: { id: 'CAT1', codigo: 'DOMESTICA', nombre: 'Doméstica' },
    },
    ...over,
  };
}

type FilaTarifa = ReturnType<typeof filaTarifa>;

/**
 * Prisma mockeado: `$transaction(fn)` ejecuta `fn` con el mismo cliente, de modo
 * que las escrituras quedan registradas en los mismos espías.
 */
/** Linaje con versión programada a futuro: el lote masivo debe omitirlo. */
const PROGRAMADAS = [
  {
    codigo: 'ADM1:agua:DOM_PROGRAMADA',
    nombre: 'Agua DOMÉSTICA (con versión programada)',
    tarifaSiguiente: { vigenciaDesde: new Date(2027, 0, 1) },
  },
];

function makeVersiones(filas: FilaTarifa[], programadas: typeof PROGRAMADAS = []) {
  const porId = new Map(filas.map((f) => [f.id, f]));
  let seq = 0;
  const cliente = {
    tarifa: {
      findUnique: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(porId.get(args.where.id) ?? null),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      // Distingue las tres consultas del servicio: selección del lote,
      // linajes con versión programada y carga puntual de `precios`.
      findMany: jest.fn((args: any = {}) => {
        if (args?.select?.precios) {
          return Promise.resolve(filas.map((f) => ({ id: f.id, precios: f.precios })));
        }
        if (args?.where?.tarifaSiguiente?.isNot === null) return Promise.resolve(programadas);
        return Promise.resolve(filas);
      }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...filaTarifa(), ...args.data, id: `NEW${++seq}` }),
      ),
    },
    tarifaMovimiento: {
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: `MOV${seq}`,
          ...args.data,
          createdAt: new Date(2026, 8, 1),
          tarifa: {
            nombre: 'Agua DOMÉSTICA MEDIO',
            version: 2,
            tipoServicio: 'agua',
            administracionId: 'ADM1',
            claseTarifa: { nombre: 'DOMÉSTICA MEDIO' },
          },
        }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    correccionTarifaria: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    actualizacionTarifaria: {
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'ACT1', ...args.data }),
      ),
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 'ACT1',
          descripcion: 'Ajuste',
          fechaPublicacion: new Date(2026, 8, 1),
          fechaAplicacion: new Date(2026, 8, 1),
          fuenteOficial: null,
          estado: 'aplicada',
          porcentaje: 10,
          filtro: {},
          totalTarifas: filas.length,
          aplicadoPor: 'ana@cea.mx',
          createdAt: new Date(2026, 8, 1),
        }),
      ),
    },
    administracion: { findMany: jest.fn().mockResolvedValue([{ id: 'ADM1', nombre: 'Querétaro' }]) },
  };
  const prisma = {
    ...cliente,
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(cliente)),
  };
  return { svc: new TarifaVersionesService(prisma as never), cliente };
}

const CTX = { usuarioId: 'u1', usuarioEmail: 'ana@cea.mx' };

describe('TarifaVersionesService.crearVersion', () => {
  it('rechaza (409) si la tarifa no es la última versión del linaje', async () => {
    const { svc, cliente } = makeVersiones([filaTarifa()]);
    cliente.tarifa.findFirst.mockResolvedValueOnce({ version: 2 });
    await expect(
      svc.crearVersion('T1', { cuotaFija: 150, motivo: 'Ajuste manual' }, CTX),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(cliente.tarifa.create).not.toHaveBeenCalled();
  });

  it('rechaza (400) una vigencia anterior al inicio de la versión actual', async () => {
    const { svc, cliente } = makeVersiones([filaTarifa()]);
    await expect(
      svc.crearVersion('T1', { cuotaFija: 150, vigenciaDesde: '2026-01-01', motivo: 'Retroactivo' }, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cliente.tarifa.create).not.toHaveBeenCalled();
  });

  it('cierra la versión anterior 1 ms antes, incrementa version y registra el movimiento', async () => {
    const { svc, cliente } = makeVersiones([filaTarifa()]);
    await svc.crearVersion('T1', { cuotaFija: 150, vigenciaDesde: '2026-09-01', motivo: 'Nuevo precio' }, CTX);

    const inicio = new Date(2026, 8, 1);
    expect(cliente.tarifa.update).toHaveBeenCalledWith({
      where: { id: 'T1' },
      data: { vigenciaHasta: new Date(inicio.getTime() - 1) },
    });

    const nueva = cliente.tarifa.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(nueva.version).toBe(2);
    expect(nueva.tarifaAnteriorId).toBe('T1');
    expect(nueva.codigo).toBe('ADM1:agua:DOM_MEDIO');
    expect(nueva.cuotaFija).toBe(150);
    expect(nueva.vigenciaDesde).toEqual(inicio);
    expect(nueva.creadoPor).toBe('ana@cea.mx');

    const mov = cliente.tarifaMovimiento.create.mock.calls[0][0].data as Record<string, any>;
    expect(mov.tipo).toBe(TIPOS_MOVIMIENTO.CAMBIO_VALOR);
    expect(mov.valoresAnteriores.cuotaFija).toBe(100);
    expect(mov.valoresNuevos.cuotaFija).toBe(150);
    expect(mov.usuarioEmail).toBe('ana@cea.mx');

    // Las correcciones activas siguen a la versión vigente.
    expect(cliente.correccionTarifaria.updateMany).toHaveBeenCalledWith({
      where: { tarifaId: 'T1', activo: true },
      data: { tarifaId: 'NEW1' },
    });
  });

  it('un cambio de sólo IVA se clasifica como CAMBIO_FISCAL', async () => {
    const { svc, cliente } = makeVersiones([filaTarifa()]);
    await svc.crearVersion('T1', { ivaPct: 16, vigenciaDesde: '2026-09-01', motivo: 'Cambio fiscal' }, CTX);
    const mov = cliente.tarifaMovimiento.create.mock.calls[0][0].data as Record<string, any>;
    expect(mov.tipo).toBe(TIPOS_MOVIMIENTO.CAMBIO_FISCAL);
    expect(mov.valoresNuevos.ivaPct).toBe(16);
    expect(mov.valoresNuevos.cuotaFija).toBe(100); // el valor económico no cambia
  });

  it('aplica el porcentaje sobre los valores actuales (AJUSTE_PORCENTUAL)', async () => {
    const { svc, cliente } = makeVersiones([filaTarifa()]);
    await svc.crearVersion('T1', { porcentaje: 10, vigenciaDesde: '2026-09-01', motivo: 'Ajuste 10%' }, CTX);
    const mov = cliente.tarifaMovimiento.create.mock.calls[0][0].data as Record<string, any>;
    expect(mov.tipo).toBe(TIPOS_MOVIMIENTO.AJUSTE_PORCENTUAL);
    expect(mov.porcentaje).toBe(10);
    expect(mov.valoresNuevos.cuotaFija).toBe(110);
    expect(mov.valoresNuevos.precios).toEqual([0, 11, 22]);
  });
});

describe('TarifaVersionesService ajuste masivo', () => {
  const FILAS = [filaTarifa(), filaTarifa({ id: 'T2', codigo: 'ADM1:agua:DOM_ALTO' })];

  it('el preview no escribe y devuelve los valores actuales y propuestos', async () => {
    const { svc, cliente } = makeVersiones(FILAS);
    const preview = await svc.previewMasiva({ filtro: {}, porcentaje: 10, vigenciaDesde: '2026-09-01' });
    expect(preview.total).toBe(2);
    expect(preview.excluidosProgramados).toBe(0);
    expect(preview.tarifas[0].actual.cuotaFija).toBe(100);
    expect(preview.tarifas[0].nuevo.cuotaFija).toBe(110);
    // tabla: el valor de referencia es el importe a 10 m³ (aquí el tope de la tabla).
    expect(preview.tarifas[0].actual.valorReferencia).toBe(20);
    expect(preview.tarifas[0].nuevo.valorReferencia).toBe(22);
    expect(cliente.tarifa.create).not.toHaveBeenCalled();
    expect(cliente.actualizacionTarifaria.create).not.toHaveBeenCalled();
  });

  it('aplicar escribe exactamente el conjunto que muestra el preview', async () => {
    const { svc, cliente } = makeVersiones(FILAS);
    const preview = await svc.previewMasiva({ filtro: {}, porcentaje: 10, vigenciaDesde: '2026-09-01' });
    const lote = await svc.aplicarMasiva(
      { filtro: {}, porcentaje: 10, vigenciaDesde: '2026-09-01', motivo: 'Actualización trimestral' },
      CTX,
    );

    const escritas = cliente.tarifa.create.mock.calls.map(
      (c) => (c[0].data as Record<string, unknown>).tarifaAnteriorId,
    );
    expect(escritas).toEqual(preview.tarifas.map((t) => t.id));
    expect(cliente.tarifaMovimiento.create).toHaveBeenCalledTimes(2);
    const mov = cliente.tarifaMovimiento.create.mock.calls[0][0].data as Record<string, any>;
    expect(mov.tipo).toBe(TIPOS_MOVIMIENTO.AJUSTE_MASIVO);
    expect(mov.actualizacionId).toBe('ACT1');

    const cabecera = cliente.actualizacionTarifaria.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(cabecera.estado).toBe('aplicada');
    expect(cabecera.totalTarifas).toBe(2);
    expect(cabecera.descripcion).toBe('Actualización trimestral');
    expect(cabecera.fechaAplicacion).toEqual(new Date(2026, 8, 1));
    expect(lote.estado).toBe('aplicada');
  });

  it('rechaza (400) un porcentaje 0 o una selección vacía', async () => {
    const { svc } = makeVersiones(FILAS);
    await expect(svc.previewMasiva({ filtro: {}, porcentaje: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const vacio = makeVersiones([]);
    await expect(vacio.svc.previewMasiva({ filtro: {}, porcentaje: 5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      vacio.svc.aplicarMasiva({ filtro: {}, porcentaje: 5, motivo: 'Ajuste' }, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('informa los linajes con versión programada que quedan fuera del lote', async () => {
    const { svc } = makeVersiones(FILAS, PROGRAMADAS);
    const preview = await svc.previewMasiva({ filtro: {}, porcentaje: 10, vigenciaDesde: '2026-09-01' });
    expect(preview.excluidosProgramados).toBe(1);
    expect(preview.excluidos).toEqual([
      {
        codigo: 'ADM1:agua:DOM_PROGRAMADA',
        nombre: 'Agua DOMÉSTICA (con versión programada)',
        vigenciaDesdeProgramada: new Date(2027, 0, 1).toISOString(),
      },
    ]);

    const lote = await svc.aplicarMasiva(
      { filtro: {}, porcentaje: 10, vigenciaDesde: '2026-09-01', motivo: 'Ajuste trimestral' },
      CTX,
    );
    expect(lote.excluidosProgramados).toBe(1);
  });
});

describe('conflictos de concurrencia (P2002 → 409)', () => {
  it('crearVersion: UNIQUE del linaje se traduce a ConflictException', async () => {
    const { svc, cliente } = makeVersiones([filaTarifa()]);
    cliente.tarifa.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed on the fields: (`codigo`,`version`)'), {
        code: 'P2002',
      }),
    );
    await expect(
      svc.crearVersion('T1', { cuotaFija: 150, vigenciaDesde: '2026-09-01', motivo: 'Nuevo precio' }, CTX),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createTarifa: código duplicado devuelve 409, no 500', async () => {
    const prisma = {
      tarifa: {
        create: jest.fn().mockRejectedValue(
          Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
        ),
      },
    };
    const svc = new TarifasService(prisma as never, {} as never);
    await expect(
      svc.createTarifa({
        codigo: 'ADM1:agua:DOM_MEDIO',
        nombre: 'Duplicada',
        tipoServicio: 'agua',
        tipoCalculo: 'fijo',
        vigenciaDesde: '2026-09-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createTarifa: otros errores de Prisma se propagan tal cual', async () => {
    const prisma = {
      tarifa: { create: jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: 'P1001' })) },
    };
    const svc = new TarifasService(prisma as never, {} as never);
    await expect(
      svc.createTarifa({
        codigo: 'X',
        nombre: 'X',
        tipoServicio: 'agua',
        tipoCalculo: 'fijo',
        vigenciaDesde: '2026-09-01',
      }),
    ).rejects.toThrow('boom');
  });
});

describe('especificidad de tarifas (compartida con facturación)', () => {
  const filas = [
    { id: 'g', administracionId: null, claseTarifaId: null },
    { id: 'a', administracionId: 'ADM1', claseTarifaId: null },
    { id: 'ac', administracionId: 'ADM1', claseTarifaId: 'CL1' },
    { id: 'c', administracionId: null, claseTarifaId: 'CL1' },
  ];

  it('gana (admin, clase) sobre el resto', () => {
    expect(filtrarMasEspecificas(filas, { administracionId: 'ADM1', claseTarifaId: 'CL1' }).map((f) => f.id)).toEqual(['ac']);
  });

  it('sin clase del contrato gana (admin, sin clase) y (admin, clase)', () => {
    expect(filtrarMasEspecificas(filas, { administracionId: 'ADM1' }).map((f) => f.id)).toEqual(['a', 'ac']);
  });

  it('sin contexto no descarta nada (comportamiento histórico)', () => {
    expect(filtrarMasEspecificas(filas, {}).map((f) => f.id)).toEqual(['g', 'a', 'ac', 'c']);
  });

  it('findTarifaVigente aplica la especificidad y es insensible a mayúsculas', async () => {
    const rows = [
      { tipoCalculo: 'fijo', cuotaFija: 10, ivaPct: 0, administracionId: null, claseTarifaId: null },
      { tipoCalculo: 'fijo', cuotaFija: 99, ivaPct: 0, administracionId: 'ADM1', claseTarifaId: null },
    ];
    const prisma = { tarifa: { findMany: jest.fn().mockResolvedValue(rows) } };
    const svc = new TarifasService(prisma as never, {} as never);

    // Sin filtros: suma todo lo vigente (10 + 99).
    const todo = await svc.calcularMonto({ tipoServicio: 'AGUA', consumoM3: 1 });
    expect(todo.subtotal).toBe(109);

    // Con administración: sólo la tarifa específica.
    const especifico = await svc.calcularMonto({
      tipoServicio: 'AGUA',
      consumoM3: 1,
      administracionId: 'ADM1',
    });
    expect(especifico.subtotal).toBe(99);

    // El servicio se compara sin distinguir mayúsculas/minúsculas.
    const where = prisma.tarifa.findMany.mock.calls[0][0].where;
    expect(where.tipoServicio).toEqual({ equals: 'AGUA', mode: 'insensitive' });
  });
});

describe('DTOs: un null explícito no puede colarse como cambio', () => {
  const errores = async (cls: any, payload: object) =>
    (await validate(plainToInstance(cls, payload) as object)).map((e) => e.property);

  it('ActualizarTarifaDto rechaza cuotaFija/precioUnitario/precios/ivaPct en null', async () => {
    expect(await errores(ActualizarTarifaDto, { motivo: 'Ajuste', cuotaFija: null })).toEqual(['cuotaFija']);
    expect(await errores(ActualizarTarifaDto, { motivo: 'Ajuste', precioUnitario: null })).toEqual([
      'precioUnitario',
    ]);
    expect(await errores(ActualizarTarifaDto, { motivo: 'Ajuste', precios: null })).toEqual(['precios']);
    expect(await errores(ActualizarTarifaDto, { motivo: 'Ajuste', ivaPct: null })).toEqual(['ivaPct']);
  });

  it('ActualizarTarifaDto acepta valores válidos y acota el tamaño de la tabla', async () => {
    expect(await errores(ActualizarTarifaDto, { motivo: 'Ajuste', cuotaFija: 0, precios: [1, 2, 3] })).toEqual([]);
    expect(
      await errores(ActualizarTarifaDto, { motivo: 'Ajuste', precios: new Array(1002).fill(1) }),
    ).toEqual(['precios']);
  });

  it('UpdateCategoriaTarifaDto rechaza ivaPct null (propagaría IVA 0 %)', async () => {
    expect(await errores(UpdateCategoriaTarifaDto, { ivaPct: null })).toEqual(['ivaPct']);
    expect(await errores(UpdateCategoriaTarifaDto, { ivaPct: 16 })).toEqual([]);
    expect(await errores(UpdateCategoriaTarifaDto, { nombre: null })).toEqual(['nombre']);
  });

  it('UpdateClaseTarifaDto SÍ acepta ivaPct null: significa "hereda de la categoría"', async () => {
    expect(await errores(UpdateClaseTarifaDto, { ivaPct: null })).toEqual([]);
    expect(await errores(UpdateClaseTarifaDto, { ivaPct: 8 })).toEqual([]);
    expect(await errores(UpdateClaseTarifaDto, { ivaPct: 120 })).toEqual(['ivaPct']);
  });

  it('PreviewMasivaDto: filtro opcional, porcentaje obligatorio y acotado', async () => {
    expect(await errores(PreviewMasivaDto, { porcentaje: 5 })).toEqual([]);
    expect(await errores(PreviewMasivaDto, { porcentaje: null })).toEqual(['porcentaje']);
    expect(await errores(PreviewMasivaDto, { porcentaje: 900 })).toEqual(['porcentaje']);
    expect(await errores(PreviewMasivaDto, { porcentaje: 5, vigenciaDesde: '01/09/2026' })).toEqual([
      'vigenciaDesde',
    ]);
  });
});
