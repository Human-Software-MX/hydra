import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Loader2, LocateFixed, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  GEO_CENTRO_DEFAULT,
  GEO_ZOOM_DEFAULT,
  GEO_ZOOM_SELECCION,
  buscarSugerenciasDireccion,
  coordenadasDesde,
  coordenadasDifieren,
  geocodificarDireccion,
  redondearCoord,
  type Coordenadas,
  type SugerenciaDireccion,
} from '@/lib/geo-picker';

/**
 * Selector de ubicación en mapa (Leaflet + tiles OpenStreetMap).
 *
 * Port a React del `MapPicker.vue` de Agora Core (ceaLookups): click en el mapa o
 * arrastre del marcador para fijar el punto, búsqueda por dirección vía Nominatim,
 * coordenadas redondeadas a 7 decimales. A diferencia del original, la ubicación es
 * opcional: sin coordenadas no hay marcador y el mapa se centra en Querétaro.
 */

// Iconos por defecto de Leaflet resueltos por Vite (mismo workaround que en Agora Core).
const ICONO_MARCADOR = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const NOMINATIM_EMAIL = (import.meta.env.VITE_NOMINATIM_EMAIL as string | undefined) || undefined;

export interface MapPickerProps {
  lat?: number | string | null;
  lng?: number | string | null;
  /** `null` cuando el usuario quita la ubicación. */
  onChange: (coords: Coordenadas | null) => void;
  disabled?: boolean;
  /** Dirección en texto para el botón "Ubicar por dirección" (geocodificación). */
  direccionBusqueda?: string;
  /** Clase de altura del mapa (p. ej. `h-[300px]`). */
  alturaClase?: string;
  className?: string;
  /** Prefijo para los ids de los inputs de latitud/longitud. */
  idPrefix?: string;
}

/** Captura el click en el mapa para colocar/mover el marcador. */
function ClickEnMapa({ disabled, onPick }: { disabled: boolean; onPick: (ll: L.LatLng) => void }) {
  useMapEvents({
    click(e) {
      if (!disabled) onPick(e.latlng);
    },
  });
  return null;
}

/**
 * Re-centra el mapa cuando las coordenadas cambian desde fuera (props, geocodificación,
 * inputs numéricos) y corrige el tamaño al montarse dentro de diálogos/pestañas.
 */
function SincronizarVista({
  coords,
  zoomObjetivo,
}: {
  coords: Coordenadas | null;
  zoomObjetivo: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(t);
  }, [map]);

  useEffect(() => {
    if (!coords) return;
    map.setView([coords.lat, coords.lng], zoomObjetivo ?? map.getZoom());
  }, [map, coords, zoomObjetivo]);

  return null;
}

