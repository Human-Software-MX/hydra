import { Logger } from '@nestjs/common';
import { PasarelaProvider } from './pasarela-provider.interface';
import { SimuladaPasarelaProvider } from './providers/simulada.provider';

/**
 * Selecciona la implementación de pasarela según la configuración
 * (env PASARELA_PROVIDER). Por defecto usa la pasarela simulada (desarrollo).
 * Para producción, registrar aquí el adaptador real (Conekta/Openpay/Stripe)
 * leyendo credenciales de entorno.
 */
export function crearPasarelaProvider(): PasarelaProvider {
  const proveedor = (process.env.PASARELA_PROVIDER ?? 'simulada').toLowerCase();
  const logger = new Logger('PasarelaFactory');

  switch (proveedor) {
    case 'simulada':
      return new SimuladaPasarelaProvider();
    // case 'conekta': return new ConektaPasarelaProvider({ apiKey: process.env.PASARELA_API_KEY!, ... });
    // case 'openpay': return new OpenpayPasarelaProvider({ merchantId: process.env.PASARELA_MERCHANT_ID!, ... });
    default:
      logger.warn(`PASARELA_PROVIDER="${proveedor}" no reconocido; usando simulada.`);
      return new SimuladaPasarelaProvider();
  }
}
