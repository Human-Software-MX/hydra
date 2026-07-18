import { EmailChannel, WhatsAppChannel } from './notificacion-channel.interface';
import { ConsoleEmailChannel, ConsoleWhatsAppChannel } from './console.channel';
import { HttpEmailChannel, HttpWhatsAppChannel } from './http.channel';
import { SmtpEmailChannel } from './smtp.channel';

/**
 * Selecciona el canal de email/WhatsApp según configuración:
 *   NOTIF_EMAIL_PROVIDER    = console | http | smtp   (default console)
 *   NOTIF_EMAIL_URL         = URL del gateway (requerido para http)
 *   NOTIF_EMAIL_AUTH        = header Authorization opcional
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM (canal smtp;
 *     definir SMTP_HOST basta para activar SMTP sin NOTIF_EMAIL_PROVIDER)
 *   NOTIF_WHATSAPP_PROVIDER = console | http   (default console)
 *   NOTIF_WHATSAPP_URL / NOTIF_WHATSAPP_AUTH
 */
export function crearEmailChannel(): EmailChannel {
  const proveedor = (process.env.NOTIF_EMAIL_PROVIDER ?? '').toLowerCase();
  if (proveedor === 'http' && process.env.NOTIF_EMAIL_URL) {
    return new HttpEmailChannel(process.env.NOTIF_EMAIL_URL, process.env.NOTIF_EMAIL_AUTH);
  }
  // SMTP explícito, o implícito cuando hay SMTP_HOST y no se pidió otro proveedor.
  if (process.env.SMTP_HOST && (proveedor === 'smtp' || proveedor === '')) {
    return new SmtpEmailChannel(process.env.SMTP_HOST);
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
