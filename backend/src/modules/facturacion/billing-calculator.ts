/**
 * Motor puro de cálculo de facturación de consumo periódico.
 *
 * Sin dependencias de Prisma/NestJS: recibe tarifas ya resueltas y devuelve el
 * desglose de importes. Se mantiene puro para poder verificarlo de forma aislada
 * (scripts/verify-billing.ts) — es código que mueve dinero y debe ser exacto.
 *
 * Modelo de cobro soportado por tipoServicio (agua, saneamiento, alcantarillado, …):
 *  - escalonado: bloques acumulativos [min, max) a precioUnitario por m³.
 *  - variable:   precioUnitario por m³ sobre el rango declarado (bloque único).
 *  - fijo:       cuotaFija independiente del consumo.
 */

export interface TarifaCalculo {
  tipoServicio: string;
  tipoCalculo: 'escalonado' | 'variable' | 'fijo' | string;
  rangoMinM3: number | null;
  rangoMaxM3: number | null;
  precioUnitario: number | null;
  cuotaFija: number | null;
  ivaPct: number;
}

export interface LineaFactura {
  tipoServicio: string;
  concepto: string;
  m3: number;
  precioUnitario: number;
  importe: number;
  ivaPct: number;
  iva: number;
}

export interface ResultadoFactura {
  consumoM3: number;
  lineas: LineaFactura[];
  subtotal: number;
  iva: number;
  total: number;
}

/** Redondea a 2 decimales evitando la deriva de punto flotante (12.005 -> 12.01). */
export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const nombreServicio = (tipoServicio: string): string => {
  const map: Record<string, string> = {
    agua: 'Servicio de agua potable',
    saneamiento: 'Saneamiento',
    alcantarillado: 'Alcantarillado',
    drenaje: 'Drenaje',
  };
  return map[tipoServicio] ?? tipoServicio;
};

/**
 * Calcula las líneas de un solo tipo de servicio para un consumo dado.
 * Ordena internamente las tarifas escalonadas por rango para ser robusto al orden de entrada.
 */
export function calcularServicio(
  tipoServicio: string,
  tarifas: TarifaCalculo[],
  consumoM3: number,
): LineaFactura[] {
  const lineas: LineaFactura[] = [];
  const nombre = nombreServicio(tipoServicio);

  // Cuota fija: se cobra siempre, exista o no consumo.
  for (const t of tarifas.filter((x) => x.tipoCalculo === 'fijo')) {
    const importe = redondear(Number(t.cuotaFija ?? 0));
    if (importe === 0) continue;
    lineas.push({
      tipoServicio,
      concepto: `${nombre} — cuota fija`,
      m3: 0,
      precioUnitario: importe,
      importe,
      ivaPct: Number(t.ivaPct ?? 0),
      iva: redondear(importe * (Number(t.ivaPct ?? 0) / 100)),
    });
  }

  // Escalonado / variable: bloques acumulativos ordenados por límite inferior.
  const bloques = tarifas
    .filter((x) => x.tipoCalculo === 'escalonado' || x.tipoCalculo === 'variable')
    .sort((a, b) => (a.rangoMinM3 ?? 0) - (b.rangoMinM3 ?? 0));

  for (const t of bloques) {
    const min = t.rangoMinM3 ?? 0;
    const max = t.rangoMaxM3 ?? Infinity;
    if (consumoM3 <= min) continue;
    const m3EnRango = Math.min(consumoM3, max) - min;
    if (m3EnRango <= 0) continue;
    const precio = Number(t.precioUnitario ?? 0);
    const importe = redondear(m3EnRango * precio);
    lineas.push({
      tipoServicio,
      concepto: `${nombre} — consumo ${min}-${max === Infinity ? '∞' : max} m³`,
      m3: redondear(m3EnRango),
      precioUnitario: precio,
      importe,
      ivaPct: Number(t.ivaPct ?? 0),
      iva: redondear(importe * (Number(t.ivaPct ?? 0) / 100)),
    });
  }

  return lineas;
}

/**
 * Calcula la factura completa combinando todos los servicios que tengan tarifa vigente.
 * `tarifasPorServicio` agrupa las tarifas ya filtradas por vigencia y administración.
 */
export function calcularFactura(params: {
  consumoM3: number;
  tarifasPorServicio: Record<string, TarifaCalculo[]>;
  /** Cargos adicionales fijos (p. ej. recargos, DAP) ya calculados aguas arriba. */
  cargosAdicionales?: Array<{ concepto: string; importe: number; ivaPct?: number }>;
}): ResultadoFactura {
  const { consumoM3, tarifasPorServicio, cargosAdicionales = [] } = params;
  const lineas: LineaFactura[] = [];

  for (const [tipoServicio, tarifas] of Object.entries(tarifasPorServicio)) {
    if (!tarifas?.length) continue;
    lineas.push(...calcularServicio(tipoServicio, tarifas, consumoM3));
  }

  for (const cargo of cargosAdicionales) {
    const importe = redondear(cargo.importe);
    lineas.push({
      tipoServicio: 'otros',
      concepto: cargo.concepto,
      m3: 0,
      precioUnitario: importe,
      importe,
      ivaPct: cargo.ivaPct ?? 0,
      iva: redondear(importe * ((cargo.ivaPct ?? 0) / 100)),
    });
  }

  const subtotal = redondear(lineas.reduce((s, l) => s + l.importe, 0));
  const iva = redondear(lineas.reduce((s, l) => s + l.iva, 0));
  const total = redondear(subtotal + iva);

  return { consumoM3, lineas, subtotal, iva, total };
}
