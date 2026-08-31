-- Mínimo vital (LGA dic-2025): restricción de flujo como estado del servicio
CREATE TABLE IF NOT EXISTS "restricciones_servicio" (
  "id" TEXT NOT NULL,
  "contrato_id" TEXT NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'programada',
  "motivo" TEXT NOT NULL DEFAULT 'adeudo',
  "litros_diarios_minimo" INTEGER NOT NULL DEFAULT 100,
  "personas_vivienda" INTEGER,
  "adeudo_al_momento" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "recibos_vencidos" INTEGER NOT NULL DEFAULT 0,
  "orden_restriccion_id" TEXT,
  "orden_reversa_id" TEXT,
  "dispositivo" TEXT,
  "evidencia" JSONB,
  "evidencia_reversa" JSONB,
  "fecha_programada" TIMESTAMP(3),
  "fecha_aplicacion" TIMESTAMP(3),
  "fecha_reversa" TIMESTAMP(3),
  "autorizado_por" TEXT,
  "aplicado_por" TEXT,
  "notas" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "restricciones_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restricciones_servicio_contrato_id_fkey" FOREIGN KEY ("contrato_id")
    REFERENCES "contratos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "restricciones_servicio_contrato_id_idx" ON "restricciones_servicio" ("contrato_id");
CREATE INDEX IF NOT EXISTS "restricciones_servicio_estado_idx" ON "restricciones_servicio" ("estado");
CREATE INDEX IF NOT EXISTS "restricciones_servicio_fecha_programada_idx" ON "restricciones_servicio" ("fecha_programada");
