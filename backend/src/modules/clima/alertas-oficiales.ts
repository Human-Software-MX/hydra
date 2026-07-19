/**
 * Alertamiento meteorológico oficial multi-fuente — calculadores puros.
 *
 * Complementa el motor de riesgos derivado del pronóstico (clima-riesgos.ts)
 * con AVISOS OFICIALES de servicios gratuitos y sin API key:
 *
 *  - Ciclones tropicales del NHC/NOAA (CurrentStorms.json): posición, categoría
 *    e intensidad de cada sistema activo en Atlántico y Pacífico Oriental —
 *    ambas cuencas afectan a México.
 *  - Crecidas de río con GloFAS (Copernicus) vía Open-Meteo Flood API: caudal
 *    pronosticado del río principal en ~5 km comparado contra su régimen
 *    histórico reciente.
 *  - Avisos CAP 1.2 (Common Alerting Protocol, estándar OASIS/WMO): formato de
 *    los alertamientos de protección civil y servicios meteorológicos (SMN,
 *    CENAPRED, agregadores WMO). URLs configurables.
 *
 * Todo es puro (sin fetch/Prisma) para poder verificarlo en verify-clima.
 */

export type SeveridadAlerta = 'media' | 'alta' | 'critica';

export interface AlertaOficial {
  fuente: 'nhc_noaa' | 'glofas_openmeteo' | 'cap';
  tipo: string; // ciclon_tropical | crecida_rio | <event del aviso CAP>
  severidad: SeveridadAlerta;
  titulo: string;
  detalle: string;
  /** Vigencia declarada por la fuente (CAP) o fechas relevantes. */
  vigencia?: { desde?: string; hasta?: string };
  zona?: string;
  impacto: string;
  accionRecomendada: string;
  /** Identificador estable para no re-difundir la misma alerta. */
  claveDedup: string;
}

const PESO_SEVERIDAD: Record<SeveridadAlerta, number> = { critica: 0, alta: 1, media: 2 };

export function ordenarPorSeveridad(alertas: AlertaOficial[]): AlertaOficial[] {
  return [...alertas].sort((a, b) => PESO_SEVERIDAD[a.severidad] - PESO_SEVERIDAD[b.severidad]);
}

// ─── Ciclones tropicales (NHC/NOAA) ──────────────────────────────────────────

export interface CiclonActivo {
  id: string;
  nombre: string;
  /** TD depresión | TS tormenta | HU huracán | MH huracán mayor | STD/STS subtropical | PTC potencial */
  clasificacion: string;
  intensidadKt: number | null;
  presionMb: number | null;
  lat: number;
  lng: number;
  direccionMovimiento?: string | null;
  velocidadMovimientoKt?: number | null;
  actualizado?: string | null;
}

export interface UmbralesCiclon {
  /** km a la sede para alerta media (default 800). */
  radioMediaKm?: number;
  /** km para alerta alta (default 500). */
  radioAltaKm?: number;
  /** km para alerta crítica (default 300). */
  radioCriticaKm?: number;
}

const CICLON_DEFAULTS: Required<UmbralesCiclon> = {
  radioMediaKm: 800,
  radioAltaKm: 500,
  radioCriticaKm: 300,
};

const CLASIFICACION_CICLON: Record<string, string> = {
  TD: 'Depresión tropical',
  TS: 'Tormenta tropical',
  HU: 'Huracán',
  MH: 'Huracán mayor (cat. 3+)',
  STD: 'Depresión subtropical',
  STS: 'Tormenta subtropical',
  PTC: 'Ciclón post-tropical',
  PC: 'Potencial ciclón tropical',
};

/** Distancia esférica en km (haversine). */
export function distanciaKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Evalúa los ciclones activos contra la sede del organismo:
 *  - dentro de radioCriticaKm → crítica; radioAltaKm → alta; radioMediaKm → media
 *  - un huracán (HU) escala media→alta; un huracán mayor (MH) escala un nivel
 *    siempre (media→alta, alta→crítica): a igual distancia, más energía.
 * Fuera de radioMediaKm no se alerta (ruido para la operación).
 */
