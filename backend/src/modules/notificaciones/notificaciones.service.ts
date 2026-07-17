import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface NotificacionEmail {
  destinatario: string;
  asunto: string;
  cuerpo: string;
  folio?: string;
}

export interface NotificacionWhatsApp {
  telefono: string;
  mensaje: string;
  folio?: string;
}

/**
 * NotificacionesService — email real vía SMTP cuando hay configuración; log en caso contrario.
 *
 * Env vars (email): SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_FROM.
 * Compatible con SendGrid (host smtp.sendgrid.net, user "apikey"), Gmail, SES, etc.
 * WhatsApp sigue en stub hasta contratar proveedor (Twilio/Meta Cloud API).
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    this.from = process.env.SMTP_FROM ?? 'no-reply@hydra.local';
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT ?? 587) === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      this.logger.log(`SMTP configurado (${host}) — emails reales activos`);
    } else {
      this.transporter = null;
      this.logger.warn('SMTP_HOST no definido — emails en modo log (mock)');
    }
  }

  async enviarEmail(data: NotificacionEmail): Promise<{ enviado: boolean; mock: boolean }> {
    if (!this.transporter) {
      this.logger.log(
        `[EMAIL MOCK] Para: ${data.destinatario} | Asunto: ${data.asunto} | Folio: ${data.folio ?? 'N/A'}`,
      );
      return { enviado: true, mock: true };
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: data.destinatario,
        subject: data.asunto,
        html: data.cuerpo,
      });
      this.logger.log(`[EMAIL] Enviado a ${data.destinatario} | Folio: ${data.folio ?? 'N/A'}`);
      return { enviado: true, mock: false };
    } catch (err) {
      this.logger.error(`[EMAIL] Fallo al enviar a ${data.destinatario}: ${(err as Error).message}`);
      return { enviado: false, mock: false };
    }
  }

  async enviarWhatsApp(data: NotificacionWhatsApp): Promise<{ enviado: boolean; mock: boolean }> {
    this.logger.log(
      `[WHATSAPP STUB] Tel: ${data.telefono} | Folio: ${data.folio ?? 'N/A'} | Msg: ${data.mensaje.substring(0, 80)}`,
    );
    // Pendiente: Twilio o Meta WhatsApp Cloud API cuando haya cuenta/credenciales
    return { enviado: true, mock: true };
  }

  async notificarFolioTramite(params: {
    folio: string;
    tipo: string;
    email?: string;
    telefono?: string;
  }): Promise<void> {
    const { folio, tipo, email, telefono } = params;
    const msg = `Su trámite "${tipo}" ha sido registrado con folio: ${folio}. Guárdelo para seguimiento.`;

    if (email) {
      await this.enviarEmail({
        destinatario: email,
        asunto: `Folio de trámite: ${folio}`,
        cuerpo: `<p>${msg}</p>`,
        folio,
      });
    }
    if (telefono) {
      await this.enviarWhatsApp({ telefono, mensaje: msg, folio });
    }
  }
}