export default function MapPicker({
  lat,
  lng,
  onChange,
  disabled = false,
  direccionBusqueda,
  alturaClase = 'h-[300px]',
  className,
  idPrefix = 'map-picker',
}: MapPickerProps) {
  const coords = useMemo(() => coordenadasDesde(lat, lng), [lat, lng]);

  // Último par emitido por interacción directa (click/arrastre): para esas
  // actualizaciones no re-centramos el mapa, el usuario ya está viéndolo.
  const ultimoEmitido = useRef<Coordenadas | null>(null);
  const [vista, setVista] = useState<{ coords: Coordenadas | null; zoom: number | null }>({
    coords: null,
    zoom: null,
  });

  useEffect(() => {
    if (!coords) return;
    if (!coordenadasDifieren(coords, ultimoEmitido.current)) return;
    setVista((v) => ({ coords, zoom: v.zoom }));
  }, [coords]);

  // Inputs numéricos editables, sincronizados con las props.
  const [latTxt, setLatTxt] = useState(coords ? String(coords.lat) : '');
  const [lngTxt, setLngTxt] = useState(coords ? String(coords.lng) : '');
  useEffect(() => {
    setLatTxt(coords ? String(coords.lat) : '');
    setLngTxt(coords ? String(coords.lng) : '');
  }, [coords]);

  const [buscando, setBuscando] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);

  // Buscador libre con sugerencias (lugares/POIs, no solo direcciones).
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const [sugerencias, setSugerencias] = useState<SugerenciaDireccion[]>([]);
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [buscandoSugerencias, setBuscandoSugerencias] = useState(false);
  // Descarta respuestas fuera de orden: solo la última petición pinta resultados.
  const busquedaSeq = useRef(0);

  useEffect(() => {
    const q = textoBusqueda.trim();
    if (q.length < 3) {
      setSugerencias([]);
      setBuscandoSugerencias(false);
      return;
    }
    const seq = ++busquedaSeq.current;
    setBuscandoSugerencias(true);
    // Debounce de 600 ms: respeta la política de uso de Nominatim (≤1 req/s).
    const t = setTimeout(async () => {
      const resultados = await buscarSugerenciasDireccion(q, { email: NOMINATIM_EMAIL });
      if (seq !== busquedaSeq.current) return;
      setSugerencias(resultados);
      setBuscandoSugerencias(false);
      setSugerenciasAbiertas(true);
    }, 600);
    return () => clearTimeout(t);
  }, [textoBusqueda]);

  const elegirSugerencia = (s: SugerenciaDireccion) => {
    setTextoBusqueda(s.etiqueta);
    setSugerencias([]);
    setSugerenciasAbiertas(false);
    setErrorBusqueda(null);
    emitir(s.coords, { recentrar: true, zoom: GEO_ZOOM_SELECCION });
  };

  const emitir = (c: Coordenadas | null, opts: { recentrar?: boolean; zoom?: number } = {}) => {
    const redondeado = c ? { lat: redondearCoord(c.lat), lng: redondearCoord(c.lng) } : null;
    ultimoEmitido.current = opts.recentrar ? null : redondeado;
    if (opts.recentrar && redondeado) setVista({ coords: redondeado, zoom: opts.zoom ?? null });
    onChange(redondeado);
  };

  const aplicarInputs = (latStr: string, lngStr: string) => {
    if (latStr.trim() === '' && lngStr.trim() === '') {
      if (coords) emitir(null);
      return;
    }
    const c = coordenadasDesde(latStr, lngStr);
    if (c && coordenadasDifieren(c, coords)) emitir(c, { recentrar: true });
  };

  const buscarDireccion = async () => {
    if (!direccionBusqueda?.trim()) return;
    setBuscando(true);
    setErrorBusqueda(null);
    const c = await geocodificarDireccion(direccionBusqueda, { email: NOMINATIM_EMAIL });
    setBuscando(false);
    if (!c) {
      setErrorBusqueda('No se encontró la dirección en el mapa. Ubique el predio manualmente.');
      return;
    }
    emitir(c, { recentrar: true, zoom: GEO_ZOOM_SELECCION });
  };

  /** Coloca el pin en la ubicación actual del dispositivo (GPS/navegador). */
  const usarMiUbicacion = () => {
    setErrorBusqueda(null);
    if (!('geolocation' in navigator)) {
      setErrorBusqueda('Este navegador no soporta geolocalización.');
      return;
    }
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUbicando(false);
        emitir(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          { recentrar: true, zoom: GEO_ZOOM_SELECCION },
        );
      },
      (err) => {
        setUbicando(false);
        setErrorBusqueda(
          err.code === err.PERMISSION_DENIED
            ? 'Permiso de ubicación denegado — habilítelo en el navegador o ubique el predio manualmente.'
            : 'No se pudo obtener la ubicación del dispositivo; ubique el predio manualmente.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const centroInicial: [number, number] = coords
    ? [coords.lat, coords.lng]
    : [GEO_CENTRO_DEFAULT.lat, GEO_CENTRO_DEFAULT.lng];

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || ubicando}
          onClick={usarMiUbicacion}
          title="Colocar el pin en la ubicación actual del dispositivo"
        >
          {ubicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="mr-1.5 h-3.5 w-3.5" />}
          Usar mi ubicación
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || buscando || !direccionBusqueda?.trim()}
          onClick={buscarDireccion}
          title="Buscar la dirección capturada en OpenStreetMap"
        >
          {buscando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
          Ubicar por dirección
        </Button>
        {coords && !disabled && (
          <Button type="button" variant="ghost" size="sm" onClick={() => emitir(null)}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Quitar ubicación
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {coords
            ? 'Arrastre el marcador o haga clic en el mapa para ajustar.'
            : 'Haga clic en el mapa para fijar la ubicación exacta del predio.'}
        </span>
      </div>

      {!disabled && (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 pr-8 text-xs"
            placeholder='Buscar lugar o dirección — ej. "Tec de Monterrey"'
            value={textoBusqueda}
            onChange={(e) => setTextoBusqueda(e.target.value)}
            onFocus={() => sugerencias.length > 0 && setSugerenciasAbiertas(true)}
            onBlur={() => setTimeout(() => setSugerenciasAbiertas(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (sugerencias.length > 0) elegirSugerencia(sugerencias[0]);
              }
              if (e.key === 'Escape') setSugerenciasAbiertas(false);
            }}
          />
          {buscandoSugerencias && (
            <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
          {sugerenciasAbiertas && sugerencias.length > 0 && (
            <ul className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
              {sugerencias.map((s) => (
                <li key={s.etiqueta}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-xs hover:bg-accent"
                    // onMouseDown (no onClick): gana al onBlur del input, que cierra la lista.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      elegirSugerencia(s);
                    }}
                  >
                    {s.etiqueta}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sugerenciasAbiertas && !buscandoSugerencias && sugerencias.length === 0 && textoBusqueda.trim().length >= 3 && (
            <p className="absolute z-[1000] mt-1 w-full rounded-md border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
              Sin resultados en Querétaro — intente con el nombre completo del lugar o coloque el pin manualmente.
            </p>
          )}
        </div>
      )}

      {errorBusqueda && <p className="text-xs text-destructive">{errorBusqueda}</p>}

      <MapContainer
        center={centroInicial}
        zoom={coords ? GEO_ZOOM_SELECCION : GEO_ZOOM_DEFAULT}
        scrollWheelZoom
        className={cn('z-0 w-full rounded-lg border', alturaClase, disabled && 'cursor-default')}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <ClickEnMapa disabled={disabled} onPick={(ll) => emitir({ lat: ll.lat, lng: ll.lng })} />
        <SincronizarVista coords={vista.coords} zoomObjetivo={vista.zoom} />
        {coords && (
          <Marker
            position={[coords.lat, coords.lng]}
            icon={ICONO_MARCADOR}
            draggable={!disabled}
            eventHandlers={{
              dragend: (e) => {
                const p = (e.target as L.Marker).getLatLng();
                emitir({ lat: p.lat, lng: p.lng });
              },
            }}
          />
        )}
      </MapContainer>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-lat`} className="text-xs">Latitud</Label>
          <Input
            id={`${idPrefix}-lat`}
            className="h-8 text-xs"
            type="number"
            step="any"
            min={-90}
            max={90}
            placeholder="20.5888000"
            value={latTxt}
            disabled={disabled}
            readOnly={disabled}
            onChange={(e) => setLatTxt(e.target.value)}
            onBlur={() => aplicarInputs(latTxt, lngTxt)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-lng`} className="text-xs">Longitud</Label>
          <Input
            id={`${idPrefix}-lng`}
            className="h-8 text-xs"
            type="number"
            step="any"
            min={-180}
            max={180}
            placeholder="-100.3899000"
            value={lngTxt}
            disabled={disabled}
            readOnly={disabled}
            onChange={(e) => setLngTxt(e.target.value)}
            onBlur={() => aplicarInputs(latTxt, lngTxt)}
          />
        </div>
      </div>
    </div>
  );
}
