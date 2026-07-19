import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import {
  AlertaOficial,
  SeveridadAlerta,
  capAAlertas,
  evaluarCiclones,
  evaluarCrecidaRio,
  ordenarPorSeveridad,
  parsearCap,
} from './alertas-oficiales';
import { ciclonesActivosNhc } from './providers/nhc.provider';
import { caudalRioGlofas } from './providers/flood.provider';
import { descargarDocumentosCap, urlsCapConfiguradas } from './providers/cap.provider';

/**
 * AlertasClimaService — agregador de alertamiento oficial multi-fuente.
 *
 * Fuentes gratuitas y sin API key (cada una se puede apagar por env):
 *  - NHC/NOAA ciclones tropicales  (CLIMA_CICLONES=off para desactivar)
 *  - GloFAS crecidas de río        (CLIMA_FLOOD=off; punto CLIMA_FLOOD_LAT/LNG)
 *  - Avisos CAP 1.2                (CLIMA_CAP_URLS=url1,url2)
 *
 * Tolerante a fallas: si una fuente no responde, las demás siguen; el estado
 * por fuente viaja en la respuesta para diagnóstico. Cache de 30 min.
 *
 * Difusión: las alertas con severidad ≥ CLIMA_ALERTAS_SEVERIDAD_MIN (default
 * alta) se envían UNA sola vez (dedup por claveDedup en alertas_climaticas_
 * emitidas) al personal operativo de CLIMA_ALERTAS_EMAILS / _WHATSAPP, vía el
 * cron JOB_ALERTAS_CLIMA_CRON (cada 6 h por default) o difusión manual.
 */

const CACHE_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_LAT = Number(process.env.HYDRA_ORG_LAT ?? 20.5888); // Querétaro
const DEFAULT_LNG = Number(process.env.HYDRA_ORG_LNG ?? -100.3899);

const PESO: Record<SeveridadAlerta, number> = { media: 0, alta: 1, critica: 2 };

interface EstadoFuente {
  activa: boolean;
  ok?: boolean;
  detalle?: string;
}

export interface ResumenAlertas {
  generadoEn: string;
  sede: { lat: number; lng: number };
  fuentes: Record<string, EstadoFuente>;
  alertas: AlertaOficial[];
  cache?: boolean;
}

