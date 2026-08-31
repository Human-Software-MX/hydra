import { afterEach, describe, expect, it } from 'vitest';
import { minorToPesos, pesosToMinor, supraConfig, supraRef } from './supra.config';

describe('conversión de dinero pesos ↔ unidades menores', () => {
  it('convierte pesos a centavos como string entero', () => {
    expect(pesosToMinor(150.5)).toBe('15050');
    expect(pesosToMinor(0.01)).toBe('1');
    expect(pesosToMinor('843.00')).toBe('84300');
  });

  it('redondea flotantes IEEE sin perder centavos (caso clásico 0.1+0.2)', () => {
    expect(pesosToMinor(0.1 + 0.2)).toBe('30');
    expect(pesosToMinor(1520.499999999)).toBe('152050');
  });

  it('convierte centavos a pesos y es inversa de pesosToMinor', () => {
    expect(minorToPesos('15050')).toBe(150.5);
    expect(minorToPesos(1)).toBe(0.01);
    expect(minorToPesos(null)).toBe(0);
    expect(minorToPesos(undefined)).toBe(0);
    for (const pesos of [0.01, 1, 99.99, 1234.56, 1000000]) {
      expect(minorToPesos(pesosToMinor(pesos))).toBe(pesos);
    }
  });
});

describe('external_refs canónicos (convención compartida con el conector de SUPRA)', () => {
  it('genera hydra:<entidad>:<id>', () => {
    expect(supraRef.contrato('abc')).toBe('hydra:contrato:abc');
    expect(supraRef.recibo('r1')).toBe('hydra:recibo:r1');
    expect(supraRef.pago('p1')).toBe('hydra:pago:p1');
    expect(supraRef.convenio('c1')).toBe('hydra:convenio:c1');
  });
});

describe('supraConfig', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('deshabilitado por defecto (kill-switch) y sin API key', () => {
    delete process.env.SUPRA_INTEGRACION_ENABLED;
    delete process.env.SUPRA_API_KEY;
    expect(supraConfig().enabled).toBe(false);
    process.env.SUPRA_INTEGRACION_ENABLED = 'true';
    // Sin API key sigue deshabilitado: nunca llamar a SUPRA sin credencial.
    expect(supraConfig().enabled).toBe(false);
  });

  it('habilitado solo con flag + API key; normaliza la base URL', () => {
    process.env.SUPRA_INTEGRACION_ENABLED = 'true';
    process.env.SUPRA_API_KEY = 'sk_test_x';
    process.env.SUPRA_BASE_URL = 'https://supra.example.com///';
    const cfg = supraConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.baseUrl).toBe('https://supra.example.com');
  });
});
