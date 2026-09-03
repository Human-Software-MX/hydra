-- Archivos entregados por el ciudadano por solicitud, clasificados contra el
-- catálogo maestro de documentos. Varios archivos por tipo de documento permitidos.

CREATE TABLE "solicitud_documentos" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "documento_id" TEXT,
    "nombre_documento" TEXT,
    "archivo_nombre" TEXT NOT NULL,
    "archivo_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "solicitud_documentos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "solicitud_documentos_solicitud_id_idx" ON "solicitud_documentos"("solicitud_id");
CREATE INDEX "solicitud_documentos_documento_id_idx" ON "solicitud_documentos"("documento_id");

ALTER TABLE "solicitud_documentos"
    ADD CONSTRAINT "solicitud_documentos_solicitud_id_fkey"
    FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solicitud_documentos"
    ADD CONSTRAINT "solicitud_documentos_documento_id_fkey"
    FOREIGN KEY ("documento_id") REFERENCES "catalogo_documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
