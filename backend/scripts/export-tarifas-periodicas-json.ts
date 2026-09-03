/**
 * Genera prisma/data/tarifas-periodicas.json desde docs/Tarifas_periodicas.xlsx (solo en máquina con el .xlsx).
 * Uso:
 *   cd backend
 *   npm run export:tarifas-periodicas-json -- "C:/ruta/Tarifas_periodicas.xlsx"
 * Sin argumento: usa ../docs/Tarifas_periodicas.xlsx.
 *
 * Luego commitea prisma/data/tarifas-periodicas.json: el seed (seedTarifasPeriodicas) lo carga de forma
 * idempotente y NUNCA reescribe versiones ya existentes (el histórico vive en la BD, no en el JSON).
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildTarifasPeriodicasPayloadFromXlsx } from '../prisma/tarifas-periodicas-import';

const outPath = path.join(__dirname, '../prisma/data/tarifas-periodicas.json');
const inputPath = process.argv[2] ?? path.resolve(__dirname, '..', '..', 'docs', 'Tarifas_periodicas.xlsx');

if (!fs.existsSync(inputPath)) {
  console.error(`No se encontró el Excel: ${inputPath}`);
  console.error('Pasa la ruta como primer argumento o coloca el archivo en docs/Tarifas_periodicas.xlsx.');
  process.exit(1);
}

const payload = buildTarifasPeriodicasPayloadFromXlsx(inputPath);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
console.log(`Escrito: ${outPath}`);
console.log(`Resumen: ${payload.tarifas.length} tarifas, ${payload.correcciones.length} correcciones, vigencia ${payload.vigenciaDesde}`);
const porServicio = payload.tarifas.reduce<Record<string, number>>((acc, t) => ((acc[t.tipoServicio] = (acc[t.tipoServicio] ?? 0) + 1), acc), {});
console.log('Por servicio:', porServicio);
if (payload.advertencias.length) {
  console.warn(`Advertencias (${payload.advertencias.length}):`);
  for (const a of payload.advertencias) console.warn(`  - ${a}`);
}
