-- Gap detection del inbox SUPRA: el escaneo LEAD(sequence) OVER (ORDER BY sequence)
-- del detector de huecos recorre este índice en vez de ordenar la tabla completa.

CREATE INDEX "supra_evento_inbox_sequence_idx" ON "supra_evento_inbox"("sequence");
