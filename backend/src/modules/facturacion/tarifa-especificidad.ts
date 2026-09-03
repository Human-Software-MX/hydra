/**
 * Especificidad de una tarifa frente a un contrato (administración + clase).
 *
 * Función pura compartida por la resolución de tarifas de facturación
 * (`FacturacionService.tarifasVigentesPorServicio`) y por el cálculo puntual
 * (`TarifasService.findTarifaVigente` / `GET /tarifas/calcular`): ambos deben
 * elegir el MISMO nivel de tarifa o el simulador mentiría respecto al recibo.
 *
 * Orden de preferencia:
 *   (admin, clase) > (admin, sin clase) > (global, clase) > (global, sin clase)
 */

/** Contexto del contrato para el que se resuelve la tarifa. */
export interface ContextoTarifa {
  administracionId?: string | null;
  claseTarifaId?: string | null;
}

/** Campos de la tarifa que determinan su especificidad. */
export interface TarifaClasificada {
  administracionId: string | null;
  claseTarifaId: string | null;
}

/** Puntaje 0..3 de una tarifa para el contexto dado. */
export function especificidadTarifa(t: TarifaClasificada, ctx: ContextoTarifa): number {
  const porAdmin = ctx.administracionId && t.administracionId === ctx.administracionId ? 2 : 0;
  const porClase = ctx.claseTarifaId && t.claseTarifaId === ctx.claseTarifaId ? 1 : 0;
  return porAdmin + porClase;
}

/**
 * Conserva sólo las tarifas del nivel más específico presente en la lista
 * (la lista debe venir ya filtrada por vigencia y por servicio).
 */
export function filtrarMasEspecificas<T extends TarifaClasificada>(tarifas: T[], ctx: ContextoTarifa): T[] {
  if (tarifas.length <= 1) return tarifas;
  let maximo = 0;
  for (const t of tarifas) {
    const puntaje = especificidadTarifa(t, ctx);
    if (puntaje > maximo) maximo = puntaje;
  }
  return maximo === 0 ? tarifas : tarifas.filter((t) => especificidadTarifa(t, ctx) === maximo);
}
