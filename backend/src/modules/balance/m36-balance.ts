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
  /**
   * Grado de confianza 1-10 de la macromedición (data grading AWWA):
   * capturado manual sin calibración verificada = 5 (default); macromedidores
   * calibrados anualmente = 8+.
   */
  gradoMacromedicion?: number;
}

/**
 * Características físicas de la red para calcular UARL/ILI (IWA Water Loss
 * Task Force). Sin estos datos el balance sigue funcionando; solo se omiten
 * ILI y su banda.
 */
export interface ParametrosRed {
  /** Lm — longitud de red de distribución (km). */
  longitudRedKm: number;
  /** Nc — número de tomas (acometidas). */
  numeroTomas: number;
  /**
   * Lp — longitud total de tubería privada entre límite de propiedad y
   * medidor (km). Default 0: en México el medidor suele estar en el límite.
   */
  longitudAcometidasKm?: number;
  /** P — presión media de operación (m.c.a.). Default 20 (con advertencia). */
  presionMediaM?: number;
  /** Días del periodo del balance. Default 30. */
  diasPeriodo?: number;
}

export interface EntradaBalance {
  suministradoM3: number;
  facturadoMedidoM3: number;
  facturadoNoMedidoM3: number;
  /** Importe facturado del periodo (para derivar tarifa media $/m³). */
  importeFacturado: number;
  parametros?: ParametrosBalance;
  red?: ParametrosRed;
}

/** Bandas del World Bank Institute para países en desarrollo. */
export type BandaILI = 'A' | 'B' | 'C' | 'D';

export interface IndicadorILI {
  /** UARL del periodo (m³) — pérdidas reales inevitables según fórmula IWA. */
  uarlM3: number;
  /** CARL (m³/día) — pérdidas reales actuales por día. */
  carlM3Dia: number;
  /** ILI = CARL/UARL. Adimensional; comparable entre organismos. */
  ili: number;
  banda: BandaILI;
  bandaDescripcion: string;
}

export interface ComponenteGrading {
  componente: string;
  /** Grado 1-10 estilo AWWA Free Water Audit Software. */
  grado: number;
  base: string;
}

export interface DataGrading {
  componentes: ComponenteGrading[];
  /** Puntaje ponderado 0-100 (data validity score). */
  puntaje: number;
  /** Nivel AWWA I-V. */
  nivel: 'I' | 'II' | 'III' | 'IV' | 'V';
  recomendaciones: string[];
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
    /** ILI/UARL — solo cuando se proporcionan características de red. */
    ili: IndicadorILI | null;
  };
  dataGrading: DataGrading;
  advertencias: string[];
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Bandas del World Bank Institute (países en desarrollo) para clasificar el ILI.
 * Referencia: Liemberger & McKenzie, "Aqualibre" / banding WBI.
 */
const BANDAS_ILI: Array<{ hasta: number; banda: BandaILI; descripcion: string }> = [
  {
    hasta: 4,
    banda: 'A',
    descripcion:
      'Reducción adicional de pérdidas puede no ser rentable salvo escasez; requiere análisis fino',
  },
  {
    hasta: 8,
    banda: 'B',
    descripcion:
      'Margen de mejora significativo: gestión de presión, control activo de fugas y mejor mantenimiento',
  },
  {
    hasta: 16,
    banda: 'C',
    descripcion:
      'Registro deficiente de pérdidas; tolerable solo con agua abundante y barata — intensificar reducción',
  },
  {
    hasta: Infinity,
    banda: 'D',
    descripcion: 'Uso muy ineficiente del recurso; programa de reducción de pérdidas imperativo y urgente',
  },
];

/**
 * UARL/ILI según la IWA Water Loss Task Force.
 *
 *   UARL (L/día) = (18·Lm + 0.8·Nc + 25·Lp) · P
 *   ILI = CARL / UARL   (ambos en el mismo periodo)
 *
 * La fórmula pierde validez estadística en sistemas muy pequeños o de baja
 * densidad (IWA: <3,000 tomas, <20 tomas/km o P <25 m) — se advierte, no se bloquea.
 */
export function calcularILI(
  perdidasRealesM3: number,
  red: ParametrosRed,
  advertencias: string[],
): IndicadorILI | null {
  const lm = red.longitudRedKm;
  const nc = red.numeroTomas;
  const lp = red.longitudAcometidasKm ?? 0;
  const dias = red.diasPeriodo ?? 30;
  if (lm <= 0 || nc <= 0 || dias <= 0) {
    advertencias.push('Datos de red inválidos (longitud, tomas o días ≤ 0); ILI omitido');
    return null;
  }

  let presion = red.presionMediaM;
  if (presion === undefined) {
    presion = 20;
    advertencias.push('presionMediaM no especificada; ILI calculado con 20 m.c.a. por defecto');
  }

  if (nc < 3_000) advertencias.push('ILI poco confiable: la fórmula UARL asume ≥3,000 tomas');
  if (nc / lm < 20) advertencias.push('ILI poco confiable: densidad menor a 20 tomas/km de red');
  if (presion < 25) advertencias.push('ILI aproximado: la fórmula UARL asume presión media ≥25 m.c.a.');

  const uarlLitrosDia = (18 * lm + 0.8 * nc + 25 * lp) * presion;
  const uarlM3 = (uarlLitrosDia * dias) / 1_000;
  if (uarlM3 <= 0) return null;

  const ili = perdidasRealesM3 / uarlM3;
  const bandaDef = BANDAS_ILI.find((b) => ili < b.hasta) ?? BANDAS_ILI[BANDAS_ILI.length - 1];
  return {
    uarlM3: r2(uarlM3),
    carlM3Dia: r2(perdidasRealesM3 / dias),
    ili: r2(ili),
    banda: bandaDef.banda,
    bandaDescripcion: bandaDef.descripcion,
  };
}

