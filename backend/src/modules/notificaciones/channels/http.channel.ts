import { Logger } from '@nestjs/common';
import {
  EmailChannel,
  WhatsAppChannel,
  EnvioEmail,
  EnvioWhatsApp,
  ResultadoEnvio,
} from './notificacion-channel.interface';

/**
 * Canal HTTP genérico: publica el mensaje a un gateway configurado por env
 * (webhook). Sirve para integrar cualquier proveedor de email o WhatsApp
 * Business API que exponga un endpoint HTTP, sin acoplar el SDK del proveedor.
 * No requiere dependencias nuevas (usa fetch nativo de Node 18+).
 */
export class HttpEmailChannel implements EmailChannel {
  readonly nombre = 'http';
  private readonly logger = new Logger('EmailChannel');

  constructor(
    private readonly url: string,
    private readonly authHeader?: string,
  ) {}

  async enviar(msg: EnvioEmail): Promise<ResultadoEnvio> {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authHeader ? { Authorization: this.authHeader } : {}),
        },
        body: JSON.stringify({
          to: msg.destinatario,
          subject: msg.asunto,
          html: msg.cuerpoHtml,
          attachments: msg.adjuntos,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { enviado: true, proveedor: this.nombre, referencia: await res.text().catch(() => undefined) };
    } catch (e: any) {
      this.logger.error(`Error email HTTP: ${e?.message}`);
      return { enviado: false, proveedor: this.nombre, error: e?.message ?? 'Error' };
    }
  }
}

export class HttpWhatsAppChannel implements WhatsAppChannel {
  readonly nombre = 'http';
  private readonly logger = new Logger('WhatsAppChannel');

  constructor(
    private readonly url: string,
    private readonly authHeader?: string,
  ) {}

  async enviar(msg: EnvioWhatsApp): Promise<ResultadoEnvio> {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authHeader ? { Authorization: this.authHeader } : {}),
        },
        body: JSON.stringify({ to: msg.telefono, message: msg.mensaje }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { enviado: true, proveedor: this.nombre, referencia: await res.text().catch(() => undefined) };
    } catch (e: any) {
      this.logger.error(`Error WhatsApp HTTP: ${e?.message}`);
      return { enviado: false, proveedor: this.nombre, error: e?.message ?? 'Error' };
    }
  }
}
