/**
 * InternalGuard — restringe la API al personal interno
 * (SUPER_ADMIN, ADMIN, OPERADOR, LECTURISTA, ATENCION_CLIENTES).
 *
 * Está registrado como `APP_GUARD` global en `AppModule`, justo después de
 * `JwtAuthGuard`. El motivo: portal de clientes y back office comparten la
 * tabla `users` y el endpoint `POST /auth/login`, así que un token con rol
 * CLIENTE es indistinguible de uno interno para el guard de JWT. Sin este
 * filtro, un cliente del portal podría leer contratos, pagos o lecturas de
 * cualquier otro usuario.
 *
 * Escapes:
 *   - `@Public()`      → ruta anónima o con guard propio; no hay usuario que evaluar.
 *   - `@AllowPortal()` → ruta de la superficie del portal (ver `PortalGuard`).
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_PORTAL_KEY } from './allow-portal.decorator';

const INTERNAL_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'OPERADOR',
  'LECTURISTA',
  'ATENCION_CLIENTES',
]);

@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const allowPortal = this.reflector.getAllAndOverride<boolean>(ALLOW_PORTAL_KEY, targets);
    if (allowPortal) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as { user?: { role?: string } }).user;

    if (!user?.role || !INTERNAL_ROLES.has(user.role)) {
      throw new ForbiddenException(
        'Solo usuarios internos pueden acceder a este recurso.',
      );
    }
    return true;
  }
}
