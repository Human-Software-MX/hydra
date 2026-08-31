import { gunzipSync } from 'zlib';
import { DiaPronostico } from '../clima-riesgos';

/**
 * Proveedor SMN — Servicio Meteorológico Nacional de CONAGUA
 * (https://smn.conagua.gob.mx/es/web-service-api), gratuito y oficial.
 *
 * El web service público entrega el pronóstico por municipio a 4 días
 * (method=1) como JSON comprimido en gzip. Es la fuente oficial mexicana,
 * pero su disponibilidad es intermitente y el payload es nacional (~MB):
 * por eso Hydra lo trata como proveedor alternativo con caída controlada a
 * Open-Meteo (clima.service.ts decide).
 *
 * Config:
 *   CLIMA_SMN_URL    (default web service oficial method=1)
 *   CLIMA_SMN_ESTADO (default "Querétaro" — filtra el payload nacional)
 */

const SMN_URL =
  process.env.CLIMA_SMN_URL ??
  'https://smn.conagua.gob.mx/webservices/?method=1';
const SMN_ESTADO = process.env.CLIMA_SMN_ESTADO ?? 'Querétaro';

/** Registro del web service SMN method=1 (pronóstico diario por municipio). */
interface RegistroSmn {
  ides: string; // id estado
  idmun: string; // id municipio
  nes: string; // nombre estado
  nmun: string; // nombre municipio
  dloc: string; // fecha local YYYYMMDD(HH)
  tmax: string;
  tmin: string;
  prec: string; // lluvia (mm)
  velvien: string; // viento km/h
}

export async function pronosticoSmn(municipio?: string): Promise<DiaPronostico[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(SMN_URL, {
      signal: controller.signal,
      headers: { 'Accept-Encoding': 'gzip' },
    });
    if (!res.ok) throw new Error(`SMN HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    // El SMN entrega gzip; según el proxy puede llegar ya descomprimido.
    let texto: string;
    try {
      texto = gunzipSync(buffer).toString('utf8');
    } catch {
      texto = buffer.toString('utf8');
    }
    const registros = JSON.parse(texto) as RegistroSmn[];
    if (!Array.isArray(registros) || registros.length === 0) {
      throw new Error('SMN sin registros');
    }

    const filtroMunicipio = municipio?.toLowerCase();
    const relevantes = registros.filter(
      (r) =>
        r.nes?.toLowerCase() === SMN_ESTADO.toLowerCase() &&
        (!filtroMunicipio || r.nmun?.toLowerCase() === filtroMunicipio),
    );
    if (relevantes.length === 0) {
      throw new Error(`SMN sin datos para ${SMN_ESTADO}${municipio ? `/${municipio}` : ''}`);
    }

    // Agrega por fecha (promedio simple entre municipios cuando no se filtró).
    const porFecha = new Map<string, { tmax: number[]; tmin: number[]; prec: number[]; viento: number[] }>();
    for (const r of relevantes) {
      const fecha = `${r.dloc.slice(0, 4)}-${r.dloc.slice(4, 6)}-${r.dloc.slice(6, 8)}`;
      const agg = porFecha.get(fecha) ?? { tmax: [], tmin: [], prec: [], viento: [] };
      const push = (arr: number[], v: string) => {
        const n = Number(v);
        if (Number.isFinite(n)) arr.push(n);
      };
      push(agg.tmax, r.tmax);
      push(agg.tmin, r.tmin);
      push(agg.prec, r.prec);
      push(agg.viento, r.velvien);
      porFecha.set(fecha, agg);
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : null;
    return [...porFecha.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, agg]) => ({
        fecha,
        tmaxC: avg(agg.tmax),
        tminC: avg(agg.tmin),
        precipitacionMm: avg(agg.prec),
        rachaVientoKmh: avg(agg.viento),
      }));
  } finally {
    clearTimeout(timer);
  }
}
