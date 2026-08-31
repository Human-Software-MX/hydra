-- Bitácora de notificaciones multicanal
CREATE TABLE IF NOT EXISTS "notificacion_logs" (
  "id" TEXT NOT NULL,
  "contrato_id" TEXT,
  "canal" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "destinatario" TEXT NOT NULL,
  "asunto" TEXT,
  "mensaje" TEXT NOT NULL,
  "proveedor" TEXT NOT NULL,
  "enviado" BOOLEAN NOT NULL DEFAULT false,
  "referencia" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notificacion_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notificacion_logs_contrato_id_idx" ON "notificacion_logs" ("contrato_id");
CREATE INDEX IF NOT EXISTS "notificacion_logs_canal_idx" ON "notificacion_logs" ("canal");
CREATE INDEX IF NOT EXISTS "notificacion_logs_tipo_idx" ON "notificacion_logs" ("tipo");
CREATE INDEX IF NOT EXISTS "notificacion_logs_created_at_idx" ON "notificacion_logs" ("created_at");
