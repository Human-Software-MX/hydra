import { Logger } from '@nestjs/common';
import {
  EmailChannel,
  WhatsAppChannel,
  EnvioEmail,
  EnvioWhatsApp,
  ResultadoEnvio,
} from './notificacion-channel.interface';

/** Canal de desarrollo: registra el envío en el log en vez de enviarlo. */
export class ConsoleEmailChannel implements EmailChannel {
  readonly nombre = 'console';
  private readonly logger = new Logger('EmailChannel');

  async enviar(msg: EnvioEmail): Promise<ResultadoEnvio> {
    this.logger.log(`[EMAIL console] → ${msg.destinatario} | ${msg.asunto}`);
    return { enviado: true, proveedor: this.nombre, referencia: 'console' };
  }
}

export class ConsoleWhatsAppChannel implements WhatsAppChannel {
  readonly nombre = 'console';
  private readonly logger = new Logger('WhatsAppChannel');

  async enviar(msg: EnvioWhatsApp): Promise<ResultadoEnvio> {
    this.logger.log(`[WHATSAPP console] → ${msg.telefono} | ${msg.mensaje.slice(0, 80)}`);
    return { enviado: true, proveedor: this.nombre, referencia: 'console' };
  }
}
