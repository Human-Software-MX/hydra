import { EmailChannel, WhatsAppChannel } from './notificacion-channel.interface';
import { ConsoleEmailChannel, ConsoleWhatsAppChannel } from './console.channel';
import { HttpEmailChannel, HttpWhatsAppChannel } from './http.channel';

/**
 * Selecciona el canal de email/WhatsApp según configuración:
 *   NOTIF_EMAIL_PROVIDER    = console | http   (default console)
 *   NOTIF_EMAIL_URL         = URL del gateway (requerido para http)
 *   NOTIF_EMAIL_AUTH        = header Authorization opcional
 *   NOTIF_WHATSAPP_PROVIDER = console | http   (default console)
 *   NOTIF_WHATSAPP_URL / NOTIF_WHATSAPP_AUTH
 */
export function crearEmailChannel(): EmailChannel {
  const proveedor = (process.env.NOTIF_EMAIL_PROVIDER ?? 'console').toLowerCase();
  if (proveedor === 'http' && process.env.NOTIF_EMAIL_URL) {
    return new HttpEmailChannel(process.env.NOTIF_EMAIL_URL, process.env.NOTIF_EMAIL_AUTH);
  }
  return new ConsoleEmailChannel();
}

export function crearWhatsAppChannel(): WhatsAppChannel {
  const proveedor = (process.env.NOTIF_WHATSAPP_PROVIDER ?? 'console').toLowerCase();
  if (proveedor === 'http' && process.env.NOTIF_WHATSAPP_URL) {
    return new HttpWhatsAppChannel(process.env.NOTIF_WHATSAPP_URL, process.env.NOTIF_WHATSAPP_AUTH);
  }
  return new ConsoleWhatsAppChannel();
}
