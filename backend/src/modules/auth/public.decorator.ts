import { SetMetadata } from '@nestjs/common';

/**
 * @Public() — exime a una ruta (o a un controlador completo) de los guards
 * globales de autenticación (`JwtAuthGuard`) y de audiencia (`InternalGuard`).
 *
 * Úsese sólo en dos casos:
 *   1. Rutas realmente anónimas (login, health check).
 *   2. Rutas servicio-a-servicio que traen su propio guard, p. ej.
 *      `@Public() @UseGuards(ApiTokenGuard)` — el token de API sustituye al JWT.
 *
 * `@Public()` NO significa "sin protección": significa "no la protege el JWT".
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
