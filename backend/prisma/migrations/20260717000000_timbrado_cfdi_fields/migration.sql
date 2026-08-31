-- Timbrado: campos fiscales CFDI 4.0
ALTER TABLE "timbrados"
  ADD COLUMN IF NOT EXISTS "serie" TEXT,
  ADD COLUMN IF NOT EXISTS "folio" TEXT,
  ADD COLUMN IF NOT EXISTS "forma_pago" TEXT,
  ADD COLUMN IF NOT EXISTS "metodo_pago" TEXT,
  ADD COLUMN IF NOT EXISTS "uso_cfdi" TEXT,
  ADD COLUMN IF NOT EXISTS "fecha_timbrado" TEXT,
  ADD COLUMN IF NOT EXISTS "sello_cfdi" TEXT,
  ADD COLUMN IF NOT EXISTS "sello_sat" TEXT,
  ADD COLUMN IF NOT EXISTS "no_certificado_sat" TEXT,
  ADD COLUMN IF NOT EXISTS "rfc_prov_certif" TEXT,
  ADD COLUMN IF NOT EXISTS "cadena_original_sat" TEXT,
  ADD COLUMN IF NOT EXISTS "xml" TEXT,
  ADD COLUMN IF NOT EXISTS "pac_proveedor" TEXT;

CREATE INDEX IF NOT EXISTS "timbrados_uuid_idx" ON "timbrados" ("uuid");
