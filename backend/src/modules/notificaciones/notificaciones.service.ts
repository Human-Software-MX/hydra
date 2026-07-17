import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailChannel, WhatsAppChannel } from './channels/notificacion-channel.interface';
import { crearEmailChannel, crearWhatsAppChannel } from './channels/channel.factory';

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

type TipoNotificacion =
  | 'recibo_emitido'
  | 'aviso_vencimiento'
  | 'aviso_restriccion'
  | 'folio_tramite'
  | 'prueba';

/**
 * NotificacionesService — envío multicanal real vía canales configurables.
 *
 * Los canales (email/WhatsApp) se resuelven por configuración (channel.factory):
 * consola por defecto (desarrollo) o HTTP a un gateway (producción). Cada envío
 * queda registrado en `notificacion_logs` para trazabilidad (opt-out y auditoría).
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);
  private readonly email: EmailChannel = crearEmailChannel();
  private readonly whatsapp: WhatsAppChannel = crearWhatsAppChannel();

  constructor(private readonly prisma: PrismaService) {}

  // ─── Envío de bajo nivel (con bitácora) ───────────────────────────────────

  async enviarEmail(
    data: NotificacionEmail & { tipo?: TipoNotificacion; contratoId?: string },
  ): Promise<{ enviado: boolean; proveedor: string }> {
    const res = await this.email.enviar({
      destinatario: data.destinatario,
      asunto: data.asunto,
      cuerpoHtml: data.cuerpo,
    });
    await this.registrar({
      contratoId: data.contratoId,
      canal: 'email',
      tipo: data.tipo ?? 'prueba',
      destinatario: data.destinatario,
      asunto: data.asunto,
      mensaje: data.cuerpo,
      proveedor: res.proveedor,
      enviado: res.enviado,
      referencia: res.referencia,
      error: res.error,
    });
    return { enviado: res.enviado, proveedor: res.proveedor };
  }

  async enviarWhatsApp(
    data: NotificacionWhatsApp & { tipo?: TipoNotificacion; contratoId?: string },
  ): Promise<{ enviado: boolean; proveedor: string }> {
    const res = await this.whatsapp.enviar({ telefono: data.telefono, mensaje: data.mensaje });
    await this.registrar({
      contratoId: data.contratoId,
      canal: 'whatsapp',
      tipo: data.tipo ?? 'prueba',
      destinatario: data.telefono,
      mensaje: data.mensaje,
      proveedor: res.proveedor,
      enviado: res.enviado,
      referencia: res.referencia,
      error: res.error,
    });
    return { enviado: res.enviado, proveedor: res.proveedor };
  }

  private async registrar(data: {
    contratoId?: string;
    canal: string;
    tipo: string;
    destinatario: string;
    asunto?: string;
    mensaje: string;
    proveedor: string;
    enviado: boolean;
    referencia?: string;
    error?: string;
  }) {
    try {
      await this.prisma.notificacionLog.create({
        data: {
          contratoId: data.contratoId ?? null,
          canal: data.canal,
          tipo: data.tipo,
          destinatario: data.destinatario,
          asunto: data.asunto ?? null,
          mensaje: data.mensaje,
          proveedor: data.proveedor,
          enviado: data.enviado,
          referencia: data.referencia ?? null,
          error: data.error ?? null,
        },
      });
    } catch (e: any) {
      this.logger.error(`No se pudo registrar la notificación: ${e?.message}`);
    }
  }

  // ─── Resolución de destinatario del contrato ──────────────────────────────

  private async destinatarioContrato(
    contratoId: string,
  ): Promise<{ email?: string; telefono?: string; nombre?: string }> {
    const roles = await this.prisma.rolPersonaContrato.findMany({
      where: { contratoId, activo: true },
      include: { persona: { select: { nombre: true, email: true, telefono: true } } },
    });
    // Preferencia de destinatario: CONTACTO > PROPIETARIO > FISCAL > resto.
    const prioridad = (rol: string) => {
      const i = ['CONTACTO', 'PROPIETARIO', 'FISCAL'].indexOf(rol);
      return i === -1 ? 99 : i;
    };
    const ordenados = [...roles].sort((a, b) => prioridad(a.rol) - prioridad(b.rol));
    const email = ordenados.find((r) => r.persona.email)?.persona.email ?? undefined;
    const telefono = ordenados.find((r) => r.persona.telefono)?.persona.telefono ?? undefined;
    const nombre = ordenados[0]?.persona.nombre;
    return { email: email ?? undefined, telefono: telefono ?? undefined, nombre };
  }

  // ─── Notificaciones de negocio ────────────────────────────────────────────

  /** Avisa al usuario que su recibo del periodo está disponible. */
  async notificarReciboEmitido(reciboId: string): Promise<{ email: boolean; whatsapp: boolean }> {
    const recibo = await this.prisma.recibo.findUnique({
      where: { id: reciboId },
      include: {
        contrato: { select: { id: true, nombre: true } },
        timbrado: { select: { periodo: true, total: true, uuid: true } },
      },
    });
    if (!recibo) return { email: false, whatsapp: false };

    const dest = await this.destinatarioContrato(recibo.contratoId);
    const total = Number(recibo.saldoVigente) + Number(recibo.saldoVencido);
    const periodo = recibo.timbrado?.periodo ?? '';
    const asunto = `Recibo de agua ${periodo} — ${recibo.contrato.nombre}`;
    const cuerpo =
      `<p>Estimado usuario,</p>` +
      `<p>Su recibo del periodo <strong>${periodo}</strong> ya está disponible.</p>` +
      `<ul><li>Total a pagar: <strong>$${total.toFixed(2)}</strong></li>` +
      `<li>Vencimiento: <strong>${recibo.fechaVencimiento}</strong></li>` +
      (recibo.timbrado?.uuid ? `<li>CFDI: ${recibo.timbrado.uuid}</li>` : '') +
      `</ul><p>Gracias por su pago oportuno.</p>`;
    const msgWa =
      `💧 Su recibo de agua del periodo ${periodo} está listo. ` +
      `Total: $${total.toFixed(2)}. Vence: ${recibo.fechaVencimiento}. ` +
      `Pague en línea o en puntos autorizados.`;

    let email = false;
    let whatsapp = false;
    if (dest.email) {
      email = (await this.enviarEmail({ destinatario: dest.email, asunto, cuerpo, tipo: 'recibo_emitido', contratoId: recibo.contratoId })).enviado;
    }
    if (dest.telefono) {
      whatsapp = (await this.enviarWhatsApp({ telefono: dest.telefono, mensaje: msgWa, tipo: 'recibo_emitido', contratoId: recibo.contratoId })).enviado;
    }
    return { email, whatsapp };
  }

  /** Aviso de vencimiento próximo/vencido. */
  async notificarVencimiento(reciboId: string): Promise<{ email: boolean; whatsapp: boolean }> {
    const recibo = await this.prisma.recibo.findUnique({
      where: { id: reciboId },
      include: { contrato: { select: { id: true, nombre: true } }, timbrado: { select: { periodo: true } } },
    });
    if (!recibo) return { email: false, whatsapp: false };
    const dest = await this.destinatarioContrato(recibo.contratoId);
    const total = Number(recibo.saldoVigente) + Number(recibo.saldoVencido);
    const periodo = recibo.timbrado?.periodo ?? '';
    const asunto = `Aviso de vencimiento — recibo ${periodo}`;
    const cuerpo =
      `<p>Le recordamos que su recibo del periodo <strong>${periodo}</strong> ` +
      `por <strong>$${total.toFixed(2)}</strong> vence el <strong>${recibo.fechaVencimiento}</strong>.</p>` +
      `<p>Evite recargos y restricciones realizando su pago a tiempo. ` +
      `Si ya pagó, ignore este mensaje.</p>`;
    const msgWa =
      `⚠️ Recordatorio: su recibo de agua ${periodo} ($${total.toFixed(2)}) vence el ${recibo.fechaVencimiento}. ` +
      `Pague para evitar recargos. Si requiere un convenio de pago, contáctenos.`;

    let email = false;
    let whatsapp = false;
    if (dest.email) {
      email = (await this.enviarEmail({ destinatario: dest.email, asunto, cuerpo, tipo: 'aviso_vencimiento', contratoId: recibo.contratoId })).enviado;
    }
    if (dest.telefono) {
      whatsapp = (await this.enviarWhatsApp({ telefono: dest.telefono, mensaje: msgWa, tipo: 'aviso_vencimiento', contratoId: recibo.contratoId })).enviado;
    }
    return { email, whatsapp };
  }

  /**
   * Aviso previo de restricción de servicio a mínimo vital (LGA dic-2025).
   * Se envía al programar la restricción — el usuario debe ser notificado antes
   * de cualquier limitación del suministro.
   */
  async notificarRestriccionProgramada(params: {
    contratoId: string;
    fechaProgramada: string;
    adeudo: number;
  }): Promise<{ email: boolean; whatsapp: boolean }> {
    const dest = await this.destinatarioContrato(params.contratoId);
    const asunto = 'Aviso de restricción de servicio por adeudo';
    const cuerpo =
      `<p>Le informamos que, por adeudo de <strong>$${params.adeudo.toFixed(2)}</strong>, ` +
      `se programó una <strong>restricción de flujo</strong> de su servicio de agua para el ` +
      `<strong>${params.fechaProgramada}</strong>.</p>` +
      `<p>Conforme a la Ley General de Aguas, su suministro <strong>no será cortado</strong>: ` +
      `se garantizará el mínimo vital. Para evitar la restricción, pague su adeudo o ` +
      `solicite un convenio de pago antes de la fecha indicada.</p>`;
    const msgWa =
      `⚠️ Aviso: por adeudo de $${params.adeudo.toFixed(2)} se programó una restricción de flujo ` +
      `de su servicio de agua para el ${params.fechaProgramada}. Su suministro NO será cortado ` +
      `(se garantiza el mínimo vital). Evítela pagando o solicitando un convenio de pago.`;

    let email = false;
    let whatsapp = false;
    if (dest.email) {
      email = (await this.enviarEmail({ destinatario: dest.email, asunto, cuerpo, tipo: 'aviso_restriccion', contratoId: params.contratoId })).enviado;
    }
    if (dest.telefono) {
      whatsapp = (await this.enviarWhatsApp({ telefono: dest.telefono, mensaje: msgWa, tipo: 'aviso_restriccion', contratoId: params.contratoId })).enviado;
    }
    return { email, whatsapp };
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
      await this.enviarEmail({ destinatario: email, asunto: `Folio de trámite: ${folio}`, cuerpo: `<p>${msg}</p>`, tipo: 'folio_tramite', folio });
    }
    if (telefono) {
      await this.enviarWhatsApp({ telefono, mensaje: msg, tipo: 'folio_tramite', folio });
    }
  }

  // ─── Consulta de bitácora ─────────────────────────────────────────────────

  async listarLogs(params: { contratoId?: string; canal?: string; tipo?: string; limit?: number }) {
    return this.prisma.notificacionLog.findMany({
      where: {
        ...(params.contratoId && { contratoId: params.contratoId }),
        ...(params.canal && { canal: params.canal }),
        ...(params.tipo && { tipo: params.tipo }),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }
}
