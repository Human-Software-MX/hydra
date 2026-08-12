-- Batch B — Data integrity & ingestion
-- =====================================================================
-- ⚠️  NOT YET APPLIED TO ANY DATABASE. Deploy decision belongs to Fernando.
--     The remote/production DB (35.188.238.10:5433) may already contain data,
--     so this migration is ATOMIC and SELF-GUARDING:
--       * Todo corre dentro de un único BEGIN … COMMIT. Postgres soporta DDL
--         transaccional para CREATE INDEX y ADD CONSTRAINT, así que si algo
--         falla el rollback deja la BD EXACTAMENTE en su esquema previo — sin
--         índices/constraints a medias y sin dejar la migración marcada como
--         fallida (evita el brick P3009 en `prisma migrate deploy`).
--       * Los guardas DO $$ … $$ al inicio ABORTAN la transacción con un
--         mensaje descriptivo ANTES de tocar el esquema si detectan datos que
--         violarían los constraints (huérfanos o duplicados). No son comentarios:
--         son SQL ejecutable que corre aunque `start:prod` aplique la migración
--         desatendido.
--
--     Prisma 6.8.2 NO envuelve el archivo en una transacción propia, por eso el
--     BEGIN/COMMIT explícito es obligatorio para la atomicidad.
--
--     Remediación si un guarda aborta (elegir antes de reintentar):
--       - Huérfanos en lecturas: `lecturas.contrato_id` histórico guardaba el
--         NÚMERO de contrato (substring 14..22), no un `contratos.id` (cuid).
--         (a) Backfill con el `contratos.id` resuelto (match por
--             numero_contrato / cea_num_contrato — ver
--             LecturasService.resolverContrato), o
--         (b) archivar/borrar los renglones huérfanos, o
--         (c) si la tabla está vacía en prod, no hay nada que hacer.
--       - Duplicados (contrato_id, periodo) en lecturas/consumos: dedupe antes
--         de aplicar (conservar el renglón vigente por periodo/contrato).
--
--     NO se usa CREATE INDEX CONCURRENTLY: no puede correr dentro de una
--     transacción. CREATE UNIQUE INDEX normal es lo correcto aquí.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- GUARDA 0) Huérfanos en lecturas respecto de la FK que se agrega abajo.
--    Aborta la transacción (rollback total) si `lecturas.contrato_id` apunta a
--    un contrato inexistente (típicamente el número crudo del archivo plano).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  huerfanas bigint;
BEGIN
  SELECT COUNT(*) INTO huerfanas
  FROM lecturas l
  LEFT JOIN contratos c ON c.id = l.contrato_id
  WHERE c.id IS NULL;

  IF huerfanas > 0 THEN
    RAISE EXCEPTION
      'Batch B abort: % lecturas huérfanas (contrato_id no es un contratos.id). Backfill/limpiar antes de aplicar.',
      huerfanas;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- GUARDA 1) Duplicados (contrato_id, periodo) en lecturas.
--    Aborta si existe más de una lectura por contrato+periodo (violaría el
--    UNIQUE que se crea abajo).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  dups bigint;
BEGIN
  SELECT COUNT(*) INTO dups
  FROM (
    SELECT contrato_id, periodo
    FROM lecturas
    GROUP BY contrato_id, periodo
    HAVING COUNT(*) > 1
  ) d;

  IF dups > 0 THEN
    RAISE EXCEPTION
      'Batch B abort: % combinaciones (contrato_id, periodo) duplicadas en lecturas. Dedupe antes de aplicar.',
      dups;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- GUARDA 2) Duplicados (contrato_id, periodo) en consumos.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  dups bigint;
BEGIN
  SELECT COUNT(*) INTO dups
  FROM (
    SELECT contrato_id, periodo
    FROM consumos
    GROUP BY contrato_id, periodo
    HAVING COUNT(*) > 1
  ) d;

  IF dups > 0 THEN
    RAISE EXCEPTION
      'Batch B abort: % combinaciones (contrato_id, periodo) duplicadas en consumos. Dedupe antes de aplicar.',
      dups;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1) UNIQUE (contrato_id, periodo) on consumos
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX "consumos_contrato_id_periodo_key" ON "consumos"("contrato_id", "periodo");

-- ---------------------------------------------------------------------
-- 2) Idempotent-ingestion lookup index (period + file hash) on lotes_lecturas
--    Non-unique on purpose: legacy lotes have NULL archivo_hash; a UNIQUE
--    over a nullable column would be inconsistent across NULLs. Duplicate
--    rejection is enforced in application code (LecturasService.cargarLote).
-- ---------------------------------------------------------------------
CREATE INDEX "lotes_lecturas_periodo_archivo_hash_idx" ON "lotes_lecturas"("periodo", "archivo_hash");

-- ---------------------------------------------------------------------
-- 3) UNIQUE (contrato_id, periodo) on lecturas
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX "lecturas_contrato_id_periodo_key" ON "lecturas"("contrato_id", "periodo");

-- ---------------------------------------------------------------------
-- 4) Real FK  lecturas.contrato_id -> contratos.id
--    La GUARDA 0 ya garantizó que no hay huérfanos, así que este ADD CONSTRAINT
--    no puede abortar por datos legados.
-- ---------------------------------------------------------------------
ALTER TABLE "lecturas" ADD CONSTRAINT "lecturas_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
