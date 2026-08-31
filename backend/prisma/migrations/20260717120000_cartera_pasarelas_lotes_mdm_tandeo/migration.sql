-- AlterTable
ALTER TABLE "timbrados" ADD COLUMN     "lote_facturacion_id" TEXT;

-- CreateTable
CREATE TABLE "documentos_cartera" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "recibo_id" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'recibo',
    "periodo" TEXT,
    "monto_original" DECIMAL(12,2) NOT NULL,
    "monto_abonado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo" DECIMAL(12,2) NOT NULL,
    "fecha_emision" TEXT NOT NULL,
    "fecha_vencimiento" TEXT NOT NULL,
    "dias_vencido" INTEGER NOT NULL DEFAULT 0,
    "bucket" TEXT NOT NULL DEFAULT 'corriente',
    "estado" TEXT NOT NULL DEFAULT 'vigente',
    "convenio_id" TEXT,
    "recalculado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_cartera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aplicaciones_pago" (
    "id" TEXT NOT NULL,
    "pago_id" TEXT NOT NULL,
    "documento_cartera_id" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "fecha" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aplicaciones_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estados_cuenta" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "saldo_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo_corriente" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo_vencido" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bucket_corriente" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bucket_1_30" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bucket_31_60" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bucket_61_90" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bucket_90_mas" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "docs_vencidos" INTEGER NOT NULL DEFAULT 0,
    "dias_mora_max" INTEGER NOT NULL DEFAULT 0,
    "score_morosidad" INTEGER NOT NULL DEFAULT 0,
    "categoria" TEXT NOT NULL DEFAULT 'AL_CORRIENTE',
    "en_convenio" BOOLEAN NOT NULL DEFAULT false,
    "restringido" BOOLEAN NOT NULL DEFAULT false,
    "recalculado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estados_cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reglas_dunning" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "tipo_contratacion_id" TEXT,
    "tipo_servicio" TEXT,
    "dias_mora_min" INTEGER NOT NULL,
    "min_docs_vencidos" INTEGER NOT NULL DEFAULT 1,
    "monto_minimo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "accion" TEXT NOT NULL,
    "canal" TEXT,
    "reintento_dias" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reglas_dunning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanas_cobranza" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'borrador',
    "administracion_id" TEXT,
    "bucket_objetivo" TEXT,
    "fecha_inicio" TIMESTAMP(3),
    "fecha_fin" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campanas_cobranza_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acciones_cobranza" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "campana_id" TEXT,
    "regla_id" TEXT,
    "etapa" INTEGER NOT NULL DEFAULT 0,
    "tipo" TEXT NOT NULL,
    "canal" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'ejecutada',
    "saldo_al_momento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dias_mora_al_momento" INTEGER NOT NULL DEFAULT 0,
    "notificacion_log_id" TEXT,
    "restriccion_id" TEXT,
    "orden_id" TEXT,
    "autorizado_por" TEXT,
    "motivo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acciones_cobranza_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intentos_pago" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "pasarela" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "url_pago" TEXT,
    "expira_en" TIMESTAMP(3),
    "pago_id" TEXT,
    "webhook_payload" JSONB,
    "origen" TEXT NOT NULL DEFAULT 'portal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intentos_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes_facturacion" (
    "id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "filtros" JSONB,
    "estado" TEXT NOT NULL DEFAULT 'generado',
    "generados" INTEGER NOT NULL DEFAULT 0,
    "con_error" INTEGER NOT NULL DEFAULT 0,
    "importe_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "motivo_cancelacion" TEXT,
    "cancelado_por" TEXT,
    "lote_origen_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lotes_facturacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lecturas_intervalo" (
    "id" TEXT NOT NULL,
    "medidor_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "m3_acumulado" DECIMAL(14,3) NOT NULL,
    "caudal_lh" DECIMAL(12,3),
    "origen" TEXT NOT NULL DEFAULT 'ami',
    "alarmas" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lecturas_intervalo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendarios_suministro" (
    "id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "horario" JSONB NOT NULL,
    "vigente_desde" TEXT NOT NULL,
    "vigente_hasta" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendarios_suministro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documentos_cartera_recibo_id_key" ON "documentos_cartera"("recibo_id");

-- CreateIndex
CREATE INDEX "documentos_cartera_contrato_id_idx" ON "documentos_cartera"("contrato_id");

-- CreateIndex
CREATE INDEX "documentos_cartera_estado_idx" ON "documentos_cartera"("estado");

-- CreateIndex
CREATE INDEX "documentos_cartera_bucket_idx" ON "documentos_cartera"("bucket");

-- CreateIndex
CREATE INDEX "documentos_cartera_fecha_vencimiento_idx" ON "documentos_cartera"("fecha_vencimiento");

-- CreateIndex
CREATE INDEX "aplicaciones_pago_pago_id_idx" ON "aplicaciones_pago"("pago_id");

-- CreateIndex
CREATE INDEX "aplicaciones_pago_documento_cartera_id_idx" ON "aplicaciones_pago"("documento_cartera_id");

-- CreateIndex
CREATE UNIQUE INDEX "estados_cuenta_contrato_id_key" ON "estados_cuenta"("contrato_id");

-- CreateIndex
CREATE INDEX "estados_cuenta_categoria_idx" ON "estados_cuenta"("categoria");

-- CreateIndex
CREATE INDEX "estados_cuenta_score_morosidad_idx" ON "estados_cuenta"("score_morosidad");

-- CreateIndex
CREATE INDEX "estados_cuenta_saldo_vencido_idx" ON "estados_cuenta"("saldo_vencido");

-- CreateIndex
CREATE INDEX "reglas_dunning_activo_orden_idx" ON "reglas_dunning"("activo", "orden");

-- CreateIndex
CREATE INDEX "campanas_cobranza_estado_idx" ON "campanas_cobranza"("estado");

-- CreateIndex
CREATE INDEX "acciones_cobranza_contrato_id_idx" ON "acciones_cobranza"("contrato_id");

-- CreateIndex
CREATE INDEX "acciones_cobranza_tipo_idx" ON "acciones_cobranza"("tipo");

-- CreateIndex
CREATE INDEX "acciones_cobranza_campana_id_idx" ON "acciones_cobranza"("campana_id");

-- CreateIndex
CREATE INDEX "acciones_cobranza_created_at_idx" ON "acciones_cobranza"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "intentos_pago_referencia_key" ON "intentos_pago"("referencia");

-- CreateIndex
CREATE UNIQUE INDEX "intentos_pago_pago_id_key" ON "intentos_pago"("pago_id");

-- CreateIndex
CREATE INDEX "intentos_pago_contrato_id_idx" ON "intentos_pago"("contrato_id");

-- CreateIndex
CREATE INDEX "intentos_pago_estado_idx" ON "intentos_pago"("estado");

-- CreateIndex
CREATE INDEX "lotes_facturacion_periodo_idx" ON "lotes_facturacion"("periodo");

-- CreateIndex
CREATE INDEX "lotes_facturacion_estado_idx" ON "lotes_facturacion"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "lecturas_intervalo_medidor_id_timestamp_key" ON "lecturas_intervalo"("medidor_id", "timestamp");

-- CreateIndex
CREATE INDEX "calendarios_suministro_sector_id_idx" ON "calendarios_suministro"("sector_id");

-- CreateIndex
CREATE INDEX "timbrados_lote_facturacion_id_idx" ON "timbrados"("lote_facturacion_id");

-- AddForeignKey
ALTER TABLE "timbrados" ADD CONSTRAINT "timbrados_lote_facturacion_id_fkey" FOREIGN KEY ("lote_facturacion_id") REFERENCES "lotes_facturacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_cartera" ADD CONSTRAINT "documentos_cartera_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_cartera" ADD CONSTRAINT "documentos_cartera_recibo_id_fkey" FOREIGN KEY ("recibo_id") REFERENCES "recibos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aplicaciones_pago" ADD CONSTRAINT "aplicaciones_pago_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aplicaciones_pago" ADD CONSTRAINT "aplicaciones_pago_documento_cartera_id_fkey" FOREIGN KEY ("documento_cartera_id") REFERENCES "documentos_cartera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estados_cuenta" ADD CONSTRAINT "estados_cuenta_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acciones_cobranza" ADD CONSTRAINT "acciones_cobranza_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acciones_cobranza" ADD CONSTRAINT "acciones_cobranza_campana_id_fkey" FOREIGN KEY ("campana_id") REFERENCES "campanas_cobranza"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intentos_pago" ADD CONSTRAINT "intentos_pago_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intentos_pago" ADD CONSTRAINT "intentos_pago_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecturas_intervalo" ADD CONSTRAINT "lecturas_intervalo_medidor_id_fkey" FOREIGN KEY ("medidor_id") REFERENCES "medidores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendarios_suministro" ADD CONSTRAINT "calendarios_suministro_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectores_hidraulicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

