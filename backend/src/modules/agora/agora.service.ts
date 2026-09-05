import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AgoraConfig,
  AgoraTicketResponse,
  CrearTicketDto,
  agoraConfig,
  agoraConfigurado,
  construirPayloadTicket,
  displayIdDeRespuesta,
  mapEstadoFromAgora,
  refDeRespuesta,
  transicionAgora,
} from './agora.config';

type AgoraTicketRow = Awaited<ReturnType<PrismaService['agoraTicket']['create']>>;

/**
 * AgoraService — integración con el sistema de tickets Agora (fork de Chatwoot).
 *
 * Con AGORA_API_URL/API_TOKEN/ACCOUNT_ID presentes habla con la API real
 * (`/api/v1/accounts/:account_id/tickets`, header `api_access_token`) y guarda
 * una copia local en `agora_tickets`. Sin configuración conserva el modo
 * simulado histórico (`_mock: true`), que no hace ninguna llamada de red.
 */
@Injectable()
export class AgoraService {
  private readonly logger = new Logger(AgoraService.name);
  private readonly config: AgoraConfig = agoraConfig();

  constructor(private readonly prisma: PrismaService) {}

  private isConfigured(): boolean {
    return agoraConfigurado(this.config);
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private get ticketsPath(): string {
    return `${this.config.baseUrl}/api/v1/accounts/${this.config.accountId}/tickets`;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          api_access_token: this.config.apiToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(`No se pudo contactar a Agora (${method} ${url}): ${motivo}`);
    } finally {
      clearTimeout(timer);
    }

    const texto = await res.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      // cuerpo no-JSON (p. ej. HTML de un proxy) — se reporta abajo
    }

