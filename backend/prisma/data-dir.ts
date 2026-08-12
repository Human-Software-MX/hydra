import * as fs from 'fs';
import * as path from 'path';

/**
 * Resuelve un archivo de `prisma/data/`.
 *
 * tsc no copia los `.json` a dist/, así que el seed compilado
 * (`dist/prisma/*.js`) no puede resolverlos contra su propio `__dirname`:
 * se cae al `prisma/data/` del proyecto, que la imagen de producción sí copia.
 */
export function resolveDataFile(fileName: string): string {
  const candidates = [
    path.join(__dirname, 'data', fileName),
    path.resolve(__dirname, '..', '..', 'prisma', 'data', fileName),
  ];
  return candidates.find((f) => fs.existsSync(f)) ?? candidates[0];
}
