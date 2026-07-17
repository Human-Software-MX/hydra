import { apiRequest, hasApi } from './client';

export interface IndicadorPct {
  pct: number | null;
  definicion: string;
}

export interface IndicadoresPigooDto {
  periodo: string | null;
  generadoEn: string;
  padron: { contratosTotales: number; contratosActivos: number; definicion: string };
  micromedicion: IndicadorPct & { medidoresActivos: number; contratosActivos: number };
  eficienciaComercial: IndicadorPct & { facturado: number; cobrado: number };
  eficienciaCobro: IndicadorPct & { recibosEmitidos: number; recibosPagados: number };
  pagoATiempo: IndicadorPct & { pagosEvaluados: number; pagosATiempo: number };
  reclamaciones: { quejasPeriodo: number; por1000Tomas: number | null; definicion: string };
  noDisponibles: Record<string, string>;
}

export async function fetchIndicadoresPigoo(periodo?: string): Promise<IndicadoresPigooDto> {
  const qs = periodo ? `?periodo=${encodeURIComponent(periodo)}` : '';
  return apiRequest<IndicadoresPigooDto>(`/indicadores/pigoo${qs}`);
}

export { hasApi };
