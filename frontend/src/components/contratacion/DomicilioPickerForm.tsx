import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import {
  fetchInegiEstados,
  fetchInegiMunicipiosCatalogo,
  fetchInegiLocalidadesCatalogo,
  fetchInegiColoniasCatalogo,
  type CatalogoEstadoINEGI,
  type CatalogoMunicipioINEGIRow,
  type CatalogoLocalidadINEGIRow,
  type CatalogoColoniaINEGIRow,
} from '@/api/domicilios-inegi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import MapPicker from '@/components/ui/map-picker';
import { geocodificarInverso, coordenadasDesde, type Coordenadas } from '@/lib/geo-picker';
import { toast } from '@/components/ui/sonner';
import { SearchableSelect } from '@/components/ui/searchable-select';

export interface DomicilioFormValue {
  estadoINEGIId: string;
  municipioINEGIId: string;
  localidadINEGIId: string;
  coloniaINEGIId: string;
  codigoPostal: string;
  calle: string;
  numExterior: string;
  numInterior: string;
  referencia: string;
  /** Ubicación exacta seleccionada en el mapa (opcional; persiste en Domicilio.gpsLat/gpsLng). */
  gpsLat?: number | null;
  gpsLng?: number | null;
}

interface Props {
  value: DomicilioFormValue;
  onChange: (v: DomicilioFormValue) => void;
  disabled?: boolean;
  /** Muestra el mapa para fijar la ubicación exacta (predio / punto de servicio). */
  conMapa?: boolean;
}

const EMPTY: DomicilioFormValue = {
  estadoINEGIId: '',
  municipioINEGIId: '',
  localidadINEGIId: '',
  coloniaINEGIId: '',
  codigoPostal: '',
  calle: '',
  numExterior: '',
  numInterior: '',
  referencia: '',
};

export const DOMICILIO_FORM_EMPTY = EMPTY;

const NOMINATIM_EMAIL = 'soporte@humansoftware.mx';

/** Normaliza para casar nombres de Nominatim contra el catálogo INEGI. */
function normNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchPorNombre<T extends { id: string; nombre: string }>(
  rows: T[] | undefined,
  nombre: string,
): T | undefined {
  if (!rows?.length || !nombre) return undefined;
  const n = normNombre(nombre);
  return (
    rows.find((r) => normNombre(r.nombre) === n) ??
    rows.find((r) => normNombre(r.nombre).includes(n) || n.includes(normNombre(r.nombre)))
  );
}

