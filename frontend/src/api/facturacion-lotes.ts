import { apiRequest } from './client';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Lote de facturación masiva (decimales llegan como string; usar Number()). */
export interface LoteFacturacionDto {
  id: string;
  periodo: string;
  filtros?: { rutaId?: string | null; zonaId?: string | null; contratoId?: string | null } | null;
  estado: string; // generado | cancelado | reprocesado
  generados: number;
  conError: number;
  importeTotal: number;
  motivoCancelacion?: string | null;
  canceladoPor?: string | null;
  loteOrigenId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoteDetalleDto extends LoteFacturacionDto {
  totales: {
    timbrados: number;
    porEstado: Array<{ estado: string; cantidad: number; importe: number }>;
  };
}

export interface ResultadoCancelacionLote {
  loteId: string;
  periodo: string;
  estado: string;
  timbradosCancelados: number;
  recibosEliminados: number;
  importeCancelado: number;
  motivo: string;
}

export interface ResultadoReprocesoLote {
  loteAnteriorId: string;
  loteNuevoId: string;
  periodo: string;
  motivo: string;
  comparativo: {
    importeAnterior: number;
    importeNuevo: number;
    diferencia: number;
    generadosAnterior: number;
    generadosNuevo: number;
  };
}

export interface ResultadoRefacturacion {
  consumoId: string;
  motivo: string;
  timbradoCanceladoId: string;
  timbradoNuevoId: string;
  reciboNuevoId: string;
  comparativo: { importeAnterior: number; importeNuevo: number; diferencia: number };
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export async function getLotesFacturacion(params?: {
  periodo?: string;
  estado?: string;
  page?: number;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (params?.periodo) q.set('periodo', params.periodo);
  if (params?.estado) q.set('estado', params.estado);
  if (params?.page) q.set('page', String(params.page));
  if (params?.limit) q.set('limit', String(params.limit));
  return apiRequest<{ data: LoteFacturacionDto[]; total: number; page: number; limit: number }>(
    `/facturacion/lotes?${q}`,
  );
}

export async function getLoteFacturacion(id: string) {
  return apiRequest<LoteDetalleDto>(`/facturacion/lotes/${id}`);
}

export async function cancelarLoteFacturacion(id: string, motivo: string) {
  return apiRequest<ResultadoCancelacionLote>(`/facturacion/lotes/${id}/cancelar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
}

export async function reprocesarLoteFacturacion(id: string, motivo: string) {
  return apiRequest<ResultadoReprocesoLote>(`/facturacion/lotes/${id}/reprocesar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
}

export async function refacturarConsumo(consumoId: string, motivo: string) {
  return apiRequest<ResultadoRefacturacion>(`/facturacion/consumos/${consumoId}/refacturar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
}
