import { Injectable, Logger } from '@nestjs/common';
import { evaluarRiesgosClimaticos, AlertaClimatica, DiaPronostico } from './clima-riesgos';
import { pronosticoOpenMeteo } from './providers/openmeteo.provider';
import { pronosticoSmn } from './providers/smn.provider';
import { GisService } from '../gis/gis.service';

/**
 * Clima operativo: pronóstico + riesgos de incidencia por zona, con servicios
 * meteorológicos GRATUITOS:
 *  - Open-Meteo (default, sin API key, 16 días)
 *  - SMN/CONAGUA (oficial mexicano, method=1 por municipio, 4 días) cuando
 *    CLIMA_PROVIDER=smn; si falla, cae a Open-Meteo automáticamente.
 *
 * Las coordenadas por zona salen de los centroides del padrón (GisService);
 * si el padrón no está georreferenciado se usa la sede del organismo
 * (HYDRA_ORG_LAT/LNG, default centro de Querétaro).
 *
 * Cache en memoria de 1 hora por coordenada: el pronóstico diario no cambia
 * más rápido y evita golpear servicios gratuitos.
 */

const CACHE_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_LAT = Number(process.env.HYDRA_ORG_LAT ?? 20.5888); // Querétaro
const DEFAULT_LNG = Number(process.env.HYDRA_ORG_LNG ?? -100.3899);
const MAX_ZONAS_RIESGO = 20;

interface EntradaCache {
  expira: number;
  dias: DiaPronostico[];
  fuente: string;
}

@Injectable()
export class ClimaService {
  private readonly logger = new Logger(ClimaService.name);
  private readonly cache = new Map<string, EntradaCache>();

  constructor(private readonly gis: GisService) {}

  private async obtenerPronostico(lat: number, lng: number, dias: number) {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)},${dias}`;
    const cacheado = this.cache.get(key);
    if (cacheado && cacheado.expira > Date.now()) {
      return { dias: cacheado.dias, fuente: cacheado.fuente, cache: true };
    }

    let serie: DiaPronostico[];
    let fuente: string;
    const proveedor = (process.env.CLIMA_PROVIDER ?? 'openmeteo').toLowerCase();
    if (proveedor === 'smn') {
      try {
        serie = await pronosticoSmn();
        fuente = 'smn_conagua';
      } catch (e: any) {
        this.logger.warn(`SMN/CONAGUA no disponible (${e?.message}); usando Open-Meteo`);
        serie = await pronosticoOpenMeteo(lat, lng, dias);
        fuente = 'open_meteo_fallback';
      }
    } else {
      serie = await pronosticoOpenMeteo(lat, lng, dias);
      fuente = 'open_meteo';
    }

    this.cache.set(key, { expira: Date.now() + CACHE_TTL_MS, dias: serie, fuente });
    return { dias: serie, fuente, cache: false };
  }

  /** Pronóstico + riesgos para una coordenada (o la sede del organismo). */
  async pronostico(params: { lat?: number; lng?: number; dias?: number }) {
    const lat = params.lat ?? DEFAULT_LAT;
    const lng = params.lng ?? DEFAULT_LNG;
    const horizonte = Math.min(Math.max(params.dias ?? 14, 1), 16);
    const { dias, fuente, cache } = await this.obtenerPronostico(lat, lng, horizonte);
    return {
      lat,
      lng,
      fuente,
      cache,
      dias,
      alertas: evaluarRiesgosClimaticos(dias),
    };
  }

  /**
   * Riesgos climáticos por zona operativa (centroides del padrón). Devuelve
   * solo zonas con alertas, más el panorama general de la sede.
   */
  async riesgosPorZona(params: { administracionId?: string; dias?: number } = {}) {
    const horizonte = Math.min(Math.max(params.dias ?? 14, 1), 16);
    const centroides = (await this.gis.centroidesZonas({ administracionId: params.administracionId }))
      .slice(0, MAX_ZONAS_RIESGO);

    const general = await this.pronostico({ dias: horizonte });

    const zonas: Array<{
      zonaId: string;
      zona: string;
      lat: number;
      lng: number;
      alertas: AlertaClimatica[];
    }> = [];
    for (const c of centroides) {
      try {
        const { dias } = await this.obtenerPronostico(c.lat, c.lng, horizonte);
        const alertas = evaluarRiesgosClimaticos(dias);
        if (alertas.length > 0) {
          zonas.push({ zonaId: c.zonaId, zona: c.zona, lat: c.lat, lng: c.lng, alertas });
        }
      } catch (e: any) {
        this.logger.warn(`Pronóstico de zona ${c.zona} falló: ${e?.message}`);
      }
    }

    return {
      horizonteDias: horizonte,
      fuente: general.fuente,
      general: { lat: general.lat, lng: general.lng, alertas: general.alertas },
      zonasEvaluadas: centroides.length,
      zonasConAlertas: zonas.length,
      zonas,
    };
  }
}