export function evaluarCiclones(
  ciclones: CiclonActivo[],
  sede: { lat: number; lng: number },
  umbrales?: UmbralesCiclon,
): AlertaOficial[] {
  const u = { ...CICLON_DEFAULTS, ...(umbrales ?? {}) };
  const alertas: AlertaOficial[] = [];

  for (const c of ciclones) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    const dist = distanciaKm(sede.lat, sede.lng, c.lat, c.lng);
    if (dist > u.radioMediaKm) continue;

    let severidad: SeveridadAlerta =
      dist <= u.radioCriticaKm ? 'critica' : dist <= u.radioAltaKm ? 'alta' : 'media';
    const clase = c.clasificacion?.toUpperCase() ?? '';
    if (clase === 'MH' && severidad !== 'critica') {
      severidad = severidad === 'alta' ? 'critica' : 'alta';
    } else if (clase === 'HU' && severidad === 'media') {
      severidad = 'alta';
    }

    const etiqueta = CLASIFICACION_CICLON[clase] ?? `Sistema tropical (${c.clasificacion})`;
    const vientoKmh = c.intensidadKt != null ? Math.round(c.intensidadKt * 1.852) : null;
    const partes = [
      `${etiqueta} "${c.nombre}" a ${Math.round(dist)} km de la sede`,
      vientoKmh != null ? `vientos sostenidos ${vientoKmh} km/h` : null,
      c.presionMb != null ? `presión ${c.presionMb} mb` : null,
      c.direccionMovimiento
        ? `movimiento ${c.direccionMovimiento}${c.velocidadMovimientoKt != null ? ` a ${Math.round(c.velocidadMovimientoKt * 1.852)} km/h` : ''}`
        : null,
    ].filter(Boolean);

    alertas.push({
      fuente: 'nhc_noaa',
      tipo: 'ciclon_tropical',
      severidad,
      titulo: `${etiqueta}: ${c.nombre}`,
      detalle: partes.join(' · '),
      zona: undefined,
      impacto:
        'Lluvia torrencial e inundación de cárcamos, cortes de energía en pozos/rebombeos, turbiedad en fuentes superficiales, riesgo para cuadrillas en campo',
      accionRecomendada:
        'Activar protocolo de ciclón: verificar plantas de emergencia y combustible, pre-vaciar cárcamos y tanques de tormenta, asegurar casetas y equipos, suspender trabajos en zanja, coordinar con Protección Civil',
      claveDedup: `nhc:${c.id}:${severidad}`,
    });
  }

  return ordenarPorSeveridad(alertas);
}

// ─── Crecida de río (GloFAS / Open-Meteo Flood API) ──────────────────────────

export interface PuntoCaudal {
  fecha: string; // YYYY-MM-DD
  caudalM3s: number | null;
  esPronostico: boolean;
}

export interface UmbralesCrecida {
  /** Pronóstico ≥ factor × p90 histórico para alerta media (default 1.5). */
  factorMedia?: number;
  /** Factor para alerta alta (default 2). */
  factorAlta?: number;
  /** Factor para crítica (default 3). */
  factorCritica?: number;
  /** Caudal mínimo absoluto en m³/s para alertar — filtra arroyos secos (default 5). */
  caudalMinimoM3s?: number;
  /** Mínimo de días históricos con dato para tener línea base (default 30). */
  diasHistoricosMin?: number;
}

const CRECIDA_DEFAULTS: Required<UmbralesCrecida> = {
  factorMedia: 1.5,
  factorAlta: 2,
  factorCritica: 3,
  caudalMinimoM3s: 5,
  diasHistoricosMin: 30,
};

