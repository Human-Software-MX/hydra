import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
import { FiltroTarifasDto } from './dto/filtro-tarifas.dto';
import { CotizarContratacionQueryDto } from './dto/cotizar-contratacion.dto';

/**
 * C2 — cobertura de la ruta de dinero `TarifasService.calcularMonto`.
 *
 * `calcularMonto` obtiene las tarifas vigentes vía `findTarifaVigente`
 * (que consulta `prisma.tarifa.findMany`) y aplica el cálculo escalonado.
 * Mockeamos únicamente esa consulta para ejercitar el motor real de tramos:
 * bloques escalonados, cuota fija y sus fronteras exactas.
 */
type TarifaRow = {
  tipoCalculo: 'escalonado' | 'variable' | 'fijo' | 'tabla' | 'lineal' | 'lineal_excedente';
  rangoMinM3?: number | null;
  rangoMaxM3?: number | null;
  precioUnitario?: number | null;
  cuotaFija?: number | null;
  precios?: number[] | null;
  parametros?: Record<string, unknown> | null;
  ivaNoObjeto?: boolean;
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
    seccion: 'PERIODICA',
    variante: null,
    parametros: null as Record<string, unknown> | null,
    ivaNoObjeto: false,
    ivaPct: 0,
    vigenciaDesde: new Date(Date.UTC(2026, 1, 1)),
    vigenciaHasta: null,
    activo: true,
    version: 1,
    tarifaAnteriorId: null,
    motivo: 'Carga inicial',
    creadoPor: 'seed',
    createdAt: new Date(Date.UTC(2026, 1, 1)),
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

/** Fila del catálogo de contratación (derechos de conexión por longitud). */
function filaContratacion(over: Record<string, unknown> = {}): FilaTarifa {
  return filaTarifa({
    id: 'C1',
    codigo: 'EXP-01:contratacion_derechos_de_conexion_red_de_drenaje:CONCRETO_CONCRETO',
    nombre: 'DERECHOS DE CONEXIÓN RED DE DRENAJE · CONCRETO-CONCRETO',
    tipoServicio: 'contratacion_derechos_de_conexion_red_de_drenaje',
    concepto: 'DERECHOS DE CONEXIÓN RED DE DRENAJE',
    tipoCalculo: 'lineal_excedente',
    administracionId: 'EXP-01',
    claseTarifaId: null,
    claseTarifa: null,
    seccion: 'CONTRATACION',
    variante: 'CONCRETO-CONCRETO',
    parametros: { cantidadIncluida: 6 },
    ivaNoObjeto: false,
    rangoMinM3: null,
    rangoMaxM3: null,
    precios: null,
    cuotaFija: 1000,
    precioUnitario: 100,
    ivaPct: 16,
    ...over,
  });
}

/**
 * Prisma mockeado: `$transaction(fn)` ejecuta `fn` con el mismo cliente, de modo
 * que las escrituras quedan registradas en los mismos espías.
 */
/** Clase tarifaria del configurador fiscal (hereda el IVA de su categoría). */
const CLASE_MOCK = {
  id: 'CL1',
  codigo: 'DOM_MEDIO',
  nombre: 'DOMÉSTICA MEDIO',
  categoriaId: 'CAT1',
  ivaPct: null,
  sigeTpsId: null,
  orden: 1,
  activo: true,
  categoria: { id: 'CAT1', codigo: 'DOMESTICA', nombre: 'Doméstica', ivaPct: 0 },
};

/** Linaje con versión programada a futuro: el lote masivo debe omitirlo. */
const PROGRAMADAS = [
  {
    codigo: 'ADM1:agua:DOM_PROGRAMADA',
    nombre: 'Agua DOMÉSTICA (con versión programada)',
    tarifaSiguiente: { vigenciaDesde: new Date(Date.UTC(2027, 0, 1)) },
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
      // `totalesPorClase` del configurador fiscal.
      groupBy: jest.fn().mockResolvedValue([]),
    },
    claseTarifa: {
      findUnique: jest.fn().mockResolvedValue(CLASE_MOCK),
      findUniqueOrThrow: jest.fn().mockResolvedValue(CLASE_MOCK),
      update: jest.fn().mockResolvedValue(CLASE_MOCK),
    },
    tarifaMovimiento: {
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: `MOV${seq}`,
          ...args.data,
          createdAt: new Date(Date.UTC(2026, 8, 1)),
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
          fechaPublicacion: new Date(Date.UTC(2026, 8, 1)),
          fechaAplicacion: new Date(Date.UTC(2026, 8, 1)),
          fuenteOficial: null,
          estado: 'aplicada',
          porcentaje: 10,
          filtro: {},
          totalTarifas: filas.length,
          aplicadoPor: 'ana@cea.mx',
          createdAt: new Date(Date.UTC(2026, 8, 1)),
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

    const inicio = new Date(Date.UTC(2026, 8, 1));
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
    expect(cabecera.fechaAplicacion).toEqual(new Date(Date.UTC(2026, 8, 1)));
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
        vigenciaDesdeProgramada: new Date(Date.UTC(2027, 0, 1)).toISOString(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de contratación: lineal_excedente, «no objeto de IVA», sección.
// ─────────────────────────────────────────────────────────────────────────────

describe('calcularServicio tipoCalculo=lineal_excedente', () => {
  // Derechos de conexión por longitud: la base cubre los primeros 6 m.
  const excedente: TarifaCalculo[] = [
    {
      tipoServicio: 'contratacion_derechos_de_conexion_red_de_drenaje',
      tipoCalculo: 'lineal_excedente',
      rangoMinM3: null,
      rangoMaxM3: null,
      precioUnitario: 100,
      cuotaFija: 1000,
      cantidadIncluida: 6,
      precios: null,
      ivaPct: 16,
    },
  ];
  const importe = (cantidad: number) =>
    calcularServicio(excedente[0].tipoServicio, excedente, cantidad).reduce((s, l) => s + l.importe, 0);

  it('por debajo de la cantidad incluida cobra sólo la cuota base', () => {
    expect(importe(4)).toBe(1000);
    expect(importe(0)).toBe(1000);
  });

  it('exactamente en la cantidad incluida no cobra excedente', () => {
    expect(importe(6)).toBe(1000);
  });

  it('por encima cobra la base más el excedente a precio proporcional', () => {
    expect(importe(10)).toBe(1400); // 1000 + 100 × (10 - 6)
    const linea = calcularServicio(excedente[0].tipoServicio, excedente, 10)[0];
    expect(linea.iva).toBeCloseTo(224, 5); // 1400 × 16 %
    expect(linea.concepto).toContain('incluye 6');
  });

  it('sin cantidadIncluida todo es excedente', () => {
    const sinIncluida: TarifaCalculo[] = [{ ...excedente[0], cantidadIncluida: null }];
    expect(calcularServicio('x', sinIncluida, 10).reduce((s, l) => s + l.importe, 0)).toBe(2000);
  });
});

describe('tarifas «No objeto de IVA» (multas, recargos)', () => {
  it('calcularServicio no traslada IVA aunque la fila traiga tasa', () => {
    const multa: TarifaCalculo[] = [
      {
        tipoServicio: 'contratacion_multa',
        tipoCalculo: 'lineal',
        rangoMinM3: null,
        rangoMaxM3: null,
        precioUnitario: 0,
        cuotaFija: 2834,
        ivaNoObjeto: true,
        ivaPct: 16,
        precios: null,
      },
    ];
    const linea = calcularServicio('contratacion_multa', multa, 0)[0];
    expect(linea.importe).toBe(2834);
    expect(linea.ivaPct).toBe(0);
    expect(linea.iva).toBe(0);
  });

  it('computeMonto tampoco traslada IVA', async () => {
    const svc = makeService([{ tipoCalculo: 'lineal', cuotaFija: 2834, precioUnitario: 0, ivaPct: 16, ivaNoObjeto: true }]);
    const r = await svc.calcularMonto({ tipoServicio: 'contratacion_multa', consumoM3: 0 });
    expect(r.subtotal).toBe(2834);
    expect(r.iva).toBe(0);
    expect(r.total).toBe(2834);
  });
});

describe('TarifasService.computeMonto (lineal_excedente)', () => {
  const rows: TarifaRow[] = [
    {
      tipoCalculo: 'lineal_excedente',
      cuotaFija: 1000,
      precioUnitario: 100,
      parametros: { cantidadIncluida: 6 },
      ivaPct: 0,
    },
  ];

  it('cobra la base hasta la cantidad incluida y el excedente por encima', async () => {
    const svc = makeService(rows);
    expect((await svc.calcularMonto({ tipoServicio: 'contratacion_x', consumoM3: 4 })).subtotal).toBe(1000);
    expect((await svc.calcularMonto({ tipoServicio: 'contratacion_x', consumoM3: 6 })).subtotal).toBe(1000);
    const r = await svc.calcularMonto({ tipoServicio: 'contratacion_x', consumoM3: 10 });
    expect(r.subtotal).toBe(1400);
    expect(r.desglose).toEqual([
      { rango: 'lineal excedente sobre 6', m3: 10, precio: 100, subtotal: 1400 },
    ]);
  });

  it('findTarifaVigente restringe el cálculo por consumo al catálogo periódico', async () => {
    const prisma = { tarifa: { findMany: jest.fn().mockResolvedValue([{ tipoCalculo: 'fijo', cuotaFija: 10, ivaPct: 0 }]) } };
    const svc = new TarifasService(prisma as never, {} as never);
    await svc.calcularMonto({ tipoServicio: 'agua', consumoM3: 1 });
    expect(prisma.tarifa.findMany.mock.calls[0][0].where.seccion).toBe('PERIODICA');
  });
});

describe('TarifaVersionesService: sección en consultas y versionado', () => {
  it('whereVigentes filtra por sección y variante', async () => {
    const { svc, cliente } = makeVersiones([filaTarifa()]);
    await svc.listarVigentes({ seccion: 'CONTRATACION', variante: 'CONCRETO-CONCRETO' });
    const where = cliente.tarifa.findMany.mock.calls[0][0].where;
    expect(where.seccion).toBe('CONTRATACION');
    expect(where.variante).toBe('CONCRETO-CONCRETO');

    // Sin filtro no se restringe ningún catálogo.
    const otro = makeVersiones([filaTarifa()]);
    await otro.svc.listarVigentes({});
    expect(otro.cliente.tarifa.findMany.mock.calls[0][0].where.seccion).toBeUndefined();
  });

  it('listarServicios agrupa también por sección', async () => {
    const { svc, cliente } = makeVersiones([filaTarifa()]);
    cliente.tarifa.groupBy.mockResolvedValueOnce([
      { tipoServicio: 'agua', concepto: null, seccion: 'PERIODICA', _count: { _all: 3 } },
      {
        tipoServicio: 'contratacion_multa',
        concepto: 'MULTA',
        seccion: 'CONTRATACION',
        _count: { _all: 1 },
      },
    ]);
    const servicios = await svc.listarServicios();
    expect(cliente.tarifa.groupBy.mock.calls[0][0].by).toEqual(['tipoServicio', 'concepto', 'seccion']);
    expect(servicios).toEqual([
      { tipoServicio: 'agua', concepto: null, seccion: 'PERIODICA', total: 3 },
      { tipoServicio: 'contratacion_multa', concepto: 'MULTA', seccion: 'CONTRATACION', total: 1 },
    ]);
  });

  it('crearVersion arrastra sección, variante, parámetros e ivaNoObjeto a la nueva versión', async () => {
    const { svc, cliente } = makeVersiones([filaContratacion()]);
    await svc.crearVersion('C1', { porcentaje: 10, vigenciaDesde: '2026-09-01', motivo: 'Ajuste' }, CTX);
    const nueva = cliente.tarifa.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(nueva.seccion).toBe('CONTRATACION');
    expect(nueva.variante).toBe('CONCRETO-CONCRETO');
    expect(nueva.parametros).toEqual({ cantidadIncluida: 6 });
    expect(nueva.ivaNoObjeto).toBe(false);
    expect(nueva.cuotaFija).toBe(1100); // el porcentaje sólo toca los valores económicos
    expect(nueva.ivaPct).toBe(16);
  });

  it('ivaNoObjeto: true fuerza ivaPct 0 y clasifica el movimiento como CAMBIO_FISCAL', async () => {
    const { svc, cliente } = makeVersiones([filaContratacion()]);
    const { tarifa, movimiento } = await svc.actualizarTarifa(
      'C1',
      { ivaNoObjeto: true, vigenciaDesde: '2026-09-01', motivo: 'Concepto no objeto de IVA' },
      CTX,
    );
    const nueva = cliente.tarifa.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(nueva.ivaNoObjeto).toBe(true);
    expect(nueva.ivaPct).toBe(0);
    expect(movimiento.tipo).toBe(TIPOS_MOVIMIENTO.CAMBIO_FISCAL);
    expect(tarifa.ivaNoObjeto).toBe(true);
    expect(tarifa.ivaPct).toBe(0);
  });

  it('actualizarTarifa sin ningún cambio sigue siendo 400', async () => {
    const { svc } = makeVersiones([filaContratacion()]);
    await expect(svc.actualizarTarifa('C1', { motivo: 'Sin cambios' }, CTX)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('el cambio fiscal de una clase no alcanza a contratación ni a las «no objeto»', async () => {
    const { svc, cliente } = makeVersiones([filaTarifa()]);
    await svc.actualizarClase('CL1', { ivaPct: 16, vigenciaDesde: '2026-09-01' }, CTX);

    const propagacion = cliente.tarifa.findMany.mock.calls.find(
      (c: any) => c[0]?.select?.ivaPct === true,
    );
    expect(propagacion).toBeDefined();
    expect(propagacion?.[0].where.seccion).toBe('PERIODICA');
    expect(propagacion?.[0].where.ivaNoObjeto).toBe(false);
    // La tarifa periódica cuyo IVA cambia sí se versiona (CAMBIO_FISCAL).
    const mov = cliente.tarifaMovimiento.create.mock.calls[0][0].data as Record<string, any>;
    expect(mov.tipo).toBe(TIPOS_MOVIMIENTO.CAMBIO_FISCAL);
    expect(mov.valoresNuevos.ivaPct).toBe(16);
  });
});

describe('TarifaVersionesService.cotizarContratacion', () => {
  it('resuelve la tarifa vigente y cobra base + excedente', async () => {
    const { svc, cliente } = makeVersiones([filaContratacion()]);
    const cotizacion = await svc.cotizarContratacion({
      administracionId: 'EXP-01',
      tipoServicio: 'contratacion_derechos_de_conexion_red_de_drenaje',
      variante: 'CONCRETO-CONCRETO',
      cantidad: 10,
    });
    expect(cotizacion.tarifa.seccion).toBe('CONTRATACION');
    expect(cotizacion.tarifa.variante).toBe('CONCRETO-CONCRETO');
    expect(cotizacion.tarifa.parametros).toEqual({ cantidadIncluida: 6 });
    expect(cotizacion.cantidad).toBe(10);
    expect(cotizacion.importe).toBe(1400); // 1000 + 100 × 4
    expect(cotizacion.ivaPct).toBe(16);
    expect(cotizacion.iva).toBeCloseTo(224, 5);
    expect(cotizacion.total).toBeCloseTo(1624, 5);
    expect(cotizacion.ivaNoObjeto).toBe(false);

    // Sólo el catálogo de contratación y sólo la administración pedida (o global).
    const where = cliente.tarifa.findMany.mock.calls[0][0].where;
    expect(where.seccion).toBe('CONTRATACION');
    expect(where.variante).toBe('CONCRETO-CONCRETO');
    expect(where.AND).toContainEqual({
      OR: [{ administracionId: 'EXP-01' }, { administracionId: null }],
    });
  });

  it('sin cantidad cobra sólo la cuota base', async () => {
    const { svc } = makeVersiones([filaContratacion()]);
    const cotizacion = await svc.cotizarContratacion({
      administracionId: 'EXP-01',
      tipoServicio: 'contratacion_derechos_de_conexion_red_de_drenaje',
    });
    expect(cotizacion.cantidad).toBe(0);
    expect(cotizacion.importe).toBe(1000);
  });

  it('prefiere la tarifa de la administración sobre la global', async () => {
    const { svc } = makeVersiones([
      filaContratacion({ id: 'GLOBAL', administracionId: null, cuotaFija: 500 }),
      filaContratacion(),
    ]);
    const cotizacion = await svc.cotizarContratacion({
      administracionId: 'EXP-01',
      tipoServicio: 'contratacion_derechos_de_conexion_red_de_drenaje',
      cantidad: 6,
    });
    expect(cotizacion.tarifa.id).toBe('C1');
    expect(cotizacion.importe).toBe(1000);
  });

  it('una tarifa «no objeto de IVA» cotiza sin traslado', async () => {
    const { svc } = makeVersiones([
      filaContratacion({
        id: 'M1',
        tipoServicio: 'contratacion_multa',
        tipoCalculo: 'lineal',
        variante: null,
        parametros: null,
        cuotaFija: 2834,
        precioUnitario: 0,
        ivaNoObjeto: true,
        ivaPct: 0,
      }),
    ]);
    const cotizacion = await svc.cotizarContratacion({
      administracionId: 'EXP-01',
      tipoServicio: 'contratacion_multa',
      cantidad: 1,
    });
    expect(cotizacion.importe).toBe(2834);
    expect(cotizacion.ivaPct).toBe(0);
    expect(cotizacion.iva).toBe(0);
    expect(cotizacion.total).toBe(2834);
    expect(cotizacion.ivaNoObjeto).toBe(true);
  });

  it('404 cuando ninguna tarifa de contratación coincide', async () => {
    const { svc } = makeVersiones([]);
    await expect(
      svc.cotizarContratacion({ administracionId: 'EXP-01', tipoServicio: 'contratacion_inexistente' }),
    ).rejects.toBeInstanceOf(NotFoundException);
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

  it('ActualizarTarifaDto: ivaNoObjeto sólo acepta booleanos', async () => {
    expect(await errores(ActualizarTarifaDto, { motivo: 'Ajuste', ivaNoObjeto: true })).toEqual([]);
    expect(await errores(ActualizarTarifaDto, { motivo: 'Ajuste', ivaNoObjeto: null })).toEqual([
      'ivaNoObjeto',
    ]);
    expect(await errores(ActualizarTarifaDto, { motivo: 'Ajuste', ivaNoObjeto: 'si' })).toEqual([
      'ivaNoObjeto',
    ]);
  });

  it('FiltroTarifasDto: seccion acotada al catálogo y variante libre', async () => {
    expect(await errores(FiltroTarifasDto, { seccion: 'CONTRATACION' })).toEqual([]);
    expect(await errores(FiltroTarifasDto, { seccion: 'PERIODICA', variante: 'CONCRETO-CONCRETO' })).toEqual([]);
    expect(await errores(FiltroTarifasDto, { seccion: 'OTRA' })).toEqual(['seccion']);
  });

  it('CotizarContratacionQueryDto: administración y servicio obligatorios, cantidad numérica', async () => {
    expect(
      await errores(CotizarContratacionQueryDto, {
        administracionId: 'EXP-01',
        tipoServicio: 'contratacion_multa',
        cantidad: '10',
      }),
    ).toEqual([]);
    expect(await errores(CotizarContratacionQueryDto, { tipoServicio: 'contratacion_multa' })).toEqual([
      'administracionId',
    ]);
    expect(
      await errores(CotizarContratacionQueryDto, {
        administracionId: 'EXP-01',
        tipoServicio: 'contratacion_multa',
        cantidad: 'abc',
      }),
    ).toEqual(['cantidad']);
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
