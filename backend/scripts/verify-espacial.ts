/**
 * Verificación aislada de la geometría espacial (fallback JS de PostGIS).
 * Ejecuta: node -r ts-node/register/transpile-only scripts/verify-espacial.ts
 */
import {
  distanciaHaversineM,
  puntoEnPoligono,
  puntoEnPoligonoGeoJSON,
  esPoligonoValido,
  PoligonoGeoJSON,
} from '../src/modules/gis/gis-espacial';

let fallos = 0;
const ok = (n: string, c: boolean) => { if (!c) fallos++; console.log(`${c ? '✓' : '✗'} ${n}`); };

// ─── Haversine ───────────────────────────────────────────────────────────────
ok('distancia a sí mismo = 0', distanciaHaversineM(20.5888, -100.3899, 20.5888, -100.3899) === 0);
// 1 grado de latitud ≈ 111.19 km
const unGrado = distanciaHaversineM(20, -100, 21, -100);
ok(`1° de latitud ≈ 111.2 km (${(unGrado / 1000).toFixed(1)} km)`, Math.abs(unGrado - 111_195) < 500);
// CDMX (Zócalo) ↔ Querétaro (centro) ≈ 172 km en línea recta
const cdmxQro = distanciaHaversineM(19.4326, -99.1332, 20.5888, -100.3899);
ok(`CDMX↔QRO ≈ 172-180 km (${(cdmxQro / 1000).toFixed(0)} km)`, cdmxQro > 165_000 && cdmxQro < 190_000);
ok('simétrica', distanciaHaversineM(20, -100, 21, -101) === distanciaHaversineM(21, -101, 20, -100));

// ─── Punto en polígono (ray casting) ─────────────────────────────────────────
// Cuadrado 1×1 centrado en Querétaro: [lng, lat] (convención GeoJSON)
const cuadrado: Array<[number, number]> = [
  [-100.9, 20.1],
  [-99.9, 20.1],
  [-99.9, 21.1],
  [-100.9, 21.1],
];
ok('centro dentro', puntoEnPoligono(20.6, -100.4, cuadrado));
ok('fuera por el este', !puntoEnPoligono(20.6, -99.5, cuadrado));
ok('fuera por el norte', !puntoEnPoligono(21.5, -100.4, cuadrado));
ok('esquina interior cercana dentro', puntoEnPoligono(20.11, -100.89, cuadrado));

// Polígono con hueco (dona): el hueco NO cuenta como dentro
const dona: PoligonoGeoJSON = {
  type: 'Polygon',
  coordinates: [
    cuadrado,
    [
      [-100.6, 20.4],
      [-100.2, 20.4],
      [-100.2, 20.8],
      [-100.6, 20.8],
    ],
  ],
};
ok('dona: anillo exterior dentro', puntoEnPoligonoGeoJSON(20.2, -100.4, dona));
ok('dona: hueco fuera', !puntoEnPoligonoGeoJSON(20.6, -100.4, dona));

// ─── Validación de GeoJSON ───────────────────────────────────────────────────
ok('polígono válido pasa', esPoligonoValido({ type: 'Polygon', coordinates: [cuadrado] }));
ok('rechaza tipo incorrecto', !esPoligonoValido({ type: 'Point', coordinates: [0, 0] }));
ok('rechaza anillo de 2 vértices', !esPoligonoValido({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }));
ok('rechaza coordenadas no numéricas', !esPoligonoValido({ type: 'Polygon', coordinates: [[[0, 0], ['x', 1], [1, 1]]] }));
ok('rechaza null/undefined', !esPoligonoValido(null) && !esPoligonoValido(undefined));

console.log(fallos === 0 ? '\nTODO OK ✓' : `\n${fallos} FALLO(S) ✗`);
process.exit(fallos === 0 ? 0 : 1);
