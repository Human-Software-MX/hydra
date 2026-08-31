import { Prisma, PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { GisTrackerService } from '../modules/gis/gis-tracker.service';
import type { PrismaService } from './prisma.service';

/**
 * B5 — Extensión de cliente Prisma que alimenta el feed de deltas GIS.
 *
 * En cada create/update/delete/upsert de los seis modelos rastreados emite una
 * fila `CambioGIS` reutilizando `GisTrackerService.registrarCambio`.
 *
 * Resiliencia: el registro del cambio es "fire-and-forget" y sus errores se
 * tragan (con `logger.warn`) — un fallo de tracking NUNCA debe romper la
 * escritura principal.
 *
 * ⚠️ LIMITACIÓN CONOCIDA (rollback → fila fantasma): la fila `CambioGIS` se
 * escribe con el cliente BASE (sin extender) y, por tanto, FUERA de la
 * transacción interactiva de la mutación. Si la mutación corre dentro de un
 * `$transaction(...)` que LUEGO hace rollback, el `CambioGIS` ya quedó commiteado
 * de forma independiente → queda un delta GIS que referencia un cambio que nunca
 * ocurrió. Es de baja severidad (el feed GIS es un stream de deltas, tolerante a
 * reconciliación) y NO se resuelve aquí: la extensión no tiene una API soportada
 * para saber si está dentro de una transacción interactiva. La corrección
 * apropiada es un patrón outbox (escribir el CambioGIS en la MISMA transacción y
 * despacharlo tras el commit). Ver `tasks/bugs.md` → "GIS phantom tracking on
 * rollback".
 *
 * Nota: `$use` (middleware) fue eliminado en Prisma 6, por eso el tracking se
 * cablea como un query-extension (`$extends`). El cliente extendido es el que
 * `PrismaModule` inyecta en toda la app, de modo que cualquier mutación de un
 * modelo rastreado pasa por este hook.
 */

const logger = new Logger('GisTracking');

const ENTIDADES_RASTREADAS = new Set(['Contrato', 'Medidor', 'Zona', 'Distrito', 'Toma', 'Ruta']);

const ACCION_POR_OPERACION: Record<string, 'insert' | 'update' | 'delete'> = {
  create: 'insert',
  update: 'update',
  upsert: 'update',
  delete: 'delete',
};

/**
 * Construye la extensión. `base` es el cliente SIN extender: lo usamos para
 * escribir `CambioGIS` sin volver a disparar el hook (evita recursión) y para
 * que la escritura de tracking quede fuera de la transacción de la mutación.
 */
export function createGisTrackingExtension(base: PrismaClient) {
  const tracker = new GisTrackerService(base as unknown as PrismaService);

  return Prisma.defineExtension({
    name: 'gis-tracking',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args);

          const accion = ACCION_POR_OPERACION[operation];
          if (accion && ENTIDADES_RASTREADAS.has(model)) {
            const entidadId =
              (result && typeof result === 'object' && 'id' in result
                ? (result as { id?: unknown }).id
                : undefined) ??
              (args && typeof args === 'object' && 'where' in args
                ? (args as { where?: { id?: unknown } }).where?.id
                : undefined);

            if (entidadId != null) {
              void tracker
                .registrarCambio({
                  entidad: model as 'Contrato' | 'Medidor' | 'Zona' | 'Distrito' | 'Toma' | 'Ruta',
                  entidadId: String(entidadId),
                  accion,
                  datosSnapshot:
                    result && typeof result === 'object' ? (result as object) : undefined,
                })
                .catch((err: unknown) => {
                  logger.warn(
                    `No se pudo registrar CambioGIS (${model}/${accion}): ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                  );
                });
            }
          }

          return result;
        },
      },
    },
  });
}
