import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Sprout,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  ACCIONES_DUNNING,
  CANALES_DUNNING,
  CATEGORIAS_MOROSIDAD,
  createReglaDunning,
  deleteReglaDunning,
  evaluarDunning,
  getAccionesCobranza,
  getCartera,
  getCarteraAging,
  getEstadoCuentaContrato,
  getReglasDunning,
  marcarIncobrable,
  recalcularCartera,
  seedReglasDunning,
  updateReglaDunning,
  type CarteraItemDto,
  type ReglaDunningDto,
  type ReglaDunningInput,
  type ResultadoDunningDto,
} from '@/api/cartera';
import {
  cancelarLoteFacturacion,
  getLoteFacturacion,
  getLotesFacturacion,
  reprocesarLoteFacturacion,
  type LoteFacturacionDto,
} from '@/api/facturacion-lotes';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

function formatDate(s?: string | null) {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

const BUCKET_LABELS: Record<string, string> = {
  corriente: 'Corriente',
  b1_30: '1–30 días',
  b31_60: '31–60 días',
  b61_90: '61–90 días',
  b90_mas: '90+ días',
};

const BUCKET_BADGES: Record<string, string> = {
  corriente: 'bg-green-100 text-green-800',
  b1_30: 'bg-yellow-100 text-yellow-800',
  b31_60: 'bg-orange-100 text-orange-800',
  b61_90: 'bg-red-100 text-red-800',
  b90_mas: 'bg-red-200 text-red-900',
};

const CATEGORIA_BADGES: Record<string, string> = {
  AL_CORRIENTE: 'bg-green-100 text-green-800',
  INCIPIENTE: 'bg-yellow-100 text-yellow-800',
  MODERADO: 'bg-orange-100 text-orange-800',
  ALTO: 'bg-red-100 text-red-800',
  CRITICO: 'bg-red-200 text-red-900',
};

const ESTADO_DOC_BADGES: Record<string, string> = {
  vigente: 'bg-blue-100 text-blue-800',
  vencido: 'bg-red-100 text-red-800',
  parcial: 'bg-yellow-100 text-yellow-800',
  pagado: 'bg-green-100 text-green-800',
  en_convenio: 'bg-purple-100 text-purple-800',
  incobrable: 'bg-gray-200 text-gray-700',
};

const ESTADO_ACCION_BADGES: Record<string, string> = {
  ejecutada: 'bg-green-100 text-green-800',
  fallida: 'bg-red-100 text-red-800',
  omitida: 'bg-gray-100 text-gray-600',
  dry_run: 'bg-blue-100 text-blue-800',
};

const ACCION_DUNNING_LABELS: Record<string, string> = {
  notificar_aviso: 'Aviso de adeudo',
  notificar_requerimiento: 'Requerimiento de pago',
  generar_restriccion: 'Restricción (mínimo vital)',
  generar_corte: 'Orden de corte',
  ofrecer_convenio: 'Ofrecer convenio',
  proponer_incobrable: 'Proponer incobrable',
};

const ESTADO_LOTE_BADGES: Record<string, string> = {
  generado: 'bg-blue-100 text-blue-800',
  cancelado: 'bg-red-100 text-red-800',
  reprocesado: 'bg-orange-100 text-orange-800',
};

function EstadoPill({ value, map }: { value: string; map: Record<string, string> }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[value] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}

function LoadingBlock({ text = 'Cargando…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <div className="h-7 w-7 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>;
}

// ─── Diálogo de resultado de dunning ────────────────────────────────────────

function DunningResultDialog({
  result,
  onClose,
}: {
  result: ResultadoDunningDto | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Evaluación de dunning {result?.dryRun ? '(dry-run)' : ''}
          </DialogTitle>
          <DialogDescription>
            {result?.dryRun
              ? 'Simulación: ninguna acción fue ejecutada realmente.'
              : 'Resultado de la corrida de dunning.'}
          </DialogDescription>
        </DialogHeader>
        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Evaluados', value: result.evaluados },
                { label: result.dryRun ? 'Aplicarían' : 'Ejecutadas', value: result.ejecutadas },
                { label: 'Fallidas', value: result.fallidas },
                { label: 'Omitidas', value: result.omitidas },
                { label: 'Sin regla', value: result.sinRegla },
              ].map(({ label, value }) => (
                <div key={label} className="border rounded-lg p-3 text-center">
                  <p className="text-xl font-bold tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            {result.mensaje && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {result.mensaje}
              </p>
            )}
            {result.acciones.length > 0 && (
              <div className="border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Regla</TableHead>
                      <TableHead>Acción</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.acciones.map((a, i) => (
                      <TableRow key={`${a.contratoId}-${i}`}>
                        <TableCell className="font-mono text-xs">
                          #{a.numeroContrato}
                        </TableCell>
                        <TableCell className="text-sm">{a.regla}</TableCell>
                        <TableCell className="text-sm">
                          {ACCION_DUNNING_LABELS[a.accion] ?? a.accion}
                        </TableCell>
                        <TableCell>
                          <EstadoPill value={a.estado} map={ESTADO_ACCION_BADGES} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab: Aging ─────────────────────────────────────────────────────────────

function TabAging() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dunningResult, setDunningResult] = useState<ResultadoDunningDto | null>(null);

  const agingQ = useQuery({ queryKey: ['cartera-aging'], queryFn: () => getCarteraAging() });

  const recalcularMut = useMutation({
    mutationFn: () => recalcularCartera(),
    onSuccess: (r) => {
      toast({
        title: 'Cartera recalculada',
        description: `${r.contratos ?? r.registros ?? 0} contratos, ${r.documentos ?? 0} documentos, ${r.errores ?? 0} errores.`,
      });
      queryClient.invalidateQueries({ queryKey: ['cartera-aging'] });
      queryClient.invalidateQueries({ queryKey: ['cartera-padron'] });
    },
    onError: (e: Error) =>
      toast({ title: 'Error al recalcular', description: e.message, variant: 'destructive' }),
  });

  const dunningMut = useMutation({
    mutationFn: () => evaluarDunning(true),
    onSuccess: (r) => setDunningResult(r),
    onError: (e: Error) =>
      toast({ title: 'Error al evaluar dunning', description: e.message, variant: 'destructive' }),
  });

  const total = agingQ.data?.total;
  const bucketCards = total
    ? [
        { key: 'corriente', importe: Number(total.bucketCorriente) },
        { key: 'b1_30', importe: Number(total.bucket1_30) },
        { key: 'b31_60', importe: Number(total.bucket31_60) },
        { key: 'b61_90', importe: Number(total.bucket61_90) },
        { key: 'b90_mas', importe: Number(total.bucket90_mas) },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => recalcularMut.mutate()}
          disabled={recalcularMut.isPending}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${recalcularMut.isPending ? 'animate-spin' : ''}`}
          />
          {recalcularMut.isPending ? 'Recalculando…' : 'Recalcular cartera'}
        </Button>
        <Button
          variant="outline"
          onClick={() => dunningMut.mutate()}
          disabled={dunningMut.isPending}
        >
          <PlayCircle className="h-4 w-4 mr-2" />
          {dunningMut.isPending ? 'Evaluando…' : 'Evaluar dunning (dry-run)'}
        </Button>
      </div>

      {agingQ.isLoading && <LoadingBlock text="Cargando aging de cartera…" />}
      {agingQ.isError && (
        <EmptyBlock text={`No se pudo cargar el aging: ${(agingQ.error as Error).message}`} />
      )}

      {total && (
        <>
          {/* Totales generales */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Saldo total', value: formatCurrency(Number(total.saldoTotal)), sub: `${total.contratos} contratos con saldo` },
              { label: 'Saldo vencido', value: formatCurrency(Number(total.saldoVencido)), sub: `${total.contratosVencidos} contratos vencidos`, color: 'text-red-600' },
              { label: 'Saldo corriente', value: formatCurrency(Number(total.saldoCorriente)), sub: 'No vencido', color: 'text-green-600' },
              { label: '% vencido', value: Number(total.saldoTotal) > 0 ? `${((Number(total.saldoVencido) / Number(total.saldoTotal)) * 100).toFixed(1)}%` : '0%', sub: 'Del saldo total' },
            ].map(({ label, value, sub, color }) => (
              <Card key={label}>
                <CardContent className="pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    {label}
                  </p>
                  <p className={`text-2xl font-bold tabular-nums ${color ?? ''}`}>{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Buckets */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {bucketCards.map(({ key, importe }) => (
              <Card key={key}>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {BUCKET_LABELS[key]}
                    </p>
                    <span className={`h-2.5 w-2.5 rounded-full ${BUCKET_BADGES[key]?.split(' ')[0] ?? 'bg-gray-200'}`} />
                  </div>
                  <p className="text-xl font-bold tabular-nums">{formatCurrency(importe)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {Number(total.saldoTotal) > 0
                      ? `${((importe / Number(total.saldoTotal)) * 100).toFixed(1)}% del total`
                      : '—'}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Por zona */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Aging por zona</CardTitle>
            </CardHeader>
            <CardContent>
              {agingQ.data!.zonas.length === 0 ? (
                <EmptyBlock text="No hay zonas con saldo pendiente." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zona</TableHead>
                      <TableHead>Administración</TableHead>
                      <TableHead className="text-right">Contratos</TableHead>
                      <TableHead className="text-right">Vencidos</TableHead>
                      <TableHead className="text-right">Corriente</TableHead>
                      <TableHead className="text-right">1–30</TableHead>
                      <TableHead className="text-right">31–60</TableHead>
                      <TableHead className="text-right">61–90</TableHead>
                      <TableHead className="text-right">90+</TableHead>
                      <TableHead className="text-right">Saldo vencido</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agingQ.data!.zonas.map((z) => (
                      <TableRow key={z.zonaId ?? 'sin_zona'}>
                        <TableCell className="font-medium">{z.zona ?? 'Sin zona'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {z.administracion ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{z.contratos}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {z.contratosVencidos}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(Number(z.bucketCorriente))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(Number(z.bucket1_30))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(Number(z.bucket31_60))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(Number(z.bucket61_90))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(Number(z.bucket90_mas))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-red-600">
                          {formatCurrency(Number(z.saldoVencido))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <DunningResultDialog result={dunningResult} onClose={() => setDunningResult(null)} />
    </div>
  );
}

// ─── Sheet: estado de cuenta de contrato ────────────────────────────────────

function EstadoCuentaSheet({
  contratoId,
  onClose,
}: {
  contratoId: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [incobrableOpen, setIncobrableOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [autorizadoPor, setAutorizadoPor] = useState(user?.name ?? '');

  const estadoQ = useQuery({
    queryKey: ['cartera-estado-cuenta', contratoId],
    queryFn: () => getEstadoCuentaContrato(contratoId!),
    enabled: !!contratoId,
  });

  const accionesQ = useQuery({
    queryKey: ['cartera-acciones', contratoId],
    queryFn: () => getAccionesCobranza({ contratoId: contratoId!, limit: 50 }),
    enabled: !!contratoId,
  });

  const incobrableMut = useMutation({
    mutationFn: () => marcarIncobrable(contratoId!, { motivo, autorizadoPor }),
    onSuccess: (r) => {
      toast({
        title: 'Contrato marcado como incobrable',
        description: `${r.documentosMarcados} documento(s) por ${formatCurrency(Number(r.saldoAlMomento))}.`,
      });
      setIncobrableOpen(false);
      setMotivo('');
      queryClient.invalidateQueries({ queryKey: ['cartera-estado-cuenta', contratoId] });
      queryClient.invalidateQueries({ queryKey: ['cartera-acciones', contratoId] });
      queryClient.invalidateQueries({ queryKey: ['cartera-padron'] });
      queryClient.invalidateQueries({ queryKey: ['cartera-aging'] });
    },
    onError: (e: Error) =>
      toast({ title: 'No se pudo marcar incobrable', description: e.message, variant: 'destructive' }),
  });

  const data = estadoQ.data;
  const ec = data?.estadoCuenta;
  const aplicaciones = useMemo(
    () =>
      (data?.documentos ?? [])
        .flatMap((d) =>
          (d.aplicaciones ?? []).map((a) => ({ ...a, periodo: d.periodo ?? d.tipo })),
        )
        .sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
    [data?.documentos],
  );
  const tieneDocsAbiertos = (data?.documentos ?? []).some(
    (d) => Number(d.saldo) > 0.01 && d.estado !== 'pagado' && d.estado !== 'incobrable',
  );

  return (
    <Sheet open={!!contratoId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {data?.contrato
              ? `Contrato #${data.contrato.numeroContrato} — ${data.contrato.nombre}`
              : 'Estado de cuenta'}
          </SheetTitle>
          <SheetDescription>
            {data?.contrato
              ? `${data.contrato.tipoServicio} · ${data.contrato.zona?.nombre ?? 'Sin zona'} · ${data.contrato.estado}`
              : 'Detalle de cartera del contrato'}
          </SheetDescription>
        </SheetHeader>

        {estadoQ.isLoading && <LoadingBlock text="Cargando estado de cuenta…" />}
        {estadoQ.isError && (
          <EmptyBlock text={`Error: ${(estadoQ.error as Error).message}`} />
        )}

        {data && (
          <div className="mt-5 space-y-6">
            {/* Resumen */}
            {ec && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Saldo total', value: formatCurrency(Number(ec.saldoTotal)) },
                  { label: 'Vencido', value: formatCurrency(Number(ec.saldoVencido)), color: 'text-red-600' },
                  { label: 'Días mora máx.', value: String(ec.diasMoraMax) },
                  { label: 'Score', value: `${ec.scoreMorosidad}/100` },
                ].map(({ label, value, color }) => (
                  <div key={label} className="border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`text-lg font-bold tabular-nums ${color ?? ''}`}>{value}</p>
                  </div>
                ))}
              </div>
            )}
            {ec && (
              <div className="flex flex-wrap items-center gap-2">
                <EstadoPill value={ec.categoria} map={CATEGORIA_BADGES} />
                {ec.enConvenio && <Badge variant="secondary">En convenio</Badge>}
                {ec.restringido && <Badge variant="destructive">Restringido</Badge>}
                <div className="ml-auto">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setIncobrableOpen(true)}
                    disabled={!tieneDocsAbiertos}
                    title={
                      tieneDocsAbiertos
                        ? 'Marcar los documentos abiertos como incobrables'
                        : 'No hay documentos abiertos que marcar'
                    }
                  >
                    <Ban className="h-4 w-4 mr-1.5" />
                    Marcar incobrable
                  </Button>
                </div>
              </div>
            )}

            {/* Documentos abiertos */}
            <div>
              <h3 className="text-sm font-semibold mb-2">
                Documentos de cartera ({data.documentos.length})
              </h3>
              {data.documentos.length === 0 ? (
                <EmptyBlock text="El contrato no tiene documentos de cartera." />
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periodo</TableHead>
                        <TableHead>Vence</TableHead>
                        <TableHead>Bucket</TableHead>
                        <TableHead className="text-right">Original</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.documentos.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.periodo ?? d.tipo}</TableCell>
                          <TableCell className="text-sm">
                            {formatDate(d.fechaVencimiento)}
                            {d.diasVencido > 0 && (
                              <span className="text-xs text-red-600 ml-1">
                                ({d.diasVencido} d)
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <EstadoPill value={BUCKET_LABELS[d.bucket] ?? d.bucket} map={{}} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Number(d.montoOriginal))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {formatCurrency(Number(d.saldo))}
                          </TableCell>
                          <TableCell>
                            <EstadoPill value={d.estado} map={ESTADO_DOC_BADGES} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Aplicaciones de pago */}
            <div>
              <h3 className="text-sm font-semibold mb-2">
                Aplicaciones de pago ({aplicaciones.length})
              </h3>
              {aplicaciones.length === 0 ? (
                <EmptyBlock text="No hay pagos aplicados a documentos." />
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Documento</TableHead>
                        <TableHead>Pago</TableHead>
                        <TableHead className="text-right">Monto aplicado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aplicaciones.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="tabular-nums">{formatDate(a.fecha)}</TableCell>
                          <TableCell>{a.periodo ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {a.pago ? `${a.pago.tipo} · ${a.pago.concepto}` : a.pagoId}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium text-green-700">
                            {formatCurrency(Number(a.monto))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Historial de acciones de cobranza */}
            <div>
              <h3 className="text-sm font-semibold mb-2">
                Acciones de cobranza ({accionesQ.data?.total ?? data.acciones.length})
              </h3>
              {(accionesQ.data?.data ?? data.acciones).length === 0 ? (
                <EmptyBlock text="Sin acciones de cobranza registradas." />
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Canal</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(accionesQ.data?.data ?? data.acciones).map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="tabular-nums text-sm">
                            {formatDate(a.createdAt)}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm font-medium">{a.tipo}</span>
                            {a.motivo && (
                              <p className="text-xs text-muted-foreground max-w-[220px] truncate" title={a.motivo}>
                                {a.motivo}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {a.canal ?? '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Number(a.saldoAlMomento))}
                          </TableCell>
                          <TableCell>
                            <EstadoPill value={a.estado} map={ESTADO_ACCION_BADGES} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Diálogo marcar incobrable */}
        <Dialog open={incobrableOpen} onOpenChange={setIncobrableOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Marcar contrato como incobrable
              </DialogTitle>
              <DialogDescription>
                Todos los documentos abiertos del contrato se marcarán como incobrables y
                saldrán de los saldos de cartera. Esta operación requiere autorización y queda
                registrada en el historial.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="motivo-incobrable">Motivo (obligatorio)</Label>
                <Textarea
                  id="motivo-incobrable"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej. Predio deshabitado sin localización del titular…"
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="autorizado-por">Autorizado por</Label>
                <Input
                  id="autorizado-por"
                  value={autorizadoPor}
                  onChange={(e) => setAutorizadoPor(e.target.value)}
                  placeholder="Nombre de quien autoriza"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIncobrableOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => incobrableMut.mutate()}
                disabled={motivo.trim().length < 5 || autorizadoPor.trim().length < 3 || incobrableMut.isPending}
              >
                {incobrableMut.isPending ? 'Marcando…' : 'Confirmar incobrable'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

// ─── Tab: Padrón vencido ────────────────────────────────────────────────────

type SortKey = 'saldoVencido' | 'scoreMorosidad' | 'diasMoraMax';

function TabPadron() {
  const [bucket, setBucket] = useState('todos');
  const [categoria, setCategoria] = useState('todas');
  const [scoreMin, setScoreMin] = useState('');
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('saldoVencido');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [contratoSel, setContratoSel] = useState<string | null>(null);
  const limit = 20;

  const params = {
    bucket: bucket !== 'todos' ? bucket : undefined,
    categoria: categoria !== 'todas' ? categoria : undefined,
    scoreMin: scoreMin ? Number(scoreMin) : undefined,
    page,
    limit,
  };

  const carteraQ = useQuery({
    queryKey: ['cartera-padron', params],
    queryFn: () => getCartera(params),
  });

  const sorted = useMemo(() => {
    const rows = [...(carteraQ.data?.data ?? [])];
    rows.sort((a, b) => {
      const va = Number(a[sortKey]);
      const vb = Number(b[sortKey]);
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return rows;
  }, [carteraQ.data?.data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <button
      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      onClick={() => toggleSort(k)}
    >
      {label}
      {sortKey === k ? (
        sortDir === 'desc' ? (
          <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUp className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );

  const total = carteraQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Bucket</Label>
          <Select
            value={bucket}
            onValueChange={(v) => {
              setBucket(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {Object.entries(BUCKET_LABELS).map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Categoría</Label>
          <Select
            value={categoria}
            onValueChange={(v) => {
              setCategoria(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {CATEGORIAS_MOROSIDAD.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Score mínimo</Label>
          <Input
            type="number"
            min={0}
            max={100}
            className="w-32"
            placeholder="0–100"
            value={scoreMin}
            onChange={(e) => {
              setScoreMin(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <p className="ml-auto text-sm text-muted-foreground">
          {total} contrato{total === 1 ? '' : 's'} con saldo
        </p>
      </div>

      {/* Tabla */}
      <div className="border rounded-lg overflow-hidden bg-white">
        {carteraQ.isLoading ? (
          <LoadingBlock text="Cargando padrón…" />
        ) : carteraQ.isError ? (
          <EmptyBlock text={`Error: ${(carteraQ.error as Error).message}`} />
        ) : sorted.length === 0 ? (
          <EmptyBlock text="No hay contratos que cumplan los filtros. Prueba con «Recalcular cartera» en la pestaña Aging si la cartera está vacía." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contrato</TableHead>
                <TableHead>Zona</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Saldo total</TableHead>
                <TableHead className="text-right">
                  <SortHeader label="Saldo vencido" k="saldoVencido" />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader label="Días mora" k="diasMoraMax" />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader label="Score" k="scoreMorosidad" />
                </TableHead>
                <TableHead>Banderas</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((ec: CarteraItemDto) => (
                <TableRow
                  key={ec.id}
                  className="cursor-pointer"
                  onClick={() => setContratoSel(ec.contratoId)}
                >
                  <TableCell>
                    <p className="font-medium">#{ec.contrato?.numeroContrato ?? '—'}</p>
                    <p className="text-xs text-muted-foreground max-w-[180px] truncate">
                      {ec.contrato?.nombre ?? ec.contratoId}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {ec.contrato?.zona?.nombre ?? '—'}
                  </TableCell>
                  <TableCell>
                    <EstadoPill value={ec.categoria} map={CATEGORIA_BADGES} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(Number(ec.saldoTotal))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-red-600">
                    {formatCurrency(Number(ec.saldoVencido))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{ec.diasMoraMax}</TableCell>
                  <TableCell className="text-right tabular-nums">{ec.scoreMorosidad}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {ec.enConvenio && <Badge variant="secondary">Convenio</Badge>}
                      {ec.restringido && <Badge variant="destructive">Restringido</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setContratoSel(ec.contratoId);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Paginación */}
      {total > limit && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <EstadoCuentaSheet contratoId={contratoSel} onClose={() => setContratoSel(null)} />
    </div>
  );
}

// ─── Tab: Reglas de dunning ─────────────────────────────────────────────────

const REGLA_VACIA: ReglaDunningInput = {
  nombre: '',
  orden: 0,
  activo: true,
  diasMoraMin: 5,
  minDocsVencidos: 1,
  montoMinimo: 0,
  accion: 'notificar_aviso',
  canal: 'ambos',
  reintentoDias: 15,
};

function TabReglas() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<ReglaDunningDto | null>(null);
  const [form, setForm] = useState<ReglaDunningInput>(REGLA_VACIA);
  const [eliminar, setEliminar] = useState<ReglaDunningDto | null>(null);

  const reglasQ = useQuery({ queryKey: ['reglas-dunning'], queryFn: getReglasDunning });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['reglas-dunning'] });

  const saveMut = useMutation({
    mutationFn: () =>
      editando ? updateReglaDunning(editando.id, form) : createReglaDunning(form),
    onSuccess: () => {
      toast({ title: editando ? 'Regla actualizada' : 'Regla creada' });
      setFormOpen(false);
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: 'Error al guardar regla', description: e.message, variant: 'destructive' }),
  });

  const toggleMut = useMutation({
    mutationFn: (regla: ReglaDunningDto) =>
      updateReglaDunning(regla.id, { activo: !regla.activo }),
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: 'Error al actualizar', description: e.message, variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteReglaDunning(id),
    onSuccess: () => {
      toast({ title: 'Regla eliminada' });
      setEliminar(null);
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: 'Error al eliminar', description: e.message, variant: 'destructive' }),
  });

  const seedMut = useMutation({
    mutationFn: seedReglasDunning,
    onSuccess: (r) => {
      toast({
        title: r.seeded ? 'Reglas default sembradas' : 'No se sembró nada',
        description: r.mensaje ?? `Total de reglas: ${r.total}`,
      });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: 'Error al sembrar', description: e.message, variant: 'destructive' }),
  });

  const abrirCrear = () => {
    setEditando(null);
    setForm(REGLA_VACIA);
    setFormOpen(true);
  };

  const abrirEditar = (r: ReglaDunningDto) => {
    setEditando(r);
    setForm({
      nombre: r.nombre,
      orden: r.orden,
      activo: r.activo,
      tipoServicio: r.tipoServicio ?? undefined,
      diasMoraMin: r.diasMoraMin,
      minDocsVencidos: r.minDocsVencidos,
      montoMinimo: Number(r.montoMinimo),
      accion: r.accion,
      canal: r.canal ?? undefined,
      reintentoDias: r.reintentoDias,
    });
    setFormOpen(true);
  };

  const setF = <K extends keyof ReglaDunningInput>(k: K, v: ReglaDunningInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={abrirCrear}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva regla
        </Button>
        <Button variant="outline" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
          <Sprout className="h-4 w-4 mr-2" />
          {seedMut.isPending ? 'Sembrando…' : 'Sembrar reglas default'}
        </Button>
        <p className="ml-auto text-xs text-muted-foreground max-w-md">
          El pipeline aplica la regla de mayor «días de mora» alcanzada; en empate gana la más
          específica (con segmento de servicio).
        </p>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white">
        {reglasQ.isLoading ? (
          <LoadingBlock text="Cargando reglas…" />
        ) : reglasQ.isError ? (
          <EmptyBlock text={`Error: ${(reglasQ.error as Error).message}`} />
        ) : (reglasQ.data ?? []).length === 0 ? (
          <EmptyBlock text="No hay reglas de dunning. Usa «Sembrar reglas default» para empezar." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Orden</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="text-right">Días mora ≥</TableHead>
                <TableHead className="text-right">Docs ≥</TableHead>
                <TableHead className="text-right">Monto ≥</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead className="text-right">Reintento</TableHead>
                <TableHead>Activa</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reglasQ.data ?? []).map((r) => (
                <TableRow key={r.id} className={r.activo ? '' : 'opacity-50'}>
                  <TableCell className="tabular-nums">{r.orden}</TableCell>
                  <TableCell className="font-medium max-w-[260px] truncate" title={r.nombre}>
                    {r.nombre}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.diasMoraMin}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.minDocsVencidos}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(Number(r.montoMinimo))}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ACCION_DUNNING_LABELS[r.accion] ?? r.accion}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.canal ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.tipoServicio ?? 'Todos'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.reintentoDias} d</TableCell>
                  <TableCell>
                    <Switch
                      checked={r.activo}
                      onCheckedChange={() => toggleMut.mutate(r)}
                      disabled={toggleMut.isPending}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => abrirEditar(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setEliminar(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Formulario crear/editar */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar regla de dunning' : 'Nueva regla de dunning'}</DialogTitle>
            <DialogDescription>
              Define cuándo y cómo actuar sobre la cartera vencida.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Nombre</Label>
              <Input
                value={form.nombre}
                onChange={(e) => setF('nombre', e.target.value)}
                placeholder="Ej. Aviso de adeudo (5 días de mora)"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Orden</Label>
              <Input
                type="number"
                value={form.orden ?? 0}
                onChange={(e) => setF('orden', Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Días de mora mínimos</Label>
              <Input
                type="number"
                min={0}
                value={form.diasMoraMin}
                onChange={(e) => setF('diasMoraMin', Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Docs vencidos mínimos</Label>
              <Input
                type="number"
                min={1}
                value={form.minDocsVencidos ?? 1}
                onChange={(e) => setF('minDocsVencidos', Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Monto mínimo (MXN)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.montoMinimo ?? 0}
                onChange={(e) => setF('montoMinimo', Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Acción</Label>
              <Select value={form.accion} onValueChange={(v) => setF('accion', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCIONES_DUNNING.map((a) => (
                    <SelectItem key={a} value={a}>
                      {ACCION_DUNNING_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Canal</Label>
              <Select
                value={form.canal ?? 'sin_canal'}
                onValueChange={(v) => setF('canal', v === 'sin_canal' ? undefined : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sin_canal">— (no aplica)</SelectItem>
                  {CANALES_DUNNING.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reintento (días)</Label>
              <Input
                type="number"
                min={1}
                value={form.reintentoDias ?? 15}
                onChange={(e) => setF('reintentoDias', Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de servicio (opcional)</Label>
              <Input
                value={form.tipoServicio ?? ''}
                onChange={(e) => setF('tipoServicio', e.target.value || undefined)}
                placeholder="Ej. Doméstico (vacío = todos)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={
                saveMut.isPending || form.nombre.trim().length === 0 || !(form.diasMoraMin >= 0)
              }
            >
              {saveMut.isPending ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear regla'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar eliminación */}
      <Dialog open={!!eliminar} onOpenChange={(o) => !o && setEliminar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar regla</DialogTitle>
            <DialogDescription>
              ¿Eliminar la regla «{eliminar?.nombre}»? Las acciones históricas que originó se
              conservan, pero la regla dejará de evaluarse.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEliminar(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => eliminar && deleteMut.mutate(eliminar.id)}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab: Lotes de facturación ──────────────────────────────────────────────

function TabLotes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [periodo, setPeriodo] = useState('');
  const [estado, setEstado] = useState('todos');
  const [page, setPage] = useState(1);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [accion, setAccion] = useState<{ tipo: 'cancelar' | 'reprocesar'; lote: LoteFacturacionDto } | null>(null);
  const [motivo, setMotivo] = useState('');
  const limit = 20;

  const params = {
    periodo: periodo || undefined,
    estado: estado !== 'todos' ? estado : undefined,
    page,
    limit,
  };

  const lotesQ = useQuery({
    queryKey: ['lotes-facturacion', params],
    queryFn: () => getLotesFacturacion(params),
  });

  const detalleQ = useQuery({
    queryKey: ['lote-facturacion', detalleId],
    queryFn: () => getLoteFacturacion(detalleId!),
    enabled: !!detalleId,
  });

  const accionMut = useMutation({
    mutationFn: () =>
      accion!.tipo === 'cancelar'
        ? cancelarLoteFacturacion(accion!.lote.id, motivo)
        : reprocesarLoteFacturacion(accion!.lote.id, motivo),
    onSuccess: (r) => {
      if (accion?.tipo === 'cancelar') {
        const rc = r as Awaited<ReturnType<typeof cancelarLoteFacturacion>>;
        toast({
          title: 'Lote cancelado',
          description: `${rc.timbradosCancelados} factura(s) canceladas por ${formatCurrency(Number(rc.importeCancelado))}.`,
        });
      } else {
        const rr = r as Awaited<ReturnType<typeof reprocesarLoteFacturacion>>;
        toast({
          title: 'Lote reprocesado',
          description: `Nuevo lote con ${rr.comparativo.generadosNuevo} factura(s); diferencia ${formatCurrency(Number(rr.comparativo.diferencia))}.`,
        });
      }
      setAccion(null);
      setMotivo('');
      queryClient.invalidateQueries({ queryKey: ['lotes-facturacion'] });
      queryClient.invalidateQueries({ queryKey: ['cartera-aging'] });
      queryClient.invalidateQueries({ queryKey: ['cartera-padron'] });
    },
    onError: (e: Error) =>
      toast({
        title: accion?.tipo === 'cancelar' ? 'No se pudo cancelar el lote' : 'No se pudo reprocesar el lote',
        description: e.message,
        variant: 'destructive',
      }),
  });

  const total = lotesQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Periodo</Label>
          <Input
            className="w-40"
            placeholder="2026-06"
            value={periodo}
            onChange={(e) => {
              setPeriodo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Estado</Label>
          <Select
            value={estado}
            onValueChange={(v) => {
              setEstado(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="generado">Generado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
              <SelectItem value="reprocesado">Reprocesado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="ml-auto text-sm text-muted-foreground">
          {total} lote{total === 1 ? '' : 's'}
        </p>
      </div>

      {/* Tabla */}
      <div className="border rounded-lg overflow-hidden bg-white">
        {lotesQ.isLoading ? (
          <LoadingBlock text="Cargando lotes…" />
        ) : lotesQ.isError ? (
          <EmptyBlock text={`Error: ${(lotesQ.error as Error).message}`} />
        ) : (lotesQ.data?.data ?? []).length === 0 ? (
          <EmptyBlock text="No hay lotes de facturación. Se generan al ejecutar la facturación masiva de un periodo." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Periodo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Generados</TableHead>
                <TableHead className="text-right">Con error</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(lotesQ.data?.data ?? []).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.periodo}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(l.createdAt)}
                  </TableCell>
                  <TableCell>
                    <EstadoPill value={l.estado} map={ESTADO_LOTE_BADGES} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.generados}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.conError > 0 ? (
                      <span className="text-red-600 font-medium">{l.conError}</span>
                    ) : (
                      0
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatCurrency(Number(l.importeTotal))}
                  </TableCell>
                  <TableCell
                    className="text-xs text-muted-foreground max-w-[180px] truncate"
                    title={l.motivoCancelacion ?? undefined}
                  >
                    {l.motivoCancelacion ?? '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => setDetalleId(l.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {l.estado === 'generado' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            title="Cancelar lote"
                            onClick={() => {
                              setAccion({ tipo: 'cancelar', lote: l });
                              setMotivo('');
                            }}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Reprocesar lote"
                            onClick={() => {
                              setAccion({ tipo: 'reprocesar', lote: l });
                              setMotivo('');
                            }}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Paginación */}
      {total > limit && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detalle de lote */}
      <Dialog open={!!detalleId} onOpenChange={(o) => !o && setDetalleId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle del lote</DialogTitle>
            <DialogDescription>
              {detalleQ.data ? `Periodo ${detalleQ.data.periodo}` : 'Cargando…'}
            </DialogDescription>
          </DialogHeader>
          {detalleQ.isLoading && <LoadingBlock />}
          {detalleQ.data && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Estado', value: detalleQ.data.estado },
                  { label: 'Timbrados', value: String(detalleQ.data.totales.timbrados) },
                  { label: 'Importe', value: formatCurrency(Number(detalleQ.data.importeTotal)) },
                ].map(({ label, value }) => (
                  <div key={label} className="border rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-bold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Estado del timbrado</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detalleQ.data.totales.porEstado.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          Sin timbrados asociados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      detalleQ.data.totales.porEstado.map((g) => (
                        <TableRow key={g.estado}>
                          <TableCell>{g.estado}</TableCell>
                          <TableCell className="text-right tabular-nums">{g.cantidad}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Number(g.importe))}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {detalleQ.data.motivoCancelacion && (
                <p className="text-sm text-muted-foreground">
                  Motivo: {detalleQ.data.motivoCancelacion}
                  {detalleQ.data.canceladoPor ? ` (${detalleQ.data.canceladoPor})` : ''}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetalleId(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancelar / Reprocesar */}
      <Dialog open={!!accion} onOpenChange={(o) => !o && setAccion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {accion?.tipo === 'cancelar' ? 'Cancelar lote de facturación' : 'Reprocesar lote de facturación'}
            </DialogTitle>
            <DialogDescription>
              {accion?.tipo === 'cancelar'
                ? `Se cancelarán las ${accion.lote.generados} factura(s) del lote del periodo ${accion.lote.periodo} y se eliminarán sus recibos. `
                : `Se cancelará el lote del periodo ${accion?.lote.periodo} y se volverá a facturar con los filtros originales. `}
              Solo procede si ningún CFDI está sellado y ningún recibo tiene pagos aplicados;
              de lo contrario el backend rechazará la operación.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="motivo-lote">Motivo (obligatorio)</Label>
            <Textarea
              id="motivo-lote"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. Tarifas incorrectas en el periodo…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccion(null)}>
              Cerrar
            </Button>
            <Button
              variant={accion?.tipo === 'cancelar' ? 'destructive' : 'default'}
              onClick={() => accionMut.mutate()}
              disabled={motivo.trim().length < 5 || accionMut.isPending}
            >
              {accionMut.isPending
                ? 'Procesando…'
                : accion?.tipo === 'cancelar'
                  ? 'Cancelar lote'
                  : 'Reprocesar lote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────

const Cartera = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Cartera y cobranza</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Aging de cartera vencida, padrón de morosidad, reglas de dunning y lotes de facturación.
        </p>
      </div>

      <Tabs defaultValue="aging">
        <TabsList>
          <TabsTrigger value="aging">Aging</TabsTrigger>
          <TabsTrigger value="padron">Padrón vencido</TabsTrigger>
          <TabsTrigger value="reglas">Reglas de dunning</TabsTrigger>
          <TabsTrigger value="lotes">Lotes de facturación</TabsTrigger>
        </TabsList>
        <TabsContent value="aging" className="mt-4">
          <TabAging />
        </TabsContent>
        <TabsContent value="padron" className="mt-4">
          <TabPadron />
        </TabsContent>
        <TabsContent value="reglas" className="mt-4">
          <TabReglas />
        </TabsContent>
        <TabsContent value="lotes" className="mt-4">
          <TabLotes />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Cartera;
