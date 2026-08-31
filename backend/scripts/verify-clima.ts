/**
 * Verificación aislada del motor de riesgos climáticos.
 * Ejecuta: node -r ts-node/register/transpile-only scripts/verify-clima.ts
 */
import {
  evaluarRiesgosClimaticos,
  escalarPorSequia,
  rangoSequia,
  DiaPronostico,
} from '../src/modules/clima/clima-riesgos';

let fallos = 0;
const ok = (n: string, c: boolean) => { if (!c) fallos++; console.log(`${c ? '✓' : '✗'} ${n}`); };

const dia = (i: number, sobre: Partial<DiaPronostico> = {}): DiaPronostico => ({
  fecha: `2026-07-${String(i + 1).padStart(2, '0')}`,
  tmaxC: 28,
  tminC: 14,
  precipitacionMm: 5,
  rachaVientoKmh: 20,
  ...sobre,
});
const semanaNormal = Array.from({ length: 7 }, (_, i) => dia(i));

// ─── Semana templada con algo de lluvia: sin alertas ─────────────────────────
ok('semana normal: 0 alertas', evaluarRiesgosClimaticos(semanaNormal).length === 0);

// ─── Lluvia fuerte vs torrencial ─────────────────────────────────────────────
const lluvias = evaluarRiesgosClimaticos([
  ...semanaNormal.slice(0, 5),
  dia(5, { precipitacionMm: 45 }),
  dia(6, { precipitacionMm: 90 }),
]);
ok('lluvia: detecta torrencial crítica', lluvias.some((a) => a.tipo === 'lluvia_torrencial' && a.severidad === 'critica'));
ok('lluvia: detecta fuerte alta (45mm no cuenta doble)', lluvias.some((a) => a.tipo === 'lluvia_fuerte' && a.fechas.length === 1));
ok('lluvia: crítica ordenada primero', lluvias[0].severidad === 'critica');
ok('lluvia: acción de protocolo de tormenta', lluvias[0].accionRecomendada.includes('tormenta'));

// ─── Ola de calor: exige días CONSECUTIVOS ───────────────────────────────────
const calorConsecutivo = evaluarRiesgosClimaticos(
  Array.from({ length: 7 }, (_, i) => dia(i, { tmaxC: i >= 2 && i <= 5 ? 36 : 30 })),
);
ok('calor: 4 días consecutivos ≥34° → alerta', calorConsecutivo.some((a) => a.tipo === 'ola_calor' && a.fechas.length === 4));

const calorSalteado = evaluarRiesgosClimaticos(
  Array.from({ length: 7 }, (_, i) => dia(i, { tmaxC: i % 2 === 0 ? 36 : 30 })),
);
ok('calor: días salteados NO son ola de calor', !calorSalteado.some((a) => a.tipo === 'ola_calor'));

const calorLargo = evaluarRiesgosClimaticos(
  Array.from({ length: 8 }, (_, i) => dia(i, { tmaxC: 36 })),
);
ok('calor: ≥6 días consecutivos escala a crítica', calorLargo.some((a) => a.tipo === 'ola_calor' && a.severidad === 'critica'));

// ─── Helada ──────────────────────────────────────────────────────────────────
const helada = evaluarRiesgosClimaticos([...semanaNormal.slice(0, 6), dia(6, { tminC: -2 })]);
ok('helada: Tmín ≤0° → alerta alta', helada.some((a) => a.tipo === 'helada' && a.severidad === 'alta'));
ok('helada: recomienda proteger medidores', helada.some((a) => a.accionRecomendada.includes('medidor')));

// ─── Viento fuerte ───────────────────────────────────────────────────────────
const viento = evaluarRiesgosClimaticos([...semanaNormal.slice(0, 6), dia(6, { rachaVientoKmh: 75 })]);
ok('viento: racha ≥60 km/h → alerta media', viento.some((a) => a.tipo === 'viento_fuerte' && a.severidad === 'media'));

