import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RefreshCw, Search, X } from 'lucide-react';

import { fetchPuntosServicio, createPuntoServicio, type PuntoServicioListItem } from '@/api/puntos-servicio';
import { createDomicilio } from '@/api/domicilios-inegi';
import DomicilioPickerForm, { DOMICILIO_FORM_EMPTY, type DomicilioFormValue } from '../DomicilioPickerForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { StepProps } from '../hooks/useWizardState';

function formatDomicilio(ps: PuntoServicioListItem): string {
  const d = ps.domicilio;
  if (!d) return '—';
  const parts = [d.calle, d.numExterior, d.codigoPostal].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

function isValid(form: DomicilioFormValue & { codigo: string }): boolean {
  return (
    form.estadoINEGIId.trim() !== '' &&
    form.municipioINEGIId.trim() !== '' &&
    form.coloniaINEGIId.trim() !== '' &&
    form.calle.trim() !== '' &&
    form.codigo.trim() !== ''
  );
}

export default function PasoServicioPoint({ data, updateData }: StepProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [domicilioForm, setDomicilioForm] = useState<DomicilioFormValue>(DOMICILIO_FORM_EMPTY);
  const [codigoPS, setCodigoPS] = useState('');

  const { data: list, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['puntos-servicio', 'wizard'],
    queryFn: () => fetchPuntosServicio({ page: 1, limit: 500 }),
  });

  const rows = list?.data ?? [];

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((ps) => {
      const codigo = ps.codigo?.toLowerCase() ?? '';
      const dom = formatDomicilio(ps).toLowerCase();
      const tipo = ps.tipoSuministro?.descripcion?.toLowerCase() ?? '';
      return codigo.includes(t) || dom.includes(t) || tipo.includes(t);
    });
  }, [rows, q]);

  const handleSelect = (ps: PuntoServicioListItem) => {
    const codigo = ps.codigo?.trim() || `PS-${ps.id.slice(0, 8)}`;
    const direccion = formatDomicilio(ps);
    updateData({
      puntoServicioId: ps.id,
      puntoServicioCodigo: codigo,
      puntoServicioDireccion: direccion !== '—' ? direccion : undefined,
      administracion: ps.administracion ?? undefined,
    });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      // 1. Crear domicilio
      const dom = await createDomicilio({
        calle: domicilioForm.calle,
        numExterior: domicilioForm.numExterior || undefined,
        numInterior: domicilioForm.numInterior || undefined,
        coloniaINEGIId: domicilioForm.coloniaINEGIId || undefined,
        codigoPostal: domicilioForm.codigoPostal || undefined,
        localidadINEGIId: domicilioForm.localidadINEGIId || undefined,
        municipioINEGIId: domicilioForm.municipioINEGIId || undefined,
        estadoINEGIId: domicilioForm.estadoINEGIId || undefined,
        referencia: domicilioForm.referencia || undefined,
        gpsLat: domicilioForm.gpsLat ?? undefined,
        gpsLng: domicilioForm.gpsLng ?? undefined,
      });
      // 2. Crear punto de servicio con el domicilio
      return createPuntoServicio({ codigo: codigoPS.trim(), domicilioId: dom.id });
    },
    onSuccess: (ps) => {
      queryClient.invalidateQueries({ queryKey: ['puntos-servicio'] });
      const partes = [domicilioForm.calle, domicilioForm.numExterior, domicilioForm.codigoPostal].filter(Boolean);
      const direccion = partes.length ? partes.join(', ') : undefined;
      updateData({
        puntoServicioId: ps.id,
        puntoServicioCodigo: ps.codigo?.trim() || ps.id,
        puntoServicioDireccion: direccion,
      });
      setShowCreate(false);
      setDomicilioForm(DOMICILIO_FORM_EMPTY);
      setCodigoPS('');
    },
  });

  const formValid = isValid({ ...domicilioForm, codigo: codigoPS });

  return (
    <section aria-labelledby="paso-punto-servicio" className="space-y-4">
      <div>
        <h2 id="paso-punto-servicio" className="text-base font-semibold">
          Punto de servicio
        </h2>
        <p className="text-sm text-muted-foreground">
          Busque y seleccione el punto de servicio o registre uno nuevo.
        </p>
      </div>

      {/* ── Crear nuevo (inline) ─────────────────────────────────────── */}
      {showCreate ? (
        <div className="rounded-lg border border-border bg-muted/10 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Nuevo punto de servicio</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => { setShowCreate(false); setDomicilioForm(DOMICILIO_FORM_EMPTY); setCodigoPS(''); }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-1 max-w-xs">
            <Label>Código del punto de servicio <span className="text-destructive">*</span></Label>
            <Input
              className="h-9"
              placeholder="Ej. PS-2024-001"
              value={codigoPS}
              onChange={(e) => setCodigoPS(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Domicilio del punto de servicio
            </p>
            <DomicilioPickerForm value={domicilioForm} onChange={setDomicilioForm} conMapa />
          </div>

          {createMut.isError && (
            <p className="text-sm text-destructive">
              {(createMut.error as Error)?.message ?? 'Error al crear punto de servicio'}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { setShowCreate(false); setDomicilioForm(DOMICILIO_FORM_EMPTY); setCodigoPS(''); }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-[#007BFF] hover:bg-blue-600 text-white"
              disabled={!formValid || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Guardando…</>
              ) : (
                <><Plus className="h-3.5 w-3.5 mr-1.5" /> Guardar punto de servicio</>
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="bg-[#007BFF] hover:bg-blue-600 text-white"
            onClick={() => navigate('/app/puntos-servicio?new=1')}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Crear nuevo
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading || isFetching}
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden />
            Actualizar lista
          </Button>
        </div>
      )}

      {/* ── Lista de puntos existentes ───────────────────────────────── */}
      {!showCreate && (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrar por código, domicilio o tipo de suministro…"
              className="pl-9"
              aria-label="Filtrar puntos de servicio"
            />
          </div>

          {data.puntoServicioId ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Seleccionado:</span>{' '}
              <span className="font-medium">{data.puntoServicioCodigo || data.puntoServicioId}</span>
            </p>
          ) : null}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
              <p className="text-sm">Cargando puntos de servicio…</p>
            </div>
          ) : null}

          {isError ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
              <p>
                No se pudo cargar el catálogo:{' '}
                {error instanceof Error ? error.message : 'Error desconocido'}
              </p>
              <button
                type="button"
                className="mt-2 text-sm font-medium underline underline-offset-2"
                onClick={() => refetch()}
              >
                Reintentar
              </button>
            </div>
          ) : null}

          {!isLoading && !isError && filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-sm">
              {rows.length === 0 ? (
                <p className="text-muted-foreground">
                  No hay puntos de servicio registrados. Use el botón <strong>Crear nuevo</strong> para registrar uno.
                </p>
              ) : (
                <p className="text-muted-foreground">Ningún resultado coincide con el filtro.</p>
              )}
            </div>
          ) : null}

          {!isLoading && !isError && filtered.length > 0 ? (
            <ScrollArea className="h-[min(360px,50vh)] rounded-md border">
              <ul className="divide-y p-0" role="listbox" aria-label="Puntos de servicio">
                {filtered.map((ps) => {
                  const selected = data.puntoServicioId === ps.id;
                  return (
                    <li key={ps.id} role="none">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => handleSelect(ps)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition-colors',
                          'hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected && 'bg-primary/10',
                        )}
                      >
                        <span className="font-medium">{ps.codigo}</span>
                        <span className="text-xs text-muted-foreground">{formatDomicilio(ps)}</span>
                        {ps.tipoSuministro?.descripcion ? (
                          <span className="text-xs text-muted-foreground">
                            {ps.tipoSuministro.descripcion}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          ) : null}
        </>
      )}
    </section>
  );
}
