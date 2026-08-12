import { apiRequest } from './client';

export interface TarifaVigente {
  id: string;
  codigo: string;
  nombre: string;
  tipoServicio: string;
  tipoCalculo: string;
  rangoMinM3: number | null;
  rangoMaxM3: number | null;
  precioUnitario: number | null;
  cuotaFija: number | null;
  ivaPct: number;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
  activo: boolean;
}

export interface ActualizacionTarifaria {
  id: string;
  descripcion: string;
  fechaPublicacion: string;
  fechaAplicacion: string;
  fuenteOficial: string | null;
  estado: string;
  aplicadoPor: string | null;
  createdAt: string;
}

/** Ajuste manual a la facturación de un contrato/periodo. Los montos llegan como Decimal serializado. */
export interface AjusteTarifarioDto {
  id: string;
  contratoId: string;
  periodo: string;
  tipo: string;
  concepto: string;
  montoOriginal: string | number;
  montoAjustado: string | number;
  motivo: string;
  aprobadoPor: string | null;
  createdAt: string;
}

export interface CalculoMonto {
  consumoM3: number;
  subtotal: number;
  iva: number;
  total: number;
  desglose: { rango: string; m3: number; precio: number; subtotal: number }[];
}

export const fetchTarifasVigentes = (tipoServicio?: string, fecha?: string) => {
  const params = new URLSearchParams();
  if (tipoServicio) params.set('tipoServicio', tipoServicio);
  if (fecha) params.set('fecha', fecha);
  const qs = params.toString();
  return apiRequest<TarifaVigente[]>(`/tarifas/vigentes${qs ? `?${qs}` : ''}`);
};

export const calcularMonto = (tipoServicio: string, consumoM3: number) =>
  apiRequest<CalculoMonto>(`/tarifas/calcular?tipoServicio=${tipoServicio}&consumoM3=${consumoM3}`);

export const fetchAjustesTarifarios = (contratoId?: string) =>
  apiRequest<AjusteTarifarioDto[]>(
    `/tarifas/ajustes/lista${contratoId ? `?contratoId=${encodeURIComponent(contratoId)}` : ''}`
  );

export const crearAjusteTarifario = (dto: {
  contratoId: string;
  periodo: string;
  tipo: string;
  concepto: string;
  montoOriginal: number;
  montoAjustado: number;
  motivo: string;
  aprobadoPor?: string;
}) =>
  apiRequest<AjusteTarifarioDto>('/tarifas/ajustes', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const fetchActualizaciones = () =>
  apiRequest<ActualizacionTarifaria[]>('/tarifas/actualizaciones/lista');

export const crearActualizacion = (dto: {
  descripcion: string;
  fechaPublicacion: string;
  fechaAplicacion: string;
  fuenteOficial?: string;
}) =>
  apiRequest<ActualizacionTarifaria>('/tarifas/actualizaciones', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

export const aplicarActualizacion = (id: string) =>
  apiRequest<ActualizacionTarifaria>(`/tarifas/actualizaciones/${id}/aplicar`, {
    method: 'POST',
    body: JSON.stringify({ aplicadoPor: 'SISTEMA' }),
  });
