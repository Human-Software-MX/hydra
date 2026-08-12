import { SetMetadata } from '@nestjs/common';

/**
 * @AllowPortal() — marca una ruta como parte de la superficie del portal de
 * clientes, es decir, alcanzable por tokens con rol CLIENTE.
 *
 * Por defecto el `InternalGuard` global rechaza a los CLIENTE en TODA la API:
 * el portal y el back office comparten tabla de usuarios y endpoint de login,
 * así que sin esta separación un token de cliente abriría el sistema interno.
 *
 * Esta marca sólo levanta el filtro de audiencia interna; la restricción real
 * de "sólo clientes" la aplica `PortalGuard` en el controlador del portal.
 */
export const ALLOW_PORTAL_KEY = 'allowPortal';
export const AllowPortal = () => SetMetadata(ALLOW_PORTAL_KEY, true);
