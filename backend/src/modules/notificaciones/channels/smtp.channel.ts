import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailChannel, EnvioEmail, ResultadoEnvio } from './notificacion-channel.interface';

/**
 * Canal de email real vía SMTP (nodemailer).
 *
 * Env vars: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_FROM.
 * Compatible con SendGrid (host smtp.sendgrid.net, user "apikey"), Gmail, SES, etc.
 */
export class SmtpEmailChannel implements EmailChannel {
  readonly nombre = 'smtp';
  private readonly logger = new Logger('EmailChannel');
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(host: string) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    this.from = process.env.SMTP_FROM ?? 'no-reply@hydra.local';
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    this.logger.log(`SMTP configurado (${host}) — emails reales activos`);
  }

  async enviar(msg: EnvioEmail): Promise<ResultadoEnvio> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: msg.destinatario,
        subject: msg.asunto,
        html: msg.cuerpoHtml,
        attachments: msg.adjuntos?.map((a) => ({
          filename: a.nombre,
          content: a.contenidoBase64,
          encoding: 'base64',
          contentType: a.tipo,
        })),
      });
      return { enviado: true, proveedor: this.nombre, referencia: info?.messageId };
    } catch (e: any) {
      this.logger.error(`Error email SMTP: ${e?.message}`);
      return { enviado: false, proveedor: this.nombre, error: e?.message ?? 'Error' };
    }
  }
}
