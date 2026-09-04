-- Tarifas de contratación en el catálogo versionado (docs/Tarifas_contratacion.xlsx)
-- =====================================================================
-- Aditiva y transaccional (rollback completo si algo falla).
--  * seccion        → PERIODICA (consumo periódico) | CONTRATACION (cargos únicos al contratar). Filas previas = PERIODICA.
--  * variante       → variable de la tarifa cuando no es una clase (materiales calle-banqueta, diámetro de medidor, plan de pago).
--  * parametros     → JSON con parámetros del concepto (consumoAsignadoM3, cantidadIncluida para lineal_excedente, variable, subconcepto).
--  * iva_no_objeto  → tratamiento «No objeto de IVA» (multas, recargos); iva_pct = 0.
-- Nuevo tipo_calculo `lineal_excedente`: cuota_fija + precio_unitario × max(0, cantidad − cantidadIncluida).
-- Los datos se cargan en el seed (seedTarifasContratacion), idempotente.
-- =====================================================================

BEGIN;

-- AlterTable
ALTER TABLE "tarifas" ADD COLUMN     "iva_no_objeto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parametros" JSONB,
ADD COLUMN     "seccion" TEXT NOT NULL DEFAULT 'PERIODICA',
ADD COLUMN     "variante" TEXT;

-- CreateIndex
CREATE INDEX "tarifas_seccion_idx" ON "tarifas"("seccion");


-- Valor de referencia: para tarifas lineales cuyo precio proporcional es 0 (sólo cuota fija) la referencia es la base.
UPDATE "tarifas" SET "valor_referencia" = "cuota_fija"
WHERE "tipo_calculo" IN ('lineal', 'lineal_excedente', 'variable')
  AND ("precio_unitario" IS NULL OR "precio_unitario" = 0)
  AND "cuota_fija" IS NOT NULL
  AND ("valor_referencia" IS NULL OR "valor_referencia" = 0);

COMMIT;
