import { BadRequestException, Body, Controller, Headers, Post, RawBodyRequest, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { SupraEventosService } from './supra-eventos.service';

/**
 * Receptor de webhooks de SUPRA.
 *
 * Público (el relay de SUPRA no lleva JWT de usuario): la autenticación es la
 * firma HMAC `Supra-Signature` verificada sobre el cuerpo CRUDO, con ventana
 * anti-replay. Responde rápido (verificar + encolar en inbox); el
 * procesamiento es asíncrono.
 */
// @Public(): el relay de SUPRA no trae JWT; la autenticación real es la firma
// HMAC verificada abajo (ver public.decorator.ts, caso 2 — guard propio).
@Public()
@Controller('integraciones/supra')
export class SupraWebhookController {
  constructor(private readonly eventos: SupraEventosService) {}

  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('supra-signature') firma: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}), 'utf8');
    this.eventos.verificarFirma(firma, raw);

    if (!body || typeof body.id !== 'string' || typeof body.type !== 'string') {
      throw new BadRequestException('Evento malformado: se esperan campos id y type');
    }
    return this.eventos.recibir(body as never);
  }
}
