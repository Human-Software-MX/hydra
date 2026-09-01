/**
 * Configuración y mapeos de la integración con Agora (fork de Chatwoot).
 *
 * Hydra consume la API REST de Agora `/api/v1/accounts/:account_id/tickets`
 * (autenticación por header `api_access_token`). Cuando AGORA_API_URL /
 * AGORA_API_TOKEN / AGORA_ACCOUNT_ID no están configurados, el módulo cae al
 * modo simulado (`_mock: true`) y sólo escribe la tabla local `agora_tickets`.
 *
 * Los mapeos viven aquí, como funciones puras, para poder probarlos sin HTTP.
 */
export interface AgoraConfig {
  baseUrl: string;
  apiToken: string;
  accountId: string;
  /** Secreto compartido para validar POST /agora/webhook. */
  webhookSecret: string;
  /** Timeout por request HTTP a Agora, en ms. */
  httpTimeoutMs: number;
  /**
   * `Ticket` valida presencia de `ticket_category_id` y `ticket_subcategory_id`
   * (app/models/ticket.rb:145-146), así que los tickets creados desde Hydra
   * necesitan una categoría/subcategoría por defecto de la cuenta de Agora.
   */
  defaultCategoryId: string;
  defaultSubcategoryId: string;
}

export function agoraConfig(): AgoraConfig {
  return {
    baseUrl: (process.env.AGORA_API_URL ?? '').replace(/\/+$/, ''),
    apiToken: process.env.AGORA_API_TOKEN ?? '',
    accountId: process.env.AGORA_ACCOUNT_ID ?? '',
    webhookSecret: process.env.AGORA_WEBHOOK_SECRET ?? '',
    httpTimeoutMs: Number(process.env.AGORA_HTTP_TIMEOUT_MS ?? 10_000),
    defaultCategoryId: process.env.AGORA_DEFAULT_CATEGORY_ID ?? '',
    defaultSubcategoryId: process.env.AGORA_DEFAULT_SUBCATEGORY_ID ?? '',
  };
}

/** La integración real sólo se activa con URL + token + cuenta. */
export function agoraConfigurado(cfg: AgoraConfig): boolean {
  return Boolean(cfg.baseUrl && cfg.apiToken && cfg.accountId);
}

// ── Mapeos de enums (db/schema.rb:23-27, app/models/ticket.rb:74-120) ────────

/** `ticket_status` de Agora → estado en español de Hydra (mapa canónico). */
export const ESTADO_AGORA_A_HYDRA: Record<string, string> = {
  open: 'Abierto',
  in_progress: 'En Progreso',
  escalated: 'Escalado',
  waiting_client: 'Esperando Cliente',
  waiting_internal: 'Esperando Interno',
  resolved: 'Resuelto',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
};

/** Inverso de ESTADO_AGORA_A_HYDRA — se deriva para que no puedan divergir. */
export const ESTADO_HYDRA_A_AGORA: Record<string, string> = Object.fromEntries(
  Object.entries(ESTADO_AGORA_A_HYDRA).map(([agora, hydra]) => [hydra, agora]),
);

/** `ticket_priority` de Agora ← prioridad en español de Hydra. */
export const PRIORIDAD_HYDRA_A_AGORA: Record<string, string> = {
  Baja: 'low',
  Media: 'medium',
  Alta: 'high',
  Urgente: 'urgent',
};

export const PRIORIDAD_AGORA_A_HYDRA: Record<string, string> = Object.fromEntries(
  Object.entries(PRIORIDAD_HYDRA_A_AGORA).map(([hydra, agora]) => [agora, hydra]),
);

/**
 * `ticket_channel` no tiene valor `api` (db/schema.rb:23): los valores son
 * whatsapp, web_chat, email, phone, in_person, mobile_app, app_cea y
 * whatsapp_gob. `web_chat` es además el default del controlador para orígenes
 * sin inbox (tickets_controller.rb:473), así que es el que usa Hydra.
 */
export const AGORA_CHANNEL = 'web_chat';

export function mapPrioridadToAgora(prioridad?: string | null): string {
  if (!prioridad) return 'medium';
  return PRIORIDAD_HYDRA_A_AGORA[prioridad] ?? 'medium';
}

