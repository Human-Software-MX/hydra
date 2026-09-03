import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Info } from 'lucide-react';
import {
  fetchCategoriasTarifa,
  updateCategoriaTarifa,
  updateClaseTarifa,
  type CategoriaTarifaDto,
  type ClaseTarifaDto,
} from '@/api/tarifas';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { IvaBadge } from './badges';
import { hoyISO } from './format';

const HEREDA = 'hereda';
const MOTIVO_DEFAULT = 'Cambio de configuración fiscal';

interface CambioPendiente {
  tipo: 'categoria' | 'clase';
  id: string;
  nombre: string;
  /** null solo aplica a clases: vuelve a heredar el IVA de su categoría. */
  ivaPct: number | null;
  ivaAnterior: number;
  /** Tarifas vigentes que recibirán una versión nueva. */
  tarifasAfectadas: number;
}

/** Tarifas vigentes de las clases que no sobrescriben el IVA: son las que hereda la categoría. */
const tarifasHeredadas = (c: CategoriaTarifaDto) =>
  c.clases.filter((cl) => cl.ivaPct == null).reduce((acc, cl) => acc + cl.totalTarifasVigentes, 0);

const tarifasDeCategoria = (c: CategoriaTarifaDto) =>
  c.clases.reduce((acc, cl) => acc + cl.totalTarifasVigentes, 0);

interface Props {
  useApi: boolean;
}

