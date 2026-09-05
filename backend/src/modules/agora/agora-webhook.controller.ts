import { Body, Controller, forwardRef, Headers, HttpCode, HttpStatus, Inject, Logger, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { AgoraService } from './agora.service';
import { SolicitudesService } from '../solicitudes/solicitudes.service';

/**
 * Receptor de webhooks de Agora.
 *
 * Público (Agora no envía JWT de Hydra): la autenticación es el secreto
 * compartido AGORA_WEBHOOK_SECRET. El disparador genérico de Chatwoot no manda
 * headers propios, por eso también se acepta `?token=` en la URL registrada.
 */
// @Public(): el relay de Agora no trae JWT; la autenticación es el secreto
// verificado abajo (ver public.decorator.ts, caso 2 — guard propio).
@Public()
@Controller('agora')
export class AgoraWebhookController {
  private readonly logger = new Logger(AgoraWebhookController.name);

  constructor(
    private readonly service: AgoraService,
    @Inject(forwardRef(() => SolicitudesService))
    private readonly solicitudes: SolicitudesService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Headers('x-agora-webhook-secret') secretHeader: string | undefined,
    @Query('token') secretQuery: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.service.verificarWebhookSecret(secretHeader ?? secretQuery);
    const resultado = await this.service.procesarWebhook(body);

    // Push de inspección: si el evento es una orden de inspección resuelta (o con
    // realizada capturada), Hydra trae los datos solo — el inspector únicamente
    // resuelve el ticket en Agora. Nunca se responde 500 al emisor por esto.
    const orden = this.service.extraerOrdenInspeccion(body);
    if (orden?.listo) {
      try {
        const r = await this.solicitudes.syncInspeccionDesdeAgora(orden.solicitudId);
        this.logger.log(
          `Webhook orden de inspección → sync ${orden.solicitudId}: ${r.camposRecibidos.length} campo(s)`,
        );
      } catch (err) {
        this.logger.warn(
          `Webhook orden de inspección: sync falló para ${orden.solicitudId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    if (!resultado) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return resultado;
  }
}
