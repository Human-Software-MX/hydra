import { Logger } from '@nestjs/common';
import { safeEvalArithmetic } from './billing-engine.service';

describe('safeEvalArithmetic (B3)', () => {
  beforeAll(() => {
    // Silenciar el log de error esperado en los casos de fallo.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('expresiones válidas', () => {
    it('evalúa una tarifa proporcional ya sustituida', () => {
      // p.ej. "cantidad*15+50" con cantidad=8 → "8*15+50"
      expect(safeEvalArithmetic('8*15+50')).toBe(170);
    });

    it('evalúa una tarifa escalonada (bloques) con paréntesis', () => {
      // 3 bloques: 50 + 60 + 60 = 170
      expect(safeEvalArithmetic('(10*5)+(20*3)+(30*2)')).toBe(170);
    });

    it('redondea a 2 decimales (roundMoney)', () => {
      expect(safeEvalArithmetic('10/3')).toBe(3.33);
    });

    it('permite espacios en la expresión', () => {
      expect(safeEvalArithmetic('  100 + 25  ')).toBe(125);
    });
  });

  describe('expresiones malformadas → lanzan (no facturan 0)', () => {
    it('lanza ante una expresión sintácticamente inválida', () => {
      expect(() => safeEvalArithmetic('5*(')).toThrow();
    });

    it('incluye la expresión ofensiva en el mensaje de error', () => {
      expect(() => safeEvalArithmetic('5*(')).toThrow('5*(');
    });

    it('lanza cuando la expresión queda vacía tras sanitizar', () => {
      expect(() => safeEvalArithmetic('   ')).toThrow();
    });
  });

  describe('intentos de inyección → rechazados por el sanitizador', () => {
    it('rechaza acceso a objetos/propiedades JS', () => {
      expect(() => safeEvalArithmetic('process.exit')).toThrow();
    });

    it('rechaza una expresión con letras/palabras (SQL-like)', () => {
      expect(() => safeEvalArithmetic('DROP TABLE contratos')).toThrow();
    });

    it('no ejecuta código arbitrario: las letras se eliminan antes de evaluar', () => {
      // "globalThis" se sanitiza a vacío; sólo quedaría un fragmento inválido.
      expect(() => safeEvalArithmetic('globalThis')).toThrow();
    });
  });
});
