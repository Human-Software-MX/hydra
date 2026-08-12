import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/**
 * RolesGuard — registrado como `APP_GUARD` global en `AppModule`, después de
 * `JwtAuthGuard` e `InternalGuard`.
 *
 * Sin metadata `@Roles(...)` la ruta queda en "cualquier usuario autenticado"
 * (que, por el InternalGuard, ya significa "cualquier usuario interno").
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user?.role);
  }
}
