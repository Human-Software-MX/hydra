import { apiRequest } from './client';

export interface LineaFactura {
  tipoServicio: string;
  concepto: string;
  m3: number;
  precioUnitario: number;
  importe: number;
  ivaPct: number;
  iva: number;
}

export interface FacturaConsumo {
  consumoId: string;
  contratoId: string;
  contratoNombre: string;
  periodo: string;
  consumoM3: number;
  lineas: LineaFactura[];
  subtotal: number;
  iva: number;
  total: number;
  saldoVencido: number;
  saldoTotal: number;
  fechaEmision: string;
  fechaVencimiento: string;
}

export interface PreviewPeriodo {
  periodo: string;
  totalConsumos: number;
  facturables: number;
  conError: number;
  importeSubtotal: number;
  importeIva: number;
  importeTotal: number;
  facturas: FacturaConsumo[];
  errores: Array<{ consumoId: string; contratoId: string; error: string }>;
}

export interface ResultadoEjecucion {
  periodo: string;
  procesados: number;
  generados: number;
  conError: number;
  importeTotal: number;
  detalle: Array<{ consumoId: string; timbradoId: string; reciboId: string; total: number }>;
  errores: Array<{ consumoId: string; error: string }>;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && p.append(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function calcularConsumo(consumoId: string): Promise<FacturaConsumo> {
  return apiRequest<FacturaConsumo>(`/facturacion/consumo/${consumoId}/calcular`);
}

export async function previewPeriodo(params: {
  periodo: string;
  rutaId?: string;
  zonaId?: string;
  contratoId?: string;
}): Promise<PreviewPeriodo> {
  return apiRequest<PreviewPeriodo>(`/facturacion/periodo/preview${qs(params)}`);
}

export async function ejecutarPeriodo(params: {
  periodo: string;
  rutaId?: string;
  zonaId?: string;
  contratoId?: string;
}): Promise<ResultadoEjecucion> {
  return apiRequest<ResultadoEjecucion>('/facturacion/periodo', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function facturarConsumo(
  consumoId: string,
): Promise<{ timbradoId: string; reciboId: string; factura: FacturaConsumo }> {
  return apiRequest(`/facturacion/consumo/${consumoId}`, { method: 'POST' });
}
