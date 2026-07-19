-- CreateTable
CREATE TABLE "auditoria_eventos" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "usuario_email" TEXT,
    "metodo" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "entidad" TEXT,
    "entidad_id" TEXT,
    "status_code" INTEGER NOT NULL,
    "duracion_ms" INTEGER NOT NULL,
    "ip" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_suscripciones" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventos" TEXT[],
    "secreto" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_suscripciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_entregas" (
    "id" TEXT NOT NULL,
    "suscripcion_id" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "status_code" INTEGER,
    "error" TEXT,
    "entregada_en" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_entregas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auditoria_eventos_entidad_idx" ON "auditoria_eventos"("entidad");

-- CreateIndex
CREATE INDEX "auditoria_eventos_usuario_email_idx" ON "auditoria_eventos"("usuario_email");

-- CreateIndex
CREATE INDEX "auditoria_eventos_created_at_idx" ON "auditoria_eventos"("created_at");

-- CreateIndex
CREATE INDEX "webhook_suscripciones_activo_idx" ON "webhook_suscripciones"("activo");

-- CreateIndex
CREATE INDEX "webhook_entregas_suscripcion_id_idx" ON "webhook_entregas"("suscripcion_id");

-- CreateIndex
CREATE INDEX "webhook_entregas_estado_idx" ON "webhook_entregas"("estado");

-- CreateIndex
CREATE INDEX "webhook_entregas_evento_idx" ON "webhook_entregas"("evento");

-- AddForeignKey
ALTER TABLE "webhook_entregas" ADD CONSTRAINT "webhook_entregas_suscripcion_id_fkey" FOREIGN KEY ("suscripcion_id") REFERENCES "webhook_suscripciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