export function mapPrioridadFromAgora(prioridad?: string | null): string {
  if (!prioridad) return 'Media';
  return PRIORIDAD_AGORA_A_HYDRA[prioridad] ?? 'Media';
}

export function mapEstadoFromAgora(status?: string | null): string | null {
  if (!status) return null;
  return ESTADO_AGORA_A_HYDRA[status] ?? null;
}

export function mapEstadoToAgora(estado?: string | null): string | null {
  if (!estado) return null;
  return ESTADO_HYDRA_A_AGORA[estado] ?? null;
}

/**
 * Estado de Hydra → acción `member` del controlador de Agora
 * (config/routes.rb:409-415 + tickets_controller.rb:91-111). Los estados sin
 * transición expuesta (escalado, esperas, cancelado) devuelven null: se
 * guardan sólo en local.
 */
export function transicionAgora(estado: string): 'resolve' | 'close' | 'reopen' | null {
  switch (estado) {
    case 'Resuelto':
      return 'resolve';
    case 'Cerrado':
      return 'close';
    case 'Abierto':
      return 'reopen';
    default:
      return null;
  }
}

export interface CrearTicketDto {
  contratoId?: string;
  tramiteId?: string;
  quejaId?: string;
  titulo: string;
  descripcion: string;
  prioridad?: string;
  creadoPor: string;
  /**
   * Número de contrato CEA. OJO: Agora lo valida contra el servicio SOAP de la
   * CEA y responde 422 si no existe (tickets_controller.rb:29-36), por eso sólo
   * se envía cuando quien llama lo proporciona explícitamente.
   */
  ceaContractNumber?: string;
}

export interface AgoraTicketPayload {
  ticket: Record<string, unknown>;
}

/**
 * Construye el cuerpo de POST .../tickets. Sólo usa campos permitidos por
 * `ticket_params` (tickets_controller.rb:434-463).
 */
export function construirPayloadTicket(
  dto: CrearTicketDto,
  cfg: Pick<AgoraConfig, 'defaultCategoryId' | 'defaultSubcategoryId'>,
): AgoraTicketPayload {
  const customAttributes: Record<string, unknown> = { origen: 'hydra' };
  if (dto.contratoId) customAttributes.hydra_contrato_id = dto.contratoId;
  if (dto.tramiteId) customAttributes.hydra_tramite_id = dto.tramiteId;
  if (dto.quejaId) customAttributes.hydra_queja_id = dto.quejaId;

  const ticket: Record<string, unknown> = {
    title: dto.titulo,
    description: dto.descripcion,
    priority: mapPrioridadToAgora(dto.prioridad),
    channel: AGORA_CHANNEL,
    custom_attributes: customAttributes,
  };

  if (cfg.defaultCategoryId) ticket.ticket_category_id = cfg.defaultCategoryId;
  if (cfg.defaultSubcategoryId) ticket.ticket_subcategory_id = cfg.defaultSubcategoryId;
  if (dto.ceaContractNumber) ticket.contract_number = dto.ceaContractNumber;

  return { ticket };
}

/** Forma (parcial) de la respuesta de Agora — `tickets/_ticket.json.jbuilder`. */
export interface AgoraTicketResponse {
  id?: number;
  display_id?: number;
  folio?: string;
  title?: string;
  status?: string;
  priority?: string;
  [key: string]: unknown;
}

/** Referencia que Hydra guarda en `agora_ref`: folio, con display_id de respaldo. */
export function refDeRespuesta(res: AgoraTicketResponse | null | undefined): string | null {
  if (!res) return null;
  if (typeof res.folio === 'string' && res.folio.trim()) return res.folio;
  if (res.display_id != null) return String(res.display_id);
  return null;
}

/**
 * Identificador de lookup en Agora: el controlador busca por `display_id`
 * (`find_by!(display_id: params[:id])`, tickets_controller.rb:388), no por id
 * interno ni por folio.
 */
export function displayIdDeRespuesta(res: AgoraTicketResponse | null | undefined): string | null {
  if (!res || res.display_id == null) return null;
  return String(res.display_id);
}
