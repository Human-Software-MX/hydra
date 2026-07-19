-- AlterTable
ALTER TABLE "campanas_cobranza" ADD COLUMN "grupo_control_pct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "acciones_cobranza" ADD COLUMN "es_control" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "registros_sequia" (
    "id" TEXT NOT NULL,
    "fecha_corte" TEXT NOT NULL,
    "cve_inegi" TEXT NOT NULL,
    "municipio" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "categoria" TEXT,
    "fuente" TEXT NOT NULL DEFAULT 'msm_conagua',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_sequia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organismos" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "db_url" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organismos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registros_sequia_fecha_corte_cve_inegi_key" ON "registros_sequia"("fecha_corte", "cve_inegi");
CREATE INDEX "registros_sequia_fecha_corte_idx" ON "registros_sequia"("fecha_corte");
CREATE INDEX "registros_sequia_categoria_idx" ON "registros_sequia"("categoria");
CREATE INDEX "registros_sequia_estado_idx" ON "registros_sequia"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "organismos_slug_key" ON "organismos"("slug");
CREATE INDEX "organismos_activo_idx" ON "organismos"("activo");

-- PostGIS (opcional): habilita consultas espaciales server-side. Si el
-- servidor Postgres no tiene los binarios de PostGIS, la migración NO falla:
-- el módulo GIS usa el fallback en JS (haversine / ray-casting).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
  RAISE NOTICE 'PostGIS habilitado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PostGIS no disponible (%). Las consultas espaciales usarán el fallback JS.', SQLERRM;
END $$;
