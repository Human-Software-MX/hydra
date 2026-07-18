import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MetodoPagoPasarela, PasarelaProvider } from './pasarela-provider.interface';
import { crearPasarelaProvider } from './pasarela.factory';

/**
 * Pasarelas de pago digitales: SPEI (referencia), OXXO (línea de captura)
 * y tarjeta. El proveedor concreto se selecciona por env PASARELA_PROVIDER
 * (default 'simulada'); el resto del sistema solo conoce IntentoPago.
 *
 * Flujo: crearIntento → cliente paga con la referencia → la pasarela llama
 * POST /pasarelas/webhook → confirmarWebhook registra el Pago y liga el intento.
 *
 * Jobs (mismo master switch que los demás):
 *   HYDRA_JOBS_ENABLED         = true | false  (default false)
 *   JOB_EXPIRAR_INTENTOS_CRON  = cron (default "0 1 * * *" — diario, 01:00)
 */
@Injectable()
export class PasarelasService {
  private readonly logger = new Logger(PasarelasService.name);
  private readonly provider: PasarelaProvider;

  constructor(private readonly prisma: PrismaService) {
    this.provider = crearPasarelaProvider();
  }

  /** Tipo legacy de Pago según el método de la pasarela. */
  private tipoPago(metodo: string): string {
    switch (metodo) {
      case 'spei':
        return 'SPEI';
      case 'oxxo':
        return 'OXXO';
      case 'tarjeta':
        return 'Tarjeta';
      default:
        return 'WEB';
    }
  }

  // ─── Alta de intentos ───────────────────────────────────────────────────────

  async crearIntento(params: {
    contratoId: string;
    monto: number;
    metodo: MetodoPagoPasarela;
    origen: 'portal' | 'caja' | 'api';
  }) {
    const { contratoId, monto, metodo, origen } = params;
    if (!(monto > 0)) {
      throw new BadRequestException('El monto debe ser mayor a cero');
    }
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true, ceaNumContrato: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const creado = await this.provider.crearIntento({
      contratoId,
      monto,
      metodo,
      referenciaContrato: contrato.ceaNumContrato ?? contratoId.substring(0, 8),
    });

    const intento = await this.prisma.intentoPago.create({
      data: {
        contratoId,
        pasarela: this.provider.nombre,
        metodo,
        referencia: creado.referencia,
        monto,
        estado: 'pendiente',
        urlPago: creado.urlPago ?? null,
        expiraEn: creado.expiraEn ?? null,
        origen,
      },
    });

    // `datos` no se persiste (es material de presentación: CLABE, banco, etc.).
    return { ...intento, datos: creado.datos ?? null };
  }

