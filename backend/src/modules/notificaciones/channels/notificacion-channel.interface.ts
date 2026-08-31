/**
 * Abstracción de canales de notificación (adapter).
 *
 * Permite conectar proveedores reales (SendGrid/SMTP para email, WhatsApp
 * Business API / Twilio para WhatsApp) sin tocar la lógica de negocio. El canal
 * por defecto es consola (desarrollo, sin secretos). Un canal HTTP genérico
 * permite integrar cualquier gateway vía webhook configurando una URL por env.
 */

export interface EnvioEmail {
  destinatario: string;
  asunto: string;
  cuerpoHtml: string;
  adjuntos?: Array<{ nombre: string; contenidoBase64: string; tipo: string }>;
}

export interface EnvioWhatsApp {
  telefono: string;
  mensaje: string;
}

export interface ResultadoEnvio {
  enviado: boolean;
  proveedor: string;
  referencia?: string;
  error?: string;
}

export interface EmailChannel {
  readonly nombre: string;
  enviar(msg: EnvioEmail): Promise<ResultadoEnvio>;
}

export interface WhatsAppChannel {
  readonly nombre: string;
  enviar(msg: EnvioWhatsApp): Promise<ResultadoEnvio>;
}
