import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Play, CheckCircle2, AlertCircle, Clock, Activity, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  getDashboard, getLogs, getConciliaciones, ejecutarConciliacion, marcarEstadoConciliacion,
  type DashboardDto, type DashboardProcesoDto, type LogProcesoDto, type ConciliacionDto,
} from '@/api/monitoreo';

const TIPO_LABELS: Record<string, string> = {
  ETL_PAGOS: 'ETL Pagos',
  GIS_EXPORT: 'Exportación GIS',
  POLIZA_COBROS: 'Póliza Cobros',
  POLIZA_FACTURACION: 'Póliza Facturación',
  VALIDACION_LECTURAS: 'Validación Lecturas',
  TIMBRADO: 'Timbrado',
  OTRO: 'Otro',
};

const TIPOS_CONCILIACION = [
  { value: 'RECAUDACION_VS_FACTURACION', label: 'Recaudación vs Facturación' },
  { value: 'FACTURACION_VS_CONTABILIDAD', label: 'Facturación vs Contabilidad' },
  { value: 'PADRON_VS_GIS', label: 'Padrón vs GIS' },
];

const ESTADO_LOG_CONFIG: Record<string, { cls: string }> = {
  Completado: { cls: 'bg-green-100 text-green-800' },
  Error: { cls: 'bg-red-100 text-red-800' },
  Advertencia: { cls: 'bg-yellow-100 text-yellow-800' },
  Iniciado: { cls: 'bg-blue-100 text-blue-800' },
  Procesando: { cls: 'bg-blue-100 text-blue-800' },
};

const ESTADO_CONCILIACION_CONFIG: Record<string, string> = {
  Revisión: 'bg-yellow-100 text-yellow-800',
  Aceptado: 'bg-green-100 text-green-800',
  Corregido: 'bg-blue-100 text-blue-800',
};

