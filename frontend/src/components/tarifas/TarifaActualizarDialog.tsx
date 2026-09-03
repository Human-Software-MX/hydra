import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Percent } from 'lucide-react';
import {
  actualizarTarifa,
  fetchTarifaDetalle,
  type ActualizarTarifaDto,
  type TarifaVigenteDto,
} from '@/api/tarifas';
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
import { useToast } from '@/components/ui/use-toast';
import { IvaBadge, TipoCalculoBadge } from './badges';
import { aplicarPct, deltaPct, fmtMXN, fmtPct, fmtPrecio, hoyISO } from './format';

type Modo = 'porcentaje' | 'valores';

interface Props {
  tarifa: TarifaVigenteDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FilaPreview {
  label: string;
  actual: number | null;
  nuevo: number | null;
  /** Precios unitarios con 4 decimales; importes de referencia con 2. */
  formato: (n: number | null | undefined) => string;
}

export function TarifaActualizarDialog({ tarifa, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [modo, setModo] = useState<Modo>('porcentaje');
  const [porcentaje, setPorcentaje] = useState('');
  const [cuotaFija, setCuotaFija] = useState('');
  const [precioUnitario, setPrecioUnitario] = useState('');
  const [vigenciaDesde, setVigenciaDesde] = useState(hoyISO());
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const esTabla = tarifa?.tipoCalculo === 'tabla';

  useEffect(() => {
    if (!open || !tarifa) return;
    setModo('porcentaje');
    setPorcentaje('');
    setCuotaFija(tarifa.cuotaFija != null ? String(tarifa.cuotaFija) : '');
    setPrecioUnitario(tarifa.precioUnitario != null ? String(tarifa.precioUnitario) : '');
    setVigenciaDesde(hoyISO());
    setMotivo('');
    setError(null);
  }, [open, tarifa]);

  /** Solo para informar cuántos tramos tiene la tabla: `precios` no viene en el listado. */
  const { data: detalle } = useQuery({
    queryKey: ['tarifa-detalle', tarifa?.id],
    queryFn: () => fetchTarifaDetalle(tarifa!.id),
    enabled: open && Boolean(tarifa?.id) && esTabla,
  });

  const pctNum = Number(porcentaje);
  /** El backend acepta [-90, 500] y rechaza 0. */
  const pctValido =
    porcentaje.trim() !== '' && Number.isFinite(pctNum) && pctNum !== 0 && pctNum >= -90 && pctNum <= 500;

  const preview = useMemo<FilaPreview[]>(() => {
    if (!tarifa) return [];
    const factor = (v: number | null) => (pctValido ? aplicarPct(v, pctNum) : null);
    const filas: FilaPreview[] = [
      { label: 'Precio base', actual: tarifa.cuotaFija, nuevo: factor(tarifa.cuotaFija), formato: fmtPrecio },
      {
        label: 'Precio m³',
        actual: tarifa.precioUnitario,
        nuevo: factor(tarifa.precioUnitario),
        formato: fmtPrecio,
      },
    ];
    if (esTabla) {
      filas.push({
        label: 'Ref. 10 m³',
        actual: tarifa.valorReferencia,
        nuevo: factor(tarifa.valorReferencia),
        formato: (n) => fmtMXN(n),
      });
    }
    return filas.filter((f) => f.actual != null);
  }, [tarifa, pctValido, pctNum, esTabla]);

  const mutation = useMutation({
    mutationFn: (dto: ActualizarTarifaDto) => actualizarTarifa(tarifa!.id, dto),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tarifas-vigentes'] });
      qc.invalidateQueries({ queryKey: ['tarifas-movimientos'] });
      qc.invalidateQueries({ queryKey: ['tarifas-kardex', res.tarifa.id] });
      if (tarifa) qc.invalidateQueries({ queryKey: ['tarifas-kardex', tarifa.id] });
      qc.invalidateQueries({ queryKey: ['tarifas-actualizaciones'] });
      toast({
        title: `Versión ${res.tarifa.version} creada`,
        description: `Vigente desde ${vigenciaDesde}.`,
      });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  const valoresCambiados =
    (cuotaFija.trim() !== '' && Number(cuotaFija) !== (tarifa?.cuotaFija ?? NaN)) ||
    (precioUnitario.trim() !== '' && Number(precioUnitario) !== (tarifa?.precioUnitario ?? NaN));

  const motivoValido = motivo.trim().length >= 3;
  const puedeGuardar =
    !mutation.isPending &&
    motivoValido &&
    (modo === 'porcentaje' ? pctValido : valoresCambiados);

  const enviar = () => {
    if (!tarifa || !puedeGuardar) return;
    setError(null);
    const dto: ActualizarTarifaDto = { motivo: motivo.trim(), vigenciaDesde };
    if (modo === 'porcentaje') {
      dto.porcentaje = pctNum;
    } else {
      if (cuotaFija.trim() !== '' && Number.isFinite(Number(cuotaFija))) dto.cuotaFija = Number(cuotaFija);
      if (precioUnitario.trim() !== '' && Number.isFinite(Number(precioUnitario))) {
        dto.precioUnitario = Number(precioUnitario);
      }
    }
    mutation.mutate(dto);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg overflow-hidden [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Actualizar tarifa</DialogTitle>
          <DialogDescription>
            {tarifa
              ? `${tarifa.claseNombre ?? tarifa.nombre} · ${tarifa.tipoServicio}${
                  tarifa.concepto ? ` · ${tarifa.concepto}` : ''
                } · ${tarifa.administracionNombre ?? 'Global'}`
              : 'Se crea una versión nueva y la actual queda en el histórico.'}
          </DialogDescription>
        </DialogHeader>

        {tarifa && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <TipoCalculoBadge tipoCalculo={tarifa.tipoCalculo} />
              <IvaBadge ivaPct={tarifa.ivaPct} />
              <span>Versión actual v{tarifa.version}</span>
            </div>

            <div className="inline-flex rounded-md border p-0.5">
              {(['porcentaje', 'valores'] as Modo[]).map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant={modo === m ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setModo(m);
                    setError(null);
                  }}
                >
                  {m === 'porcentaje' ? 'Porcentaje' : 'Valores'}
                </Button>
              ))}
            </div>

            {modo === 'porcentaje' ? (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="tarifa-pct">Porcentaje a aplicar</Label>
                  <div className="relative">
                    <Input
                      id="tarifa-pct"
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    Se admiten valores negativos para reducir la tarifa. El IVA no cambia.
                  </p>
                </div>

                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40">
                        <th
                          scope="col"
                          className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          Concepto
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          Actual
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          Nuevo
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          Δ%
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((f) => (
                        <tr key={f.label} className="border-t">
                          <td className="px-3 py-2">{f.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{f.formato(f.actual)}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-[#003366]">
                            {f.nuevo != null ? f.formato(f.nuevo) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {f.nuevo != null ? fmtPct(deltaPct(f.actual, f.nuevo), 1) : '—'}
                          </td>
                        </tr>
                      ))}
                      {preview.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                            Esta tarifa no tiene importes que actualizar por porcentaje
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {esTabla && (
                  <p className="text-xs text-muted-foreground">
                    La tabla de precios
                    {detalle?.precios ? ` (${detalle.precios.length} tramos)` : ''} se recalcula completa con
                    el mismo porcentaje.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="tarifa-cuota">Precio base (cuota fija)</Label>
                    <Input
                      id="tarifa-cuota"
                      type="number"
                      step={0.01}
                      inputMode="decimal"
                      value={cuotaFija}
                      onChange={(e) => setCuotaFija(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="tarifa-unitario">Precio m³</Label>
                    <Input
                      id="tarifa-unitario"
                      type="number"
                      step={0.0001}
                      inputMode="decimal"
                      value={precioUnitario}
                      onChange={(e) => setPrecioUnitario(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  La tabla de precios por m³ no se edita a mano: se actualiza en bloque desde el modo
                  porcentaje.
                </p>
              </div>
            )}

            <div className="max-w-[220px]">
              <Label htmlFor="tarifa-vigencia">Vigencia desde</Label>
              <Input
                id="tarifa-vigencia"
                type="date"
                value={vigenciaDesde}
                onChange={(e) => setVigenciaDesde(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="tarifa-motivo">Motivo</Label>
              <Textarea
                id="tarifa-motivo"
                rows={2}
                placeholder="Ej. Actualización autorizada por el consejo tarifario"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              {!motivoValido && motivo.trim() !== '' && (
                <p className="mt-1 text-xs text-destructive">El motivo debe tener al menos 3 caracteres.</p>
              )}
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            className="bg-[#007BFF] text-white hover:bg-blue-600"
            onClick={enviar}
            disabled={!puedeGuardar}
          >
            {mutation.isPending ? 'Guardando…' : 'Crear versión'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
