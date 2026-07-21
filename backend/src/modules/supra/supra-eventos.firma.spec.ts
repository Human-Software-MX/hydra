import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { SupraEventosService } from './supra-eventos.service';

/**
 * Verificación de la firma Supra-Signature (t=<unix>,v1=<hex HMAC-SHA256 de
 * "<t>.<body>">) — el mismo esquema que firma el relay de SUPRA
 * (supra-1/backend/src/engine/services/webhooks.ts).
 */
const SECRET = 'whsec_test_secret';

function servicio(toleranceSec = 300): SupraEventosService {
  const clientStub = {
    config: { webhookSecret: SECRET, webhookToleranceSec: toleranceSec },
  };
  // Solo se ejercita verificarFirma: el resto de dependencias no se usa.
  return new SupraEventosService(
    undefined as never,
    clientStub as never,
    undefined as never,
    undefined as never,
  );
}

function firmar(body: string, t = Math.floor(Date.now() / 1000), secret = SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('verificarFirma (Supra-Signature)', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', data: {} });

  it('acepta una firma válida dentro de la tolerancia', () => {
    expect(() => servicio().verificarFirma(firmar(body), Buffer.from(body))).not.toThrow();
  });

  it('rechaza firma con secreto incorrecto', () => {
    const header = firmar(body, Math.floor(Date.now() / 1000), 'whsec_otro');
    expect(() => servicio().verificarFirma(header, Buffer.from(body))).toThrow(UnauthorizedException);
  });

  it('rechaza cuerpo alterado (anti-tamper)', () => {
    const header = firmar(body);
    const alterado = body.replace('payment.succeeded', 'payment.failed');
    expect(() => servicio().verificarFirma(header, Buffer.from(alterado))).toThrow(UnauthorizedException);
  });

  it('rechaza timestamp fuera de la ventana (anti-replay)', () => {
    const viejo = Math.floor(Date.now() / 1000) - 3600;
    expect(() => servicio(300).verificarFirma(firmar(body, viejo), Buffer.from(body))).toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza header ausente o malformado', () => {
    expect(() => servicio().verificarFirma(undefined, Buffer.from(body))).toThrow(UnauthorizedException);
    expect(() => servicio().verificarFirma('v1=abc', Buffer.from(body))).toThrow(UnauthorizedException);
    expect(() => servicio().verificarFirma('t=xyz,v1=', Buffer.from(body))).toThrow(UnauthorizedException);
  });

  it('rechaza todo si falta el secreto configurado (fail-closed)', () => {
    const svc = new SupraEventosService(
      undefined as never,
      { config: { webhookSecret: '', webhookToleranceSec: 300 } } as never,
      undefined as never,
      undefined as never,
    );
    expect(() => svc.verificarFirma(firmar(body), Buffer.from(body))).toThrow(UnauthorizedException);
  });
});
