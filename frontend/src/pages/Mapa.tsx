import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, CloudRain, MapPin, Siren } from 'lucide-react';
import {
  fetchPadronGeojson,
  fetchRiesgosClima,
  fetchAlertasOficiales,
  PadronFeatureProps,
  AlertaClimatica,
} from '@/api/gis-mapa';
import { hasApi } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const useApi = hasApi();

/** Centro por defecto: Querétaro. */
const CENTRO_DEFAULT: [number, number] = [20.5888, -100.3899];

type Capa = 'cartera' | 'estado';

const COLOR_CARTERA: Record<string, string> = {
  AL_CORRIENTE: '#16a34a',
  INCIPIENTE: '#eab308',
  MODERADO: '#f97316',
  ALTO: '#dc2626',
  CRITICO: '#7f1d1d',
  SIN_DATOS: '#94a3b8',
};

const COLOR_ESTADO: Record<string, string> = {
  Activo: '#16a34a',
  Suspendido: '#f97316',
  Cancelado: '#94a3b8',
  Restringido: '#dc2626',
};

const colorDe = (capa: Capa, p: PadronFeatureProps): string =>
  capa === 'cartera'
    ? (COLOR_CARTERA[p.carteraCategoria] ?? COLOR_CARTERA.SIN_DATOS)
    : (COLOR_ESTADO[p.estado] ?? '#64748b');

const badgeSeveridad = (s: AlertaClimatica['severidad']) =>
  s === 'critica' ? 'destructive' : s === 'alta' ? 'default' : 'secondary';

const fmtMoney = (v: number) =>
  v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

