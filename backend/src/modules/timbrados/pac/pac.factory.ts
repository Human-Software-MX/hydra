import { Logger } from '@nestjs/common';
import { PacProvider } from './pac-provider.interface';
import { SimuladoPacProvider } from './simulado.provider';

/**
 * Selecciona la implementación de PAC según la configuración (env PAC_PROVIDER).
 * Por defecto usa el proveedor simulado (desarrollo). Para producción, registrar
 * aquí el adaptador real (Finkok/SW) leyendo credenciales de entorno.
 */
export function crearPacProvider(): PacProvider {
  const proveedor = (process.env.PAC_PROVIDER ?? 'simulado').toLowerCase();
  const logger = new Logger('PacFactory');

  switch (proveedor) {
    case 'simulado':
      return new SimuladoPacProvider();
    // case 'finkok': return new FinkokPacProvider({ user: process.env.PAC_USER!, ... });
    // case 'sw':     return new SwPacProvider({ token: process.env.PAC_TOKEN! });
    default:
      logger.warn(`PAC_PROVIDER="${proveedor}" no reconocido; usando simulado.`);
      return new SimuladoPacProvider();
  }
}

export const PAC_PROVIDER = 'PAC_PROVIDER_TOKEN';