    if (!res.ok) {
      const detalle =
        (json && typeof json === 'object' && 'error' in json
          ? String((json as { error: unknown }).error)
          : texto.slice(0, 300)) || res.statusText;
      throw new BadGatewayException(`Agora respondió ${res.status}: ${detalle}`);
    }
    return json as T;
  }

  // ── Operaciones ───────────────────────────────────────────────────────────

  async createTicket(dto: CrearTicketDto) {
    if (!this.isConfigured()) {
      const ticket = await this.prisma.agoraTicket.create({
        data: {
          contratoId: dto.contratoId ?? null,
          tramiteId: dto.tramiteId ?? null,
          quejaId: dto.quejaId ?? null,
          agoraRef: `AGORA-MOCK-${Date.now()}`,
          titulo: dto.titulo,
          descripcion: dto.descripcion,
          prioridad: dto.prioridad ?? 'Media',
          creadoPor: dto.creadoPor,
          datosEnvio: dto as object,
          respuesta: { mock: true, message: 'Ticket creado en modo mock' },
        },
      });
      return { ...ticket, _mock: true };
    }

    const payload = construirPayloadTicket(dto, this.config);
    // Si Agora falla NO se escribe fila local: no se finge un ticket inexistente.
    const respuesta = await this.request<AgoraTicketResponse>('POST', this.ticketsPath, payload);

    const ticket = await this.prisma.agoraTicket.create({
      data: {
        contratoId: dto.contratoId ?? null,
        tramiteId: dto.tramiteId ?? null,
        quejaId: dto.quejaId ?? null,
        agoraRef: refDeRespuesta(respuesta),
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        estado: mapEstadoFromAgora(respuesta?.status) ?? 'Abierto',
        prioridad: dto.prioridad ?? 'Media',
        creadoPor: dto.creadoPor,
        datosEnvio: payload as object,
        respuesta: (respuesta ?? {}) as object,
      },
    });
    return ticket;
  }

  /**
   * Crea en Agora la ORDEN DE INSPECCIÓN de una solicitud (junta CEA 02-sep:
   * la información de la inspección llega por el servicio que lleva la orden).
   * Los campos a levantar viajan como custom_attributes vacíos que el inspector
   * llena en Agora; Hydra los recibe con syncInspeccionDesdeAgora.
   * Devuelve el display_id (clave de lookup de la API de Agora) o null en mock.
   */
  async crearOrdenInspeccion(params: {
    solicitudId: string;
    folio: string;
    domicilio: string;
    tipoContratacion: string;
    camposRequeridos: string[];
    creadoPor: string;
  }): Promise<{ displayId: string | null; ref: string | null; mock: boolean }> {
    const dto: CrearTicketDto = {
      titulo: `Orden de inspección — ${params.folio}`,
      descripcion:
        `Inspección de campo para la solicitud ${params.folio}.\n` +
        `Domicilio: ${params.domicilio}\n` +
        `Tipo de contratación: ${params.tipoContratacion}\n` +
        `Datos a levantar: ${params.camposRequeridos.join(', ') || '—'}`,
      prioridad: 'Media',
      creadoPor: params.creadoPor,
      customAttributes: {
        hydra_tipo: 'orden_inspeccion',
        hydra_solicitud_id: params.solicitudId,
        hydra_folio: params.folio,
        inspeccion_campos: params.camposRequeridos.join(','),
        // Placeholders que llena el inspector en Agora:
        material_calle: '',
        material_banqueta: '',
        diametro_toma: '',
        diametro_descarga: '',
        metros_toma: '',
        metros_descarga: '',
        tiene_medidor: '',
        tipo_medidor: '',
        realizada: '',
        motivo_no_realizada: '',
      },
    };

    if (!this.isConfigured()) {
      const ticket = await this.createTicket(dto);
      return { displayId: null, ref: (ticket as { agoraRef?: string }).agoraRef ?? null, mock: true };
    }

    const payload = construirPayloadTicket(dto, this.config);
    const respuesta = await this.request<AgoraTicketResponse>('POST', this.ticketsPath, payload);
    await this.prisma.agoraTicket.create({
      data: {
        agoraRef: refDeRespuesta(respuesta),
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        estado: mapEstadoFromAgora(respuesta?.status) ?? 'Abierto',
        prioridad: dto.prioridad ?? 'Media',
        creadoPor: dto.creadoPor,
        datosEnvio: payload as object,
        respuesta: (respuesta ?? {}) as object,
      },
    });
    return {
      displayId: displayIdDeRespuesta(respuesta),
      ref: refDeRespuesta(respuesta),
      mock: false,
    };
  }

  /** Lee un ticket de Agora por display_id (la clave que usa su API de lookup). */
  async getTicketPorDisplayId(displayId: string): Promise<AgoraTicketResponse> {
    if (!this.isConfigured()) {
      throw new BadGatewayException('Agora no está configurado (AGORA_API_URL/TOKEN/ACCOUNT_ID)');
    }
    return this.request<AgoraTicketResponse>('GET', `${this.ticketsPath}/${encodeURIComponent(displayId)}`);
  }

  async findOne(id: string) {
    const ticket = await this.prisma.agoraTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    return this.marcarMock(ticket);
  }

  async findAll(params: { contratoId?: string; estado?: string }) {
    const tickets = await this.prisma.agoraTicket.findMany({
      where: {
        ...(params.contratoId && { contratoId: params.contratoId }),
        ...(params.estado && { estado: params.estado }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return tickets.map((t) => this.marcarMock(t));
  }

  /** Relee el ticket en Agora y actualiza el estado local. */
  async syncFromAgora(id: string) {
    const local = await this.prisma.agoraTicket.findUnique({ where: { id } });
    if (!local) throw new NotFoundException('Ticket no encontrado');
    if (!this.isConfigured()) return this.marcarMock(local);

    const displayId = this.displayIdLocal(local);
    if (!displayId) {
      throw new BadGatewayException(
        'El ticket no tiene display_id de Agora; fue creado en modo simulado y no puede sincronizarse',
      );
    }

    const remoto = await this.request<AgoraTicketResponse>(
      'GET',
      `${this.ticketsPath}/${encodeURIComponent(displayId)}`,
    );
    const estado = mapEstadoFromAgora(remoto?.status) ?? local.estado;

    return this.prisma.agoraTicket.update({
      where: { id },
      data: {
        estado,
        agoraRef: refDeRespuesta(remoto) ?? local.agoraRef,
        respuesta: (remoto ?? {}) as object,
      },
    });
  }

  /**
   * Actualiza el estado local y, si hay integración real y el estado tiene una
   * transición expuesta por Agora, la empuja. El push es best-effort: un fallo
   * se registra pero no revierte el cambio local.
   */
  async updateEstado(id: string, estado: string) {
    const local = await this.prisma.agoraTicket.findUnique({ where: { id } });
    if (!local) throw new NotFoundException('Ticket no encontrado');

    if (this.isConfigured()) {
      const accion = transicionAgora(estado);
      const displayId = this.displayIdLocal(local);
      if (accion && displayId) {
        try {
          await this.request(
            'POST',
            `${this.ticketsPath}/${encodeURIComponent(displayId)}/${accion}`,
            {},
          );
        } catch (err) {
          const motivo = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `No se pudo propagar "${estado}" (${accion}) del ticket ${id} a Agora: ${motivo}`,
          );
        }
      }
    }

    return this.prisma.agoraTicket.update({ where: { id }, data: { estado } });
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  /**
   * El disparador genérico de webhooks de Agora no envía headers propios
   * (`Webhooks::Trigger#perform_request`), así que el secreto puede llegar por
   * el header `x-agora-webhook-secret` o por `?token=` en la URL registrada.
   */
  verificarWebhookSecret(recibido?: string | null): void {
    const esperado = this.config.webhookSecret;
    if (!esperado || !recibido) throw new UnauthorizedException('Webhook no autorizado');
    const a = Buffer.from(esperado, 'utf8');
    const b = Buffer.from(recibido, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Webhook no autorizado');
    }
  }

  /**
   * Procesa un evento de Agora. Devuelve null cuando el evento no referencia un
   * ticket conocido (el controlador responde 204 sin efectos).
   * Payload: `{ ticket: { display_id, folio, status, … }, event }`
   * (automation_rules/ticket_action_service.rb:296-330).
   */
  async procesarWebhook(body: unknown): Promise<{ id: string; estado: string } | null> {
    if (!body || typeof body !== 'object') return null;
    const raiz = body as Record<string, unknown>;
    const nodo =
      raiz.ticket && typeof raiz.ticket === 'object'
        ? (raiz.ticket as Record<string, unknown>)
        : raiz;

    const refs: string[] = [];
    if (typeof nodo.folio === 'string' && nodo.folio.trim()) refs.push(nodo.folio);
    if (nodo.display_id != null) refs.push(String(nodo.display_id));
    if (refs.length === 0) return null;

    const estado = mapEstadoFromAgora(typeof nodo.status === 'string' ? nodo.status : null);
    if (!estado) return null;

    const local = await this.prisma.agoraTicket.findFirst({
      where: { agoraRef: { in: refs } },
      orderBy: { createdAt: 'desc' },
    });
    if (!local) return null;

    const actualizado = await this.prisma.agoraTicket.update({
      where: { id: local.id },
      data: { estado, respuesta: nodo as object },
    });
    this.logger.log(
      `Webhook Agora ${String(raiz.event ?? 'sin evento')}: ticket ${actualizado.id} → ${estado}`,
    );
    return { id: actualizado.id, estado: actualizado.estado };
  }

  /**
   * Si el payload del webhook corresponde a una ORDEN DE INSPECCIÓN de Hydra,
   * devuelve su solicitudId y si el ticket llegó resuelto/cerrado o con la
   * inspección marcada (realizada con valor). El sync posterior es idempotente,
   * así que ante la duda conviene sincronizar.
   */
  extraerOrdenInspeccion(body: unknown): { solicitudId: string; listo: boolean } | null {
    if (!body || typeof body !== 'object') return null;
    const raiz = body as Record<string, unknown>;
    const nodo =
      raiz.ticket && typeof raiz.ticket === 'object'
        ? (raiz.ticket as Record<string, unknown>)
        : raiz;
    const attrs = (nodo.custom_attributes ?? {}) as Record<string, unknown>;
    if (attrs.hydra_tipo !== 'orden_inspeccion') return null;
    const solicitudId = typeof attrs.hydra_solicitud_id === 'string' ? attrs.hydra_solicitud_id : null;
    if (!solicitudId) return null;
    const status = typeof nodo.status === 'string' ? nodo.status.toLowerCase() : '';
    const realizada = String(attrs.realizada ?? '').trim() !== '';
    return { solicitudId, listo: ['resolved', 'closed'].includes(status) || realizada };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** display_id guardado en la respuesta de Agora (lookup del controlador Rails). */
  private displayIdLocal(ticket: AgoraTicketRow): string | null {
    const respuesta = ticket.respuesta as AgoraTicketResponse | null;
    return displayIdDeRespuesta(respuesta);
  }

  /** Marca las filas creadas sin integración real para que la UI lo indique. */
  private marcarMock(ticket: AgoraTicketRow) {
    const respuesta = ticket.respuesta as { mock?: boolean } | null;
    return respuesta && respuesta.mock === true ? { ...ticket, _mock: true } : ticket;
  }
}
