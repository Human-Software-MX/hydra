/**
 * Contrato de un proveedor de pasarela de pago digital.
 *
 * Permite conectar Conekta, Openpay, Stripe, etc. sin tocar el resto del
 * sistema: cada integración implementa esta interfaz y se selecciona por
 * configuración (env PASARELA_PROVIDER). El proveedor genera la referencia
 * de cobro (referencia SPEI / línea de captura OXXO / checkout de tarjeta)
 * y valida/parsea los webhooks de confirmación de pago.
 */
export type MetodoPagoPasarela = 'spei' | 'oxxo' | 'tarjeta';

export interface CrearIntentoParams {
  contratoId: string;
  monto: number;
  metodo: MetodoPagoPasarela;
  /** Referencia legible del contrato (núm. CEA o id corto) para el estado de cuenta. */
  referenciaContrato: string;
}

export interface IntentoCreado {
  /** Referencia única de cobro (SPEI) / línea de captura (OXXO) / id de cargo (tarjeta). */
  referencia: string;
  /** URL de checkout hospedado (tarjeta) o de instrucciones de pago. */
  urlPago?: string;
  /** Fecha límite para pagar; después el intento se marca expirado. */
  expiraEn?: Date;
  /** Datos adicionales para mostrar al cliente (CLABE de cobro, banco, etc.). */
  datos?: Record<string, unknown>;
}

export interface WebhookParseado {
  referencia: string;
  estado: 'pagado' | 'fallido' | 'expirado' | 'cancelado';
  montoPagado: number;
  /** Fecha del pago en ISO. */
  fecha: string;
}

export interface PasarelaProvider {
  readonly nombre: string;

  /** Crea la intención de cobro en la pasarela y devuelve la referencia. */
  crearIntento(params: CrearIntentoParams): Promise<IntentoCreado>;

  /**
   * Verifica la firma HMAC/secreto del webhook. Es la única barrera de
   * seguridad del endpoint público POST /pasarelas/webhook.
   */
  verificarFirmaWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): boolean;

  /** Normaliza el payload del webhook al modelo interno. Lanza si es ilegible. */
  parsearWebhook(payload: unknown): WebhookParseado;
}
