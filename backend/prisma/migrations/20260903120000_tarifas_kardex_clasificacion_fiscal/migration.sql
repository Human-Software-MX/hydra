-- Tarifas: histórico (Kardex), clasificación por tipo de servicio y configuración fiscal
-- =====================================================================
-- Aditiva y transaccional. Postgres soporta DDL transaccional, así que si algo
-- falla el rollback deja la BD exactamente en su esquema previo (evita P3009).
--
--  * categorias_tarifa   → clasificación principal/fiscal (DOMESTICA, COMERCIAL, …) con IVA por defecto.
--  * clases_tarifa       → tipo de tarifa / variante (DOMÉSTICA MEDIO, DOMÉSTICO ALTO, …); iva_pct nulo = hereda.
--  * tarifa_movimientos  → Kardex: un renglón por versión creada con snapshot de valores anteriores y nuevos.
--  * tarifas             → versionado inmutable: (codigo, version) único; tarifa_anterior_id enlaza versiones;
--                          nuevos tipo_calculo `tabla` (precios JSONB 0..N m³) y `lineal`; precios a 4 decimales.
--  * tipos_contratacion  → clase_tarifa_id: qué clase factura cada tipo de contratación.
--
-- Los catálogos (categorías/clases) y el alta de las tarifas del Excel Feb-2026 se cargan
-- en el seed (prisma/seed-catalogos.ts → seedTarifasPeriodicas), de forma idempotente.
-- =====================================================================

BEGIN;

-- GUARDA) La restricción única (codigo, version) requiere que no existan duplicados previos.
DO $$
DECLARE dup INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup FROM (
    SELECT codigo, version FROM "tarifas" GROUP BY codigo, version HAVING COUNT(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'tarifas: % combinaciones (codigo, version) duplicadas. Renumere version antes de aplicar.', dup;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "tipos_contratacion" ADD COLUMN     "clase_tarifa_id" TEXT;

-- AlterTable
ALTER TABLE "tarifas" ADD COLUMN     "clase_tarifa_id" TEXT,
ADD COLUMN     "concepto" TEXT,
ADD COLUMN     "creado_por" TEXT,
ADD COLUMN     "motivo" TEXT,
ADD COLUMN     "precios" JSONB,
ADD COLUMN     "tarifa_anterior_id" TEXT,
ADD COLUMN     "valor_referencia" DECIMAL(12,4),
ALTER COLUMN "precio_unitario" SET DATA TYPE DECIMAL(12,4),
ALTER COLUMN "cuota_fija" SET DATA TYPE DECIMAL(12,4);

-- AlterTable
ALTER TABLE "actualizaciones_tarifarias" ADD COLUMN     "filtro" JSONB,
ADD COLUMN     "porcentaje" DECIMAL(8,4),
ADD COLUMN     "total_tarifas" INTEGER;

-- CreateTable
CREATE TABLE "categorias_tarifa" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "iva_pct" DECIMAL(5,2) NOT NULL DEFAULT 16,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categorias_tarifa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clases_tarifa" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria_id" TEXT NOT NULL,
    "iva_pct" DECIMAL(5,2),
    "sige_tps_id" INTEGER,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clases_tarifa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarifa_movimientos" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tarifa_id" TEXT NOT NULL,
    "tarifa_anterior_id" TEXT,
    "tipo" TEXT NOT NULL,
    "porcentaje" DECIMAL(8,4),
    "valores_anteriores" JSONB,
    "valores_nuevos" JSONB NOT NULL,
    "vigencia_desde" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "actualizacion_id" TEXT,
    "usuario_id" TEXT,
    "usuario_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tarifa_movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_tarifa_codigo_key" ON "categorias_tarifa"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "clases_tarifa_codigo_key" ON "clases_tarifa"("codigo");

-- CreateIndex
CREATE INDEX "clases_tarifa_categoria_id_idx" ON "clases_tarifa"("categoria_id");

-- CreateIndex
CREATE INDEX "tarifa_movimientos_codigo_idx" ON "tarifa_movimientos"("codigo");

-- CreateIndex
CREATE INDEX "tarifa_movimientos_tarifa_id_idx" ON "tarifa_movimientos"("tarifa_id");

-- CreateIndex
CREATE INDEX "tarifa_movimientos_actualizacion_id_idx" ON "tarifa_movimientos"("actualizacion_id");

-- CreateIndex
CREATE INDEX "tarifa_movimientos_created_at_idx" ON "tarifa_movimientos"("created_at");

-- CreateIndex
CREATE INDEX "tipos_contratacion_clase_tarifa_id_idx" ON "tipos_contratacion"("clase_tarifa_id");

-- CreateIndex
CREATE UNIQUE INDEX "tarifas_tarifa_anterior_id_key" ON "tarifas"("tarifa_anterior_id");

-- CreateIndex
CREATE INDEX "tarifas_clase_tarifa_id_idx" ON "tarifas"("clase_tarifa_id");

-- CreateIndex
CREATE UNIQUE INDEX "tarifas_codigo_version_key" ON "tarifas"("codigo", "version");

-- AddForeignKey
ALTER TABLE "tipos_contratacion" ADD CONSTRAINT "tipos_contratacion_clase_tarifa_id_fkey" FOREIGN KEY ("clase_tarifa_id") REFERENCES "clases_tarifa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_clase_tarifa_id_fkey" FOREIGN KEY ("clase_tarifa_id") REFERENCES "clases_tarifa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_tarifa_anterior_id_fkey" FOREIGN KEY ("tarifa_anterior_id") REFERENCES "tarifas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clases_tarifa" ADD CONSTRAINT "clases_tarifa_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_tarifa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifa_movimientos" ADD CONSTRAINT "tarifa_movimientos_tarifa_id_fkey" FOREIGN KEY ("tarifa_id") REFERENCES "tarifas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifa_movimientos" ADD CONSTRAINT "tarifa_movimientos_actualizacion_id_fkey" FOREIGN KEY ("actualizacion_id") REFERENCES "actualizaciones_tarifarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill del valor de referencia para filas previas (tabla → precios[10]; fijo → cuota fija; resto → precio unitario).
UPDATE "tarifas" SET "valor_referencia" = CASE
  WHEN "tipo_calculo" = 'tabla' AND jsonb_typeof("precios") = 'array' AND jsonb_array_length("precios") > 0
    THEN ("precios"->>LEAST(10, jsonb_array_length("precios") - 1))::numeric
  WHEN "tipo_calculo" = 'fijo' THEN "cuota_fija"
  ELSE COALESCE("precio_unitario", "cuota_fija")
END
WHERE "valor_referencia" IS NULL;

COMMIT;
