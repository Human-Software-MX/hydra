import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Percent } from 'lucide-react';
import {
  aplicarActualizacionMasiva,
  previewActualizacionMasiva,
  type CategoriaTarifaDto,
  type FiltroTarifas,
  type PreviewMasivaResult,
  type ServicioTarifaDto,
} from '@/api/tarifas';
import type { AdministracionCatalogo } from '@/api/catalogos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/use-toast';
import { IvaBadge, Pill } from './badges';
import { SeccionToggle } from './SeccionToggle';
import {
  esContratacion,
  etiquetaSeccion,
  etiquetaServicio,
  etiquetaTipoServicio,
  fmtFecha,
  fmtMXN,
  fmtPct,
  fmtPrecio,
  hoyISO,
} from './format';

const TODAS = '__all__';

const servicioKey = (tipoServicio: string, concepto: string | null | undefined) =>
  `${tipoServicio}|${concepto ?? ''}`;

/** Quita cadenas vacías: el backend interpreta la ausencia de clave como "todas". */
function limpiarFiltro(f: FiltroTarifas): FiltroTarifas {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  }
  return out as FiltroTarifas;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filtroInicial: FiltroTarifas;
  administraciones: AdministracionCatalogo[];
  categorias: CategoriaTarifaDto[];
  servicios: ServicioTarifaDto[];
  /** Se llama al aplicar el lote, para llevar al usuario al historial de actualizaciones. */
  onAplicada: () => void;
}

