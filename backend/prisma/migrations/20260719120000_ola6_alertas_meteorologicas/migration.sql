-- Ola 6: alertamiento meteorológico oficial multi-fuente (NHC, GloFAS, CAP)
-- Bitácora de alertas difundidas — dedup de envíos al personal operativo.

CREATE TABLE IF NOT EXISTS "alertas_climaticas_emitidas" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "fuente" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidad" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "detalle" TEXT NOT NULL,
    "destinatarios" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alertas_climaticas_emitidas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "alertas_climaticas_emitidas_clave_key" ON "alertas_climaticas_emitidas"("clave");
CREATE INDEX IF NOT EXISTS "alertas_climaticas_emitidas_fuente_idx" ON "alertas_climaticas_emitidas"("fuente");
CREATE INDEX IF NOT EXISTS "alertas_climaticas_emitidas_created_at_idx" ON "alertas_climaticas_emitidas"("created_at");
