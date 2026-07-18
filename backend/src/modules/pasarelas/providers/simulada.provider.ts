import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  CrearIntentoParams,
  IntentoCreado,
  PasarelaProvider,
  WebhookParseado,
} from '../pasarela-provider.interface';

/** CLABE de cobro dummy (banco 646 = STP, plaza 180) para pagos SPEI simulados. */
const CLABE_COBRO_SIMULADA = '646180157099999993';

const HORAS_EXPIRACION_REFERENCIA = 72; // SPEI / OXXO
const MINUTOS_EXPIRACION_TARJETA = 30;

/**
 * Pasarela de pago simulada — desarrollo y demo sin credenciales reales.
 *
 * Genera referencias deterministas (derivadas por hash de contrato + método +
 * timestamp, con dígito verificador simple) con el formato de cada método:
 *   - SPEI:    referencia numérica de 20 dígitos + CLABE de cobro dummy
 *   - OXXO:    línea de captura de 14 dígitos
 *   - tarjeta: id de cargo + URL de checkout simulada
 *
 * En modo simulado no hay firma real: verificarFirmaWebhook devuelve true y el
 * pago se confirma vía POST /pasarelas/intentos/:id/simular-pago (QA/demo).
 * En producción se sustituye por un proveedor real (Conekta/Openpay/Stripe)
 * vía PASARELA_PROVIDER, sin cambiar el resto del sistema.
 */
export class SimuladaPasarelaProvider implements PasarelaProvider {
  readonly nombre = 'simulada';

  async crearIntento(params: CrearIntentoParams): Promise<IntentoCreado> {
    const ahora = new Date();
    const semilla = `${params.contratoId}:${params.metodo}:${params.monto}:${ahora.getTime()}`;

    switch (params.metodo) {
      case 'spei': {
        const referencia = this.referenciaNumerica(semilla, 20);
        return {
          referencia,
          expiraEn: this.enHoras(ahora, HORAS_EXPIRACION_REFERENCIA),
          datos: {
            clabe: CLABE_COBRO_SIMULADA,
            banco: 'STP (simulado)',
            beneficiario: 'CEA Querétaro',
            conceptoPago: `Contrato ${params.referenciaContrato}`,
          },
        };
      }
      case 'oxxo': {
        const referencia = this.referenciaNumerica(semilla, 14);
        return {
          referencia,
          expiraEn: this.enHoras(ahora, HORAS_EXPIRACION_REFERENCIA),
          datos: {
            lineaCaptura: referencia,
            comision: 'La tienda puede cobrar comisión por el servicio',
          },
        };
      }
      case 'tarjeta': {
        const referencia = `ch_sim_${this.hashDigits(semilla).slice(0, 24)}`;
        return {
          referencia,
          urlPago: `https://pagos-simulada.ceaqueretaro.local/checkout/${referencia}`,
          expiraEn: new Date(ahora.getTime() + MINUTOS_EXPIRACION_TARJETA * 60_000),
        };
      }
      default:
        throw new BadRequestException(`Método de pago no soportado: ${params.metodo}`);
    }
  }

  /** En modo simulado no hay secreto compartido: toda firma es válida. */
  verificarFirmaWebhook(
    _headers: Record<string, string | string[] | undefined>,
    _rawBody: string,
  ): boolean {
    return true;
  }

  parsearWebhook(payload: unknown): WebhookParseado {
    const p = (payload ?? {}) as Record<string, unknown>;
    const referencia = typeof p.referencia === 'string' ? p.referencia : '';
    if (!referencia) {
      throw new BadRequestException('Webhook sin campo "referencia"');
    }
    const estados = ['pagado', 'fallido', 'expirado', 'cancelado'] as const;
    const estado = estados.includes(p.estado as (typeof estados)[number])
      ? (p.estado as WebhookParseado['estado'])
      : 'pagado';
    const montoPagado = Number(p.montoPagado ?? p.monto ?? 0);
    const fecha = typeof p.fecha === 'string' ? p.fecha : new Date().toISOString();
    return { referencia, estado, montoPagado, fecha };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private enHoras(desde: Date, horas: number): Date {
    return new Date(desde.getTime() + horas * 3_600_000);
  }

  /** Dígitos deterministas derivados por hash de la semilla. */
  private hashDigits(semilla: string): string {
    // Dos rondas de sha256 en hex → suficientes dígitos tras filtrar letras.
    const hex =
      createHash('sha256').update(semilla).digest('hex') +
      createHash('sha256').update(`${semilla}#2`).digest('hex');
    return hex.replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10));
  }

  /**
   * Referencia numérica de `longitud` dígitos: cuerpo determinista + dígito
   * verificador simple (suma ponderada 1-2-1-2… mod 10, estilo línea de captura).
   */
  private referenciaNumerica(semilla: string, longitud: number): string {
    const cuerpo = this.hashDigits(semilla).slice(0, longitud - 1);
    return cuerpo + this.digitoVerificador(cuerpo);
  }

  private digitoVerificador(cuerpo: string): string {
    let suma = 0;
    for (let i = 0; i < cuerpo.length; i++) {
      const peso = i % 2 === 0 ? 1 : 2;
      const prod = Number(cuerpo[i]) * peso;
      suma += prod > 9 ? prod - 9 : prod;
    }
    return String((10 - (suma % 10)) % 10);
  }
}
