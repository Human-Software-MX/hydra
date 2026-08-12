import { Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

/** Nombre del throttler estricto de credenciales declarado en AppModule. */
export const LOGIN_THROTTLER = 'login';

const LOGIN_THROTTLE_METADATA = 'app-throttler:login';

/**
 * Marca el handler que valida credenciales. Sólo en él corre el throttler
 * `login`; en el resto de la API se salta (ver `skipIf` más abajo).
 */
export const LoginThrottle = () => SetMetadata(LOGIN_THROTTLE_METADATA, true);

/**
 * IP real del cliente. `main.ts` fija `trust proxy = 1`, así que Express ya
 * resuelve `req.ip` desde X-Forwarded-For contando exactamente un salto (el
 * reverse proxy). Sin ese ajuste todos los clientes caerían en un solo cubo.
 */
function clientIp(req: Record<string, any>): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Throttler de credenciales: la llave es `IP + email`, no sólo la IP.
 *   - Un atacante desde una IP no puede bloquear cuentas ajenas (cada email
 *     tiene su propio contador).
 *   - Una oficina entera detrás de una sola IP NAT no se bloquea entre sí
 *     mientras cada quien use su propio email.
 * El cubo `default` sigue aplicando sobre el mismo handler y acota el barrido
 * de emails desde una IP (ver `@Throttle` en AuthController).
 */
export const LOGIN_THROTTLER_OPTIONS: ThrottlerOptions = {
  name: LOGIN_THROTTLER,
  ttl: 60_000,
  limit: 5,
  skipIf: (context) =>
    Reflect.getMetadata(LOGIN_THROTTLE_METADATA, context.getHandler()) !== true,
  getTracker: (req) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    return `${clientIp(req)}:${email}`;
  },
};

/**
 * ThrottlerGuard con llave por identidad en vez de `req.ip` a secas.
 *
 * El guard corre antes que JwtAuthGuard (así el límite se aplica sin tocar la
 * base de datos), por lo que `req.user` todavía no existe: el id de usuario se
 * obtiene verificando la firma del bearer token. Se verifica —no se decodifica—
 * para que nadie pueda inventar un `sub` y estrenar cubo en cada petición.
 * Sin token válido se cae a la IP real del cliente.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = this.userIdFromBearer(req);
    return userId ? `user:${userId}` : `ip:${clientIp(req)}`;
  }

  private userIdFromBearer(req: Record<string, any>): string | null {
    const header = req.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    try {
      const payload = this.jwtService.verify<{ sub?: unknown }>(header.slice(7).trim());
      return typeof payload?.sub === 'string' ? payload.sub : null;
    } catch {
      // Token vencido/inválido: se limita por IP como cualquier anónimo.
      return null;
    }
  }
}
