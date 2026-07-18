import { apiRequest, hasApi } from './client';

/** Shape plano de `GET /indicadores/pigoo` (IndicadoresPigoo del backend). */
export interface IndicadoresPigooDto {
  /** Periodo YYYY-MM, o null cuando el cálculo es el acumulado histórico. */
  periodo: string | null;
  // Padrón
  padronContratos: number;
  contratosActivos: number;
  contratosConMedidor: number;
  micromedicionPct: number | null;
  // Volúmenes
  volumenProducidoM3: number | null;
  volumenFacturadoM3: number;
  eficienciaFisicaPct: number | null;
  consumoPromedioPorContratoM3: number | null;
  // Comercial
  importeFacturado: number;
  importeRecaudado: number;
  eficienciaComercialPct: number | null;
  eficienciaGlobalPct: number | null;
  // Cobro (PIGOO IP.15)
  recibosEmitidos: number;
  recibosPagados: number;
  eficienciaCobroPct: number | null;
  // Pago a tiempo
  pagosEvaluados: number;
  pagosATiempo: number;
  pagoATiempoPct: number | null;
  // Cartera
  carteraVencida: number;
  usuariosConAdeudo: number;
  rezagoPctPadron: number | null;
  // Servicio
  restriccionesVigentes: number;
  conveniosActivos: number;
  quejasAbiertas: number;
  // Reclamaciones
  quejasPeriodo: number;
  reclamacionesPor1000Tomas: number | null;
}

export async function fetchIndicadoresPigoo(periodo?: string): Promise<IndicadoresPigooDto> {
  const qs = periodo ? `?periodo=${encodeURIComponent(periodo)}` : '';
  return apiRequest<IndicadoresPigooDto>(`/indicadores/pigoo${qs}`);
}

export { hasApi };
