-- Integración SUPRA (Payment Engine): mapa de IDs, inbox de eventos y outbox de comandos.

CREATE TABLE "supra_mapa" (
    "id" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "hydra_id" TEXT NOT NULL,
    "supra_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supra_mapa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supra_mapa_entidad_hydra_id_key" ON "supra_mapa"("entidad", "hydra_id");
CREATE UNIQUE INDEX "supra_mapa_entidad_supra_id_key" ON "supra_mapa"("entidad", "supra_id");
CREATE INDEX "supra_mapa_supra_id_idx" ON "supra_mapa"("supra_id");

CREATE TABLE "supra_evento_inbox" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "sequence" BIGINT,
    "payload" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "recibido_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesado_en" TIMESTAMP(3),

    CONSTRAINT "supra_evento_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supra_evento_inbox_event_id_key" ON "supra_evento_inbox"("event_id");
CREATE INDEX "supra_evento_inbox_estado_idx" ON "supra_evento_inbox"("estado");
CREATE INDEX "supra_evento_inbox_tipo_idx" ON "supra_evento_inbox"("tipo");

CREATE TABLE "supra_comando_outbox" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "payload" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximo_intento" TIMESTAMP(3),
    "respuesta" JSONB,
    "error" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supra_comando_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supra_comando_outbox_idempotency_key_key" ON "supra_comando_outbox"("idempotency_key");
CREATE INDEX "supra_comando_outbox_estado_proximo_intento_idx" ON "supra_comando_outbox"("estado", "proximo_intento");
CREATE INDEX "supra_comando_outbox_tipo_idx" ON "supra_comando_outbox"("tipo");
