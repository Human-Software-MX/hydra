-- Cola de excepciones VEE de lecturas
CREATE TABLE IF NOT EXISTS "excepciones_lectura" (
  "id" TEXT NOT NULL,
  "lectura_id" TEXT NOT NULL,
  "contrato_id" TEXT NOT NULL,
  "periodo" TEXT NOT NULL,
  "regla" TEXT NOT NULL,
  "severidad" TEXT NOT NULL,
  "detalle" JSONB,
  "estado" TEXT NOT NULL DEFAULT 'pendiente',
  "resolucion" TEXT,
  "resuelto_por" TEXT,
  "resuelta_en" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "excepciones_lectura_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "excepciones_lectura_lectura_id_regla_key" ON "excepciones_lectura" ("lectura_id", "regla");
CREATE INDEX IF NOT EXISTS "excepciones_lectura_contrato_id_idx" ON "excepciones_lectura" ("contrato_id");
CREATE INDEX IF NOT EXISTS "excepciones_lectura_periodo_idx" ON "excepciones_lectura" ("periodo");
CREATE INDEX IF NOT EXISTS "excepciones_lectura_estado_idx" ON "excepciones_lectura" ("estado");
CREATE INDEX IF NOT EXISTS "excepciones_lectura_regla_idx" ON "excepciones_lectura" ("regla");