/** Percentil p (0-100) por interpolación lineal; null si no hay valores. */
export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const idx = (Math.min(Math.max(p, 0), 100) / 100) * (orden.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? orden[lo] : orden[lo] + (orden[hi] - orden[lo]) * (idx - lo);
}

/**
 * Compara el caudal pronosticado contra el régimen reciente del propio río
 * (p90 de la ventana histórica): una crecida es anómala respecto a SU historia,
 * no respecto a un umbral universal. Sin suficiente historia no se alerta
 * (mejor silencio que falso positivo).
 */
export function evaluarCrecidaRio(
  serie: PuntoCaudal[],
  umbrales?: UmbralesCrecida,
): AlertaOficial[] {
  const u = { ...CRECIDA_DEFAULTS, ...(umbrales ?? {}) };
  const historicos = serie
    .filter((s) => !s.esPronostico && s.caudalM3s != null)
    .map((s) => s.caudalM3s as number);
  if (historicos.length < u.diasHistoricosMin) return [];

  const base = percentil(historicos, 90);
  if (base == null) return [];
  const baseEfectiva = Math.max(base, 0.1); // evita división por régimen ~0

  const pronostico = serie.filter((s) => s.esPronostico && s.caudalM3s != null);
  if (pronostico.length === 0) return [];

  const pico = pronostico.reduce((max, s) => ((s.caudalM3s as number) > (max.caudalM3s as number) ? s : max));
  const picoCaudal = pico.caudalM3s as number;
  if (picoCaudal < u.caudalMinimoM3s) return [];

  const razon = picoCaudal / baseEfectiva;
  let severidad: SeveridadAlerta | null = null;
  if (razon >= u.factorCritica) severidad = 'critica';
  else if (razon >= u.factorAlta) severidad = 'alta';
  else if (razon >= u.factorMedia) severidad = 'media';
  if (!severidad) return [];

  const diasSobreUmbral = pronostico
    .filter((s) => (s.caudalM3s as number) >= u.factorMedia * baseEfectiva)
    .map((s) => s.fecha);

  return [
    {
      fuente: 'glofas_openmeteo',
      tipo: 'crecida_rio',
      severidad,
      titulo: 'Crecida de río pronosticada (GloFAS)',
      detalle: `Caudal pico pronosticado ${Math.round(picoCaudal * 10) / 10} m³/s el ${pico.fecha} — ${Math.round(razon * 10) / 10}× el p90 histórico reciente (${Math.round(baseEfectiva * 10) / 10} m³/s); ${diasSobreUmbral.length} día(s) sobre umbral`,
      vigencia: {
        desde: diasSobreUmbral[0] ?? pico.fecha,
        hasta: diasSobreUmbral[diasSobreUmbral.length - 1] ?? pico.fecha,
      },
      impacto:
        'Inundación de captaciones y cárcamos ribereños, turbiedad extrema en fuentes superficiales, socavación de cruces de tubería en cauces',
      accionRecomendada:
        'Revisar protecciones de captaciones superficiales, alistar monitoreo de turbiedad y dosificación, inspeccionar cruces de río de la red, coordinar desalojo preventivo de equipos en zona federal',
      claveDedup: `glofas:${pico.fecha}:${severidad}`,
    },
  ];
}

// ─── Avisos CAP 1.2 (Common Alerting Protocol) ───────────────────────────────

export interface AvisoCap {
  identificador: string;
  emisor?: string;
  enviado?: string;
  idioma?: string;
  evento: string;
  severidadCap: string; // Extreme | Severe | Moderate | Minor | Unknown
  urgencia?: string;
  certeza?: string;
  titular?: string;
  descripcion?: string;
  instruccion?: string;
  inicio?: string;
  expira?: string;
  zonas: string[];
}

const decodificarXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/** Contenido del primer tag `<nombre>` dentro de `xml` (ignora namespace/atributos). */
const tagCap = (xml: string, nombre: string): string | undefined => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`, 'i'));
  return m ? decodificarXml(m[1]) : undefined;
};

const bloquesCap = (xml: string, nombre: string): string[] => {
  const re = new RegExp(`<(?:\\w+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
};

/**
 * Parsea un documento CAP 1.2 (uno o varios `<alert>`). Si un alert trae
 * varios `<info>` (multi-idioma), prefiere los de español (`es*`); si no hay,
 * usa el primero. Tolerante a namespaces y CDATA; sin dependencias XML.
 */
export function parsearCap(xml: string): AvisoCap[] {
  const avisos: AvisoCap[] = [];
  const alerts = bloquesCap(xml, 'alert');
  for (const alert of alerts.length > 0 ? alerts : []) {
    const identificador = tagCap(alert, 'identifier') ?? '';
    const emisor = tagCap(alert, 'sender');
    const enviado = tagCap(alert, 'sent');
    const infos = bloquesCap(alert, 'info');
    if (infos.length === 0) continue;

    const enEspanol = infos.filter((i) => (tagCap(i, 'language') ?? '').toLowerCase().startsWith('es'));
    const elegidos = enEspanol.length > 0 ? enEspanol : [infos[0]];

    for (const info of elegidos) {
      const evento = tagCap(info, 'event');
      if (!evento) continue;
      avisos.push({
        identificador,
        emisor,
        enviado,
        idioma: tagCap(info, 'language'),
        evento,
        severidadCap: tagCap(info, 'severity') ?? 'Unknown',
        urgencia: tagCap(info, 'urgency'),
        certeza: tagCap(info, 'certainty'),
        titular: tagCap(info, 'headline'),
        descripcion: tagCap(info, 'description'),
        instruccion: tagCap(info, 'instruction'),
        inicio: tagCap(info, 'onset') ?? tagCap(info, 'effective'),
        expira: tagCap(info, 'expires'),
        zonas: bloquesCap(info, 'area')
          .map((a) => tagCap(a, 'areaDesc'))
          .filter((z): z is string => Boolean(z)),
      });
    }
  }
  return avisos;
}

const SEVERIDAD_CAP: Record<string, SeveridadAlerta> = {
  extreme: 'critica',
  severe: 'alta',
  moderate: 'media',
  minor: 'media',
};

/**
 * Convierte avisos CAP en alertas operativas. Descarta los ya expirados
 * (contra `ahoraIso`, inyectado para pureza) y los de severidad desconocida
 * los trata como media (un aviso oficial nunca se ignora en silencio).
 */
export function capAAlertas(avisos: AvisoCap[], ahoraIso: string): AlertaOficial[] {
  const ahora = Date.parse(ahoraIso);
  const alertas: AlertaOficial[] = [];
  for (const a of avisos) {
    if (a.expira) {
      const exp = Date.parse(a.expira);
      if (Number.isFinite(exp) && exp < ahora) continue;
    }
    const severidad = SEVERIDAD_CAP[a.severidadCap.toLowerCase()] ?? 'media';
    alertas.push({
      fuente: 'cap',
      tipo: a.evento,
      severidad,
      titulo: a.titular ?? a.evento,
      detalle: [
        a.descripcion,
        a.urgencia ? `Urgencia: ${a.urgencia}` : null,
        a.certeza ? `Certeza: ${a.certeza}` : null,
        a.emisor ? `Emisor: ${a.emisor}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      vigencia: { desde: a.inicio, hasta: a.expira },
      zona: a.zonas.join('; ') || undefined,
      impacto: 'Según el aviso oficial: revisar afectación a fuentes, red y personal en campo',
      accionRecomendada:
        a.instruccion ??
        'Seguir la instrucción del aviso oficial y el protocolo interno correspondiente al fenómeno',
      claveDedup: `cap:${a.identificador}:${a.evento}:${severidad}`,
    });
  }
  return ordenarPorSeveridad(alertas);
}