export default function Mapa() {
  const [capa, setCapa] = useState<Capa>('cartera');

  const padronQ = useQuery({
    queryKey: ['gis-padron-geojson'],
    queryFn: () => fetchPadronGeojson({ limit: 5000 }),
    enabled: useApi,
    staleTime: 5 * 60 * 1000,
  });

  const climaQ = useQuery({
    queryKey: ['clima-riesgos'],
    queryFn: () => fetchRiesgosClima(),
    enabled: useApi,
    staleTime: 30 * 60 * 1000,
  });

  const alertasQ = useQuery({
    queryKey: ['clima-alertas-oficiales'],
    queryFn: () => fetchAlertasOficiales(),
    enabled: useApi,
    staleTime: 30 * 60 * 1000,
  });

  const features = padronQ.data?.features ?? [];
  const centro = useMemo<[number, number]>(() => {
    if (features.length === 0) return CENTRO_DEFAULT;
    const sum = features.reduce(
      (acc, f) => [acc[0] + f.geometry.coordinates[1], acc[1] + f.geometry.coordinates[0]],
      [0, 0],
    );
    return [sum[0] / features.length, sum[1] / features.length];
  }, [features]);

  const leyenda = capa === 'cartera' ? COLOR_CARTERA : COLOR_ESTADO;
  const alertasGenerales = climaQ.data?.general.alertas ?? [];
  const zonasConAlertas = climaQ.data?.zonas ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mapa operativo"
        subtitle="Padrón georreferenciado (OpenStreetMap) y riesgos climáticos por zona — Open-Meteo / SMN CONAGUA"
      />

      <div className="flex items-center gap-3">
        <MapPin className="h-4 w-4 text-muted-foreground" />
        <Select value={capa} onValueChange={(v) => setCapa(v as Capa)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Capa temática" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cartera">Cartera (categoría de mora)</SelectItem>
            <SelectItem value="estado">Estado del servicio</SelectItem>
          </SelectContent>
        </Select>
        {padronQ.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {padronQ.data && (
          <span className="text-sm text-muted-foreground">
            {padronQ.data.meta.georreferenciados.toLocaleString()} contratos georreferenciados
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <div className="h-[560px] w-full overflow-hidden rounded-lg">
              <MapContainer center={centro} zoom={12} className="h-full w-full">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {features.map((f) => {
                  const p = f.properties;
                  return (
                    <CircleMarker
                      key={p.contratoId}
                      center={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
                      radius={5}
                      pathOptions={{
                        color: colorDe(capa, p),
                        fillColor: colorDe(capa, p),
                        fillOpacity: 0.75,
                        weight: 1,
                      }}
                    >
                      <Popup>
                        <div className="space-y-1 text-sm">
                          <div className="font-semibold">
                            #{p.numeroContrato} — {p.nombre}
                          </div>
                          {p.direccion && <div>{p.direccion}</div>}
                          <div>
                            Zona: {p.zona ?? 'N/D'} · {p.tipoServicio}
                          </div>
                          <div>Estado: {p.estado}</div>
                          <div>
                            Cartera: {p.carteraCategoria}
                            {p.saldoVencido > 0 && <> · vencido {fmtMoney(p.saldoVencido)}</>}
                            {p.diasMoraMax > 0 && <> · {p.diasMoraMax} días</>}
                          </div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Leyenda — {capa === 'cartera' ? 'cartera' : 'estado del servicio'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {Object.entries(leyenda).map(([nombre, color]) => (
                <div key={nombre} className="flex items-center gap-2 text-sm">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                  <span>{nombre.replaceAll('_', ' ')}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Siren className="h-4 w-4" /> Alertas oficiales — NHC · GloFAS · CAP
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {alertasQ.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Consultando fuentes oficiales…
                </div>
              )}
              {alertasQ.isError && (
                <p className="text-sm text-muted-foreground">
                  Alertamiento oficial no disponible en este momento.
                </p>
              )}
              {alertasQ.data && alertasQ.data.alertas.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Sin alertas oficiales vigentes (ciclones, crecidas de río ni avisos CAP).
                </p>
              )}
              {(alertasQ.data?.alertas ?? []).map((a) => (
                <div key={a.claveDedup} className="space-y-1 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={badgeSeveridad(a.severidad)}>{a.severidad.toUpperCase()}</Badge>
                    <span className="text-sm font-medium">{a.titulo}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.detalle}</p>
                  {a.zona && <p className="text-xs text-muted-foreground">Zona: {a.zona}</p>}
                  <p className="text-xs">
                    <span className="font-medium">Acción:</span> {a.accionRecomendada}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CloudRain className="h-4 w-4" /> Riesgos climáticos ({climaQ.data?.horizonteDias ?? 14} días)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {climaQ.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Consultando pronóstico…
                </div>
              )}
              {climaQ.isError && (
                <p className="text-sm text-muted-foreground">
                  Servicio meteorológico no disponible en este momento.
                </p>
              )}
              {climaQ.data && alertasGenerales.length === 0 && zonasConAlertas.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Sin riesgos climáticos relevantes en el horizonte. Fuente: {climaQ.data.fuente}.
                </p>
              )}
              {alertasGenerales.map((a) => (
                <div key={`g-${a.tipo}`} className="space-y-1 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={badgeSeveridad(a.severidad)}>{a.severidad.toUpperCase()}</Badge>
                    <span className="text-sm font-medium">{a.tipo.replaceAll('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.detalle}</p>
                  <p className="text-xs">
                    <span className="font-medium">Acción:</span> {a.accionRecomendada}
                  </p>
                </div>
              ))}
              {zonasConAlertas.map((z) => (
                <div key={z.zonaId} className="space-y-1 rounded-md border p-2">
                  <div className="text-sm font-medium">Zona {z.zona}</div>
                  {z.alertas.map((a) => (
                    <div key={`${z.zonaId}-${a.tipo}`} className="flex items-center gap-2 text-xs">
                      <Badge variant={badgeSeveridad(a.severidad)}>{a.severidad}</Badge>
                      <span>{a.tipo.replaceAll('_', ' ')} — {a.detalle}</span>
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
