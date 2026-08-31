import { apiRequest } from './client';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export const METODOS_PAGO_PASARELA = ['spei', 'oxxo', 'tarjeta'] as const;
export type MetodoPagoPasarela = (typeof METODOS_PAGO_PASARELA)[number];

/** Intento de pago digital (SPEI/OXXO/tarjeta). Decimales llegan como string; usar Number(). */
export interface IntentoPagoDto {
  id: string;
  contratoId: string;
  pasarela: string;
  metodo: MetodoPagoPasarela | string;
  referencia: string;
  monto: number;
  estado: string; // pendiente | pagado | expirado | cancelado | fallido
  urlPago?: string | null;
  expiraEn?: string | null;
  pagoId?: string | null;
  origen: string; // portal | caja | api
  createdAt: string;
  updatedAt?: string;
}

/**
 * Datos de presentación del intento recién creado (no se persisten):
 * SPEI → clabe/banco/beneficiario/conceptoPago; OXXO → lineaCaptura/comision.
 */
export interface IntentoPagoCreadoDto extends IntentoPagoDto {
  datos?: {
    clabe?: string;
    banco?: string;
    beneficiario?: string;
    conceptoPago?: string;
    lineaCaptura?: string;
    comision?: string;
  } | null;
}

export interface ResultadoSimulacionPago {
  ok: boolean;
  idempotente?: boolean;
  intentoId: string;
  pagoId?: string | null;
  estado?: string;
}

// ─── Portal del cliente ───────────────────────────────────────────────────────

export async function crearIntentoPagoPortal(
  contratoId: string,
  data: { monto: number; metodo: MetodoPagoPasarela },
) {
  return apiRequest<IntentoPagoCreadoDto>(`/portal/contratos/${contratoId}/intentos-pago`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getIntentosPagoPortal(contratoId: string) {
  return apiRequest<IntentoPagoDto[]>(`/portal/contratos/${contratoId}/intentos-pago`);
}

// La pasarela local fue retirada (SUPRA es el único motor de pagos): los
// endpoints /pasarelas/* ya no existen y la simulación local responde 410.
// El pago se confirma en el checkout de SUPRA (urlPago → /pay/<token>).
