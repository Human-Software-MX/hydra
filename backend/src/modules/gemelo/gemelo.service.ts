import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Gemelo comercial (P3.22, SWAN Digital Twin Readiness Guide, hito DT-1/DT-2):
 * expone la demanda agregada del padrón comercial por zona/administración y
 * periodo, en las unidades que consumen los modelos hidráulicos (m³/día y
 * L/s promedio). Es la interfaz entre el mundo comercial (consumos
 * facturados) y el mundo técnico (EPANET, WaterGEMS, sectorización): el
 * modelador asigna estas demandas a los nodos de su modelo.
 */
@Injectable()
export class GemeloService {
  constructor(private readonly prisma: PrismaService) {}

  private diasDePeriodo(periodo: string): number {
    const [anio, mes] = periodo.split('-').map(Number);
    return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  }

  /**
   * Demanda agregada del periodo agrupada por zona (o administración):
   * m³ facturados, m³/día, L/s promedio, tomas activas y dotación por toma.
   */
  async demanda(params: { periodo: string; agrupacion?: 'zona' | 'administracion' }) {
    if (!/^\d{4}-\d{2}$/.test(params.periodo)) {
      throw new BadRequestException('periodo debe tener formato YYYY-MM');
    }
    const agrupacion = params.agrupacion ?? 'zona';
    const dias = this.diasDePeriodo(params.periodo);
    const segundos = dias * 86_400;

    const consumos = await this.prisma.consumo.findMany({
      where: { periodo: params.periodo, confirmado: true },
      select: {
        m3: true,
        tipo: true,
        contrato: {
          select: {
            id: true,
            zona: {
              select: {
                id: true,
                nombre: true,
                administracionId: true,
                administracion: { select: { id: true, nombre: true } },
              },
            },
          },
        },
      },
    });

    type Grupo = {
      grupoId: string | null;
      grupo: string;
      administracion: string | null;
      tomas: number;
      m3Periodo: number;
      m3Medido: number;
      m3Estimado: number;
    };
    const grupos = new Map<string, Grupo>();
    const tomasVistas = new Map<string, Set<string>>();

    for (const c of consumos) {
      const zona = c.contrato.zona;
      const key =
        agrupacion === 'zona'
          ? (zona?.id ?? 'sin_zona')
          : (zona?.administracionId ?? 'sin_administracion');
      let g = grupos.get(key);
      if (!g) {
        g = {
          grupoId: agrupacion === 'zona' ? (zona?.id ?? null) : (zona?.administracionId ?? null),
          grupo:
            agrupacion === 'zona'
              ? (zona?.nombre ?? 'Sin zona')
              : (zona?.administracion?.nombre ?? 'Sin administración'),
          administracion: zona?.administracion?.nombre ?? null,
          tomas: 0,
          m3Periodo: 0,
          m3Medido: 0,
          m3Estimado: 0,
        };
        grupos.set(key, g);
        tomasVistas.set(key, new Set());
      }
      const m3 = Number(c.m3);
      g.m3Periodo += m3;
      if (c.tipo === 'Real') g.m3Medido += m3;
      else g.m3Estimado += m3;
      tomasVistas.get(key)!.add(c.contrato.id);
    }

    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10_000) / 10_000;
    const data = [...grupos.entries()]
      .map(([key, g]) => {
        const tomas = tomasVistas.get(key)!.size;
        return {
          grupoId: g.grupoId,
          grupo: g.grupo,
          administracion: g.administracion,
          tomas,
          m3Periodo: r2(g.m3Periodo),
          m3Medido: r2(g.m3Medido),
          m3Estimado: r2(g.m3Estimado),
          m3Dia: r2(g.m3Periodo / dias),
          litrosSegundo: r4((g.m3Periodo * 1_000) / segundos),
          m3DiaPorToma: tomas > 0 ? r4(g.m3Periodo / dias / tomas) : null,
        };
      })
      .sort((a, b) => b.m3Periodo - a.m3Periodo);

    const total = {
      tomas: data.reduce((s, d) => s + d.tomas, 0),
      m3Periodo: r2(data.reduce((s, d) => s + d.m3Periodo, 0)),
      m3Dia: r2(data.reduce((s, d) => s + d.m3Dia, 0)),
      litrosSegundo: r4(data.reduce((s, d) => s + d.litrosSegundo, 0)),
    };

    return { periodo: params.periodo, agrupacion, diasPeriodo: dias, total, data };
  }

  /**
   * Serie de demanda (últimos N periodos) por grupo — el patrón estacional
   * que un modelador convierte en factores de demanda del modelo hidráulico.
   */
  async serieDemanda(params: { hasta: string; periodos?: number; agrupacion?: 'zona' | 'administracion' }) {
    if (!/^\d{4}-\d{2}$/.test(params.hasta)) {
      throw new BadRequestException('hasta debe tener formato YYYY-MM');
    }
    const n = Math.min(params.periodos ?? 12, 24);
    const periodos: string[] = [];
    let [anio, mes] = params.hasta.split('-').map(Number);
    for (let i = 0; i < n; i++) {
      periodos.unshift(`${anio}-${String(mes).padStart(2, '0')}`);
      mes--;
      if (mes === 0) {
        mes = 12;
        anio--;
      }
    }
    const resultados = await Promise.all(
      periodos.map((p) => this.demanda({ periodo: p, agrupacion: params.agrupacion })),
    );
    return {
      agrupacion: params.agrupacion ?? 'zona',
      serie: resultados.map((r) => ({ periodo: r.periodo, total: r.total, data: r.data })),
    };
  }
}
