import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Webhooks de eventos de negocio para integraciones externas y apps
 * ciudadanas (API pública, P1.12 del análisis state-of-the-art).
 *
 * Eventos soportados: `pago.aplicado`, `recibo.emitido`, `lectura.capturada`.
 * Cada entrega firma el body con HMAC-SHA256 (header `X-Hydra-Signature`,
 * hex) usando el secreto de la suscripción, para que el receptor verifique
 * autenticidad. La emisión es fire-and-forget: un webhook caído JAMÁS afecta
 * el flujo de negocio; los fallos quedan en `webhook_entregas` y un cron los
 * reintenta con backoff implícito (cada 15 min, máximo MAX_INTENTOS).
 *
 *   HYDRA_JOBS_ENABLED   = true | false (master switch, default false)
 *   JOB_WEBHOOKS_CRON    = cron de reintentos (default cada 15 min)
 *   WEBHOOK_TIMEOUT_MS   = timeout por entrega (default 5000)
 */

export const EVENTOS_WEBHOOK = ['pago.aplicado', 'recibo.emitido', 'lectura.capturada'] as const;
export type EventoWebhook = (typeof EVENTOS_WEBHOOK)[number];

const MAX_INTENTOS = 5;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  private jobsHabilitados(): boolean {
    return (process.env.HYDRA_JOBS_ENABLED ?? 'false').toLowerCase() === 'true';
  }

  // ─── Emisión (llamada desde los servicios de negocio) ─────────────────────

  /**
   * Emite un evento a todas las suscripciones activas que lo escuchan.
   * Nunca lanza y no bloquea: registra las entregas y las dispara en
   * background.
   */
  async emitir(evento: EventoWebhook, payload: Record<string, unknown>): Promise<void> {
    try {
      const suscripciones = await this.prisma.webhookSuscripcion.findMany({
        where: { activo: true, eventos: { has: evento } },
        select: { id: true },
      });
      if (suscripciones.length === 0) return;

      const cuerpo = { evento, emitidoEn: new Date().toISOString(), datos: payload };
      const entregas = await Promise.all(
        suscripciones.map((s) =>
          this.prisma.webhookEntrega.create({
            data: { suscripcionId: s.id, evento, payload: cuerpo as never },
            select: { id: true },
          }),
        ),
      );
      // Disparo en background; los fallos quedan para el cron de reintentos.
      for (const e of entregas) {
        void this.intentarEntrega(e.id).catch(() => undefined);
      }
    } catch (e: any) {
      this.logger.warn(`emitir(${evento}) falló sin afectar el flujo: ${e?.message}`);
    }
  }

  /** Ejecuta (o reintenta) una entrega puntual. */
  private async intentarEntrega(entregaId: string): Promise<void> {
    const entrega = await this.prisma.webhookEntrega.findUnique({
      where: { id: entregaId },
      include: { suscripcion: { select: { url: true, secreto: true, activo: true } } },
    });
    if (!entrega || entrega.estado === 'entregada' || !entrega.suscripcion.activo) return;
    if (entrega.intentos >= MAX_INTENTOS) return;

    const body = JSON.stringify(entrega.payload);
    const firma = createHmac('sha256', entrega.suscripcion.secreto).update(body).digest('hex');
    const timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 5_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(entrega.suscripcion.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hydra-Event': entrega.evento,
          'X-Hydra-Signature': firma,
          'X-Hydra-Delivery': entrega.id,
        },
        body,
        signal: controller.signal,
      });
      statusCode = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e: any) {
      error = e?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : (e?.message ?? 'error de red');
    } finally {
      clearTimeout(timer);
    }

    const exito = statusCode !== null && statusCode >= 200 && statusCode < 300;
    await this.prisma.webhookEntrega.update({
      where: { id: entrega.id },
      data: {
        intentos: { increment: 1 },
        statusCode,
        error: exito ? null : error,
        estado: exito ? 'entregada' : entrega.intentos + 1 >= MAX_INTENTOS ? 'fallida' : 'pendiente',
        ...(exito && { entregadaEn: new Date() }),
      },
    });
  }

  // ─── Reintentos programados ────────────────────────────────────────────────

  @Cron(process.env.JOB_WEBHOOKS_CRON ?? '*/15 * * * *', { name: 'webhooks-reintentos' })
  async cronReintentos() {
    if (!this.jobsHabilitados()) return;
    await this.reintentarPendientes();
  }

  async reintentarPendientes() {
    const pendientes = await this.prisma.webhookEntrega.findMany({
      where: { estado: 'pendiente', intentos: { gt: 0, lt: MAX_INTENTOS } },
      select: { id: true },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });
    for (const p of pendientes) {
      await this.intentarEntrega(p.id).catch(() => undefined);
    }
    return { reintentadas: pendientes.length };
  }

  // ─── CRUD de suscripciones ─────────────────────────────────────────────────

  listarSuscripciones() {
    return this.prisma.webhookSuscripcion.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        nombre: true,
        url: true,
        eventos: true,
        activo: true,
        createdAt: true,
        // secreto NO se devuelve: solo se muestra una vez al crear
      },
    });
  }

  async crearSuscripcion(params: { nombre: string; url: string; eventos: string[] }) {
    const invalidos = params.eventos.filter((e) => !EVENTOS_WEBHOOK.includes(e as EventoWebhook));
    if (invalidos.length > 0) {
      throw new NotFoundException(
        `Eventos no soportados: ${invalidos.join(', ')} (soportados: ${EVENTOS_WEBHOOK.join(', ')})`,
      );
    }
    const secreto = randomBytes(32).toString('hex');
    const s = await this.prisma.webhookSuscripcion.create({
      data: { nombre: params.nombre, url: params.url, eventos: params.eventos, secreto },
    });
    // El secreto solo viaja en esta respuesta; guárdelo el integrador.
    return { id: s.id, nombre: s.nombre, url: s.url, eventos: s.eventos, secreto };
  }

  async actualizarSuscripcion(
    id: string,
    params: { nombre?: string; url?: string; eventos?: string[]; activo?: boolean },
  ) {
    const existe = await this.prisma.webhookSuscripcion.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new NotFoundException('Suscripción no encontrada');
    return this.prisma.webhookSuscripcion.update({
      where: { id },
      data: params,
      select: { id: true, nombre: true, url: true, eventos: true, activo: true },
    });
  }

  async eliminarSuscripcion(id: string) {
    const existe = await this.prisma.webhookSuscripcion.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new NotFoundException('Suscripción no encontrada');
    await this.prisma.webhookSuscripcion.delete({ where: { id } });
    return { eliminada: true };
  }

  /** Envía un evento de prueba a la suscripción (verificación del integrador). */
  async probarSuscripcion(id: string) {
    const s = await this.prisma.webhookSuscripcion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Suscripción no encontrada');
    const entrega = await this.prisma.webhookEntrega.create({
      data: {
        suscripcionId: s.id,
        evento: 'prueba',
        payload: { evento: 'prueba', emitidoEn: new Date().toISOString(), datos: { mensaje: 'Hydra webhook OK' } },
      },
      select: { id: true },
    });
    await this.intentarEntrega(entrega.id);
    return this.prisma.webhookEntrega.findUnique({ where: { id: entrega.id } });
  }

  listarEntregas(params: { suscripcionId?: string; evento?: string; estado?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 200);
    const where = {
      ...(params.suscripcionId && { suscripcionId: params.suscripcionId }),
      ...(params.evento && { evento: params.evento }),
      ...(params.estado && { estado: params.estado }),
    };
    return Promise.all([
      this.prisma.webhookEntrega.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.webhookEntrega.count({ where }),
    ]).then(([data, total]) => ({ data, total, page, limit }));
  }
}