export function ActualizacionMasivaDialog({
  open,
  onOpenChange,
  filtroInicial,
  administraciones,
  categorias,
  servicios,
  onAplicada,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [paso, setPaso] = useState<1 | 2>(1);
  const [filtro, setFiltro] = useState<FiltroTarifas>(filtroInicial);
  const [porcentaje, setPorcentaje] = useState('');
  const [vigenciaDesde, setVigenciaDesde] = useState(hoyISO());
  const [motivo, setMotivo] = useState('');
  const [fuenteOficial, setFuenteOficial] = useState('');
  const [resultado, setResultado] = useState<PreviewMasivaResult | null>(null);
  const [mostrarExcluidos, setMostrarExcluidos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPaso(1);
    setFiltro(filtroInicial);
    setPorcentaje('');
    setVigenciaDesde(hoyISO());
    setMotivo('');
    setFuenteOficial('');
    setResultado(null);
    setMostrarExcluidos(false);
    setError(null);
    // filtroInicial se toma como snapshot al abrir; los cambios posteriores del filtro
    // de la página no deben reescribir lo que el usuario ya ajustó aquí.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clases = useMemo(() => {
    const todas = categorias.flatMap((c) => c.clases);
    return filtro.categoriaId ? todas.filter((cl) => cl.categoriaId === filtro.categoriaId) : todas;
  }, [categorias, filtro.categoriaId]);

  /** El lote hereda la sección de la página; el select solo ofrece los servicios de esa sección. */
  const opcionesServicio = useMemo(() => {
    const visibles = filtro.seccion ? servicios.filter((s) => s.seccion === filtro.seccion) : servicios;
    return visibles.map((s) => ({
      value: servicioKey(s.tipoServicio, s.concepto),
      label: etiquetaServicio(s),
    }));
  }, [servicios, filtro.seccion]);

  const pctNum = Number(porcentaje);
  /** El backend acepta [-90, 500] y rechaza 0. */
  const pctValido =
    porcentaje.trim() !== '' && Number.isFinite(pctNum) && pctNum !== 0 && pctNum >= -90 && pctNum <= 500;
  const motivoValido = motivo.trim().length >= 3;

  const previewMut = useMutation({
    mutationFn: previewActualizacionMasiva,
    onSuccess: (res) => {
      setResultado(res);
      setMostrarExcluidos(false);
      setPaso(2);
    },
    onError: (err: Error) => setError(err.message),
  });

  const aplicarMut = useMutation({
    mutationFn: aplicarActualizacionMasiva,
    onSuccess: (lote) => {
      qc.invalidateQueries({ queryKey: ['tarifas-vigentes'] });
      qc.invalidateQueries({ queryKey: ['tarifas-movimientos'] });
      qc.invalidateQueries({ queryKey: ['tarifas-actualizaciones'] });
      qc.invalidateQueries({ queryKey: ['tarifas-categorias'] });
      toast({
        title: 'Actualización aplicada',
        description: `${lote.totalTarifas ?? resultado?.total ?? 0} tarifas actualizadas con vigencia ${fmtFecha(
          lote.fechaAplicacion,
        )}.`,
      });
      onOpenChange(false);
      onAplicada();
    },
    onError: (err: Error) => setError(err.message),
  });

  const previsualizar = () => {
    setError(null);
    previewMut.mutate({ filtro: limpiarFiltro(filtro), porcentaje: pctNum, vigenciaDesde });
  };

  const confirmar = () => {
    setError(null);
    aplicarMut.mutate({
      filtro: limpiarFiltro(filtro),
      porcentaje: pctNum,
      vigenciaDesde,
      motivo: motivo.trim(),
      fuenteOficial: fuenteOficial.trim() || undefined,
    });
  };

  const pendiente = previewMut.isPending || aplicarMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !pendiente && onOpenChange(o)}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl overflow-hidden [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Actualización masiva de tarifas</DialogTitle>
          <DialogDescription>
            {paso === 1
              ? 'Elige el alcance y el porcentaje; podrás revisar el detalle antes de confirmar.'
              : 'Revisa el resultado del cálculo. Al confirmar se crea una versión nueva por tarifa.'}
          </DialogDescription>
        </DialogHeader>

        {paso === 1 ? (
          <div className="space-y-4">
            <div>
              <Label>Sección</Label>
              <div className="mt-1">
                <SeccionToggle
                  value={filtro.seccion}
                  onChange={(seccion) =>
                    setFiltro({ ...filtro, seccion, tipoServicio: undefined, concepto: undefined })
                  }
                  conTodas
                  ariaLabel="Sección de las tarifas a actualizar"
                />
              </div>
              {!filtro.seccion && (
                <p className="mt-1.5 text-xs text-amber-700">
                  Se incluirán tarifas periódicas y de contratación.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Administración</Label>
                <SearchableSelect
                  placeholder="Todas las administraciones"
                  searchPlaceholder="Buscar administración…"
                  value={filtro.administracionId ?? TODAS}
                  onValueChange={(v) =>
                    setFiltro({ ...filtro, administracionId: v === TODAS ? undefined : v })
                  }
                  options={[
                    { value: TODAS, label: 'Todas las administraciones' },
                    ...administraciones.map((a) => ({ value: a.id, label: a.nombre })),
                  ]}
                />
              </div>
              <div>
                <Label>Categoría</Label>
                <SearchableSelect
                  placeholder="Todas las categorías"
                  searchPlaceholder="Buscar categoría…"
                  value={filtro.categoriaId ?? TODAS}
                  onValueChange={(v) =>
                    setFiltro({
                      ...filtro,
                      categoriaId: v === TODAS ? undefined : v,
                      claseTarifaId: undefined,
                    })
                  }
                  options={[
                    { value: TODAS, label: 'Todas las categorías' },
                    ...categorias.map((c) => ({ value: c.id, label: c.nombre })),
                  ]}
                />
              </div>
              <div>
                <Label>Clase</Label>
                <SearchableSelect
                  placeholder="Todas las clases"
                  searchPlaceholder="Buscar clase…"
                  value={filtro.claseTarifaId ?? TODAS}
                  onValueChange={(v) => setFiltro({ ...filtro, claseTarifaId: v === TODAS ? undefined : v })}
                  options={[
                    { value: TODAS, label: 'Todas las clases' },
                    ...clases.map((cl) => ({ value: cl.id, label: cl.nombre })),
                  ]}
                />
              </div>
              <div>
                <Label>Servicio / concepto</Label>
                <SearchableSelect
                  placeholder="Todos los servicios"
                  searchPlaceholder="Buscar servicio…"
                  value={filtro.tipoServicio ? servicioKey(filtro.tipoServicio, filtro.concepto) : TODAS}
                  onValueChange={(v) => {
                    if (v === TODAS) {
                      setFiltro({ ...filtro, tipoServicio: undefined, concepto: undefined });
                      return;
                    }
                    const [tipoServicio, concepto] = v.split('|');
                    setFiltro({ ...filtro, tipoServicio, concepto: concepto || undefined });
                  }}
                  options={[{ value: TODAS, label: 'Todos los servicios' }, ...opcionesServicio]}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="masiva-pct">Porcentaje</Label>
                <div className="relative">
                  <Input
                    id="masiva-pct"
                    type="number"
                    step={0.1}
                    inputMode="decimal"
                    placeholder="Ej. 4.5"
                    value={porcentaje}
                    onChange={(e) => setPorcentaje(e.target.value)}
                    className="pr-8"
                  />
                  <Percent className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
              <div>
                <Label htmlFor="masiva-vigencia">Vigencia desde</Label>
                <Input
                  id="masiva-vigencia"
                  type="date"
                  value={vigenciaDesde}
                  onChange={(e) => setVigenciaDesde(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="masiva-motivo">Motivo</Label>
              <Textarea
                id="masiva-motivo"
                rows={2}
                placeholder="Ej. Actualización anual publicada en La Sombra de Arteaga"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="masiva-fuente">Fuente oficial (opcional)</Label>
              <Input
                id="masiva-fuente"
                placeholder="Ej. Decreto publicado el 01/01/2026"
                value={fuenteOficial}
                onChange={(e) => setFuenteOficial(e.target.value)}
              />
            </div>

            {!filtro.administracionId &&
              !filtro.categoriaId &&
              !filtro.claseTarifaId &&
              !filtro.tipoServicio && (
                <p className="text-xs text-muted-foreground">
                  {filtro.seccion
                    ? `Sin más filtros, el porcentaje se aplica a todas las tarifas vigentes de la sección ${etiquetaSeccion(
                        filtro.seccion,
                      ).toLowerCase()}.`
                    : 'Sin filtros, el porcentaje se aplica a todas las tarifas vigentes.'}
                </p>
              )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <p className="text-sm">
              Se actualizarán{' '}
              <span className="font-semibold">{resultado?.total ?? 0} tarifa{resultado?.total === 1 ? '' : 's'}</span>{' '}
              en <span className="font-semibold">{fmtPct(resultado?.porcentaje ?? pctNum)}</span> con vigencia{' '}
              <span className="font-semibold">{fmtFecha(resultado?.vigenciaDesde ?? vigenciaDesde)}</span>
              {filtro.seccion && (
                <>
                  {' en '}
                  <Pill tono="violet" className="align-middle">
                    {etiquetaSeccion(filtro.seccion)}
                  </Pill>
                </>
              )}
              .
            </p>

            {(resultado?.excluidosProgramados ?? 0) > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0">
                  <p>
                    {resultado?.excluidosProgramados} tarifa
                    {resultado?.excluidosProgramados === 1 ? '' : 's'} con una versión programada a futuro no se
                    incluye{resultado?.excluidosProgramados === 1 ? '' : 'n'}.
                  </p>
                  {(resultado?.excluidos?.length ?? 0) > 0 && (
                    <>
                      <button
                        type="button"
                        className="mt-1 font-medium underline"
                        aria-expanded={mostrarExcluidos}
                        onClick={() => setMostrarExcluidos((v) => !v)}
                      >
                        {mostrarExcluidos ? 'Ocultar detalle' : 'Ver detalle'}
                      </button>
                      {mostrarExcluidos && (
                        <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-auto">
                          {resultado?.excluidos?.map((e) => (
                            <li key={e.codigo}>
                              {e.nombre} · programada desde {fmtFecha(e.vigenciaDesdeProgramada)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="w-full max-w-full max-h-[52vh] overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                  <tr>
                    {(
                      [
                        ['Clase', ''],
                        ['Servicio', ''],
                        ['Administración', ''],
                        ['IVA', ''],
                        ['Precio base', 'text-right'],
                        ['Precio m³', 'text-right'],
                        ['Ref. 10 m³', 'text-right'],
                      ] as const
                    ).map(([h, align]) => (
                      <th
                        key={h}
                        scope="col"
                        className={`px-2.5 py-2 font-semibold uppercase tracking-wider text-muted-foreground ${align || 'text-left'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(resultado?.tarifas ?? []).map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="px-2.5 py-2">
                        <p className="max-w-[170px] truncate font-medium" title={t.claseNombre ?? t.nombre}>
                          {t.claseNombre ?? t.nombre}
                        </p>
                        {t.categoriaNombre ? (
                          <p className="text-[11px] text-muted-foreground">{t.categoriaNombre}</p>
                        ) : (
                          t.variante && <p className="text-[11px] text-muted-foreground">{t.variante}</p>
                        )}
                      </td>
                      <td className="max-w-[120px] truncate px-2.5 py-2" title={t.tipoServicio}>
                        {esContratacion(t.seccion) ? (t.concepto ?? etiquetaTipoServicio(t.tipoServicio)) : t.tipoServicio}
                      </td>
                      <td className="max-w-[140px] px-2.5 py-2 text-[11px] leading-tight text-muted-foreground">
                        {t.administracionNombre ?? 'Global'}
                      </td>
                      <td className="px-2.5 py-2">
                        <IvaBadge ivaPct={t.ivaPct} ivaNoObjeto={t.ivaNoObjeto} />
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">
                        {fmtPrecio(t.actual.cuotaFija)}{' '}
                        <span className="text-muted-foreground">→</span>{' '}
                        <span className="font-semibold text-[#003366]">{fmtPrecio(t.nuevo.cuotaFija)}</span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">
                        {fmtPrecio(t.actual.precioUnitario)}{' '}
                        <span className="text-muted-foreground">→</span>{' '}
                        <span className="font-semibold text-[#003366]">{fmtPrecio(t.nuevo.precioUnitario)}</span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">
                        {esContratacion(t.seccion) ? (
                          '—'
                        ) : (
                          <>
                            {fmtMXN(t.actual.valorReferencia)}{' '}
                            <span className="text-muted-foreground">→</span>{' '}
                            <span className="font-semibold text-[#003366]">{fmtMXN(t.nuevo.valorReferencia)}</span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(resultado?.tarifas.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                        Ninguna tarifa vigente coincide con el filtro
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {paso === 1 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pendiente}>
                Cancelar
              </Button>
              <Button
                className="bg-[#007BFF] text-white hover:bg-blue-600"
                onClick={previsualizar}
                disabled={!pctValido || !motivoValido || pendiente}
              >
                {previewMut.isPending ? 'Calculando…' : 'Previsualizar'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setPaso(1)} disabled={pendiente}>
                Volver
              </Button>
              <Button
                className="bg-amber-600 text-white hover:bg-amber-700"
                onClick={confirmar}
                disabled={pendiente || (resultado?.total ?? 0) === 0}
              >
                {aplicarMut.isPending ? 'Aplicando…' : 'Confirmar actualización'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