const NIVELES_GRADING: Array<{ hasta: number; nivel: DataGrading['nivel'] }> = [
  { hasta: 25, nivel: 'I' },
  { hasta: 50, nivel: 'II' },
  { hasta: 70, nivel: 'III' },
  { hasta: 90, nivel: 'IV' },
  { hasta: 100, nivel: 'V' },
];

/**
 * Data grading simplificado estilo AWWA Free Water Audit Software: cada
 * componente del balance recibe un grado 1-10 según la procedencia de su dato
 * (medido y calibrado > medido > estimado local > default bibliográfico) y el
 * puntaje ponderado indica cuánta confianza merece el balance completo.
 */
function calcularDataGrading(entrada: EntradaBalance, conRed: boolean): DataGrading {
  const p = entrada.parametros ?? {};
  const componentes: ComponenteGrading[] = [];
  const recomendaciones: string[] = [];

  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

  const gradoSuministrado = clamp(Math.round(p.gradoMacromedicion ?? 5), 1, 10);
  componentes.push({
    componente: 'volumen_suministrado',
    grado: gradoSuministrado,
    base:
      p.gradoMacromedicion !== undefined
        ? 'grado declarado por el organismo'
        : 'macromedición capturada manualmente sin calibración verificada (default 5)',
  });
  if (gradoSuministrado < 7) {
    recomendaciones.push('Calibrar macromedidores por fuente y documentar la verificación anual');
  }

  const facturadoTotal = entrada.facturadoMedidoM3 + entrada.facturadoNoMedidoM3;
  const fraccionMedida = facturadoTotal > 0 ? entrada.facturadoMedidoM3 / facturadoTotal : 0;
  const gradoMedido = fraccionMedida >= 0.9 ? 8 : fraccionMedida >= 0.7 ? 6 : fraccionMedida >= 0.5 ? 4 : 2;
  componentes.push({
    componente: 'consumo_facturado',
    grado: gradoMedido,
    base: `${r2(fraccionMedida * 100)}% del volumen facturado proviene de micromedición real`,
  });
  if (gradoMedido < 6) {
    recomendaciones.push('Aumentar cobertura de micromedición y reducir consumos estimados/cuota fija');
  }

  const estimacionesDeclaradas =
    p.fraccionSubmedicion !== undefined || p.fraccionNoAutorizado !== undefined;
  const gradoAparentes = estimacionesDeclaradas ? 5 : 3;
  componentes.push({
    componente: 'perdidas_aparentes',
    grado: gradoAparentes,
    base: estimacionesDeclaradas
      ? 'fracciones de submedición/no autorizado estimadas por el organismo'
      : 'fracciones default bibliográficas (5% submedición, 2% no autorizado)',
  });
  if (gradoAparentes < 6) {
    recomendaciones.push(
      'Sustentar submedición con banco de pruebas de medidores y no autorizado con censo de tomas',
    );
  }

  if (conRed) {
    componentes.push({
      componente: 'datos_de_red',
      grado: 5,
      base: 'longitud de red, tomas y presión declarados (sin telemetría de presión)',
    });
    recomendaciones.push('Instrumentar presión por sector para elevar la confianza del ILI');
  } else {
    componentes.push({
      componente: 'datos_de_red',
      grado: 1,
      base: 'sin características de red: ILI no calculable',
    });
    recomendaciones.push(
      'Capturar longitud de red (km), número de tomas y presión media para habilitar UARL/ILI',
    );
  }

  // Ponderación: los volúmenes dominan la confianza del balance.
  const pesos: Record<string, number> = {
    volumen_suministrado: 0.3,
    consumo_facturado: 0.3,
    perdidas_aparentes: 0.2,
    datos_de_red: 0.2,
  };
  const puntaje = r2(
    componentes.reduce((s, c) => s + c.grado * 10 * (pesos[c.componente] ?? 0), 0),
  );
  const nivel = (NIVELES_GRADING.find((n) => puntaje <= n.hasta) ?? NIVELES_GRADING[4]).nivel;

  return { componentes, puntaje, nivel, recomendaciones };
}

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

  const ili = entrada.red ? calcularILI(reales, entrada.red, advertencias) : null;
  const dataGrading = calcularDataGrading(entrada, Boolean(entrada.red));

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
      ili,
    },
    dataGrading,
    advertencias,
  };
}
