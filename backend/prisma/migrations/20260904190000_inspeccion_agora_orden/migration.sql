-- Enlace de la inspección con su orden en AgoraCore (junta CEA 02-sep: los datos
-- de la inspección llegan a través del servicio que lleva la orden, sin recaptura).
ALTER TABLE "solicitud_inspecciones" ADD COLUMN "agora_orden_ref" TEXT;