export function ConfiguracionFiscalTab({ useApi }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [cambio, setCambio] = useState<CambioPendiente | null>(null);
  const [vigenciaDesde, setVigenciaDesde] = useState(hoyISO());
  const [motivo, setMotivo] = useState(MOTIVO_DEFAULT);
  const [error, setError] = useState<string | null>(null);

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ['tarifas-categorias'],
    queryFn: fetchCategoriasTarifa,
    enabled: useApi,
  });

  useEffect(() => {
    if (!cambio) return;
    setVigenciaDesde(hoyISO());
    setMotivo(MOTIVO_DEFAULT);
    setError(null);
  }, [cambio]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['tarifas-categorias'] });
    qc.invalidateQueries({ queryKey: ['tarifas-vigentes'] });
    qc.invalidateQueries({ queryKey: ['tarifas-movimientos'] });
  };

  const mutation = useMutation({
    mutationFn: (c: CambioPendiente) => {
      const dto = { ivaPct: c.ivaPct, vigenciaDesde, motivo: motivo.trim() };
      return c.tipo === 'categoria'
        ? updateCategoriaTarifa(c.id, { ...dto, ivaPct: c.ivaPct ?? 0 })
        : updateClaseTarifa(c.id, dto);
    },
    onSuccess: (_res, c) => {
      invalidar();
      toast({
        title: 'Configuración fiscal actualizada',
        description:
          c.tarifasAfectadas > 0
            ? `Se creó una versión nueva en ${c.tarifasAfectadas} tarifa${c.tarifasAfectadas === 1 ? '' : 's'}.`
            : 'No había tarifas vigentes que versionar.',
      });
      setCambio(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          El IVA se define por categoría y lo heredan sus clases; una clase puede sobrescribirlo. Los servicios
          domésticos están exentos (0 %).
        </AlertDescription>
      </Alert>

      {isLoading && <p className="text-sm text-muted-foreground">Cargando catálogo fiscal…</p>}
      {!isLoading && categorias.length === 0 && (
        <div className="rounded-xl border border-border/50 bg-white py-10 text-center text-sm text-muted-foreground shadow-sm">
          {useApi ? 'Sin categorías de tarifa registradas' : 'Sin conexión al servidor de tarifas'}
        </div>
      )}

      {categorias.map((c) => (
        <div key={c.id} className="rounded-xl border border-border/50 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold">{c.nombre}</p>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {c.codigo}
                </Badge>
                <IvaBadge ivaPct={c.ivaPct} />
              </div>
              {c.descripcion && <p className="mt-0.5 text-xs text-muted-foreground">{c.descripcion}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {c.clases.length} clase{c.clases.length === 1 ? '' : 's'} · {tarifasDeCategoria(c)} tarifa
                {tarifasDeCategoria(c) === 1 ? '' : 's'} vigente{tarifasDeCategoria(c) === 1 ? '' : 's'}
              </p>
            </div>
            <div className="w-[180px]">
              <Label className="text-xs text-muted-foreground">IVA de la categoría</Label>
              <Select
                value={String(c.ivaPct)}
                onValueChange={(v) => {
                  const nuevo = Number(v);
                  if (nuevo === c.ivaPct) return;
                  setCambio({
                    tipo: 'categoria',
                    id: c.id,
                    nombre: c.nombre,
                    ivaPct: nuevo,
                    ivaAnterior: c.ivaPct,
                    tarifasAfectadas: tarifasHeredadas(c),
                  });
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 % (exenta)</SelectItem>
                  <SelectItem value="16">16 %</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 divide-y divide-border/60 border-t border-border/60">
            {c.clases.map((cl) => (
              <FilaClase
                key={cl.id}
                clase={cl}
                ivaCategoria={c.ivaPct}
                onCambiar={(ivaPct) =>
                  setCambio({
                    tipo: 'clase',
                    id: cl.id,
                    nombre: cl.nombre,
                    ivaPct,
                    ivaAnterior: cl.ivaEfectivo,
                    tarifasAfectadas: cl.totalTarifasVigentes,
                  })
                }
              />
            ))}
            {c.clases.length === 0 && (
              <p className="py-3 text-xs text-muted-foreground">Esta categoría no tiene clases.</p>
            )}
          </div>
        </div>
      ))}

      <Dialog open={Boolean(cambio)} onOpenChange={(o) => !o && !mutation.isPending && setCambio(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md overflow-hidden [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Cambiar configuración fiscal</DialogTitle>
            <DialogDescription>
              {cambio
                ? `${cambio.tipo === 'categoria' ? 'Categoría' : 'Clase'} ${cambio.nombre}: IVA ${
                    cambio.ivaAnterior
                  } % → ${cambio.ivaPct == null ? 'heredado' : `${cambio.ivaPct} %`}.`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {cambio && (
            <div className="space-y-3">
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                Se creará una nueva versión en{' '}
                <span className="font-semibold">
                  {cambio.tarifasAfectadas} tarifa{cambio.tarifasAfectadas === 1 ? '' : 's'} vigente
                  {cambio.tarifasAfectadas === 1 ? '' : 's'}
                </span>
                {cambio.tipo === 'categoria' ? ' de las clases que heredan el IVA.' : ' de esta clase.'}
              </p>
              <div className="max-w-[220px]">
                <Label htmlFor="fiscal-vigencia">Vigencia desde</Label>
                <Input
                  id="fiscal-vigencia"
                  type="date"
                  value={vigenciaDesde}
                  onChange={(e) => setVigenciaDesde(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="fiscal-motivo">Motivo</Label>
                <Textarea
                  id="fiscal-motivo"
                  rows={2}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
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
            <Button variant="outline" onClick={() => setCambio(null)} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button
              className="bg-[#007BFF] text-white hover:bg-blue-600"
              disabled={mutation.isPending || motivo.trim().length < 3}
              onClick={() => cambio && mutation.mutate(cambio)}
            >
              {mutation.isPending ? 'Guardando…' : 'Confirmar cambio'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilaClase({
  clase,
  ivaCategoria,
  onCambiar,
}: {
  clase: ClaseTarifaDto;
  ivaCategoria: number;
  onCambiar: (ivaPct: number | null) => void;
}) {
  const valor = clase.ivaPct == null ? HEREDA : String(clase.ivaPct);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{clase.nombre}</p>
          <Badge variant="outline" className="font-mono text-[10px]">
            {clase.codigo}
          </Badge>
          {clase.sigeTpsId != null && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              SIGE {clase.sigeTpsId}
            </span>
          )}
          <IvaBadge ivaPct={clase.ivaEfectivo} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {clase.totalTarifasVigentes} tarifa{clase.totalTarifasVigentes === 1 ? '' : 's'} vigente
          {clase.totalTarifasVigentes === 1 ? '' : 's'}
          {clase.ivaPct == null ? ' · IVA heredado' : ' · IVA propio'}
        </p>
      </div>
      <div className="w-[180px]">
        <Select
          value={valor}
          onValueChange={(v) => {
            const nuevo = v === HEREDA ? null : Number(v);
            if (nuevo === clase.ivaPct) return;
            onCambiar(nuevo);
          }}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={HEREDA}>Hereda ({ivaCategoria} %)</SelectItem>
            <SelectItem value="0">0 %</SelectItem>
            <SelectItem value="16">16 %</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
