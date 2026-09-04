-- Formaliza dos reglas de la junta CEA 02-sep-2026:
--
-- 1) Saneamiento y alcantarillado NO son tarifas: son un porcentaje del agua.
--    La regla vive en el concepto (porcentaje_de_servicio + porcentaje) y deja
--    de estar hardcodeada en el frontend (10 % alcantarillado, 12 % saneamiento).
-- 2) Campos formales de inspección: medidor binario, diámetro de descarga,
--    metros lineales (los que usan las tarifas de conexión) y resultado binario
--    con motivo e intentos (regla de 3 visitas).

ALTER TABLE "conceptos_cobro"
    ADD COLUMN "porcentaje_de_servicio" TEXT,
    ADD COLUMN "porcentaje" DECIMAL(5,2);

-- Regla inicial (validable por CEA): alcantarillado 10 % del agua, saneamiento 12 %.
UPDATE "conceptos_cobro"
   SET "porcentaje_de_servicio" = 'agua', "porcentaje" = 10
 WHERE upper("nombre") LIKE 'ALCANTARILLADO%';
UPDATE "conceptos_cobro"
   SET "porcentaje_de_servicio" = 'agua', "porcentaje" = 12
 WHERE upper("nombre") LIKE 'SANEAMIENTO%' OR upper("nombre") LIKE 'TRATAMIENTO DE AGUAS%';

ALTER TABLE "solicitud_inspecciones"
    ADD COLUMN "tiene_medidor" BOOLEAN,
    ADD COLUMN "diametro_descarga" TEXT,
    ADD COLUMN "metros_lineales_toma" DECIMAL(8,2),
    ADD COLUMN "metros_lineales_descarga" DECIMAL(8,2),
    ADD COLUMN "realizada" BOOLEAN,
    ADD COLUMN "motivo_no_realizada" TEXT,
    ADD COLUMN "intentos" INTEGER NOT NULL DEFAULT 0;

-- Backfill desde los campos legacy donde existan.
UPDATE "solicitud_inspecciones"
   SET "tiene_medidor" = CASE lower(coalesce("medidor_existente", ''))
       WHEN 'si' THEN true WHEN 'sí' THEN true WHEN 's' THEN true
       WHEN 'no' THEN false WHEN 'n' THEN false ELSE NULL END
 WHERE "medidor_existente" IS NOT NULL;