  async listarIntentos(filtros: { contratoId?: string; estado?: string }) {
    return this.prisma.intentoPago.findMany({
      where: {
        ...(filtros.contratoId && { contratoId: filtros.contratoId }),
        ...(filtros.estado && { estado: filtros.estado }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async listarIntentosContrato(contratoId: string) {
    return this.prisma.intentoPago.findMany({
      where: { contratoId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Webhook de confirmación ────────────────────────────────────────────────

  /**
   * Procesa la notificación de la pasarela. Idempotente: si el intento ya está
   * pagado devuelve ok sin duplicar el Pago (el claim condicional dentro de la
   * transacción también cubre webhooks concurrentes).
   */
  async confirmarWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ) {
    // Nota: con un proveedor real la firma debe validarse sobre el cuerpo crudo
    // (habilitar rawBody en bootstrap); en modo simulado no hay firma.
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    if (!this.provider.verificarFirmaWebhook(headers, rawBody)) {
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    const evento = this.provider.parsearWebhook(body);
    const intento = await this.prisma.intentoPago.findUnique({
      where: { referencia: evento.referencia },
    });
    if (!intento) {
      throw new NotFoundException(`Referencia desconocida: ${evento.referencia}`);
    }

    if (intento.estado === 'pagado') {
      return { ok: true, idempotente: true, intentoId: intento.id, pagoId: intento.pagoId };
    }

    const webhookPayload = JSON.parse(rawBody);

    // Resultado no exitoso: solo se actualiza el estado del intento.
    if (evento.estado !== 'pagado') {
      const actualizado = await this.prisma.intentoPago.update({
        where: { id: intento.id },
        data: { estado: evento.estado, webhookPayload },
      });
      return { ok: true, intentoId: actualizado.id, estado: actualizado.estado };
    }

    const montoPagado = evento.montoPagado > 0 ? evento.montoPagado : Number(intento.monto);
    const fechaPago = /^\d{4}-\d{2}-\d{2}/.test(evento.fecha)
      ? evento.fecha.substring(0, 10)
      : new Date().toISOString().substring(0, 10);

    const resultado = await this.prisma.$transaction(async (tx) => {
      // Claim condicional: si otro webhook concurrente ya lo marcó pagado, no duplica.
      const claim = await tx.intentoPago.updateMany({
        where: { id: intento.id, estado: { not: 'pagado' }, pagoId: null },
        data: { estado: 'pagado' },
      });
      if (claim.count === 0) {
        return { ok: true, idempotente: true, intentoId: intento.id, pagoId: null as string | null };
      }

      // Pago creado vía prisma directamente (no se importa PagosModule);
      // el recálculo de cartera/saldos lo cubre el job nocturno.
      const pago = await tx.pago.create({
        data: {
          contratoId: intento.contratoId,
          monto: montoPagado,
          fecha: fechaPago,
          tipo: this.tipoPago(intento.metodo),
          concepto: 'Pago en línea',
          origen: 'nativo',
          oficina: 'PASARELA',
        },
      });

      await tx.intentoPago.update({
        where: { id: intento.id },
        data: { pagoId: pago.id, webhookPayload },
      });

      return { ok: true, idempotente: false, intentoId: intento.id, pagoId: pago.id };
    });

    if (!resultado.idempotente) {
      this.logger.log(
        `Intento ${resultado.intentoId} pagado (${intento.metodo}, $${montoPagado}) → pago ${resultado.pagoId}`,
      );
    }
    return resultado;
  }

  // ─── Simulación de pago (demo/QA) ───────────────────────────────────────────

  /**
   * Dispara internamente el flujo de confirmación como si la pasarela hubiera
   * notificado el pago. SOLO disponible con PASARELA_PROVIDER='simulada'.
   */
  async simularPagoExitoso(intentoId: string) {
    const proveedor = (process.env.PASARELA_PROVIDER ?? 'simulada').toLowerCase();
    if (proveedor !== 'simulada') {
      throw new BadRequestException(
        'La simulación de pagos solo está disponible con PASARELA_PROVIDER=simulada',
      );
    }
    const intento = await this.prisma.intentoPago.findUnique({ where: { id: intentoId } });
    if (!intento) throw new NotFoundException('Intento de pago no encontrado');

    return this.confirmarWebhook(
      {},
      {
        referencia: intento.referencia,
        estado: 'pagado',
        montoPagado: Number(intento.monto),
        fecha: new Date().toISOString(),
        simulado: true,
      },
    );
  }

  // ─── Job: expirar intentos vencidos ─────────────────────────────────────────

  @Cron(process.env.JOB_EXPIRAR_INTENTOS_CRON ?? '0 1 * * *', { name: 'expirar-intentos-pago' })
  async cronExpirarPendientes() {
    if ((process.env.HYDRA_JOBS_ENABLED ?? 'false').toLowerCase() !== 'true') return;
    await this.expirarPendientes();
  }

  async expirarPendientes() {
    const { count } = await this.prisma.intentoPago.updateMany({
      where: { estado: 'pendiente', expiraEn: { lt: new Date() } },
      data: { estado: 'expirado' },
    });
    if (count > 0) this.logger.log(`Intentos de pago expirados: ${count}`);
    return { expirados: count };
  }
}
