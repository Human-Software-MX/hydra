import { describe, expect, it, vi } from 'vitest';
import {
  buscarSugerenciasDireccion,
  coordenadasDesde,
  coordenadasDifieren,
  formatearCoordenadas,
  geocodificarDireccion,
  nominatimSearchUrl,
  nominatimSuggestUrl,
  redondearCoord,
} from './geo-picker';

describe('redondearCoord', () => {
  it('redondea a 7 decimales (precisión Decimal(10,7))', () => {
    expect(redondearCoord(20.58881234567)).toBe(20.5888123);
    expect(redondearCoord(-100.38999999999)).toBe(-100.39);
  });
});

describe('coordenadasDesde', () => {
  it('acepta números y cadenas numéricas', () => {
    expect(coordenadasDesde(20.5888, -100.3899)).toEqual({ lat: 20.5888, lng: -100.3899 });
    expect(coordenadasDesde('20.5888', '-100.3899')).toEqual({ lat: 20.5888, lng: -100.3899 });
  });

  it('devuelve null si falta o es inválida cualquiera de las dos', () => {
    expect(coordenadasDesde(null, -100.3)).toBeNull();
    expect(coordenadasDesde(20.5, undefined)).toBeNull();
    expect(coordenadasDesde('', '')).toBeNull();
    expect(coordenadasDesde('abc', '-100.3')).toBeNull();
    expect(coordenadasDesde(91, -100.3)).toBeNull();
    expect(coordenadasDesde(20.5, 181)).toBeNull();
    expect(coordenadasDesde(NaN, 1)).toBeNull();
  });
});

describe('coordenadasDifieren', () => {
  it('ignora diferencias por debajo del umbral', () => {
    expect(
      coordenadasDifieren({ lat: 20.5, lng: -100.3 }, { lat: 20.5 + 1e-7, lng: -100.3 }),
    ).toBe(false);
  });

  it('detecta cambios reales y presencia/ausencia', () => {
    expect(coordenadasDifieren({ lat: 20.5, lng: -100.3 }, { lat: 20.6, lng: -100.3 })).toBe(true);
    expect(coordenadasDifieren(null, { lat: 20.5, lng: -100.3 })).toBe(true);
    expect(coordenadasDifieren({ lat: 20.5, lng: -100.3 }, null)).toBe(true);
    expect(coordenadasDifieren(null, null)).toBe(false);
  });
});

describe('formatearCoordenadas', () => {
  it('formatea con 6 decimales o cadena vacía si no hay coordenadas', () => {
    expect(formatearCoordenadas(20.5888, -100.3899)).toBe('20.588800, -100.389900');
    expect(formatearCoordenadas(null, null)).toBe('');
  });
});

describe('nominatimSearchUrl', () => {
  it('acota la búsqueda a México/Querétaro y pide un solo resultado JSON', () => {
    const url = new URL(nominatimSearchUrl('Av. Constituyentes 100, Querétaro', 'ops@cea.mx'));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('q')).toBe('Av. Constituyentes 100, Querétaro');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('countrycodes')).toBe('mx');
    expect(url.searchParams.get('bounded')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('viewbox')).toBe('-100.6,20.2,-99.8,21.0');
    expect(url.searchParams.get('email')).toBe('ops@cea.mx');
  });
});

describe('geocodificarDireccion', () => {
  const respuesta = (body: unknown, ok = true) =>
    ({ ok, json: async () => body }) as unknown as Response;

  it('devuelve las coordenadas del primer resultado, redondeadas', async () => {
    const fetchImpl = vi.fn(async () => respuesta([{ lat: '20.58881234567', lon: '-100.38991' }]));
    const c = await geocodificarDireccion('Calle 1, Querétaro', { fetchImpl });
    expect(c).toEqual({ lat: 20.5888123, lng: -100.38991 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('devuelve null sin resultados, con error HTTP, con excepción o con dirección vacía', async () => {
    expect(await geocodificarDireccion('x', { fetchImpl: vi.fn(async () => respuesta([])) })).toBeNull();
    expect(await geocodificarDireccion('x', { fetchImpl: vi.fn(async () => respuesta([], false)) })).toBeNull();
    expect(
      await geocodificarDireccion('x', {
        fetchImpl: vi.fn(async () => {
          throw new Error('red');
        }),
      }),
    ).toBeNull();
    const noLlamado = vi.fn();
    expect(await geocodificarDireccion('   ', { fetchImpl: noLlamado })).toBeNull();
    expect(noLlamado).not.toHaveBeenCalled();
  });
});

describe('nominatimSuggestUrl', () => {
  it('pide varias opciones en español, acotadas a Querétaro', () => {
    const url = new URL(nominatimSuggestUrl('tec de monterrey'));
    expect(url.searchParams.get('limit')).toBe('6');
    expect(url.searchParams.get('bounded')).toBe('1');
    expect(url.searchParams.get('viewbox')).toBe('-100.6,20.2,-99.8,21.0');
    expect(url.searchParams.get('accept-language')).toBe('es');
  });
});

describe('buscarSugerenciasDireccion', () => {
  const respuesta = (body: unknown, ok = true) =>
    ({ ok, json: async () => body }) as unknown as Response;

  it('mapea resultados con etiqueta y coordenadas redondeadas, deduplicando', async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta([
        { display_name: 'Tec de Monterrey, Epigmenio González, Querétaro', lat: '20.61234567891', lon: '-100.4034' },
        { display_name: 'Tec de Monterrey, Epigmenio González, Querétaro', lat: '20.61234567891', lon: '-100.4034' },
        { display_name: 'Sin coords', lat: null, lon: null },
      ]),
    );
    const s = await buscarSugerenciasDireccion('tec de monterrey', { fetchImpl });
    expect(s).toEqual([
      {
        etiqueta: 'Tec de Monterrey, Epigmenio González, Querétaro',
        coords: { lat: 20.6123457, lng: -100.4034 },
      },
    ]);
  });

  it('devuelve lista vacía con texto corto, error HTTP o excepción de red', async () => {
    const noLlamado = vi.fn();
    expect(await buscarSugerenciasDireccion('ab', { fetchImpl: noLlamado })).toEqual([]);
    expect(noLlamado).not.toHaveBeenCalled();
    expect(
      await buscarSugerenciasDireccion('centro qro', { fetchImpl: vi.fn(async () => respuesta([], false)) }),
    ).toEqual([]);
    expect(
      await buscarSugerenciasDireccion('centro qro', {
        fetchImpl: vi.fn(async () => {
          throw new Error('red');
        }),
      }),
    ).toEqual([]);
  });
});