export default function DomicilioPickerForm({ value, onChange, disabled = false, conMapa = false }: Props) {
  const set = (patch: Partial<DomicilioFormValue>) => onChange({ ...value, ...patch });
  // valor más reciente para el flujo async del prellenado (evita cierres obsoletos)
  const valueRef = useRef(value);
  valueRef.current = value;
  const [prellenando, setPrellenando] = useState(false);

  // ── Catálogos cascading ────────────────────────────────────────────────
  const { data: estados = [], isLoading: loadingEstados } = useQuery({
    queryKey: ['inegi-estados'],
    queryFn: fetchInegiEstados,
    staleTime: 10 * 60 * 1000,
  });

  const { data: mpioRes, isLoading: loadingMpios } = useQuery({
    queryKey: ['inegi-municipios', value.estadoINEGIId],
    queryFn: () => fetchInegiMunicipiosCatalogo({ estadoId: value.estadoINEGIId, limit: 200 }),
    enabled: Boolean(value.estadoINEGIId),
    staleTime: 10 * 60 * 1000,
  });
  const municipios: CatalogoMunicipioINEGIRow[] = mpioRes?.data ?? [];

  const { data: locRes, isLoading: loadingLocs } = useQuery({
    queryKey: ['inegi-localidades', value.municipioINEGIId],
    queryFn: () => fetchInegiLocalidadesCatalogo({ municipioId: value.municipioINEGIId, limit: 500 }),
    enabled: Boolean(value.municipioINEGIId),
    staleTime: 10 * 60 * 1000,
  });
  const localidades: CatalogoLocalidadINEGIRow[] = locRes?.data ?? [];

  const { data: colRes, isLoading: loadingCols } = useQuery({
    queryKey: ['inegi-colonias', value.localidadINEGIId],
    queryFn: () => fetchInegiColoniasCatalogo({ localidadId: value.localidadINEGIId, limit: 500 }),
    enabled: Boolean(value.localidadINEGIId),
    staleTime: 10 * 60 * 1000,
  });
  const colonias: CatalogoColoniaINEGIRow[] = colRes?.data ?? [];

  const handleEstado = (id: string) => {
    // La cascada INEGI se reinicia; la ubicación del mapa se conserva (es independiente del catálogo).
    onChange({ ...EMPTY, estadoINEGIId: id, gpsLat: value.gpsLat, gpsLng: value.gpsLng });
  };
  const handleMunicipio = (id: string) => {
    set({ municipioINEGIId: id, localidadINEGIId: '', coloniaINEGIId: '', codigoPostal: '' });
  };
  const handleLocalidad = (id: string) => {
    set({ localidadINEGIId: id, coloniaINEGIId: '' });
  };

  /** Texto para geocodificar la dirección capturada (nombres del catálogo, no IDs). */
  const direccionBusqueda = useMemo(() => {
    if (!conMapa) return '';
    const nombreDe = (rows: Array<{ id: string; nombre: string }> | undefined, id: string) =>
      rows?.find((r) => r.id === id)?.nombre ?? '';
    return [
      [value.calle?.trim(), value.numExterior?.trim()].filter(Boolean).join(' '),
      nombreDe(colRes?.data, value.coloniaINEGIId),
      value.codigoPostal?.trim(),
      nombreDe(locRes?.data, value.localidadINEGIId),
      nombreDe(mpioRes?.data, value.municipioINEGIId),
      nombreDe(estados, value.estadoINEGIId),
    ]
      .filter(Boolean)
      .join(', ');
  }, [conMapa, value, colRes, locRes, mpioRes, estados]);

  /**
   * Pin en el mapa → dirección: geocodifica en reversa y prellena todo lo que se
   * pueda resolver (calle, número, CP y la cascada INEGI por nombre). Los campos
   * que Nominatim no trae conservan lo capturado.
   */
  const handleMapa = async (c: Coordenadas | null) => {
    set({ gpsLat: c?.lat ?? null, gpsLng: c?.lng ?? null });
    if (!c || disabled) return;
    setPrellenando(true);
    try {
      const dir = await geocodificarInverso(c, { email: NOMINATIM_EMAIL });
      if (!dir) return;
      const base = valueRef.current;
      const patch: Partial<DomicilioFormValue> = {
        gpsLat: c.lat,
        gpsLng: c.lng,
        calle: dir.calle || base.calle,
        numExterior: dir.numExterior || base.numExterior,
        codigoPostal: dir.codigoPostal || base.codigoPostal,
      };

      // Cascada INEGI por nombre (mejor esfuerzo): estado → municipio → localidad → colonia
      const estado = matchPorNombre(estados, dir.estado);
      if (estado) {
        patch.estadoINEGIId = estado.id;
        const mpios = await fetchInegiMunicipiosCatalogo({ estadoId: estado.id, limit: 200 });
        const mpio = matchPorNombre(mpios.data, dir.municipio) ?? matchPorNombre(mpios.data, dir.localidad);
        if (mpio) {
          patch.municipioINEGIId = mpio.id;
          const locs = await fetchInegiLocalidadesCatalogo({ municipioId: mpio.id, limit: 500 });
          const loc = matchPorNombre(locs.data, dir.localidad) ?? matchPorNombre(locs.data, dir.municipio);
          if (loc) {
            patch.localidadINEGIId = loc.id;
            const cols = await fetchInegiColoniasCatalogo({ localidadId: loc.id, limit: 500 });
            const col =
              matchPorNombre(cols.data, dir.colonia) ??
              (dir.codigoPostal
                ? cols.data?.find((x) => (x as { codigoPostal?: string }).codigoPostal === dir.codigoPostal)
                : undefined);
            if (col) patch.coloniaINEGIId = col.id;
          }
        }
      }

      onChange({ ...valueRef.current, ...patch });
      const partes = [dir.calle, dir.colonia, dir.municipio].filter(Boolean);
      if (partes.length > 0) toast.success(`Dirección prellenada: ${partes.join(', ')}`);
    } finally {
      setPrellenando(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {/* Mapa primero: colocar el pin prellena la dirección de abajo */}
      {conMapa && (
        <div className="col-span-2 space-y-1">
          <Label>Ubicación del predio en el mapa</Label>
          <p className="text-xs text-muted-foreground">
            Coloque el pin (clic o arrastre) y la dirección se prellenará automáticamente; después
            solo valide o complete los campos.
          </p>
          <MapPicker
            lat={value.gpsLat}
            lng={value.gpsLng}
            disabled={disabled}
            direccionBusqueda={direccionBusqueda}
            onChange={(c) => void handleMapa(c)}
          />
          {prellenando && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Prellenando dirección desde el pin…
            </p>
          )}
        </div>
      )}

      {/* Estado */}
      <div className="space-y-1">
        <Label>Estado <span className="text-destructive">*</span></Label>
        {loadingEstados ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
          </div>
        ) : (
          <SearchableSelect
            value={value.estadoINEGIId}
            onValueChange={handleEstado}
            disabled={disabled}
            placeholder="Seleccionar estado"
            searchPlaceholder="Buscar estado…"
            options={estados.map((e: CatalogoEstadoINEGI) => ({ value: e.id, label: e.nombre }))}
          />
        )}
      </div>

      {/* Municipio */}
      <div className="space-y-1">
        <Label>Municipio <span className="text-destructive">*</span></Label>
        {loadingMpios ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
          </div>
        ) : (
          <SearchableSelect
            value={value.municipioINEGIId}
            onValueChange={handleMunicipio}
            disabled={disabled || !value.estadoINEGIId}
            placeholder={value.estadoINEGIId ? 'Seleccionar municipio' : 'Primero seleccione estado'}
            searchPlaceholder="Buscar municipio…"
            options={municipios.map((m: CatalogoMunicipioINEGIRow) => ({ value: m.id, label: m.nombre }))}
          />
        )}
      </div>

      {/* Localidad */}
      <div className="space-y-1">
        <Label>Localidad <span className="text-destructive">*</span></Label>
        {loadingLocs ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
          </div>
        ) : (
          <SearchableSelect
            value={value.localidadINEGIId}
            onValueChange={handleLocalidad}
            disabled={disabled || !value.municipioINEGIId}
            placeholder="Seleccionar localidad"
            searchPlaceholder="Buscar localidad…"
            options={localidades.map((l: CatalogoLocalidadINEGIRow) => ({ value: l.id, label: l.nombre }))}
          />
        )}
      </div>

      {/* Colonia */}
      <div className="space-y-1">
        <Label>Colonia <span className="text-destructive">*</span></Label>
        {loadingCols ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
          </div>
        ) : (
          <SearchableSelect
            value={value.coloniaINEGIId}
            onValueChange={(id) => set({ coloniaINEGIId: id })}
            disabled={disabled || !value.localidadINEGIId}
            placeholder={value.localidadINEGIId ? 'Seleccionar colonia' : 'Primero seleccione localidad'}
            searchPlaceholder="Buscar colonia…"
            options={colonias.map((c: CatalogoColoniaINEGIRow) => ({
              value: c.id,
              label: c.tipo && c.tipo !== 'COLONIA' ? `${c.nombre} (${c.tipo})` : c.nombre,
            }))}
          />
        )}
      </div>

      {/* CP (auto-filled, editable) */}
      <div className="space-y-1">
        <Label>Código postal</Label>
        <Input
          className="h-9"
          placeholder="76000"
          value={value.codigoPostal}
          readOnly={disabled}
          disabled={disabled}
          onChange={(e) => set({ codigoPostal: e.target.value })}
          maxLength={5}
        />
      </div>

      {/* Calle */}
      <div className="space-y-1">
        <Label>Calle <span className="text-destructive">*</span></Label>
        <Input
          className="h-9"
          placeholder="Nombre de la calle"
          value={value.calle}
          readOnly={disabled}
          disabled={disabled}
          onChange={(e) => set({ calle: e.target.value })}
        />
      </div>

      {/* Número exterior */}
      <div className="space-y-1">
        <Label>Núm. exterior <span className="text-destructive">*</span></Label>
        <Input
          className="h-9"
          placeholder="123"
          value={value.numExterior}
          readOnly={disabled}
          disabled={disabled}
          onChange={(e) => set({ numExterior: e.target.value })}
        />
      </div>

      {/* Número interior */}
      <div className="space-y-1">
        <Label>Núm. interior</Label>
        <Input
          className="h-9"
          placeholder="A, Depto 2…"
          value={value.numInterior}
          readOnly={disabled}
          disabled={disabled}
          onChange={(e) => set({ numInterior: e.target.value })}
        />
      </div>

      {/* Referencia — full width */}
      <div className="col-span-2 space-y-1">
        <Label>Referencia</Label>
        <Input
          className="h-9"
          placeholder="Entre calles, punto de referencia…"
          value={value.referencia}
          readOnly={disabled}
          disabled={disabled}
          onChange={(e) => set({ referencia: e.target.value })}
        />
      </div>

    </div>
  );
}
