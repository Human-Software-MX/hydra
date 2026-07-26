import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { supraConfig, SupraConfig } from './supra.config';

/** Error normalizado de la API /v1 de SUPRA (envelope plano {type:"error",...}). */
export class SupraApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly param?: string,
    public readonly retryable = false,
    /** ms sugeridos por el header Retry-After de un 429 (si vino). */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SupraApiError';
  }
}

// ── Formas de recurso del engine (subset usado por Hydra) ────────────────────

export interface SupraList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface SupraCustomer {
  object: 'customer';
  id: string;
  name: string;
  email: string | null;
  external_ref: string | null;
  status: string;
  created_at: string;
}

export interface SupraObligation {
  object: 'obligation';
  id: string;
  customer: string;
  type: string;
  amount_due_minor: string;
  amount_settled_minor: string;
  currency: string;
  status: 'issued' | 'partially_settled' | 'settled' | 'canceled' | 'written_off';
  due_at: string | null;
  external_ref: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface SupraAllocation {
  id: string;
  obligation: string;
  amount: string;
}

export interface SupraPayment {
  object: 'payment';
  id: string;
  customer: string;
  amount: string;
  currency: string;
  source: string;
  status: string;
  received_at: string;
  external_ref: string | null;
  allocations?: SupraAllocation[];
  excess?: string;
  created_at: string;
}

export interface SupraInstallment {
  object: 'installment';
  id: string;
  sequence: number;
  obligation: string;
  amount: string;
  due_at: string;
  status: 'issued' | 'partially_settled' | 'settled' | 'canceled';
  is_down_payment: boolean;
}

export interface SupraPaymentPlan {
  object: 'payment_plan';
  id: string;
  customer: string;
  source_obligation: string;
  total_amount: string;
  currency: string;
  installment_count: number;
  status: 'active' | 'completed' | 'canceled' | 'defaulted';
  grace_days: number;
  default_after_missed: number | null;
  created_at: string;
  installments?: SupraInstallment[];
}

export interface SupraPaymentLink {
  object: string;
  id: string;
  obligation?: string;
  amount?: string;
  currency?: string;
  status: string;
  token: string;
  url_path: string;
  description?: string | null;
  expires_at?: string | null;
  created_at?: string;
}

export interface SupraBalance {
  object: 'customer_balance';
  customer: string;
  currency: string;
  credit_available: string;
  receivable_balance: string;
}

/** Envelope de evento del log replayable de SUPRA (`GET /v1/events`). */
export interface SupraEventoRemoto {
  object?: string;
  id: string;
  type: string;
  created: string;
  tenant_id: string;
  data: Record<string, unknown>;
  sequence?: number | string;
}

/**
 * Cliente HTTP server-to-server hacia la API /v1 de SUPRA.
 *
 * - Auth: Bearer sk_… (scopes mínimos: customers/obligations/payments r+w).
 * - Idempotencia: header `Idempotency-Key` determinista por operación
 *   (`hydra:pago:<id>`, `hydra:recibo:<id>`, …) — el retry es siempre seguro.
 * - Errores: envelope plano {type:"error", code, message, param, retryable}
 *   → SupraApiError.
 * - El frontend NUNCA usa este cliente; solo el backend de Hydra.
 */
@Injectable()
export class SupraClientService {
  private readonly logger = new Logger(SupraClientService.name);
  readonly config: SupraConfig = supraConfig();