// ─── Estiaje: horizonte ≥14 días sin lluvia ──────────────────────────────────
const seco14 = evaluarRiesgosClimaticos(
  Array.from({ length: 14 }, (_, i) => dia(i, { precipitacionMm: 0 })),
);
ok('estiaje: 14 días secos → alerta', seco14.some((a) => a.tipo === 'estiaje'));

const seco7 = evaluarRiesgosClimaticos(
  Array.from({ length: 7 }, (_, i) => dia(i, { precipitacionMm: 0 })),
);
ok('estiaje: horizonte corto (7 días) no alerta', !seco7.some((a) => a.tipo === 'estiaje'));

// ─── Umbrales configurables y datos nulos ────────────────────────────────────
const umbralCustom = evaluarRiesgosClimaticos(
  [...semanaNormal.slice(0, 6), dia(6, { precipitacionMm: 25 })],
  { lluviaFuerteMm: 20 },
);
ok('umbral custom: 25mm alerta con umbral de 20', umbralCustom.some((a) => a.tipo === 'lluvia_fuerte'));

const nulos = evaluarRiesgosClimaticos(
  Array.from({ length: 14 }, (_, i) => dia(i, { tmaxC: null, tminC: null, precipitacionMm: null, rachaVientoKmh: null })),
);
ok('datos nulos: solo estiaje (precip null = 0 acumulado), sin falsos positivos', nulos.every((a) => a.tipo === 'estiaje'));
ok('serie vacía: sin alertas', evaluarRiesgosClimaticos([]).length === 0);

// ─── Monitor de Sequía: cruce con estiaje ────────────────────────────────────
ok('rango: D4 > D0 > sin sequía', rangoSequia('D4') > rangoSequia('D0') && rangoSequia(null) === -1);

const conEstiaje = () =>
  evaluarRiesgosClimaticos(Array.from({ length: 14 }, (_, i) => dia(i, { precipitacionMm: 0 })));

// Sin sequía: no cambia nada
const sinSequia = escalarPorSequia(conEstiaje(), null);
ok('sequía null: estiaje se queda en media', sinSequia.find((a) => a.tipo === 'estiaje')?.severidad === 'media');

// D1 + estiaje pronosticado → alta
const d1 = escalarPorSequia(conEstiaje(), 'D1', { fechaCorte: '2026-07-15' });
const estiajeD1 = d1.find((a) => a.tipo === 'estiaje');
ok('D1 escala estiaje a alta', estiajeD1?.severidad === 'alta');
ok('D1 menciona el Monitor en el detalle', Boolean(estiajeD1?.detalle.includes('Monitor de Sequía')));

// D3 + estiaje pronosticado → crítica
ok('D3 escala estiaje a crítica', escalarPorSequia(conEstiaje(), 'D3').find((a) => a.tipo === 'estiaje')?.severidad === 'critica');

// D2 SIN estiaje pronosticado → agrega la alerta igualmente
const semanaLluviosa = Array.from({ length: 14 }, (_, i) => dia(i, { precipitacionMm: 8 }));
const d2SinEstiaje = escalarPorSequia(evaluarRiesgosClimaticos(semanaLluviosa), 'D2', { municipiosAfectados: 5 });
const agregada = d2SinEstiaje.find((a) => a.tipo === 'estiaje');
ok('D2 sin estiaje pronosticado: agrega alerta estructural', agregada?.severidad === 'alta');
ok('alerta estructural menciona municipios afectados', Boolean(agregada?.detalle.includes('5 municipio(s)')));

// D0 sin estiaje pronosticado: NO agrega alerta (solo anormalmente seco)
ok('D0 sin estiaje: no agrega alerta', !escalarPorSequia(evaluarRiesgosClimaticos(semanaLluviosa), 'D0').some((a) => a.tipo === 'estiaje'));

