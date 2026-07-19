import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GisTrackerService } from './gis-tracker.service';

@Injectable()
export class GisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracker: GisTrackerService,
  ) {}

  async getDelta(params?: { entidades?: string[] }) {
    const desde = await this.tracker.getFechaUltimaSyncExitosa();
    const cambios = await this.tracker.getCambiosPendientes({
      entidades: params?.entidades as any,
      desde: desde ?? undefined,
    });
    return {
      desde: desde?.toISOString() ?? 'primera_sincronizacion',
      totalCambios: cambios.length,
      cambios,
    };
  }

  async iniciarSync(): Promise<{ logId: string; totalCambiosPendientes: number }> {
    const desde = await this.tracker.getFechaUltimaSyncExitosa();
    const cambiosPendientes = await this.tracker.getCambiosPendientes({ desde: desde ?? undefined });

    const log = await this.prisma.logSincronizacion.create({
      data: {
        tipo: 'GIS',
        estado: 'en_progreso',
        totalCambios: cambiosPendientes.length,
        cambios: { connect: cambiosPendientes.map((c) => ({ id: c.id })) },
      },
    });

    return { logId: log.id, totalCambiosPendientes: cambiosPendientes.length };
  }

  async completarSync(
    logId: string,
    resultado: {
      estado: 'exitosa' | 'fallida';
      totalExportados: number;
      totalErrores: number;
      detalles?: object;
    },
  ) {
    const log = await this.prisma.logSincronizacion.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException('Log de sincronización no encontrado');

    if (resultado.estado === 'exitosa') {
      await this.prisma.cambioGIS.updateMany({
        where: { logId, exportado: false },
        data: { exportado: true },
      });
    }

    return this.prisma.logSincronizacion.update({
      where: { id: logId },
      data: {
        estado: resultado.estado,
        totalExportados: resultado.totalExportados,
        totalErrores: resultado.totalErrores,
        detalles: resultado.detalles ?? undefined,
        fechaFin: new Date(),
      },
    });
  }

  async getHistorialSync(params: { page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [data, total] = await Promise.all([
      this.prisma.logSincronizacion.findMany({
        orderBy: { fechaInicio: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          tipo: true,
          estado: true,
          totalCambios: true,
          totalExportados: true,
          totalErrores: true,
          fechaInicio: true,
          fechaFin: true,
        },
      }),
      this.prisma.logSincronizacion.count(),
    ]);
    return { data, total, page, limit };
  }

  async conciliar(params: { entidad: string; idsEnGIS: string[] }) {
    const { entidad, idsEnGIS } = params;
    const gisSet = new Set(idsEnGIS);

    let idsEnSistema: string[] = [];
    switch (entidad) {
      case 'Contrato':
        idsEnSistema = (await this.prisma.contrato.findMany({ select: { id: true } })).map((c) => c.id);
        break;
      case 'Medidor':
        idsEnSistema = (await this.prisma.medidor.findMany({ select: { id: true } })).map((m) => m.id);
        break;
      case 'Zona':
        idsEnSistema = (await this.prisma.zona.findMany({ select: { id: true } })).map((z) => z.id);
        break;
      case 'Distrito':
        idsEnSistema = (await this.prisma.distrito.findMany({ select: { id: true } })).map((d) => d.id);
        break;
      default:
        return { error: `Entidad ${entidad} no soportada para conciliación` };
    }

    const sistemaSet = new Set(idsEnSistema);
    const soloEnSistema = idsEnSistema.filter((id) => !gisSet.has(id));
    const soloEnGIS = idsEnGIS.filter((id) => !sistemaSet.has(id));

    await this.prisma.logSincronizacion.create({
      data: {
        tipo: 'GIS_conciliacion',
        estado: 'exitosa',
        totalCambios: soloEnSistema.length + soloEnGIS.length,
        detalles: {
          soloEnSistema: soloEnSistema.slice(0, 100),
          soloEnGIS: soloEnGIS.slice(0, 100),
        },
        fechaFin: new Date(),
      },
    });

    return {
      entidad,
      totalEnSistema: idsEnSistema.length,
      totalEnGIS: idsEnGIS.length,
      soloEnSistema: { count: soloEnSistema.length, ids: soloEnSistema.slice(0, 50) },
      soloEnGIS: { count: soloEnGIS.length, ids: soloEnGIS.slice(0, 50) },
      diferencias: soloEnSistema.length + soloEnGIS.length,
    };
  }

  async getEstado() {
    const [ultimaSync, cambiosPendientes] = await Promise.all([
      this.prisma.logSincronizacion.findFirst({
        where: { tipo: 'GIS' },
        orderBy: { fechaInicio: 'desc' },
        select: {
          id: true,
          estado: true,
          fechaInicio: true,
          fechaFin: true,
          totalExportados: true,
        },
      }),
      this.prisma.cambioGIS.count({ where: { exportado: false } }),
    ]);
    return { ultimaSync, cambiosPendientes };
  }

  // ─── GIS visual (P2.18): padrón como GeoJSON — gratis, sin PostGIS ─────────
  // Las coordenadas salen de PuntoServicio.gpsLat/gpsLng con fallback a
  // Domicilio.gpsLat/gpsLng. PostGIS es el upgrade opcional (imagen
  // postgis/postgis + CREATE EXTENSION) cuando se necesiten consultas
  // espaciales server-side; para pintar el padrón basta el modelo actual.

  /**
   * Padrón georreferenciado como GeoJSON FeatureCollection. Propiedades por
   * contrato: estado del servicio, tipo, zona y situación de cartera
   * (categoría/saldo vencido) para tematizar el mapa.
   */
  async padronGeojson(params: {
    zonaId?: string;
    administracionId?: string;
    limit?: number;
  }) {
    const limit = Math.min(params.limit ?? 5_000, 20_000);
    const contratos = await this.prisma.contrato.findMany({
      where: {
        ...(params.zonaId && { zonaId: params.zonaId }),
        ...(params.administracionId && { zona: { administracionId: params.administracionId } }),
        OR: [
          { puntoServicio: { gpsLat: { not: null }, gpsLng: { not: null } } },
          { domicilio: { gpsLat: { not: null }, gpsLng: { not: null } } },
        ],
      },
      take: limit,
      select: {
        id: true,
        numeroContrato: true,
        nombre: true,
        estado: true,
        tipoServicio: true,
        zona: { select: { id: true, nombre: true } },
        puntoServicio: { select: { gpsLat: true, gpsLng: true } },
        domicilio: { select: { gpsLat: true, gpsLng: true, direccionConcatenada: true } },
        estadoCuenta: { select: { categoria: true, saldoVencido: true, diasMoraMax: true } },
      },
    });

    const features = contratos
      .map((c) => {
        const lat = Number(c.puntoServicio?.gpsLat ?? c.domicilio?.gpsLat);
        const lng = Number(c.puntoServicio?.gpsLng ?? c.domicilio?.gpsLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lng, lat] },
          properties: {
            contratoId: c.id,
            numeroContrato: c.numeroContrato,
            nombre: c.nombre,
            estado: c.estado,
            tipoServicio: c.tipoServicio,
            zonaId: c.zona?.id ?? null,
            zona: c.zona?.nombre ?? null,
            direccion: c.domicilio?.direccionConcatenada ?? null,
            carteraCategoria: c.estadoCuenta?.categoria ?? 'SIN_DATOS',
            saldoVencido: Number(c.estadoCuenta?.saldoVencido ?? 0),
            diasMoraMax: c.estadoCuenta?.diasMoraMax ?? 0,
          },
        };
      })
      .filter(Boolean);

    return {
      type: 'FeatureCollection' as const,
      features,
      meta: { total: features.length, limit, georreferenciados: features.length },
    };
  }

  /**
   * Centroide (promedio de coordenadas del padrón) por zona — insumo del mapa
   * y del pronóstico climático por zona.
   */
  async centroidesZonas(params: { administracionId?: string } = {}) {
    const contratos = await this.prisma.contrato.findMany({
      where: {
        zonaId: { not: null },
        ...(params.administracionId && { zona: { administracionId: params.administracionId } }),
        OR: [
          { puntoServicio: { gpsLat: { not: null }, gpsLng: { not: null } } },
          { domicilio: { gpsLat: { not: null }, gpsLng: { not: null } } },
        ],
      },
      select: {
        zona: { select: { id: true, nombre: true, administracionId: true } },
        puntoServicio: { select: { gpsLat: true, gpsLng: true } },
        domicilio: { select: { gpsLat: true, gpsLng: true } },
      },
    });

    const acc = new Map<
      string,
      { zonaId: string; zona: string; administracionId: string; sumLat: number; sumLng: number; n: number }
    >();
    for (const c of contratos) {
      const lat = Number(c.puntoServicio?.gpsLat ?? c.domicilio?.gpsLat);
      const lng = Number(c.puntoServicio?.gpsLng ?? c.domicilio?.gpsLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || !c.zona) continue;
      const a = acc.get(c.zona.id) ?? {
        zonaId: c.zona.id,
        zona: c.zona.nombre,
        administracionId: c.zona.administracionId,
        sumLat: 0,
        sumLng: 0,
        n: 0,
      };
      a.sumLat += lat;
      a.sumLng += lng;
      a.n++;
      acc.set(c.zona.id, a);
    }

    return [...acc.values()].map((a) => ({
      zonaId: a.zonaId,
      zona: a.zona,
      administracionId: a.administracionId,
      lat: Math.round((a.sumLat / a.n) * 1e6) / 1e6,
      lng: Math.round((a.sumLng / a.n) * 1e6) / 1e6,
      contratosGeorreferenciados: a.n,
    }));
  }
}
