-- Volumen producido por periodo (macromedición) — insumo de eficiencia física PIGOO y balance M36
CREATE TABLE IF NOT EXISTS "volumenes_producidos" (
  "id" TEXT NOT NULL,
  "periodo" TEXT NOT NULL,
  "administracion_id" TEXT,
  "m3" DECIMAL(14,2) NOT NULL,
  "fuente" TEXT,
  "notas" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "volumenes_producidos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "volumenes_producidos_periodo_administracion_id_key"
  ON "volumenes_producidos" ("periodo", "administracion_id");
CREATE INDEX IF NOT EXISTS "volumenes_producidos_periodo_idx" ON "volumenes_producidos" ("periodo");
