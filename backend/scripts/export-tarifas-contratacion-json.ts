/**
 * Genera prisma/data/tarifas-contratacion.json desde docs/Tarifas_contratacion.xlsx (solo en máquina con el .xlsx).
 * Uso:
 *   cd backend
 *   npm run export:tarifas-contratacion-json -- "C:/ruta/Tarifas_contratacion.xlsx"
 * Sin argumento: usa ../docs/Tarifas_contratacion.xlsx. Luego commitea el JSON: el seed (seedTarifasContratacion)
 * lo carga de forma idempotente y NUNCA reescribe versiones ya existentes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildTarifasContratacionPayloadFromXlsx } from '../prisma/tarifas-contratacion-import';

const outPath = path.join(__dirname, '../prisma/data/tarifas-contratacion.json');
const inputPath = process.argv[2] ?? path.resolve(__dirname, '..', '..', 'docs', 'Tarifas_contratacion.xlsx');

if (!fs.existsSync(inputPath)) {
  console.error(`No se encontró el Excel: ${inputPath}`);
  process.exit(1);
}

const payload = buildTarifasContratacionPayloadFromXlsx(inputPath);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 1)}
`, 'utf8');
console.log(`Escrito: ${outPath}`);
console.log(`Resumen: ${payload.tarifas.length} tarifas, vigencia ${payload.vigenciaDesde}`);
const porConcepto = payload.tarifas.reduce<Record<string, number>>((acc, t) => ((acc[t.tipoServicio] = (acc[t.tipoServicio] ?? 0) + 1), acc), {});
console.log('Por concepto:', porConcepto);
console.log('Con clase:', payload.tarifas.filter((t) => t.claseCodigo).length, '· con variante:', payload.tarifas.filter((t) => t.variante).length, '· no objeto:', payload.tarifas.filter((t) => t.ivaNoObjeto).length);
if (payload.advertencias.length) {
  console.warn(`Advertencias (${payload.advertencias.length}):`);
  for (const a of payload.advertencias) console.warn(`  - ${a}`);
}
