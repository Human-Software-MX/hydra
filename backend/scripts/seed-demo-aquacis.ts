/**
 * Seed de datos demo desde los lotes AQUACIS reales del repo.
 *
 * Carga los dos lotes de lectura (salida 0001M08L20 y vuelta 0007AM1L44) y el
 * catálogo Observac.dat a través del esquema REAL de Hydra: contratos,
 * medidores, rutas, lotes de lectura, lecturas, consumos e incidencias — para
 * que la app completa (frontend + API) corra "como el proyecto real, solo que
 * con datos demo". Materializa el mapeo docs/canonico/mappings/aquasis.yaml
 * en el lado Hydra.
 *
 * - Idempotente: ids determinísticos (aq-*) + createMany skipDuplicates.
 * - Sin PII: los nombres de abonado se anonimizan (Usuario Demo NNN);
 *   el resto (consumos, incidencias, rutas, localidades) es real.
 *
 * Uso: npm run seed:demo-aquacis   (LECTURAS_DIR apunta a la carpeta
 * "Interfase con Sistema de Lecturas"; en docker compose va montada en
 * /data/lecturas). Requiere el seed base corrido (zonas EXP-01/Z001).
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const prisma = new PrismaClient();

const LECTURAS_DIR =
  process.env.LECTURAS_DIR ??
  join(
    __dirname,
    '../../Requerimientos/Documentos/Interfaces-20260224T185812Z-1-001/Interfaces/Interfase con Sistema de Lecturas',
  );

// (id, inicio 1-based, longitud, tipo) — layout AQUACIS verificado byte a byte
const CAMPOS: [string, number, number, 's' | 'i'][] = [
  ['lotplec_expid', 1, 4, 's'], ['lotplec_zonid', 5, 3, 's'],
  ['lotplec_anno', 8, 4, 'i'], ['lotplec_pernum', 12, 2, 's'],
  ['lot_tipo', 14, 1, 's'], ['lot_numero', 15, 2, 's'],
  ['lec_cntt_num', 17, 9, 's'], ['dir_finca', 159, 9, 's'],
  ['ncal_nombre', 190, 30, 's'], ['lec_pto_codr', 220, 14, 's'],
  ['cont_numero', 282, 12, 's'], ['lec_anterio', 389, 9, 'i'],
  ['lec_esp_inf', 398, 9, 'i'], ['lec_esp_sup', 407, 9, 'i'],
  ['fecha_lec', 417, 8, 's'], ['hora_lec', 425, 6, 's'],
  ['lectura', 431, 9, 'i'], ['observac', 440, 2, 's'],
  ['cortado', 416, 1, 's'], ['barrio', 1014, 40, 's'],
  ['uso', 1094, 1, 's'], ['foto', 1281, 200, 's'],
];

const LOT_RE = /^\d{4}[A-Z0-9]{3}[LIR]\d{2}$/;
const TIPO_LOTE: Record<string, string> = { L: 'Lectura', I: 'Inspección', R: 'Repaso' };

type Registro = Record<string, any>;

function parseLote(path: string): Registro[] {
  const out: Registro[] = [];
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    if (line.length < 400) continue;
    const rec: Registro = {};
    for (const [fid, ini, lon, tipo] of CAMPOS) {
      const raw = line.slice(ini - 1, ini - 1 + lon).trim();
      rec[fid] = tipo === 'i' ? (raw ? parseInt(raw, 10) : null) : raw;
    }
    rec.esVuelta = rec.fecha_lec && rec.fecha_lec !== '00000000';
    out.push(rec);
  }
  return out;
}

const title = (s: string) =>
  s.toLowerCase().replace(/(^|\s)\S/g, (c: string) => c.toUpperCase());

async function main() {
  const archivos = (readdirSync(LECTURAS_DIR, { recursive: true }) as string[])
    .map((p) => join(LECTURAS_DIR, p))
    .filter((p) => statSync(p).isFile());
  const lotFiles = archivos.filter((p) => LOT_RE.test(basename(p))).sort();
  if (!lotFiles.length) throw new Error(`No hay lotes AQUACIS bajo ${LECTURAS_DIR}`);

  // Prerrequisito territorial del seed base (por si corre solo)
  await prisma.administracion.upsert({
    where: { id: 'EXP-01' },
    update: {},
    create: { id: 'EXP-01', nombre: 'Administración Querétaro' },
  });
  await prisma.zona.upsert({
    where: { id: 'Z001' },
    update: {},
    create: { id: 'Z001', administracionId: 'EXP-01', nombre: 'Norte' },
  });

  // Catálogo de incidencias desde Observac.dat (avería → dispara estimación)
  const obsPath = archivos.find((p) => basename(p) === 'Observac.dat');
  const incidenciaIdPorCodigo = new Map<string, string>();
  if (obsPath) {
    for (const line of readFileSync(obsPath, 'latin1').split(/\r?\n/)) {
      if (line.length <= 5) continue;
      const codigo = line.slice(0, 2).trim();
      const descripcion = line.slice(2, 62).trim();
      const esAveria = /FUGA|PARADO|DESTRUIDO|AVERIA/i.test(descripcion);
      const inc = await prisma.catalogoIncidencia.upsert({
        where: { codigo },
        update: { descripcion, esAveria },
        create: { codigo, descripcion, esAveria },
      });
      incidenciaIdPorCodigo.set(codigo, inc.id);
    }
    console.log(`  incidencias: ${incidenciaIdPorCodigo.size} claves (Observac.dat)`);
  }

  let totContratos = 0, totLecturas = 0, totConsumos = 0, totMedidores = 0;
  let demoIdx = 0;

  for (const lf of lotFiles) {
    const nombre = basename(lf);
    const recs = parseLote(lf);
    const periodo = `${recs[0].lotplec_anno}-${recs[0].lotplec_pernum}`;
    const esVuelta = recs.some((r) => r.esVuelta);
    const localidad = title(recs.find((r) => r.barrio)?.barrio ?? 'Querétaro');

    const rutaId = `aq-ruta-${recs[0].lotplec_expid}${recs[0].lotplec_zonid}`;
    await prisma.ruta.upsert({
      where: { id: rutaId },
      update: {},
      create: {
        id: rutaId,
        zonaId: 'Z001',
        sector: localidad,
        libreta: nombre,
        lecturista: 'Cuadrilla AQUACIS',
      },
    });

    // Contratos (anonimizados) — mapeo registro_lectura → service_agreement → Contrato
    const contratos = recs.map((r) => ({
      id: `aq-${r.lec_cntt_num}`,
      numeroContrato: parseInt(r.lec_cntt_num, 10),
      tipoContrato: 'Agua',
      tipoServicio: r.uso === '0' ? 'Comercial' : 'Doméstico',
      nombre: `Usuario Demo ${String(++demoIdx).padStart(3, '0')}`,
      rfc: 'XAXX010101000',
      direccion: `${title(r.ncal_nombre)} ${r.dir_finca.replace(/^0+/, '') || 'S/N'}, ${localidad}`,
      contacto: 'demo@ctcf.local',
      estado: r.cortado === 'S' ? 'Suspendido' : 'Activo',
      fecha: `${periodo}-01`,
      ceaNumContrato: r.lec_cntt_num,
      zonaId: 'Z001',
      rutaId,
    }));
    const resC = await prisma.contrato.createMany({ data: contratos, skipDuplicates: true });
    totContratos += resC.count;

    // Medidores (1:1 con contrato)
    const medidores = recs
      .filter((r) => r.cont_numero)
      .map((r) => ({
        id: `aqm-${r.lec_cntt_num}`,
        contratoId: `aq-${r.lec_cntt_num}`,
        serie: r.cont_numero,
        estado: 'Instalado',
        lecturaInicial: r.lec_anterio ?? 0,
      }));
    const resM = await prisma.medidor.createMany({ data: medidores, skipDuplicates: true });
    totMedidores += resM.count;

    // Lote de lecturas
    const lote = await prisma.loteLecturas.upsert({
      where: { id: `aql-${nombre}` },
      update: {},
      create: {
        id: `aql-${nombre}`,
        zonaId: 'Z001',
        rutaId,
        periodo,
        tipoLote: TIPO_LOTE[recs[0].lot_tipo] ?? 'Lectura',
        archivoNombre: nombre,
        estado: esVuelta ? 'Cargado' : 'Emitido',
        totalRegistros: recs.length,
        totalValidos: esVuelta ? recs.length : 0,
        cargadoPor: 'seed-demo-aquacis',
      },
    });

    // Lecturas: la vuelta trae captura real; la salida queda Pendiente
    const lecturas = recs.map((r) => ({
      id: `aqr-${nombre}-${r.lec_cntt_num}`,
      loteId: lote.id,
      contratoId: `aq-${r.lec_cntt_num}`,
      periodo,
      lecturaActual: r.esVuelta ? r.lectura : null,
      lecturaAnterior: r.lec_anterio,
      consumoReal:
        r.esVuelta && r.lectura !== null && r.lec_anterio !== null && r.lectura >= r.lec_anterio
          ? r.lectura - r.lec_anterio
          : null,
      esEstimada: false,
      lecturaMinZona: r.lec_esp_inf,
      lecturaMaxZona: r.lec_esp_sup,
      urlFoto: r.esVuelta && r.foto ? r.foto : null,
      estado: r.esVuelta ? 'Válida' : 'Pendiente',
      incidenciaId: r.esVuelta && r.observac ? incidenciaIdPorCodigo.get(r.observac) ?? null : null,
    }));
    const resL = await prisma.lectura.createMany({ data: lecturas, skipDuplicates: true });
    totLecturas += resL.count;

    // Consumos confirmados del periodo (solo vuelta, sin negativos)
    const consumos = recs
      .filter((r) => r.esVuelta && r.lectura !== null && r.lec_anterio !== null && r.lectura >= r.lec_anterio)
      .map((r) => ({
        id: `aqc-${r.lec_cntt_num}-${periodo}`,
        contratoId: `aq-${r.lec_cntt_num}`,
        periodo,
        m3: r.lectura - r.lec_anterio,
        tipo: 'Real',
        confirmado: true,
      }));
    const resCo = await prisma.consumo.createMany({ data: consumos, skipDuplicates: true });
    totConsumos += resCo.count;

    console.log(`  lote ${nombre}: ${recs.length} registros (${esVuelta ? 'vuelta' : 'salida'}) → ${localidad}`);
  }

  console.log(
    `Seed demo AQUACIS completado: ${totContratos} contratos, ${totMedidores} medidores, ` +
    `${totLecturas} lecturas, ${totConsumos} consumos, ${lotFiles.length} lotes.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
