-- Clasificación fiscal SIGE por concepto de cobro.
-- Fuente: hoja «Cat conceptos contrat» del catálogo SIGE (tconid, tasa_16, tasa_0, tasa_no_objeto).
-- AMBAS = el concepto puede ir a 16 % o 0 % según el uso (doméstico/no doméstico);
-- NO_OBJETO = fuera del objeto del IVA (multas y recargos).

ALTER TABLE "conceptos_cobro"
    ADD COLUMN "sige_tcon_id" INTEGER,
    ADD COLUMN "clasificacion_iva" TEXT;

CREATE UNIQUE INDEX "conceptos_cobro_sige_tcon_id_key" ON "conceptos_cobro"("sige_tcon_id");
