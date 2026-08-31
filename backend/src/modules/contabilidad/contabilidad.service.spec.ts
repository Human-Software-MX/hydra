import { ContabilidadService } from './contabilidad.service';

/**
 * C2 — generador de folio de póliza (`generarNumeroPoliza`).
 *
 * Es privado; lo ejercitamos por su contrato observable con un `prisma`
 * mockeado. Cubre: seed inicial, incremento max+1, y — de forma explícita —
 * la CARRERA de concurrencia (dos llamadas simultáneas leen el mismo max y
 * emiten el mismo folio). Ese último test DOCUMENTA el comportamiento actual;
 * el arreglo (secuencia en BD / unique) queda registrado en tasks/bugs.md.
 */
function makeService(findFirst: jest.Mock) {
  const prisma = { poliza: { findFirst } };
  const svc = new ContabilidadService(prisma as never);
  // Acceso al método privado sin exponerlo en la API pública.
  const gen = (): Promise<string> =>
    (svc as unknown as { generarNumeroPoliza(): Promise<string> }).generarNumeroPoliza();
  return { svc, gen, findFirst };
}

describe('ContabilidadService.generarNumeroPoliza (C2 folio)', () => {
  it('arranca en 1584000 cuando no hay pólizas previas', async () => {
    const { gen } = makeService(jest.fn().mockResolvedValue(null));
    await expect(gen()).resolves.toBe('1584000');
  });

  it('devuelve max + 1 y siempre como string', async () => {
    const { gen } = makeService(jest.fn().mockResolvedValue({ numero: '1584005' }));
    const folio = await gen();
    expect(folio).toBe('1584006');
    expect(typeof folio).toBe('string');
  });

  it('consulta el número más alto (orderBy numero desc)', async () => {
    const { gen, findFirst } = makeService(jest.fn().mockResolvedValue({ numero: '1590000' }));
    await gen();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { numero: 'desc' } }),
    );
  });

  it('DOCUMENTA la carrera: dos folios concurrentes colisionan con el mismo max', async () => {
    // Ambas lecturas ven el mismo "último" antes de que la otra escriba.
    const { gen } = makeService(jest.fn().mockResolvedValue({ numero: '1584010' }));
    const [a, b] = await Promise.all([gen(), gen()]);
    // Comportamiento actual (defecto conocido): folio duplicado.
    expect(a).toBe('1584011');
    expect(b).toBe('1584011');
    expect(a).toBe(b);
  });
});