// ═══ Ola 6: alertamiento oficial multi-fuente (NHC, GloFAS, CAP) ═════════════
import {
  evaluarCiclones,
  evaluarCrecidaRio,
  parsearCap,
  capAAlertas,
  distanciaKm,
  percentil,
  CiclonActivo,
  PuntoCaudal,
} from '../src/modules/clima/alertas-oficiales';

const SEDE = { lat: 20.5888, lng: -100.3899 }; // Querétaro

// ─── Ciclones NHC ────────────────────────────────────────────────────────────
const ciclon = (sobre: Partial<CiclonActivo> = {}): CiclonActivo => ({
  id: 'ep012026',
  nombre: 'Alma',
  clasificacion: 'TS',
  intensidadKt: 50,
  presionMb: 990,
  lat: 18.5,
  lng: -104.0, // costa de Colima ~ 480 km de Querétaro
  ...sobre,
});

ok('haversine: QRO-CDMX ~185 km', Math.abs(distanciaKm(20.5888, -100.3899, 19.4326, -99.1332) - 185) < 10);

const tsCerca = evaluarCiclones([ciclon()], SEDE);
ok('ciclón: TS a ~480 km → alerta alta', tsCerca.length === 1 && tsCerca[0].severidad === 'alta');
ok('ciclón: detalle trae nombre y km/h', tsCerca[0].detalle.includes('Alma') && tsCerca[0].detalle.includes('93 km/h'));

const lejano = evaluarCiclones([ciclon({ lat: 12, lng: -130 })], SEDE);
ok('ciclón: fuera del radio de vigilancia → sin alerta', lejano.length === 0);

const huMedia = evaluarCiclones([ciclon({ clasificacion: 'HU', lat: 15.5, lng: -105.5 })], SEDE); // ~750 km
ok('ciclón: HU en radio media escala a alta', huMedia.length === 1 && huMedia[0].severidad === 'alta');

const mhAlta = evaluarCiclones([ciclon({ clasificacion: 'MH' })], SEDE); // ~480 km
ok('ciclón: huracán mayor en radio alta escala a crítica', mhAlta[0].severidad === 'critica');

const mhCritica = evaluarCiclones([ciclon({ clasificacion: 'MH', lat: 20.0, lng: -102.0 })], SEDE); // ~250 km
ok('ciclón: crítica no escala más allá de crítica', mhCritica[0].severidad === 'critica');
ok('ciclón: claveDedup estable por sistema+severidad', mhCritica[0].claveDedup === 'nhc:ep012026:critica');

ok('ciclón: coordenadas inválidas se ignoran', evaluarCiclones([ciclon({ lat: NaN })], SEDE).length === 0);
ok('ciclón: sin sistemas activos → sin alertas', evaluarCiclones([], SEDE).length === 0);

// ─── Crecida de río GloFAS ───────────────────────────────────────────────────
ok('percentil: p90 de 1..100 ≈ 90.1', Math.abs((percentil(Array.from({ length: 100 }, (_, i) => i + 1), 90) ?? 0) - 90.1) < 0.01);
ok('percentil: lista vacía → null', percentil([], 90) === null);

const serieCaudal = (picoM3s: number, base = 10): PuntoCaudal[] => [
  ...Array.from({ length: 60 }, (_, i) => ({
    fecha: `2026-05-${String((i % 30) + 1).padStart(2, '0')}`,
    caudalM3s: base + (i % 5), // régimen estable ~10-14, p90 ≈ 14
    esPronostico: false,
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    fecha: `2026-07-${String(20 + i).padStart(2, '0')}`,
    caudalM3s: i === 5 ? picoM3s : base,
    esPronostico: true,
  })),
];

ok('crecida: pico 3× p90 → crítica', evaluarCrecidaRio(serieCaudal(45))[0]?.severidad === 'critica');
ok('crecida: pico 2× p90 → alta', evaluarCrecidaRio(serieCaudal(28.5))[0]?.severidad === 'alta');
ok('crecida: pico ~1.6× p90 → media', evaluarCrecidaRio(serieCaudal(23))[0]?.severidad === 'media');
ok('crecida: régimen normal → sin alerta', evaluarCrecidaRio(serieCaudal(12)).length === 0);
ok('crecida: fecha del pico en el detalle', evaluarCrecidaRio(serieCaudal(45))[0]?.detalle.includes('2026-07-25'));

