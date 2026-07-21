/**
 * Configuración de la integración con SUPRA (Payment Engine).
 *
 * SUPRA es la fuente de verdad del dominio financiero (pagos, convenios,
 * obligaciones/saldos). Hydra consume su API `/v1` server-to-server y recibe
 * eventos por webhook firmado. Con SUPRA_INTEGRACION_ENABLED=false todos los
 * módulos caen al camino legacy local (kill-switch de la transición).
 */
export interface SupraConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  /** Secreto whsec_… devuelto por POST /v1/webhook_endpoints. */
  webhookSecret: string;
  /** Tolerancia anti-replay del webhook, en segundos. */
  webhookToleranceSec: number;
  /** Timeout por request HTTP a SUPRA, en ms. */
  httpTimeoutMs: number;
  /** Base pública del host de SUPRA para ligas de checkout (/pay/<token>). */
  publicUrl: string;
  currency: string;
}

export function supraConfig(): SupraConfig {
  const baseUrl = (process.env.SUPRA_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  return {
    enabled:
      (process.env.SUPRA_INTEGRACION_ENABLED ?? 'false').toLowerCase() === 'true' &&
      Boolean(process.env.SUPRA_API_KEY),
    baseUrl,
    apiKey: process.env.SUPRA_API_KEY ?? '',
    webhookSecret: process.env.SUPRA_WEBHOOK_SECRET ?? '',
    webhookToleranceSec: Number(process.env.SUPRA_WEBHOOK_TOLERANCE ?? 300),
    httpTimeoutMs: Number(process.env.SUPRA_HTTP_TIMEOUT_MS ?? 10_000),
    publicUrl: (process.env.SUPRA_PUBLIC_URL ?? baseUrl).replace(/\/+$/, ''),
    currency: process.env.SUPRA_CURRENCY ?? 'MXN',
  };
}

/** Pesos (Decimal/number) → unidades menores (centavos) como string. */
export function pesosToMinor(pesos: number | string): string {
  const n = typeof pesos === 'string' ? Number(pesos) : pesos;
  return String(Math.round(n * 100));
}

/** Unidades menores (string|number) → pesos con 2 decimales. */
export function minorToPesos(minor: string | number | null | undefined): number {
  if (minor === null || minor === undefined) return 0;
  return Math.round(Number(minor)) / 100;
}

/** external_ref canónicos (convención compartida con el conector de SUPRA). */
export const supraRef = {
  contrato: (id: string) => `hydra:contrato:${id}`,
  recibo: (id: string) => `hydra:recibo:${id}`,
  pago: (id: string) => `hydra:pago:${id}`,
  convenio: (id: string) => `hydra:convenio:${id}`,
};
