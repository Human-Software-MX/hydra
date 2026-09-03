-- Catálogo maestro de documentos de contratación + refactor de la relación con tipos.
--
-- Fuente: hoja «documento» del catálogo SIGE (dconid). La relación tipo→documento de
-- SIGE viene DEGENERADA: los 170 tipos tienen exactamente los mismos 24 documentos
-- (producto cartesiano, 4 080 filas sin información). Por eso aquí se siembra SOLO el
-- catálogo; la relación real la cura CEA vía API/UI.
--
-- La presentación (ORIGINAL/COPIA) se separa del nombre, y cada documento lleva una
-- clasificación semántica para agrupar los dropdowns (COMUN, PERSONA_MORAL, etc.),
-- pendiente de validación con CEA.

CREATE TABLE "catalogo_documentos" (
    "id" TEXT NOT NULL,
    "codigo_sige" INTEGER,
    "nombre" TEXT NOT NULL,
    "presentacion" TEXT,
    "clasificacion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catalogo_documentos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalogo_documentos_codigo_sige_key" ON "catalogo_documentos"("codigo_sige");
CREATE INDEX "catalogo_documentos_clasificacion_idx" ON "catalogo_documentos"("clasificacion");

-- Refactor de la relación: FK al catálogo, condición de uso y orden.
ALTER TABLE "documentos_requeridos_tipo_contratacion"
    ALTER COLUMN "nombre_documento" DROP NOT NULL,
    ADD COLUMN "documento_id" TEXT,
    ADD COLUMN "aplica_uso" TEXT,
    ADD COLUMN "orden" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "documentos_requeridos_tipo_contratacion_documento_id_idx"
    ON "documentos_requeridos_tipo_contratacion"("documento_id");
CREATE UNIQUE INDEX "documentos_requeridos_tipo_contratacion_tipo_contratacion_i_key"
    ON "documentos_requeridos_tipo_contratacion"("tipo_contratacion_id", "documento_id");

ALTER TABLE "documentos_requeridos_tipo_contratacion"
    ADD CONSTRAINT "documentos_requeridos_tipo_contratacion_documento_id_fkey"
    FOREIGN KEY ("documento_id") REFERENCES "catalogo_documentos"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los 24 documentos del catálogo SIGE. Id estable doc-<dconid>.
INSERT INTO "catalogo_documentos" ("id", "codigo_sige", "nombre", "presentacion", "clasificacion", "updated_at")
SELECT 'doc-' || lpad(v.codigo_sige::text, 3, '0'), v.codigo_sige, v.nombre, v.presentacion, v.clasificacion, CURRENT_TIMESTAMP
FROM (VALUES
  (1, 'Certificado de Número Oficial', 'COPIA', 'COMUN'),
  (2, 'Identificación Oficial', 'COPIA', 'COMUN'),
  (3, 'Constancia de Propiedad', 'ORIGINAL_Y_COPIA', 'COMUN'),
  (5, 'Certificado de Conexión para Toma de Agua', 'ORIGINAL', 'COMUN'),
  (6, 'Póliza de Garantía o Acta de Entrega de la Vivienda', 'COPIA', 'COMUN'),
  (7, 'Acta Constitutiva de la Asociación de Condóminos', 'COPIA', 'CONDOMINAL'),
  (8, 'Identificación Oficial del Representante de la Asociación', 'COPIA', 'CONDOMINAL'),
  (9, 'Documento que lo Avale como Propietario', 'COPIA', 'COMUN'),
  (10, 'Croquis de Ubicación del Predio', NULL, 'COMUN'),
  (11, 'Carta de Adhesión y/o convenio', NULL, 'OTRO'),
  (12, 'Expediente Documentos Factibilidades', NULL, 'FACTIBILIDAD'),
  (13, 'Expediente Documentos Regularizaciones', NULL, 'REGULARIZACION'),
  (14, 'Formato de Solicitud de Baja Definitiva', 'ORIGINAL_Y_COPIA', 'BAJA'),
  (15, 'Petición por escrito', 'ORIGINAL', 'OTRO'),
  (16, 'IFE Representante o titular del Hidrante', 'COPIA', 'HIDRANTE'),
  (17, 'IFE del Representante de cada familia beneficiada', 'COPIA', 'HIDRANTE'),
  (18, 'Solicitud Por Escrito', NULL, 'OTRO'),
  (19, 'Identificación Oficial del Representante', 'COPIA', 'REPRESENTACION'),
  (20, 'Identificación Oficial de 2 Testigos', 'COPIA', 'REPRESENTACION'),
  (21, 'Carta Poder Simple', 'ORIGINAL', 'REPRESENTACION'),
  (22, 'Acta Constitutiva', 'COPIA', 'PERSONA_MORAL'),
  (23, 'RFC (Cédula)', 'COPIA', 'PERSONA_MORAL'),
  (24, 'Poder del Representante Legal', 'COPIA', 'PERSONA_MORAL'),
  (41, 'Uso de suelo', NULL, 'COMUN')
) AS v(codigo_sige, nombre, presentacion, clasificacion)
ON CONFLICT ("codigo_sige") DO UPDATE
   SET "nombre" = EXCLUDED."nombre",
       "presentacion" = EXCLUDED."presentacion",
       "clasificacion" = EXCLUDED."clasificacion",
       "updated_at" = CURRENT_TIMESTAMP;

-- Backfill de filas legacy capturadas como texto libre: si el nombre coincide con un
-- documento del catálogo (ignorando la presentación entre paréntesis), se liga.
UPDATE "documentos_requeridos_tipo_contratacion" d
   SET "documento_id" = c."id"
  FROM "catalogo_documentos" c
 WHERE d."documento_id" IS NULL
   AND d."nombre_documento" IS NOT NULL
   AND upper(trim(regexp_replace(d."nombre_documento", '\s*\((ORIGINAL Y COPIA|ORIGINAL|COPIA)\s*\)\s*$', '', 'i'))) = upper(c."nombre");