function formatDate(s?: string) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(ms?: number) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCurrency(n?: number) {
  if (n === undefined || n === null) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

// ─── Process Health Card ──────────────────────────────────────────────────────

function ProcesoCard({ proceso }: { proceso: DashboardProcesoDto }) {
  const label = TIPO_LABELS[proceso.tipo] ?? proceso.tipo;
  const { saludable, errores, total, ultimo } = proceso;

  const icon = saludable
    ? <CheckCircle2 className="h-5 w-5 text-green-600" />
    : errores > 0
      ? <AlertCircle className="h-5 w-5 text-red-500" />
      : <Clock className="h-5 w-5 text-gray-400" />;

  const statusCls = saludable
    ? 'border-green-200 bg-green-50'
    : errores > 0
      ? 'border-red-200 bg-red-50'
      : 'border-gray-200 bg-gray-50';

  return (
    <div className={cn('rounded-lg border p-3 space-y-2', statusCls)}>
      <div className="flex items-start gap-2">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{label}</div>
          <div className="text-xs text-muted-foreground">
            {total === 0 ? 'Sin actividad en 24h' : `${total} ejecución${total !== 1 ? 'es' : ''} hoy`}
            {errores > 0 && ` · ${errores} error${errores !== 1 ? 'es' : ''}`}
          </div>
        </div>
        <span className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0',
          saludable ? 'bg-green-200 text-green-800' : errores > 0 ? 'bg-red-200 text-red-800' : 'bg-gray-200 text-gray-600',
        )}>
          {saludable ? 'OK' : errores > 0 ? 'Error' : 'Inactivo'}
        </span>
      </div>

      {ultimo && (
        <div className="text-xs text-muted-foreground border-t pt-1.5 space-y-0.5">
          <div>Último: {formatDate(ultimo.inicio)}</div>
          <div className="flex gap-3">
            <span>{formatDuration(ultimo.duracionMs)}</span>
            <span>{ultimo.registros} registros</span>
            {ultimo.errores > 0 && <span className="text-red-600">{ultimo.errores} errores</span>}
          </div>
          {ultimo.errorMsg && (
            <div className="text-red-600 truncate" title={ultimo.errorMsg}>
              {ultimo.errorMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Log Detail Panel ─────────────────────────────────────────────────────────

function LogDetail({ log, onClose }: { log: LogProcesoDto; onClose: () => void }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{TIPO_LABELS[log.tipo] ?? log.tipo}</div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          { label: 'Estado', value: log.estado },
          { label: 'SubTipo', value: log.subTipo ?? '—' },
          { label: 'Inicio', value: formatDate(log.inicio) },
          { label: 'Fin', value: formatDate(log.fin) },
          { label: 'Duración', value: formatDuration(log.duracionMs) },
          { label: 'Registros', value: String(log.registros) },
          { label: 'Errores', value: String(log.errores) },
          { label: 'Advertencias', value: String(log.advertencias) },
        ].map((item) => (
          <div key={item.label} className="rounded border p-2">
            <div className="text-muted-foreground">{item.label}</div>
            <div className="font-medium mt-0.5">{item.value}</div>
          </div>
        ))}
      </div>

      {log.errorMsg && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Error
          </div>
          <pre className="text-xs bg-red-50 text-red-800 rounded border p-2 overflow-x-auto whitespace-pre-wrap">
            {log.errorMsg}
          </pre>
        </div>
      )}

      {log.detalle && Object.keys(log.detalle).length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Detalle
          </div>
          <pre className="text-xs bg-muted rounded border p-2 overflow-x-auto max-h-40">
            {JSON.stringify(log.detalle, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Ejecutar Conciliacion Dialog ─────────────────────────────────────────────

function EjecutarConciliacionDialog({
  open,
  onOpenChange,
  onExecuted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExecuted: () => void;
}) {
  const now = new Date();
  const defaultPeriodo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [tipo, setTipo] = useState('RECAUDACION_VS_FACTURACION');
  const [periodo, setPeriodo] = useState(defaultPeriodo);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  function handleClose() {
    setError('');
    onOpenChange(false);
  }

  async function handleSubmit() {
    setRunning(true);
    setError('');
    try {
      await ejecutarConciliacion(tipo, periodo);
      handleClose();
      onExecuted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al ejecutar conciliación.');
    } finally { setRunning(false); }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Ejecutar conciliación</DialogTitle>
          <DialogDescription>
            Lanza una conciliación puntual entre sistemas para el período seleccionado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="space-y-1.5">
            <Label>Tipo de conciliación</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_CONCILIACION.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Período (YYYY-MM)</Label>
            <Input
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              placeholder="2026-02"
              pattern="\d{4}-\d{2}"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={running}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={running || !periodo} className="gap-1.5">
            <Play className="h-4 w-4" />
            {running ? 'Ejecutando...' : 'Ejecutar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const Monitoreo = () => {
  const [dashboard, setDashboard] = useState<DashboardDto | null>(null);
  const [dashLoading, setDashLoading] = useState(true);

  const [logs, setLogs] = useState<LogProcesoDto[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [selectedLog, setSelectedLog] = useState<LogProcesoDto | null>(null);

  const [conciliaciones, setConciliaciones] = useState<ConciliacionDto[]>([]);
  const [conciTotal, setConciTotal] = useState(0);
  const [conciLoading, setConciLoading] = useState(false);
  const [filtroConcTipo, setFiltroConcTipo] = useState('todos');
  const [selectedConci, setSelectedConci] = useState<ConciliacionDto | null>(null);
  const [showEjecutar, setShowEjecutar] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setDashboard(await getDashboard());
    } catch (err) { console.error(err); } finally { setDashLoading(false); }
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await getLogs({
        tipo: filtroTipo !== 'todos' ? filtroTipo : undefined,
        estado: filtroEstado !== 'todos' ? filtroEstado : undefined,
        limit: 50,
      });
      setLogs(res.data);
      setLogsTotal(res.total);
    } catch (err) { console.error(err); } finally { setLogsLoading(false); }
  }, [filtroTipo, filtroEstado, refreshKey]);

  const loadConciliaciones = useCallback(async () => {
    setConciLoading(true);
    try {
      const res = await getConciliaciones({
        tipo: filtroConcTipo !== 'todos' ? filtroConcTipo : undefined,
        limit: 30,
      });
      setConciliaciones(res.data);
      setConciTotal(res.total);
    } catch (err) { console.error(err); } finally { setConciLoading(false); }
  }, [filtroConcTipo, refreshKey]);

  useEffect(() => {
    loadDashboard();
    intervalRef.current = setInterval(loadDashboard, 60000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadDashboard]);

  useEffect(() => { loadLogs(); }, [loadLogs]);
  useEffect(() => { loadConciliaciones(); }, [loadConciliaciones]);

  async function handleMarcarEstado(id: string, estado: string) {
    try {
      await marcarEstadoConciliacion(id, estado);
      setRefreshKey((k) => k + 1);
      setSelectedConci(null);
    } catch (err) { console.error(err); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header">
          <h1 className="page-title">Monitoreo del Sistema</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => { setRefreshKey((k) => k + 1); loadDashboard(); }}
        >
          <RefreshCw className="h-4 w-4" /> Actualizar
        </Button>
      </div>

      {/* Dashboard cards */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Salud del sistema (últimas 24h)</h2>
          {dashboard && (
            <span className="text-xs text-muted-foreground">
              Actualizado: {formatDate(dashboard.generadoEn)}
            </span>
          )}
        </div>

        {dashLoading ? (
          <div className="text-sm text-muted-foreground">Cargando dashboard...</div>
        ) : dashboard ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {dashboard.procesos.map((p) => (
              <ProcesoCard key={p.tipo} proceso={p} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No se pudo cargar el dashboard.</div>
        )}
      </div>

      {/* Logs + Conciliaciones tabs */}
      <Tabs defaultValue="logs">
        <TabsList>
          <TabsTrigger value="logs">Log de procesos</TabsTrigger>
          <TabsTrigger value="conciliaciones">Conciliaciones</TabsTrigger>
        </TabsList>

        {/* ── Logs Tab ── */}
        <TabsContent value="logs" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-2 items-center">
            <SearchableSelect
              value={filtroTipo}
              onValueChange={setFiltroTipo}
              options={[{ value: 'todos', label: 'Todos los tipos' }, ...Object.entries(TIPO_LABELS).map(([k, v]) => ({ value: k, label: v }))]}
              placeholder="Tipo"
              searchPlaceholder="Buscar tipo…"
              className="h-8 text-sm w-44"
            />
            <Select value={filtroEstado} onValueChange={setFiltroEstado}>
              <SelectTrigger className="h-8 text-sm w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                {['Completado', 'Error', 'Advertencia', 'Iniciado', 'Procesando'].map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(filtroTipo !== 'todos' || filtroEstado !== 'todos') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => { setFiltroTipo('todos'); setFiltroEstado('todos'); }}
              >
                Limpiar
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={cn('space-y-2', selectedLog ? 'lg:col-span-2' : 'lg:col-span-3')}>
              {logsLoading ? (
                <div className="text-sm text-muted-foreground py-4">Cargando logs...</div>
              ) : logs.length === 0 ? (
                <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                  Sin registros con los filtros seleccionados.
                </div>
              ) : (
                <>
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Tipo</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Inicio</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground hidden md:table-cell">Duración</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground hidden md:table-cell">Registros</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Estado</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {logs.map((l) => (
                          <tr
                            key={l.id}
                            className={cn(
                              'cursor-pointer hover:bg-accent/40 transition-colors',
                              selectedLog?.id === l.id ? 'bg-accent/60' : '',
                            )}
                            onClick={() => setSelectedLog(selectedLog?.id === l.id ? null : l)}
                          >
                            <td className="px-3 py-2">
                              <div className="text-xs font-medium">{TIPO_LABELS[l.tipo] ?? l.tipo}</div>
                              {l.subTipo && <div className="text-[10px] text-muted-foreground">{l.subTipo}</div>}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">
                              {formatDate(l.inicio)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-muted-foreground hidden md:table-cell">
                              {formatDuration(l.duracionMs)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-muted-foreground hidden md:table-cell">
                              {l.registros}
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                'px-2 py-0.5 rounded text-xs font-medium',
                                ESTADO_LOG_CONFIG[l.estado]?.cls ?? 'bg-gray-100 text-gray-700',
                              )}>
                                {l.estado}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <ChevronRight className={cn(
                                'h-4 w-4 text-muted-foreground transition-transform',
                                selectedLog?.id === l.id ? 'rotate-90' : '',
                              )} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {logs.length} de {logsTotal} registro{logsTotal !== 1 ? 's' : ''}
                  </p>
                </>
              )}
            </div>

            {selectedLog && (
              <LogDetail log={selectedLog} onClose={() => setSelectedLog(null)} />
            )}
          </div>
        </TabsContent>

        {/* ── Conciliaciones Tab ── */}
        <TabsContent value="conciliaciones" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={filtroConcTipo} onValueChange={setFiltroConcTipo}>
                <SelectTrigger className="h-8 text-sm w-56"><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los tipos</SelectItem>
                  {TIPOS_CONCILIACION.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filtroConcTipo !== 'todos' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground"
                  onClick={() => setFiltroConcTipo('todos')}
                >
                  Limpiar
                </Button>
              )}
            </div>
            <Button size="sm" onClick={() => setShowEjecutar(true)} className="gap-1.5">
              <Play className="h-4 w-4" /> Ejecutar conciliación
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={cn('space-y-2', selectedConci ? 'lg:col-span-2' : 'lg:col-span-3')}>
              {conciLoading ? (
                <div className="text-sm text-muted-foreground py-4">Cargando conciliaciones...</div>
              ) : conciliaciones.length === 0 ? (
                <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                  No hay reportes de conciliación. Ejecuta una para comenzar.
                </div>
              ) : (
                <>
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Tipo</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Período</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground hidden md:table-cell">Diferencias</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground hidden md:table-cell">Brecha</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Estado</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {conciliaciones.map((c) => (
                          <tr
                            key={c.id}
                            className={cn(
                              'cursor-pointer hover:bg-accent/40 transition-colors',
                              selectedConci?.id === c.id ? 'bg-accent/60' : '',
                            )}
                            onClick={() => setSelectedConci(selectedConci?.id === c.id ? null : c)}
                          >
                            <td className="px-3 py-2">
                              <div className="text-xs font-medium">
                                {TIPOS_CONCILIACION.find(t => t.value === c.tipo)?.label ?? c.tipo}
                              </div>
                              <div className="text-[10px] text-muted-foreground">{formatDate(c.ejecutadoEn)}</div>
                            </td>
                            <td className="px-3 py-2 text-xs font-mono text-muted-foreground hidden sm:table-cell">
                              {c.periodo}
                            </td>
                            <td className="px-3 py-2 text-right hidden md:table-cell">
                              <span className={cn(
                                'text-xs font-medium',
                                c.diferencias > 0 ? 'text-red-600' : 'text-green-600',
                              )}>
                                {c.diferencias}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-xs hidden md:table-cell">
                              {c.montoDiferencia !== undefined
                                ? <span className={Number(c.montoDiferencia) !== 0 ? 'text-red-600' : 'text-green-600'}>
                                    {formatCurrency(Number(c.montoDiferencia))}
                                  </span>
                                : '—'}
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                'px-2 py-0.5 rounded text-xs font-medium',
                                ESTADO_CONCILIACION_CONFIG[c.estado] ?? 'bg-gray-100 text-gray-700',
                              )}>
                                {c.estado}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <ChevronRight className={cn(
                                'h-4 w-4 text-muted-foreground transition-transform',
                                selectedConci?.id === c.id ? 'rotate-90' : '',
                              )} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {conciliaciones.length} de {conciTotal} reporte{conciTotal !== 1 ? 's' : ''}
                  </p>
                </>
              )}
            </div>

            {/* Conciliacion detail */}
            {selectedConci && (
              <div className="rounded-lg border bg-card p-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm">
                    {TIPOS_CONCILIACION.find(t => t.value === selectedConci.tipo)?.label ?? selectedConci.tipo}
                  </div>
                  <button onClick={() => setSelectedConci(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: 'Período', value: selectedConci.periodo },
                    { label: 'Ejecutado', value: formatDate(selectedConci.ejecutadoEn) },
                    { label: 'Sistema A', value: String(selectedConci.totalSistemaA) },
                    { label: 'Sistema B', value: String(selectedConci.totalSistemaB) },
                    { label: 'Coincidencias', value: String(selectedConci.coincidencias) },
                    { label: 'Diferencias', value: String(selectedConci.diferencias) },
                  ].map((item) => (
                    <div key={item.label} className="rounded border p-2">
                      <div className="text-muted-foreground">{item.label}</div>
                      <div className="font-medium mt-0.5">{item.value}</div>
                    </div>
                  ))}
                </div>

                {(selectedConci.montoSistemaA !== undefined || selectedConci.montoSistemaB !== undefined) && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border p-2">
                      <div className="text-muted-foreground">Monto A</div>
                      <div className="font-medium">{formatCurrency(Number(selectedConci.montoSistemaA))}</div>
                    </div>
                    <div className="rounded border p-2">
                      <div className="text-muted-foreground">Monto B</div>
                      <div className="font-medium">{formatCurrency(Number(selectedConci.montoSistemaB))}</div>
                    </div>
                    <div className="rounded border p-2 col-span-2">
                      <div className="text-muted-foreground">Brecha</div>
                      <div className={cn(
                        'font-bold',
                        Number(selectedConci.montoDiferencia) !== 0 ? 'text-red-600' : 'text-green-600',
                      )}>
                        {formatCurrency(Number(selectedConci.montoDiferencia))}
                      </div>
                    </div>
                  </div>
                )}

                {selectedConci.detalles && Object.keys(selectedConci.detalles).length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Detalle de diferencias
                    </div>
                    <pre className="text-xs bg-muted rounded border p-2 overflow-x-auto max-h-36">
                      {JSON.stringify(selectedConci.detalles, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedConci.estado === 'Revisión' && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleMarcarEstado(selectedConci.id, 'Aceptado')}
                      className="text-green-700 border-green-300 hover:bg-green-50"
                    >
                      Marcar Aceptado
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleMarcarEstado(selectedConci.id, 'Corregido')}
                    >
                      Marcar Corregido
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <EjecutarConciliacionDialog
        open={showEjecutar}
        onOpenChange={setShowEjecutar}
        onExecuted={() => { setShowEjecutar(false); setRefreshKey((k) => k + 1); }}
      />
    </div>
  );
};

export default Monitoreo;
