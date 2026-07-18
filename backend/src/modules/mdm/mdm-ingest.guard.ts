/**
 * MdmIngestGuard — autenticación dual para la ingesta de lecturas de intervalo.
 *
 * Los colectores IoT (gateways AMI/AMR, head-ends) no manejan sesiones JWT:
 * se autentican con un API key fijo de servicio-a-servicio. El personal
 * interno, en cambio, entra con su JWT normal (+ roles del endpoint).
 *
 *   - Header `X-API-KEY: <MDM_INGEST_API_KEY>`  → acceso de colector
 *   - Sin ese header                            → JwtAuthGuard + RolesGuard
 *
 * Sigue el patrón de ApiTokenGuard (auth/api-token.guard.ts): el key vive en
 * env y se exige longitud mínima para evitar configuraciones débiles.
 *
 *   MDM_INGEST_API_KEY = token fijo (mínimo 16 caracteres)
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isObservable, lastValueFrom } from 'rxjs';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

@Injectable()
export class MdmIngestGuard implements CanActivate {
  constructor(
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly rolesGuard: RolesGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    // Vía colector IoT: el header manda — si viene, se valida contra env y
    // no se cae al flujo JWT (un key inválido debe fallar, no degradar).
    if (apiKey !== undefined) {
      const esperado = process.env.MDM_INGEST_API_KEY;
      if (!esperado || esperado.length < 16) {
        throw new UnauthorizedException(
          'Ingesta por API key deshabilitada. Configure MDM_INGEST_API_KEY (mínimo 16 caracteres) en .env',
        );
      }
      if (apiKey !== esperado) {
        throw new UnauthorizedException('X-API-KEY inválida');
      }
      return true;
    }

    // Vía personal interno: JWT + roles del handler.
    const jwtResultado = this.jwtAuthGuard.canActivate(context);
    const jwtOk = await (isObservable(jwtResultado)
      ? lastValueFrom(jwtResultado)
      : Promise.resolve(jwtResultado));
    if (!jwtOk) return false;
    return this.rolesGuard.canActivate(context);
  }
}
