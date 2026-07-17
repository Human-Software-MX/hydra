-- CreateTable
CREATE TABLE "sige_hydra" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "reporte_cea_app" TEXT,
    "descripcion_breve" TEXT NOT NULL,
    "titular" TEXT NOT NULL,
    "contrato_num" TEXT NOT NULL,
    "contrato_id" TEXT,
    "orden_aquacis" TEXT,
    "estado_accion" TEXT,
    "canal" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL,
    "grupo_asignacion" TEXT,
    "asignado_a" TEXT,
    "actualizado" TIMESTAMP(3),
    "colonia" TEXT,
    "direccion" TEXT,
    "zona" TEXT,
    "administracion" TEXT,
    "telefono" TEXT,
    "datos_raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sige_hydra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sige_hydra_numero_key" ON "sige_hydra"("numero");

-- CreateIndex
CREATE INDEX "sige_hydra_contrato_id_idx" ON "sige_hydra"("contrato_id");

-- CreateIndex
CREATE INDEX "sige_hydra_contrato_num_idx" ON "sige_hydra"("contrato_num");

-- CreateIndex
CREATE INDEX "sige_hydra_estado_idx" ON "sige_hydra"("estado");

-- AddForeignKey
ALTER TABLE "sige_hydra" ADD CONSTRAINT "sige_hydra_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
