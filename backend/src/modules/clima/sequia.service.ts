import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CATEGORIAS_SEQUIA, rangoSequia } from './clima-riesgos';

/**
 * Monitor de Sequía de México (MSM) — CONAGUA/SMN, corte quincenal por
 * municipio con categorías D0-D4 (esquema del US/North American Drought
 * Monitor). Fuente oficial y gratuita:
 * https://smn.conagua.gob.mx/es/climatologia/monitor-de-sequia/monitor-de-sequia-en-mexico
 *
 * CONAGUA publica el detalle municipal como Excel (formato ancho, una columna
 * por corte). Este servicio ingiere el corte vigente en dos formas:
 *  1. POST /clima/sequia/ingesta con registros JSON o CSV simple
 *     (cve_inegi,municipio,estado,categoria) — el analista convierte el xlsx.
 *  2. Fetch remoto de un CSV en ese mismo formato si se configura
 *     CLIMA_SEQUIA_URL (p. ej. un CSV publicado por el propio organismo).
 *
 * El dato alimenta el cruce con las alertas de estiaje del pronóstico
 * (clima-riesgos.escalarPorSequia) y el resumen GET /clima/sequia.
 */

const ESTADO_DEFAULT = process.env.CLIMA_SEQUIA_ESTADO ?? process.env.CLIMA_SMN_ESTADO ?? 'Querétaro';

export interface RegistroSequiaEntrada {
  cveInegi: string;
  municipio: string;
  estado: string;
  /** D0..D4 o null/'' = sin sequía. */
  categoria?: string | null;
}

@Injectable()
export class SequiaService {
  private readonly logger = new Logger(SequiaService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizarCategoria(v: string | null | undefined): string | null {
    const cat = (v ?? '').trim().toUpperCase();
    if (cat === '' || cat === 'SIN SEQUIA' || cat === 'SIN SEQUÍA' || cat === 'NULL') return null;
    if (!CATEGORIAS_SEQUIA.includes(cat as never)) {
      throw new BadRequestException(`Categoría de sequía inválida: "${v}" (use D0..D4 o vacío)`);
    }
    return cat;
  }

  /** CSV simple con encabezado: cve_inegi,municipio,estado,categoria */
  parseCsv(csv: string): RegistroSequiaEntrada[] {
    const lineas = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lineas.length < 2) throw new BadRequestException('CSV vacío o sin registros');

    const header = lineas[0].toLowerCase().split(',').map((h) => h.trim());
    const idx = (nombre: string) => {
      const i = header.indexOf(nombre);
      if (i < 0) throw new BadRequestException(`CSV sin columna "${nombre}" (encabezado esperado: cve_inegi,municipio,estado,categoria)`);
      return i;
    };
    const iCve = idx('cve_inegi');
    const iMun = idx('municipio');
    const iEdo = idx('estado');
    const iCat = idx('categoria');

    return lineas.slice(1).map((l) => {
      const cols = l.split(',').map((c) => c.trim());
      return {
        cveInegi: cols[iCve],
        municipio: cols[iMun],
        estado: cols[iEdo],
        categoria: cols[iCat] ?? null,
      };
    });
  }

  /** Ingesta idempotente de un corte quincenal (upsert por fechaCorte+cve). */
  async ingestar(params: {
    fechaCorte: string;
    registros?: RegistroSequiaEntrada[];
    csv?: string;
  }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fechaCorte)) {
      throw new BadRequestException('fechaCorte debe tener formato YYYY-MM-DD');
    }
    const registros = params.registros ?? (params.csv ? this.parseCsv(params.csv) : []);
    if (registros.length === 0) {
      throw new BadRequestException('Proporcione `registros` (JSON) o `csv`');
    }

    let procesados = 0;
    for (const r of registros) {
      if (!r.cveInegi || !r.municipio || !r.estado) {
        throw new BadRequestException(`Registro incompleto: ${JSON.stringify(r)}`);
      }
      const categoria = this.normalizarCategoria(r.categoria);
      await this.prisma.registroSequia.upsert({
        where: { fechaCorte_cveInegi: { fechaCorte: params.fechaCorte, cveInegi: r.cveInegi } },
        create: {
          fechaCorte: params.fechaCorte,
          cveInegi: r.cveInegi,
          municipio: r.municipio,
          estado: r.estado,
          categoria,
        },
        update: { municipio: r.municipio, estado: r.estado, categoria },
      });
      procesados++;
    }
    this.logger.log(`Monitor de Sequía: corte ${params.fechaCorte}, ${procesados} municipios ingresados`);
    return { fechaCorte: params.fechaCorte, procesados };
  }

  /** Ingesta desde CSV remoto (CLIMA_SEQUIA_URL) — para automatizar el corte. */
  async ingestarRemoto(fechaCorte: string) {
    const url = process.env.CLIMA_SEQUIA_URL;
    if (!url) {
      throw new BadRequestException('CLIMA_SEQUIA_URL no configurada; use la ingesta manual (CSV/JSON)');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new BadRequestException(`Fuente de sequía HTTP ${res.status}`);
      const csv = await res.text();
      return await this.ingestar({ fechaCorte, csv });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resumen del corte más reciente para un estado: distribución por categoría,
   * categoría máxima (insumo del escalamiento de estiaje) y municipios D2+.
   */
  async resumenActual(estado?: string) {
    const edo = estado ?? ESTADO_DEFAULT;
    const ultimo = await this.prisma.registroSequia.findFirst({
      where: { estado: { equals: edo, mode: 'insensitive' } },
      orderBy: { fechaCorte: 'desc' },
      select: { fechaCorte: true },
    });
    if (!ultimo) {
      return {
        estado: edo,
        fechaCorte: null,
        categoriaMaxima: null,
        municipios: 0,
        municipiosAfectados: 0,
        distribucion: {},
        municipiosSeveros: [],
        mensaje: 'Sin datos del Monitor de Sequía cargados. Ingrese el corte en POST /clima/sequia/ingesta',
      };
    }

    const registros = await this.prisma.registroSequia.findMany({
      where: { estado: { equals: edo, mode: 'insensitive' }, fechaCorte: ultimo.fechaCorte },
      select: { municipio: true, categoria: true, cveInegi: true },
      orderBy: { municipio: 'asc' },
    });

    const distribucion: Record<string, number> = {};
    let categoriaMaxima: string | null = null;
    for (const r of registros) {
      const key = r.categoria ?? 'sin_sequia';
      distribucion[key] = (distribucion[key] ?? 0) + 1;
      if (rangoSequia(r.categoria) > rangoSequia(categoriaMaxima)) categoriaMaxima = r.categoria;
    }

    return {
      estado: edo,
      fechaCorte: ultimo.fechaCorte,
      categoriaMaxima,
      municipios: registros.length,
      municipiosAfectados: registros.filter((r) => r.categoria !== null).length,
      distribucion,
      municipiosSeveros: registros
        .filter((r) => rangoSequia(r.categoria) >= rangoSequia('D2'))
        .map((r) => ({ municipio: r.municipio, cveInegi: r.cveInegi, categoria: r.categoria })),
    };
  }
}
