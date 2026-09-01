import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { AgoraService } from './agora.service';

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
  constructor(private readonly service: AgoraService) {}

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
    if (!resultado) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return resultado;
  }
}
