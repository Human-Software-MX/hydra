import { describe, expect, it } from 'vitest';
import { parsearTextoIdentificacion, patchPropietarioDesdeIdentificacion } from './ocr-documentos';

const INE = `INSTITUTO NACIONAL ELECTORAL
CREDENCIAL PARA VOTAR
NOMBRE
GARCIA
RAMIREZ
MARIA ELENA
DOMICILIO
C FLOR DE MARIA 32
FECHA DE NACIMIENTO 12/03/1985
CURP GARM850312MQTRMR08
CLAVE DE ELECTOR GRRMMR85031222M100
`;

describe('parsearTextoIdentificacion', () => {
  it('extrae CURP y bloque de nombre INE (3 lineas)', () => {
    const d = parsearTextoIdentificacion(INE)!;
    expect(d.curp).toBe('GARM850312MQTRMR08');
    expect(d.paterno).toBe('GARCIA');
    expect(d.materno).toBe('RAMIREZ');
    expect(d.nombres).toBe('MARIA ELENA');
    expect(d.rfc).toBeUndefined(); // la CURP no debe contar como RFC
  });
  it('extrae RFC solo si aparece por separado', () => {
    const d = parsearTextoIdentificacion('RFC GARM850312AB3\nCURP GARM850312MQTRMR08')!;
    expect(d.rfc).toBe('GARM850312AB3');
    expect(d.curp).toBe('GARM850312MQTRMR08');
  });
  it('nombre en la misma linea -> nombreCompleto crudo', () => {
    const d = parsearTextoIdentificacion('NOMBRE GARCIA RAMIREZ MARIA\nDOMICILIO X')!;
    expect(d.nombreCompleto).toBe('GARCIA RAMIREZ MARIA');
    expect(d.paterno).toBeUndefined();
  });
  it('texto sin datos -> null', () => {
    expect(parsearTextoIdentificacion('hola mundo 123')).toBeNull();
  });
});

describe('patchPropietarioDesdeIdentificacion', () => {
  const base = { propTipoPersona: 'fisica' as const, propPaterno: '', propMaterno: '', propNombre: '', propRfc: '' };
  it('llena solo campos vacios', () => {
    const r = patchPropietarioDesdeIdentificacion(base, { rfc: 'GARM850312AB3', paterno: 'GARCIA', materno: 'RAMIREZ', nombres: 'MARIA' })!;
    expect(r.patch).toEqual({ propRfc: 'GARM850312AB3', propPaterno: 'GARCIA', propMaterno: 'RAMIREZ', propNombre: 'MARIA' });
  });
  it('no pisa lo capturado', () => {
    const r = patchPropietarioDesdeIdentificacion({ ...base, propNombre: 'JUAN', propRfc: 'XXX' }, { rfc: 'GARM850312AB3', paterno: 'GARCIA', nombres: 'MARIA' });
    expect(r).toBeNull();
  });
  it('solo nombreCompleto -> no llena nombre', () => {
    const r = patchPropietarioDesdeIdentificacion(base, { nombreCompleto: 'GARCIA RAMIREZ MARIA' });
    expect(r).toBeNull();
  });
});
