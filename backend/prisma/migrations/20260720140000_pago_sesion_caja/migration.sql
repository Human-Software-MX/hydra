-- Vínculo operativo pago↔cajero/sesión para el corte de caja por sesión.

ALTER TABLE "pagos" ADD COLUMN "usuario_id" TEXT;
ALTER TABLE "pagos" ADD COLUMN "sesion_caja_id" TEXT;

CREATE INDEX "pagos_sesion_caja_id_idx" ON "pagos"("sesion_caja_id");