@Injectable()
export class AlertasClimaService {
  private readonly logger = new Logger(AlertasClimaService.name);
  private cacheResumen: { expira: number; resumen: ResumenAlertas } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  async alertasOficiales(opts: { refrescar?: boolean } = {}): Promise<ResumenAlertas> {
    if (!opts.refrescar && this.cacheResumen && this.cacheResumen.expira > Date.now()) {
      return { ...this.cacheResumen.resumen, cache: true };
    }

    const sede = { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
    const fuentes: Record<string, EstadoFuente> = {};
    const alertas: AlertaOficial[] = [];

    // ── Ciclones tropicales (NHC/NOAA) ──
    if ((process.env.CLIMA_CICLONES ?? 'on').toLowerCase() !== 'off') {
      try {
        const ciclones = await ciclonesActivosNhc();
        const deCiclon = evaluarCiclones(ciclones, sede);
        alertas.push(...deCiclon);
        fuentes.nhc_noaa = {
          activa: true,
          ok: true,
          detalle: `${ciclones.length} sistema(s) activo(s), ${deCiclon.length} dentro del radio de vigilancia`,
        };
      } catch (e: any) {
        fuentes.nhc_noaa = { activa: true, ok: false, detalle: e?.message };
        this.logger.warn(`NHC no disponible: ${e?.message}`);
      }
    } else {
      fuentes.nhc_noaa = { activa: false };
    }

    // ── Crecida de río (GloFAS) ──
    if ((process.env.CLIMA_FLOOD ?? 'on').toLowerCase() !== 'off') {
      const lat = Number(process.env.CLIMA_FLOOD_LAT ?? sede.lat);
      const lng = Number(process.env.CLIMA_FLOOD_LNG ?? sede.lng);
      try {
        const serie = await caudalRioGlofas(lat, lng);
        const deCrecida = evaluarCrecidaRio(serie);
        alertas.push(...deCrecida);
        fuentes.glofas_openmeteo = {
          activa: true,
          ok: true,
          detalle: `${serie.length} día(s) de caudal en (${lat.toFixed(3)}, ${lng.toFixed(3)}); ${deCrecida.length} alerta(s)`,
        };
      } catch (e: any) {
        fuentes.glofas_openmeteo = { activa: true, ok: false, detalle: e?.message };
        this.logger.warn(`GloFAS no disponible: ${e?.message}`);
      }
    } else {
      fuentes.glofas_openmeteo = { activa: false };
    }

    // ── Avisos CAP oficiales ──
    const urlsCap = urlsCapConfiguradas();
    if (urlsCap.length > 0) {
      const docs = await descargarDocumentosCap(urlsCap);
      const errores = docs.filter((d) => d.error);
      const avisos = docs.flatMap((d) => (d.xml ? parsearCap(d.xml) : []));
      const deCap = capAAlertas(avisos, new Date().toISOString());
      alertas.push(...deCap);
      fuentes.cap = {
        activa: true,
        ok: errores.length < docs.length,
        detalle: `${docs.length - errores.length}/${docs.length} feed(s) OK, ${avisos.length} aviso(s), ${deCap.length} vigente(s)${
          errores.length ? ` · errores: ${errores.map((e) => `${e.url}: ${e.error}`).join('; ')}` : ''
        }`,
      };
    } else {
      fuentes.cap = { activa: false, detalle: 'Configura CLIMA_CAP_URLS con feeds CAP oficiales' };
    }

    const resumen: ResumenAlertas = {
      generadoEn: new Date().toISOString(),
      sede,
      fuentes,
      alertas: ordenarPorSeveridad(alertas),
    };
    this.cacheResumen = { expira: Date.now() + CACHE_TTL_MS, resumen };
    return resumen;
  }

  /**
   * Difunde al personal operativo las alertas nuevas (no emitidas antes) con
   * severidad ≥ mínima. Devuelve qué se emitió y qué se omitió por dedup.
   */
  async difundir(opts: { severidadMinima?: SeveridadAlerta } = {}) {
    const minima =
      opts.severidadMinima ??
      ((process.env.CLIMA_ALERTAS_SEVERIDAD_MIN ?? 'alta').toLowerCase() as SeveridadAlerta);
    const umbral = PESO[minima] ?? PESO.alta;

    const resumen = await this.alertasOficiales();
    const candidatas = resumen.alertas.filter((a) => PESO[a.severidad] >= umbral);

    const emails = (process.env.CLIMA_ALERTAS_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    const telefonos = (process.env.CLIMA_ALERTAS_WHATSAPP ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const emitidas: string[] = [];
    const omitidas: string[] = [];

    for (const alerta of candidatas) {
      const existente = await this.prisma.alertaClimaticaEmitida.findUnique({
        where: { clave: alerta.claveDedup },
      });
      if (existente) {
        omitidas.push(alerta.claveDedup);
        continue;
      }

      let destinatarios = 0;
      const asunto = `[Hydra · Alerta ${alerta.severidad.toUpperCase()}] ${alerta.titulo}`;
      const cuerpo = [
        `<p><strong>${alerta.titulo}</strong> (${alerta.fuente}, severidad ${alerta.severidad})</p>`,
        `<p>${alerta.detalle}</p>`,
        alerta.zona ? `<p><strong>Zona:</strong> ${alerta.zona}</p>` : '',
        `<p><strong>Impacto esperado:</strong> ${alerta.impacto}</p>`,
        `<p><strong>Acción recomendada:</strong> ${alerta.accionRecomendada}</p>`,
      ].join('');
      const mensajeCorto = `⚠️ Alerta ${alerta.severidad.toUpperCase()} (${alerta.fuente}): ${alerta.titulo}. ${alerta.detalle}. Acción: ${alerta.accionRecomendada}`;

      for (const email of emails) {
        const r = await this.notificaciones.enviarEmail({
          destinatario: email,
          asunto,
          cuerpo,
          tipo: 'alerta_climatica',
        });
        if (r.enviado) destinatarios += 1;
      }
      for (const tel of telefonos) {
        const r = await this.notificaciones.enviarWhatsApp({
          telefono: tel,
          mensaje: mensajeCorto,
          tipo: 'alerta_climatica',
        });
        if (r.enviado) destinatarios += 1;
      }

      await this.prisma.alertaClimaticaEmitida.create({
        data: {
          clave: alerta.claveDedup,
          fuente: alerta.fuente,
          tipo: alerta.tipo,
          severidad: alerta.severidad,
          titulo: alerta.titulo,
          detalle: alerta.detalle,
          destinatarios,
        },
      });
      emitidas.push(alerta.claveDedup);
    }

    return {
      severidadMinima: minima,
      evaluadas: resumen.alertas.length,
      candidatas: candidatas.length,
      emitidas,
      omitidasPorDedup: omitidas,
      destinatariosConfigurados: { emails: emails.length, whatsapp: telefonos.length },
    };
  }

  /** Bitácora de alertas ya difundidas (para el panel y auditoría). */
  async emitidas(limit = 50) {
    return this.prisma.alertaClimaticaEmitida.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  /** Vigilancia periódica: evalúa fuentes y difunde lo nuevo. */
  @Cron(process.env.JOB_ALERTAS_CLIMA_CRON ?? '15 */6 * * *', { name: 'alertas-clima' })
  async cronDifusion() {
    if ((process.env.CLIMA_ALERTAS_AUTO ?? 'on').toLowerCase() === 'off') return;
    try {
      const r = await this.difundir();
      if (r.emitidas.length > 0) {
        this.logger.log(`Difusión de alertas climáticas: ${r.emitidas.length} nueva(s) emitida(s)`);
      }
    } catch (e: any) {
      this.logger.error(`Cron alertas-clima falló: ${e?.message}`);
    }
  }
}
