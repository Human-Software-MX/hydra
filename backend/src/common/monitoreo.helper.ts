import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const monitoreoLogger = new Logger('conMonitoreo');

export type TipoProceso =
  | 'ETL_PAGOS'
  | 'GIS_EXPORT'
  | 'POLIZA_COBROS'
  | 'POLIZA_FACTURACION'
  | 'VALIDACION_LECTURAS'
  | 'TIMBRADO'
  | 'OTRO';

export type EstadoProceso = 'Iniciado' | 'Procesando' | 'Completado' | 'Error' | 'Advertencia';

/**
 * Envuelve un proceso crítico con logging automático de inicio/fin/error.
 * Uso:
 *   const resultado = await conMonitoreo(prisma, 'ETL_PAGOS', async (ctx) => {
 *     ctx.registros = filasProcesadas;
 *     return resultado;
 *   }, { subTipo: 'OXXO', usuarioId });
 */
export async function conMonitoreo<T>(
  prisma: PrismaService,
  tipo: TipoProceso,
  fn: (ctx: {
    registros: number;
    errores: number;
    advertencias: number;
    detalle: object;
  }) => Promise<T>,
  opts?: { subTipo?: string; usuarioId?: string; detalle?: object },
): Promise<T> {
  const log = await prisma.logProceso.create({
    data: { tipo, subTipo: opts?.subTipo ?? null, estado: 'Iniciado', usuarioId: opts?.usuarioId ?? null },
  });
  const inicio = Date.now();
  const ctx = { registros: 0, errores: 0, advertencias: 0, detalle: opts?.detalle ?? {} };
  try {
    const result = await fn(ctx);
    // El cierre de bookkeeping va aislado: un fallo de la escritura de
    // monitoreo NUNCA debe convertir una operación de negocio ya COMMITEADA
    // (p.ej. una póliza ya creada) en un 500 al caller → riesgo de póliza
    // duplicada al reintentar. Se registra la advertencia y se devuelve el
    // resultado real de todos modos.
    try {
      await prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: ctx.errores > 0 ? 'Advertencia' : 'Completado',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          registros: ctx.registros,
          errores: ctx.errores,
          advertencias: ctx.advertencias,
          detalle: ctx.detalle,
        },
      });
    } catch (bookkeepingErr: unknown) {
      monitoreoLogger.warn(
        `No se pudo cerrar el LogProceso ${log.id} (${tipo}) en éxito: ${
          bookkeepingErr instanceof Error ? bookkeepingErr.message : String(bookkeepingErr)
        }`,
      );
    }
    return result;
  } catch (err: unknown) {
    // Igual en la ruta de error: si el bookkeeping falla, NO debe enmascarar el
    // error de negocio original — se traga (con warning) y se re-lanza el real.
    try {
      await prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: 'Error',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          errores: ctx.errores + 1,
          errorMsg: err instanceof Error ? err.message : String(err),
          detalle: ctx.detalle,
        },
      });
    } catch (bookkeepingErr: unknown) {
      monitoreoLogger.warn(
        `No se pudo cerrar el LogProceso ${log.id} (${tipo}) en error: ${
          bookkeepingErr instanceof Error ? bookkeepingErr.message : String(bookkeepingErr)
        }`,
      );
    }
    throw err;
  }
}
