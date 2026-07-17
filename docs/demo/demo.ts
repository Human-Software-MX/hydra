#!/usr/bin/env bun
/**
 * Demo conceptual Hydra/agua — parseo real + KPIs contra el modelo canónico.
 *
 * Corre dentro del contenedor (ver docker-compose.yml):
 *   1. Parsea los lotes AQUACIS reales (archivos posicionales de 1,480 chars,
 *      latin1) y el catálogo Observac.dat.
 *   2. Lee el modelo canónico `agua` como ARTEFACTO (docs/canonico/agua.yaml,
 *      generado por Callosum en design-time — el motor no corre aquí).
 *   3. Calcula agregados y KPIs en memoria.
 *   4. Renderiza el dashboard (template.html + DEMO_DATA) y lo sirve en :8090.
 *
 * Nada del dashboard está hardcodeado: cambia los archivos de entrada y
 * cambian los números. TypeScript/Bun — el mismo lenguaje del resto del repo.
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { parse as parseYaml } from "yaml";

const LECTURAS = process.env.LECTURAS_DIR ?? "/data/lecturas";
const CANONICO = process.env.CANONICO_DIR ?? "/canonico";
const OUT = process.env.OUT_DIR ?? "/srv";
const PORT = Number(process.env.PORT ?? 8090);

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// (id, inicio 1-based, longitud, tipo) — layout verificado byte a byte
// (docs/canonico/mappings/aquasis.yaml documenta el mapeo campo a campo)
const CAMPOS: [string, number, number, "s" | "i"][] = [
  ["lotplec_expid", 1, 4, "s"], ["lotplec_zonid", 5, 3, "s"],
  ["lotplec_anno", 8, 4, "i"], ["lotplec_pernum", 12, 2, "s"],
  ["lot_tipo", 14, 1, "s"], ["lot_numero", 15, 2, "s"],
  ["lec_cntt_num", 17, 9, "s"], ["cntt_activid", 146, 4, "s"],
  ["dir_finca", 159, 9, "s"], ["ncal_nombre", 190, 30, "s"],
  ["lec_pto_codr", 220, 14, "s"], ["ptos_id", 234, 9, "s"],
  ["empl_int_ext", 243, 1, "s"], ["cont_numero", 282, 12, "s"],
  ["cont_calmm", 294, 4, "s"], ["lec_anterio", 389, 9, "i"],
  ["lec_esp_inf", 398, 9, "i"], ["lec_esp_sup", 407, 9, "i"],
  ["fecha_lec", 417, 8, "s"], ["hora_lec", 425, 6, "s"],
  ["lectura", 431, 9, "i"], ["observac", 440, 2, "s"],
  ["contratista", 442, 4, "s"], ["lector", 446, 4, "s"],
  ["cntt_estado", 639, 1, "s"], ["ptos_refcat", 819, 20, "s"],
  ["barrio", 1014, 40, "s"], ["municipio", 1054, 40, "s"],
  ["uso", 1094, 1, "s"], ["marca", 1098, 5, "s"],
  ["poliza_padre", 1143, 10, "s"], ["contrato_sige_colonia", 1185, 96, "s"],
  ["foto", 1281, 200, "s"],
];

const LOT_RE = /^\d{4}[A-Z0-9]{3}[LIR]\d{2}$/;

type Registro = Record<string, string | number | null> & { read_at: Date | null };

function* parseLote(path: string): Generator<Registro> {
  const text = readFileSync(path, "latin1");
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 400) continue;
    const rec: any = {};
    for (const [fid, ini, lon, tipo] of CAMPOS) {
      const raw = line.slice(ini - 1, ini - 1 + lon).trim();
      rec[fid] = tipo === "i" ? (raw ? parseInt(raw, 10) : null) : raw;
    }
    const f = rec.fecha_lec as string;
    const h = (rec.hora_lec as string) && rec.hora_lec !== "000000" ? rec.hora_lec : "000000";
    rec.read_at = f && f !== "00000000"
      ? new Date(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8), +h.slice(0, 2), +h.slice(2, 4), +h.slice(4, 6))
      : null;
    delete rec.fecha_lec;
    yield rec as Registro;
  }
}

function walk(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((p) => join(dir, p))
    .filter((p) => statSync(p).isFile());
}

const moda = (xs: string[]) => {
  const freq = new Map<string, number>();
  for (const x of xs) freq.set(x, (freq.get(x) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";
};
const mediana = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const title = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const pad2 = (n: number) => String(n).padStart(2, "0");

// ── 1. Parseo ────────────────────────────────────────────────────────
const archivos = walk(LECTURAS);
const lotFiles = archivos.filter((p) => LOT_RE.test(basename(p))).sort();
if (!lotFiles.length) {
  console.error(`No se encontraron lotes AQUACIS bajo ${LECTURAS}`);
  process.exit(1);
}

const registros: Registro[] = [];
const lotesMeta: { id: string; locality: string; period: string; records: number; is_return: boolean }[] = [];
for (const lf of lotFiles) {
  const recs = [...parseLote(lf)];
  registros.push(...recs);
  lotesMeta.push({
    id: basename(lf),
    locality: title(moda(recs.map((r) => r.barrio as string).filter(Boolean))),
    period: `${recs[0].lotplec_anno}-${recs[0].lotplec_pernum}`,
    records: recs.length,
    is_return: recs.some((r) => r.read_at),
  });
  console.log(`  lote ${basename(lf)}: ${recs.length} registros (${lotesMeta.at(-1)!.is_return ? "vuelta" : "salida"})`);
}

const incidCat = new Map<string, string>();
const obsPath = archivos.find((p) => basename(p) === "Observac.dat");
if (obsPath) {
  for (const line of readFileSync(obsPath, "latin1").split(/\r?\n/)) {
    if (line.length > 5) incidCat.set(line.slice(0, 2).trim(), line.slice(2, 62).trim());
  }
}
console.log(`  catálogo de incidencias: ${incidCat.size} claves`);

// ── 2. Modelo canónico como artefacto ────────────────────────────────
const modelo = parseYaml(readFileSync(join(CANONICO, "agua.yaml"), "utf-8"));
const canonical = { version: modelo.version as string, entities: (modelo.entities as unknown[]).length };
console.log(`  canónico agua v${canonical.version}: ${canonical.entities} entidades (artefacto Callosum)`);

// ── 3. Agregados y KPIs ──────────────────────────────────────────────
const totalPadron = registros.length;
const dom = registros.filter((r) => r.uso === "1").length;
const nondom = registros.filter((r) => r.uso === "0").length;

const returnIds = new Set(lotesMeta.filter((l) => l.is_return).map((l) => l.id));
const ret = registros.filter((r) =>
  returnIds.has(`${r.lotplec_expid}${r.lotplec_zonid}${r.lot_tipo}${r.lot_numero}`));
const retN = ret.length;
const conInc = ret.filter((r) => r.observac).length;
const fotos = ret.filter((r) => r.foto).length;

const cons = ret
  .filter((r) => r.lectura !== null && r.lec_anterio !== null && (r.lectura as number) >= (r.lec_anterio as number))
  .map((r) => (r.lectura as number) - (r.lec_anterio as number));
const negativos = ret.filter((r) =>
  r.lectura !== null && r.lec_anterio !== null && (r.lectura as number) < (r.lec_anterio as number)).length;

const enBanda = (r: Registro) =>
  r.lectura !== null && r.lec_esp_inf !== null && r.lec_esp_sup !== null &&
  (r.lec_esp_inf as number) <= (r.lectura as number) && (r.lectura as number) <= (r.lec_esp_sup as number);
const dentro = ret.filter((r) => r.lectura !== null && r.lec_esp_inf !== null && enBanda(r)).length;
const fuera = ret.filter((r) => r.lectura !== null && r.lec_esp_inf !== null && !enBanda(r)).length;

const buckets: [number, number, string][] = [
  [0, 0, "0"], [1, 5, "1–5"], [6, 10, "6–10"], [11, 15, "11–15"],
  [16, 20, "16–20"], [21, 30, "21–30"], [31, 50, "31–50"], [51, Infinity, ">50"],
];
const hist = buckets.map(([lo, hi, label]) => ({ label, n: cons.filter((c) => c >= lo && c <= hi).length }));

const tiempos = ret.map((r) => r.read_at).filter((t): t is Date => t !== null).sort((a, b) => +a - +b);
let perHour = 0, fechaLec = "—", ventana = "—", mins = 0;
if (tiempos.length) {
  const t0 = tiempos[0], t1 = tiempos.at(-1)!;
  mins = Math.max((+t1 - +t0) / 60000, 1);
  perHour = Math.round((tiempos.length / (mins / 60)) * 10) / 10;
  fechaLec = `${t0.getDate()}-${MESES[t0.getMonth()]}-${t0.getFullYear()}`;
  ventana = `${pad2(t0.getHours())}:${pad2(t0.getMinutes())}–${pad2(t1.getHours())}:${pad2(t1.getMinutes())}`;
}

const incCounts = new Map<string, number>();
for (const r of ret) if (r.observac) incCounts.set(r.observac as string, (incCounts.get(r.observac as string) ?? 0) + 1);
const incItems = [...incCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([code, n]) => {
    const d = incidCat.get(code) ?? code;
    return { code, name: d.charAt(0).toUpperCase() + d.slice(1).toLowerCase(), n };
  });

const nMeters = new Set(registros.map((r) => r.cont_numero).filter(Boolean)).size;
const nRefcat = registros.filter((r) => r.ptos_refcat).length;
const nLoc = registros.filter((r) => r.barrio).length;
const nColonia = registros.filter((r) => {
  const c = r.contrato_sige_colonia as string;
  return c && (/^\d{6,}\s{2,}\S/.test(c) || !/^\d/.test(c));
}).length;

const flag = (p: number) => (p >= 90 ? "good" : p >= 10 ? "serious" : "critical");
const confidence = [
  { name: "Foto y timestamp de lectura", pct: pct(fotos, retN), detail: `lote de vuelta (${fotos}/${retN})` },
  { name: "Medidor registrado", pct: pct(nMeters, totalPadron), detail: `${nMeters} series únicas de ${totalPadron}` },
  { name: "Localidad identificada", pct: pct(nLoc, totalPadron), detail: `${nLoc} de ${totalPadron}` },
  { name: "Clave catastral (vínculo GIS)", pct: pct(nRefcat, totalPadron), detail: `${nRefcat} de ${totalPadron}` },
  { name: "Colonia identificable", pct: pct(nColonia, totalPadron), detail: "viaja incrustada en el campo LIBRE" },
].map((c) => ({ ...c, flag: flag(c.pct) }));

const hoy = new Date();
const data = {
  generated_at: `${hoy.getDate()}-${MESES[hoy.getMonth()]}-${hoy.getFullYear()}`,
  canonical,
  lots: lotesMeta,
  padron: { total: totalPadron, dom, nondom, pct_dom: pct(dom, totalPadron) },
  readings: {
    return_total: retN, clean: retN - conInc, pct_clean: pct(retN - conInc, retN),
    read_date: fechaLec, window: ventana, minutes: Math.round(mins), per_hour: perHour,
    return_lots: lotesMeta.filter((l) => l.is_return).map((l) => l.id),
  },
  consumo: {
    n: cons.length, median: mediana(cons),
    mean: cons.length ? Math.round((cons.reduce((s, c) => s + c, 0) / cons.length) * 10) / 10 : 0,
    zeros: cons.filter((c) => c === 0).length, negatives: negativos, hist,
  },
  band: { inside: dentro, outside: fuera, pct_out: pct(fuera, dentro + fuera) },
  incidences: { total: conInc, pct: pct(conInc, retN), items: incItems },
  confidence,
};

// ── 4. Render + servidor ─────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const template = readFileSync(join(import.meta.dir, "template.html"), "utf-8");
writeFileSync(join(OUT, "index.html"), template.replace("__DEMO_DATA__", JSON.stringify(data)));
writeFileSync(join(OUT, "data.json"), JSON.stringify(data, null, 1));
console.log(`✓ dashboard generado en ${join(OUT, "index.html")} (${totalPadron} registros fuente)`);

Bun.serve({
  port: PORT,
  fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(join(OUT, path === "/" ? "index.html" : path.slice(1)));
    return file.size ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log(`Sirviendo en http://0.0.0.0:${PORT}/ ...`);
