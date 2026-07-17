/**
 * Balance hídrico IWA/AWWA (manual M36) — calculador puro.
 *
 * Descompone el volumen suministrado al sistema en consumo autorizado y
 * pérdidas, siguiendo la taxonomía estándar:
 *
 *   Volumen suministrado
 *   ├─ Consumo autorizado
 *   │  ├─ Facturado medido        (consumos tipo Real)
 *   │  ├─ Facturado no medido     (Promedio/Mixto/Cuota fija)
 *   │  └─ Autorizado no facturado (hidrantes, parques, purgas — parámetro)
 *   └─ Pérdidas de agua (= suministrado − consumo autorizado)
 *      ├─ Pérdidas aparentes (comerciales)
 *      │  ├─ Submedición          (% del volumen medido — parámetro, típico 5-10%)
 *      │  └─ Consumo no autorizado (% del suministrado — parámetro)
 *      └─ Pérdidas reales (físicas) = resto
 *
 * Valorización estándar M36: pérdidas aparentes a tarifa media de venta
 * (es agua que llegó al usuario y no se cobró) y pérdidas reales a costo
 * de producción (es agua que nunca llegó).
 */

export interface ParametrosBalance {
  /** m³ autorizados no facturados (hidrantes, riego público…). Default 0. */
  autorizadoNoFacturadoM3?: number;
  /** Fracción de submedición sobre el volumen medido (0.05 = 5%). Default 0.05. */
  fraccionSubmedicion?: number;
  /** Fracción de consumo no autorizado sobre el suministrado. Default 0.02. */
  fraccionNoAutorizado?: number;
  /** Costo de producción por m³ (para valorizar pérdidas reales). Default: tarifa media. */
  costoProduccionM3?: number;
}

export interface EntradaBalance {
  suministradoM3: number;
  facturadoMedidoM3: number;
  facturadoNoMedidoM3: number;
  /** Importe facturado del periodo (para derivar tarifa media $/m³). */
  importeFacturado: number;
  parametros?: ParametrosBalance;
}

export interface BalanceM36 {
  suministradoM3: number;
  consumoAutorizado: {
    facturadoMedidoM3: number;
    facturadoNoMedidoM3: number;
    autorizadoNoFacturadoM3: number;
    totalM3: number;
  };
  perdidas: {
    totalM3: number;
    aparentes: {
      submedicionM3: number;
      noAutorizadoM3: number;
      totalM3: number;
      valorPesos: number; // a tarifa media (agua entregada no cobrada)
    };
    realesM3: number;
    realesValorPesos: number; // a costo de producción
  };
  indicadores: {
    aguaNoContabilizadaPct: number | null; // NRW = (suministrado - facturado) / suministrado
    eficienciaFisicaPct: number | null; // facturado / suministrado
    tarifaMediaM3: number | null;
    perdidasTotalesValorPesos: number;
  };
  advertencias: string[];
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularBalanceM36(entrada: EntradaBalance): BalanceM36 {
  const p = entrada.parametros ?? {};
  const advertencias: string[] = [];

  const suministrado = entrada.suministradoM3;
  const medido = entrada.facturadoMedidoM3;
  const noMedido = entrada.facturadoNoMedidoM3;
  const facturadoTotal = medido + noMedido;
  const autorizadoNoFacturado = p.autorizadoNoFacturadoM3 ?? 0;

  const consumoAutorizadoTotal = facturadoTotal + autorizadoNoFacturado;

  const tarifaMedia = facturadoTotal > 0 ? entrada.importeFacturado / facturadoTotal : null;
  const costoProduccion = p.costoProduccionM3 ?? tarifaMedia ?? 0;
  if (p.costoProduccionM3 === undefined) {
    advertencias.push('costoProduccionM3 no especificado; pérdidas reales valorizadas a tarifa media');
  }

  // Pérdidas totales = suministrado − consumo autorizado (piso en 0 con advertencia).
  let perdidasTotales = suministrado - consumoAutorizadoTotal;
  if (perdidasTotales < 0) {
    advertencias.push(
      `El consumo autorizado (${r2(consumoAutorizadoTotal)} m³) excede el suministrado (${r2(suministrado)} m³); revise la macromedición`,
    );
    perdidasTotales = 0;
  }

  // Pérdidas aparentes estimadas por parámetros, acotadas a las pérdidas totales.
  const submedicion = medido * (p.fraccionSubmedicion ?? 0.05);
  const noAutorizado = suministrado * (p.fraccionNoAutorizado ?? 0.02);
  let aparentes = submedicion + noAutorizado;
  if (aparentes > perdidasTotales) {
    advertencias.push('Las pérdidas aparentes estimadas exceden las totales; se acotan al total');
    aparentes = perdidasTotales;
  }
  const reales = perdidasTotales - aparentes;

  const valorAparentes = aparentes * (tarifaMedia ?? 0);
  const valorReales = reales * costoProduccion;

  return {
    suministradoM3: r2(suministrado),
    consumoAutorizado: {
      facturadoMedidoM3: r2(medido),
      facturadoNoMedidoM3: r2(noMedido),
      autorizadoNoFacturadoM3: r2(autorizadoNoFacturado),
      totalM3: r2(consumoAutorizadoTotal),
    },
    perdidas: {
      totalM3: r2(perdidasTotales),
      aparentes: {
        submedicionM3: r2(Math.min(submedicion, aparentes)),
        noAutorizadoM3: r2(Math.max(aparentes - submedicion, 0)),
        totalM3: r2(aparentes),
        valorPesos: r2(valorAparentes),
      },
      realesM3: r2(reales),
      realesValorPesos: r2(valorReales),
    },
    indicadores: {
      aguaNoContabilizadaPct:
        suministrado > 0 ? r2(((suministrado - facturadoTotal) / suministrado) * 100) : null,
      eficienciaFisicaPct: suministrado > 0 ? r2((facturadoTotal / suministrado) * 100) : null,
      tarifaMediaM3: tarifaMedia !== null ? r2(tarifaMedia) : null,
      perdidasTotalesValorPesos: r2(valorAparentes + valorReales),
    },
    advertencias,
  };
}