const arroyoSeco: PuntoCaudal[] = [
  ...Array.from({ length: 60 }, (_, i) => ({ fecha: `2026-05-${String((i % 30) + 1).padStart(2, '0')}`, caudalM3s: 0.2, esPronostico: false })),
  { fecha: '2026-07-25', caudalM3s: 3, esPronostico: true }, // 15× su base pero 3 m³/s absolutos
];
ok('crecida: arroyo seco bajo caudal mínimo absoluto → sin alerta', evaluarCrecidaRio(arroyoSeco).length === 0);

const pocaHistoria = evaluarCrecidaRio([
  ...Array.from({ length: 5 }, (_, i) => ({ fecha: `2026-07-${10 + i}`, caudalM3s: 10, esPronostico: false })),
  { fecha: '2026-07-25', caudalM3s: 100, esPronostico: true },
]);
ok('crecida: sin historia suficiente → sin alerta (no falso positivo)', pocaHistoria.length === 0);

// ─── CAP 1.2 ─────────────────────────────────────────────────────────────────
const capXml = `<?xml version="1.0"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>MX-SMN-2026-0719-001</identifier>
  <sender>smn.conagua.gob.mx</sender>
  <sent>2026-07-19T06:00:00-06:00</sent>
  <info>
    <language>en-US</language>
    <event>Severe Thunderstorm</event>
    <severity>Severe</severity>
    <headline>Severe storms expected</headline>
  </info>
  <info>
    <language>es-MX</language>
    <event>Tormenta severa</event>
    <urgency>Expected</urgency>
    <severity>Severe</severity>
    <certainty>Likely</certainty>
    <headline>Tormentas severas en el Bajío</headline>
    <description><![CDATA[Lluvias &gt; 70 mm con granizo]]></description>
    <instruction>Resguardar equipos y suspender trabajo en zanjas</instruction>
    <expires>2026-07-20T23:59:00-06:00</expires>
    <area><areaDesc>Querétaro</areaDesc></area>
    <area><areaDesc>Guanajuato</areaDesc></area>
  </info>
</alert>`;

const avisos = parsearCap(capXml);
ok('CAP: prefiere el <info> en español', avisos.length === 1 && avisos[0].evento === 'Tormenta severa');
ok('CAP: decodifica CDATA y entidades', avisos[0].descripcion === 'Lluvias > 70 mm con granizo');
ok('CAP: junta múltiples áreas', avisos[0].zonas.join(';') === 'Querétaro;Guanajuato');

const vigentes = capAAlertas(avisos, '2026-07-19T12:00:00-06:00');
ok('CAP: Severe → alta y conserva la instrucción oficial', vigentes[0]?.severidad === 'alta' && vigentes[0].accionRecomendada.includes('zanjas'));
ok('CAP: aviso expirado se descarta', capAAlertas(avisos, '2026-07-21T12:00:00-06:00').length === 0);

const capExtremo = parsearCap(capXml.replace(/Severe<\/severity>/g, 'Extreme</severity>'));
ok('CAP: Extreme → crítica', capAAlertas(capExtremo, '2026-07-19T12:00:00-06:00')[0]?.severidad === 'critica');

const soloIngles = parsearCap(`<alert><identifier>X1</identifier><info><language>en-US</language><event>Flood Warning</event><severity>Moderate</severity></info></alert>`);
ok('CAP: sin español usa el primer <info>; Moderate → media', capAAlertas(soloIngles, '2026-07-19T12:00:00Z')[0]?.severidad === 'media');
ok('CAP: XML sin <alert> → sin avisos', parsearCap('<html>not cap</html>').length === 0);

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
