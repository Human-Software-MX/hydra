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
 *  - tabla:      importe acumulado leído de `precios[m³]` (m³ redondeados) hasta
 *                rangoMaxM3; por encima, cuotaFija + precioUnitario × m³.
 *  - lineal:     cuotaFija + precioUnitario × consumo.
 *  - lineal_excedente: cuotaFija (cubre `cantidadIncluida` unidades) +
 *                precioUnitario × excedente. Usado por las tarifas de
 *                contratación por longitud (la base cubre los primeros 6 m).
 */

export interface TarifaCalculo {
  tipoServicio: string;
  tipoCalculo: 'escalonado' | 'variable' | 'fijo' | 'tabla' | 'lineal' | 'lineal_excedente' | string;
  rangoMinM3: number | null;
  rangoMaxM3: number | null;
  precioUnitario: number | null;
  cuotaFija: number | null;
  /** tipoCalculo=tabla: importe acumulado por m³ (índice = m³, 0..rangoMaxM3). */
  precios?: number[] | null;
  /** tipoCalculo=lineal_excedente: unidades ya cubiertas por la cuota base (`parametros.cantidadIncluida`). */
  cantidadIncluida?: number | null;
  /** «No objeto de IVA» (multas, recargos): el traslado es 0 sea cual sea `ivaPct`. */
  ivaNoObjeto?: boolean;
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

/** Redondeo a 4 decimales (precios unitarios derivados de una tabla). */
function redondear4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * m³ facturables de una tarifa de tabla: el consumo se redondea al entero más
 * cercano y la fracción exacta de 0.5 se queda en el m³ inferior (regla CEA:
 * sólo sube cuando la fracción supera 0.5).
 */
export function m3Facturables(consumoM3: number): number {
  const piso = Math.floor(consumoM3);
  return consumoM3 - piso > 0.5 ? piso + 1 : piso;
}

/**
 * Tasa de IVA aplicable: las tarifas «No objeto de IVA» (multas, recargos) no
 * trasladan impuesto aunque la fila traiga otro `ivaPct`.
 */
export function tasaIva(t: Pick<TarifaCalculo, 'ivaPct' | 'ivaNoObjeto'>): number {
  return t.ivaNoObjeto ? 0 : Number(t.ivaPct ?? 0);
}

/**
 * Unidades incluidas en la cuota base de una tarifa `lineal_excedente`, leídas
 * de `Tarifa.parametros.cantidadIncluida` (0 si no viene: todo es excedente).
 */
export function cantidadIncluidaDe(parametros: unknown): number {
  const v = (parametros as { cantidadIncluida?: unknown } | null)?.cantidadIncluida;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** `lineal_excedente`: la cuota base cubre `cantidadIncluida`; el resto va a precio proporcional. */
export function importeLinealExcedente(t: TarifaCalculo, cantidad: number): number {
  const incluida = t.cantidadIncluida ?? 0;
  const excedente = Math.max(0, cantidad - incluida);
  return Number(t.cuotaFija ?? 0) + Number(t.precioUnitario ?? 0) * excedente;
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
      ivaPct: tasaIva(t),
      iva: redondear(importe * (tasaIva(t) / 100)),
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
      ivaPct: tasaIva(t),
      iva: redondear(importe * (tasaIva(t) / 100)),
    });
  }

  // Tabla: el importe ya viene acumulado por m³ (índice = m³ facturables).
  for (const t of tarifas.filter((x) => x.tipoCalculo === 'tabla')) {
    const m3 = Math.max(0, m3Facturables(consumoM3));
    const tope = t.rangoMaxM3 ?? (t.precios?.length ? t.precios.length - 1 : 0);
    const dentroDeTabla = !!t.precios?.length && m3 <= tope;
    const importe = dentroDeTabla
      ? redondear(Number(t.precios?.[Math.min(m3, (t.precios?.length ?? 1) - 1)] ?? 0))
      : redondear(Number(t.cuotaFija ?? 0) + Number(t.precioUnitario ?? 0) * m3);
    if (importe === 0) continue;
    lineas.push({
      tipoServicio,
      concepto: `${nombre} — consumo ${m3} m³ (tabla)`,
      m3,
      precioUnitario: m3 > 0 ? redondear4(importe / m3) : importe,
      importe,
      ivaPct: tasaIva(t),
      iva: redondear(importe * (tasaIva(t) / 100)),
    });
  }

  // Lineal: cuota fija más precio por unidad consumida.
  for (const t of tarifas.filter((x) => x.tipoCalculo === 'lineal')) {
    const precio = Number(t.precioUnitario ?? 0);
    const importe = redondear(Number(t.cuotaFija ?? 0) + precio * consumoM3);
    if (importe === 0) continue;
    lineas.push({
      tipoServicio,
      concepto: `${nombre} — cargo lineal`,
      m3: redondear(consumoM3),
      precioUnitario: precio,
      importe,
      ivaPct: tasaIva(t),
      iva: redondear(importe * (tasaIva(t) / 100)),
    });
  }

  // Lineal con excedente: la cuota base cubre `cantidadIncluida` unidades.
  for (const t of tarifas.filter((x) => x.tipoCalculo === 'lineal_excedente')) {
    const incluida = t.cantidadIncluida ?? 0;
    const precio = Number(t.precioUnitario ?? 0);
    const importe = redondear(importeLinealExcedente(t, consumoM3));
    if (importe === 0) continue;
    lineas.push({
      tipoServicio,
      concepto: `${nombre} — cargo base (incluye ${incluida}) + excedente`,
      m3: redondear(consumoM3),
      precioUnitario: precio,
      importe,
      ivaPct: tasaIva(t),
      iva: redondear(importe * (tasaIva(t) / 100)),
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
