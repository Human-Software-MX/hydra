import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GisTrackerService } from './gis-tracker.service';
import { conMonitoreo } from '../../common/monitoreo.helper';

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
    return conMonitoreo(this.prisma, 'GIS_EXPORT', async (ctx) => {
      const desde = await this.tracker.getFechaUltimaSyncExitosa();
      const cambiosPendientes = await this.tracker.getCambiosPendientes({
        desde: desde ?? undefined,
      });

      const log = await this.prisma.logSincronizacion.create({
        data: {
          tipo: 'GIS',
          estado: 'en_progreso',
          totalCambios: cambiosPendientes.length,
          cambios: { connect: cambiosPendientes.map((c) => ({ id: c.id })) },
        },
      });

      ctx.registros = cambiosPendientes.length;
      ctx.detalle = { logId: log.id, desde: desde?.toISOString() ?? null };

      return { logId: log.id, totalCambiosPendientes: cambiosPendientes.length };
    });
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
}