  // ── Circuit breaker de LECTURAS (fail-fast; §E.1 de la auditoría) ──────────
  // Solo aplica a GETs: los POST idempotentes ya tienen outbox/reintentos y
  // nunca deben quedar en fail-fast silencioso.
  private static readonly BREAKER_UMBRAL = 5;
  private static readonly BREAKER_COOLDOWN_MS = 30_000;
  private fallosConsecutivosLectura = 0;
  private breakerAbiertoHasta = 0;

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Lanza 503 si la integración no está habilitada (guard para camino SUPRA). */
  assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException('La integración con SUPRA no está habilitada');
    }
  }

  /**
   * Request con reintentos (§E.1): backoff exponencial + jitter, máx 3 intentos
   * para GETs y POSTs idempotentes (misma Idempotency-Key en cada intento),
   * 429 honrando Retry-After. Los POST sin Idempotency-Key NO se reintentan.
   */
  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    opts?: { idempotencyKey?: string; correlationId?: string },
  ): Promise<T> {
    const esLectura = method === 'GET';
    const reintentable = esLectura || Boolean(opts?.idempotencyKey);
    const maxIntentos = reintentable ? 3 : 1;

    if (esLectura && Date.now() < this.breakerAbiertoHasta) {
      throw new SupraApiError(
        0,
        'circuit_open',
        `SUPRA en fail-fast por fallos consecutivos (cooldown ${SupraClientService.BREAKER_COOLDOWN_MS / 1000}s)`,
        undefined,
        true,
      );
    }

    let ultimoError: unknown;
    for (let intento = 1; intento <= maxIntentos; intento++) {
      try {
        const resultado = await this.requestOnce<T>(method, path, body, opts);
        if (esLectura) this.fallosConsecutivosLectura = 0;
        return resultado;
      } catch (err) {
        ultimoError = err;
        const apiErr = err instanceof SupraApiError ? err : null;
        const transitorio =
          apiErr !== null &&
          (apiErr.status === 0 || apiErr.status === 429 || apiErr.status >= 500 || apiErr.retryable);

        // El breaker solo cuenta indisponibilidad real (red/timeout/5xx).
        if (esLectura && apiErr && (apiErr.status === 0 || apiErr.status >= 500)) {
          this.fallosConsecutivosLectura++;
          if (this.fallosConsecutivosLectura >= SupraClientService.BREAKER_UMBRAL) {
            this.breakerAbiertoHasta = Date.now() + SupraClientService.BREAKER_COOLDOWN_MS;
            this.fallosConsecutivosLectura = 0;
            this.logger.warn(
              `Circuit breaker de lecturas SUPRA abierto por ${SupraClientService.BREAKER_COOLDOWN_MS / 1000}s`,
            );
          }
        }

        if (!transitorio || intento >= maxIntentos) throw err;
        const backoff = Math.min(250 * 2 ** (intento - 1), 2_000) + Math.floor(Math.random() * 250);
        const espera =
          apiErr?.status === 429 && apiErr.retryAfterMs
            ? Math.min(apiErr.retryAfterMs, 5_000)
            : backoff;
        this.logger.warn(
          `SUPRA ${method} ${path} intento ${intento}/${maxIntentos} falló (${apiErr?.code ?? 'error'}); reintento en ${espera}ms`,
        );
        await new Promise((r) => setTimeout(r, espera));
      }
    }
    throw ultimoError;
  }

  private async requestOnce<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    opts?: { idempotencyKey?: string; correlationId?: string },
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          ...(opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
          ...(opts?.correlationId ? { 'x-request-id': opts.correlationId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // cuerpo no-JSON (p. ej. HTML de un proxy) — se maneja abajo
      }
      if (!res.ok) {
        const code = json?.code ?? 'unknown';
        const message = json?.message ?? `HTTP ${res.status} de SUPRA en ${method} ${path}`;
        const retryAfterSec = Number(res.headers?.get?.('retry-after'));
        throw new SupraApiError(
          res.status,
          code,
          message,
          json?.param,
          Boolean(json?.retryable),
          Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : undefined,
        );
      }
      return json as T;
    } catch (err) {
      if (err instanceof SupraApiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SUPRA ${method} ${path} falló: ${msg}`);
      throw new SupraApiError(0, 'provider_unavailable', `SUPRA inaccesible: ${msg}`, undefined, true);
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Customers ───────────────────────────────────────────────────────────────

  async findCustomerByExternalRef(externalRef: string): Promise<SupraCustomer | null> {
    const list = await this.request<SupraList<SupraCustomer>>(
      'GET',
      `/v1/customers?external_ref=${encodeURIComponent(externalRef)}&limit=1`,
    );
    return list.data[0] ?? null;
  }

  createCustomer(input: {
    name: string;
    email?: string;
    external_ref: string;
    metadata?: Record<string, unknown>;
  }): Promise<SupraCustomer> {
    return this.request<SupraCustomer>('POST', '/v1/customers', input, {
      idempotencyKey: input.external_ref,
    });
  }

  getBalance(customerId: string): Promise<SupraBalance> {
    return this.request<SupraBalance>(
      'GET',
      `/v1/customers/${customerId}/balance?currency=${this.config.currency}`,
    );
  }

  // ── Obligations ─────────────────────────────────────────────────────────────

  createObligation(input: {
    customer: string;
    amount_due_minor: string;
    type: string;
    due_at?: string;
    external_ref?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SupraObligation> {
    return this.request<SupraObligation>(
      'POST',
      '/v1/obligations',
      { ...input, currency: this.config.currency },
      { idempotencyKey: input.external_ref },
    );
  }

  cancelObligation(id: string): Promise<SupraObligation> {
    return this.request<SupraObligation>('POST', `/v1/obligations/${id}/cancel`);
  }

  async listObligations(params: {
    customer?: string;
    status?: string;
    limit?: number;
    starting_after?: string;
  }): Promise<SupraList<SupraObligation>> {
    const q = new URLSearchParams();
    if (params.customer) q.set('customer', params.customer);
    if (params.status) q.set('status', params.status);
    q.set('limit', String(params.limit ?? 100));
    if (params.starting_after) q.set('starting_after', params.starting_after);
    return this.request<SupraList<SupraObligation>>('GET', `/v1/obligations?${q.toString()}`);
  }

  /** Obligaciones ABIERTAS de un customer (issued + partially_settled). */
  async listOpenObligations(customerId: string): Promise<SupraObligation[]> {
    const [issued, partial] = await Promise.all([
      this.listObligations({ customer: customerId, status: 'issued' }),
      this.listObligations({ customer: customerId, status: 'partially_settled' }),
    ]);
    return [...issued.data, ...partial.data];
  }

  createPaymentPlan(
    obligationId: string,
    input: {
      schedule?: { amount: string; due_at: string; down_payment?: boolean }[];
      installments?: number;
      interval_days?: number;
      first_due_at?: string;
      grace_days?: number;
      default_after_missed?: number | null;
    },
    idempotencyKey?: string,
  ): Promise<SupraPaymentPlan> {
    return this.request<SupraPaymentPlan>(
      'POST',
      `/v1/obligations/${obligationId}/payment_plan`,
      input,
      { idempotencyKey },
    );
  }

  // ── Payments ────────────────────────────────────────────────────────────────

  recordPayment(input: {
    customer: string;
    amount: string;
    received_at?: string;
    external_ref?: string;
    allocations?: { obligation: string; amount: string }[];
  }): Promise<SupraPayment> {
    return this.request<SupraPayment>(
      'POST',
      '/v1/payments',
      { ...input, currency: this.config.currency },
      { idempotencyKey: input.external_ref },
    );
  }

  getPayment(id: string): Promise<SupraPayment> {
    return this.request<SupraPayment>('GET', `/v1/payments/${id}`);
  }

  /**
   * Devolución de un pago. Puede responder 201 (refund `succeeded`) o —con
   * maker-checker configurado en el tenant (`refund_threshold_minor`)— 202 con
   * un approval_request pendiente que otra API key debe aprobar.
   */
  createRefund(
    paymentId: string,
    input: { amount?: string; reason?: string; external_ref?: string },
  ): Promise<
    | { object: 'refund'; id: string; payment: string; amount: string; status: string }
    | { object: 'approval_request'; id: string; kind: string; status: string; expires_at?: string }
  > {
    return this.request('POST', `/v1/payments/${paymentId}/refunds`, input, {
      idempotencyKey: input.external_ref,
    });
  }

  listPayments(params: {
    customer?: string;
    limit?: number;
    starting_after?: string;
  }): Promise<SupraList<SupraPayment>> {
    const q = new URLSearchParams();
    if (params.customer) q.set('customer', params.customer);
    q.set('limit', String(params.limit ?? 100));
    if (params.starting_after) q.set('starting_after', params.starting_after);
    return this.request<SupraList<SupraPayment>>('GET', `/v1/payments?${q.toString()}`);
  }

  /** Todos los payments de un customer (todas las páginas, cap defensivo). */
  async listAllPaymentsByCustomer(customerId: string): Promise<SupraPayment[]> {
    const out: SupraPayment[] = [];
    let cursor: string | undefined;
    const MAX_PAGINAS = 50;
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const res = await this.listPayments({ customer: customerId, limit: 100, starting_after: cursor });
      out.push(...res.data);
      if (!res.has_more || !res.next_cursor) return out;
      cursor = res.next_cursor;
    }
    this.logger.warn(
      `listAllPaymentsByCustomer(${customerId}): cap de ${MAX_PAGINAS} páginas alcanzado con has_more=true — resultado TRUNCADO`,
    );
    return out;
  }

  /** Todas las obligations de un customer en todos los estados (paginado). */
  async listAllObligationsByCustomer(customerId: string): Promise<SupraObligation[]> {
    const out: SupraObligation[] = [];
    const MAX_PAGINAS = 50;
    for (const status of ['issued', 'partially_settled', 'settled', 'canceled', 'written_off']) {
      let cursor: string | undefined;
      let agotado = false;
      for (let i = 0; i < MAX_PAGINAS; i++) {
        const res = await this.listObligations({
          customer: customerId,
          status,
          limit: 100,
          starting_after: cursor,
        });
        out.push(...res.data);
        if (!res.has_more || !res.next_cursor) {
          agotado = true;
          break;
        }
        cursor = res.next_cursor;
      }
      if (!agotado) {
        this.logger.warn(
          `listAllObligationsByCustomer(${customerId}): cap de ${MAX_PAGINAS} páginas alcanzado en status=${status} — resultado TRUNCADO`,
        );
      }
    }
    return out;
  }

  // ── Events (log replayable de SUPRA — backfill de huecos del inbox) ─────────

  /** Página del log de eventos del tenant a partir de un sequence exclusivo. */
  listEvents(params: { after?: string | number | bigint; limit?: number }): Promise<SupraList<SupraEventoRemoto>> {
    const q = new URLSearchParams();
    if (params.after !== undefined) q.set('after', String(params.after));
    q.set('limit', String(params.limit ?? 100));
    return this.request<SupraList<SupraEventoRemoto>>('GET', `/v1/events?${q.toString()}`);
  }

  // ── Payment plans ───────────────────────────────────────────────────────────

  listPaymentPlans(params: {
    customer?: string;
    limit?: number;
    starting_after?: string;
  }): Promise<SupraList<SupraPaymentPlan>> {
    const q = new URLSearchParams();
    if (params.customer) q.set('customer', params.customer);
    q.set('limit', String(params.limit ?? 100));
    if (params.starting_after) q.set('starting_after', params.starting_after);
    return this.request<SupraList<SupraPaymentPlan>>('GET', `/v1/payment_plans?${q.toString()}`);
  }

  getPaymentPlan(id: string): Promise<SupraPaymentPlan> {
    return this.request<SupraPaymentPlan>('GET', `/v1/payment_plans/${id}`);
  }

  cancelPaymentPlan(id: string): Promise<SupraPaymentPlan & { canceled_installments?: number }> {
    return this.request('POST', `/v1/payment_plans/${id}/cancel`);
  }

  // ── Payment links (checkout alojado /pay/<token>) ───────────────────────────

  createPaymentLink(input: {
    obligation: string;
    description?: string;
    expires_at?: string;
  }): Promise<SupraPaymentLink> {
    return this.request<SupraPaymentLink>('POST', '/v1/payment_links', input);
  }

  getPaymentLink(id: string): Promise<SupraPaymentLink> {
    return this.request<SupraPaymentLink>('GET', `/v1/payment_links/${id}`);
  }

  /** URL pública de checkout para una liga. */
  checkoutUrl(link: SupraPaymentLink): string {
    return `${this.config.publicUrl}${link.url_path ?? `/pay/${link.token}`}`;
  }

  // ── Transferencias bancarias (instrucción SPEI de cobro por obligación) ─────

  /**
   * Emite la instrucción de depósito (CLABE + referencia) para una obligación
   * vía el conector bank_transfer del tenant. Idempotente: una obligación con
   * instrucción existente la reutiliza. El depósito se confirma después por
   * webhook + poll-as-truth de SUPRA.
   */
  createBankTransferInstruction(
    instanceId: string,
    obligationId: string,
  ): Promise<{
    object: string;
    obligation: string;
    clabe: string;
    reference: string;
    amount: string;
    currency: string;
  }> {
    return this.request('POST', `/v1/connector_instances/${instanceId}/transfers`, {
      obligation: obligationId,
    });
  }

  // ── Statement reconciliation (conciliación de recaudadores/banca) ───────────

  createStatementSource(input: {
    name: string;
    kind: string;
    matching_config?: Record<string, unknown>;
  }): Promise<{ id: string; object: string; name: string; kind: string }> {
    return this.request('POST', '/v1/statement_sources', input);
  }

  importStatementLines(
    sourceId: string,
    lines: {
      external_id: string;
      kind: string;
      amount: string;
      currency: string;
      value_date: string;
      reference?: string;
      counterparty_ref?: string;
    }[],
  ): Promise<{ object: string; source: string; imported: number; skipped: number }> {
    return this.request('POST', `/v1/statement_sources/${sourceId}/import`, { lines });
  }

  reconcileStatementSource(sourceId: string): Promise<{
    id: string;
    lines_considered: number;
    matched: number;
    partial: number;
    unmatched: number;
    exceptions_opened: number;
  }> {
    return this.request('POST', `/v1/statement_sources/${sourceId}/reconcile`, {});
  }

  listStatementLines(params: {
    source: string;
    status?: string;
    limit?: number;
    starting_after?: string;
  }): Promise<SupraList<{ id: string; external_id: string; status: string; amount: string }>> {
    const q = new URLSearchParams({ source: params.source, limit: String(params.limit ?? 100) });
    if (params.status) q.set('status', params.status);
    if (params.starting_after) q.set('starting_after', params.starting_after);
    return this.request('GET', `/v1/statement_lines?${q.toString()}`);
  }

  createReconciliationMatch(input: {
    line: string;
    target_type: 'payment' | 'refund' | 'settlement';
    target: string;
  }): Promise<{ id: string; match_type: string; residual: string }> {
    return this.request('POST', '/v1/reconciliation_matches', input);
  }

  listReconciliationExceptions(params?: {
    status?: string;
  }): Promise<SupraList<{ id: string; line: string; kind: string; detail: unknown; status: string }>> {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    return this.request('GET', `/v1/reconciliation_exceptions?${q.toString()}`);
  }

  resolveReconciliationException(
    id: string,
    input: { resolution: 'write_off' | 'corrected' | 'matched_late' | 'rejected'; note?: string },
  ): Promise<{ id: string; status: string; resolution: string }> {
    return this.request('POST', `/v1/reconciliation_exceptions/${id}/resolve`, input);
  }
}
