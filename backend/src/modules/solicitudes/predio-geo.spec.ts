import { coordenadasPredio, redondearCoord } from './predio-geo';

describe('coordenadasPredio', () => {
  it('propaga un par válido redondeado a 7 decimales', () => {
    expect(coordenadasPredio({ gpsLat: 20.58881234567, gpsLng: -100.3899 })).toEqual({
      gpsLat: 20.5888123,
      gpsLng: -100.3899,
    });
  });

  it('acepta cadenas numéricas (JSON de formulario)', () => {
    expect(coordenadasPredio({ gpsLat: '20.5888', gpsLng: '-100.3899' })).toEqual({
      gpsLat: 20.5888,
      gpsLng: -100.3899,
    });
  });

  it('descarta pares incompletos, nulos, no numéricos o fuera de rango', () => {
    expect(coordenadasPredio({})).toBeUndefined();
    expect(coordenadasPredio({ gpsLat: 20.5 })).toBeUndefined();
    expect(coordenadasPredio({ gpsLat: null, gpsLng: null })).toBeUndefined();
    expect(coordenadasPredio({ gpsLat: '', gpsLng: '' })).toBeUndefined();
    expect(coordenadasPredio({ gpsLat: 'abc', gpsLng: -100 })).toBeUndefined();
    expect(coordenadasPredio({ gpsLat: 91, gpsLng: -100 })).toBeUndefined();
    expect(coordenadasPredio({ gpsLat: 20, gpsLng: -181 })).toBeUndefined();
  });
});

describe('redondearCoord', () => {
  it('redondea a 7 decimales', () => {
    expect(redondearCoord(-100.38999999999)).toBe(-100.39);
  });
});
