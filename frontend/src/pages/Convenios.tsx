import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckSquare, ChevronRight, CreditCard, Plus, RefreshCw, Search, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { buscarContratos, type ContratoSearch } from '@/api/atencion';
import {
  getConvenios, createConvenio, aplicarParcialidad, cancelarConvenio,
  updateChecklistConvenio,
  type ConvenioDto, type ConvenioChecklist,
} from '@/api/convenios';

const TIPOS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia', 'SPEI', 'OXXO'] as const;
const ESTADOS_CONVENIO = ['Activo', 'Completado', 'Cancelado', 'Vencido'] as const;
const TIPOS_CONVENIO = ['Parcialidades', 'SaldoAFavor', 'GraciaTotal'] as const;

const ESTADO_CONFIG: Record<string, string> = {
  Activo: 'bg-blue-100 text-blue-800',
  Completado: 'bg-green-100 text-green-800',
  Cancelado: 'bg-red-100 text-red-800',
  Vencido: 'bg-orange-100 text-orange-800',
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

function formatDate(s?: string) {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Inline contract search ───────────────────────────────────────────────────

function ContractSearch({
  value,
  onSelect,
  placeholder = 'Buscar contrato...',
}: {
  value: ContratoSearch | null;
  onSelect: (c: ContratoSearch | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContratoSearch[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await buscarContratos(q);
        setResults(data);
        setOpen(true);
      } catch { setResults([]); } finally { setLoading(false); }
    }, 300);
  }, []);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-muted/30">
        <span className="font-mono text-xs text-muted-foreground">{value.id}</span>
        <span className="text-sm font-medium truncate">{value.nombre}</span>
        <button onClick={() => onSelect(null)} className="ml-auto text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="pl-9"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden">
          <ul className="py-1 max-h-56 overflow-y-auto">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                  onClick={() => { onSelect(c); setQuery(''); setOpen(false); setResults([]); }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                    <span className="font-medium truncate">{c.nombre}</span>
                    <span className="ml-auto text-xs text-muted-foreground shrink-0">{c.estado}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{c.direccion}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Nuevo Convenio Dialog ────────────────────────────────────────────────────

function NuevoConvenioDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [contrato, setContrato] = useState<ContratoSearch | null>(null);
  const [tipo, setTipo] = useState<string>('Parcialidades');
  const [numParcialidades, setNumParcialidades] = useState('3');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [porcentajeAnticipo, setPorcentajeAnticipo] = useState('');
  // facturas: array of { timbradoId, monto }
  const [facturas, setFacturas] = useState([{ timbradoId: '', monto: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setContrato(null);
    setTipo('Parcialidades');
    setNumParcialidades('3');
    setFechaVencimiento('');
    setPorcentajeAnticipo('');
    setFacturas([{ timbradoId: '', monto: '' }]);
    setError('');
  }

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  const montoTotal = facturas.reduce((s, f) => s + (Number(f.monto) || 0), 0);
  const pctAnticipo = Number(porcentajeAnticipo) || 0;
  const montoAnticipo = pctAnticipo > 0 ? Math.round(montoTotal * pctAnticipo / 100 * 100) / 100 : 0;
  const montoRestante = montoTotal - montoAnticipo;
  const montoParcialidad = numParcialidades && Number(numParcialidades) > 0
    ? Math.ceil(montoRestante / Number(numParcialidades) * 100) / 100
    : 0;

  async function handleSubmit() {
    if (!contrato) { setError('Selecciona un contrato.'); return; }
    if (facturas.some(f => !f.timbradoId.trim() || !f.monto)) {
      setError('Completa todas las facturas.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createConvenio({
        contratoId: contrato.id,
        tipo,
        numParcialidades: Number(numParcialidades),
        facturas: facturas.map(f => ({ timbradoId: f.timbradoId.trim(), monto: Number(f.monto) })),
        fechaVencimiento: fechaVencimiento || undefined,
        porcentajeAnticipo: pctAnticipo > 0 ? pctAnticipo : undefined,
      });
      handleClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear convenio.');
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Nuevo Convenio de Pago</DialogTitle>
          <DialogDescription>
            Configura el convenio y el plan de parcialidades para el cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Contrato <span className="text-red-500">*</span></Label>
            <ContractSearch value={contrato} onSelect={setContrato} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo de convenio</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_CONVENIO.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Número de parcialidades</Label>
              <Input
                type="number"
                min="1"
                max="24"
                value={numParcialidades}
                onChange={(e) => setNumParcialidades(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fecha de vencimiento (opcional)</Label>
              <Input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Anticipo % (opcional)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="5"
                value={porcentajeAnticipo}
                onChange={(e) => setPorcentajeAnticipo(e.target.value)}
                placeholder="0"
              />
              {montoAnticipo > 0 && (
                <p className="text-xs text-muted-foreground">
                  Anticipo: {formatCurrency(montoAnticipo)}
                </p>
              )}
            </div>
          </div>

          {/* Facturas */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Facturas incluidas <span className="text-red-500">*</span></Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFacturas((prev) => [...prev, { timbradoId: '', monto: '' }])}
                className="h-7 text-xs gap-1"
              >
                <Plus className="h-3 w-3" /> Agregar
              </Button>
            </div>
            {facturas.map((f, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  value={f.timbradoId}
                  onChange={(e) => setFacturas((prev) => prev.map((x, j) => j === i ? { ...x, timbradoId: e.target.value } : x))}
                  placeholder="ID de timbrado"
                  className="flex-1 text-sm"
                />
                <Input
                  type="number"
                  min="0.01"
                  value={f.monto}
                  onChange={(e) => setFacturas((prev) => prev.map((x, j) => j === i ? { ...x, monto: e.target.value } : x))}
                  placeholder="Monto"
                  className="w-28 text-sm"
                />
                {facturas.length > 1 && (
                  <button
                    onClick={() => setFacturas((prev) => prev.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Preview */}
          {montoTotal > 0 && (
            <div className="rounded-lg bg-muted/40 border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Monto total</span>
                <span className="font-medium">{formatCurrency(montoTotal)}</span>
              </div>
              {montoAnticipo > 0 && (
                <>
                  <div className="flex justify-between text-amber-700">
                    <span>Anticipo ({pctAnticipo}%)</span>
                    <span className="font-medium">{formatCurrency(montoAnticipo)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monto a financiar</span>
                    <span className="font-medium">{formatCurrency(montoRestante)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between border-t pt-1">
                <span className="text-muted-foreground">Monto por parcialidad</span>
                <span className="font-bold">{formatCurrency(montoParcialidad)}</span>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creando...' : 'Crear convenio'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Aplicar Parcialidad Dialog ───────────────────────────────────────────────

function AplicarParcialidadDialog({
  convenio,
  open,
  onOpenChange,
  onApplied,
}: {
  convenio: ConvenioDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}) {
  const [monto, setMonto] = useState('');
  const [tipo, setTipo] = useState('Efectivo');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleClose() {
    setMonto('');
    setTipo('Efectivo');
    setError('');
    onOpenChange(false);
  }

  async function handleSubmit() {
    if (!convenio || !monto) return;
    setSaving(true);
    setError('');
    try {
      await aplicarParcialidad(convenio.id, Number(monto), tipo);
      handleClose();
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al aplicar parcialidad.');
    } finally { setSaving(false); }
  }

  if (!convenio) return null;

  const montoParcialidad = Number(convenio.montoParcialidad);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Aplicar parcialidad</DialogTitle>
          <DialogDescription>
            {convenio.contrato?.nombre ?? convenio.contratoId} ·
            {' '}{convenio.parcialidadesRestantes} parcialidad{convenio.parcialidadesRestantes !== 1 ? 'es' : ''} restante{convenio.parcialidadesRestantes !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="space-y-1.5">
            <Label>Monto de la parcialidad</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder={formatCurrency(montoParcialidad)}
            />
            <p className="text-xs text-muted-foreground">
              Monto convenido: {formatCurrency(montoParcialidad)}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de pago</Label>
            <SearchableSelect
              value={tipo}
              onValueChange={setTipo}
              searchPlaceholder="Buscar tipo de pago…"
              options={TIPOS_PAGO.map((t) => ({ value: t, label: t }))}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving || !monto}>
            {saving ? 'Aplicando...' : 'Aplicar pago'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Convenio Detail Panel ────────────────────────────────────────────────────

// ─── Checklist documental ────────────────────────────────────────────────────

const DOCUMENTOS_CONVENIO_DEFAULT = [
  'Identificación oficial',
  'Comprobante de domicilio',
  'Solicitud de convenio firmada',
  'Constancia fiscal (si aplica)',
  'Carta poder (si aplica)',
];

function ChecklistPanel({
  convenio,
  onUpdated,
}: {
  convenio: ConvenioDto;
  onUpdated: () => void;
}) {
  const docs = DOCUMENTOS_CONVENIO_DEFAULT;
  const checklist: ConvenioChecklist = (convenio.checklistInterna as ConvenioChecklist | null) ?? {};
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<ConvenioChecklist>({ ...checklist });

  async function toggle(doc: string) {
    const next = { ...local, [doc]: !local[doc] };
    setLocal(next);
    setSaving(true);
    try {
      await updateChecklistConvenio(convenio.id, next);
      onUpdated();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  }

  const completed = docs.filter((d) => local[d]).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Checklist documental
        </div>
        <span className={cn(
          'text-xs px-1.5 py-0.5 rounded-full font-medium',
          completed === docs.length ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
        )}>
          {completed}/{docs.length}
        </span>
      </div>
      <ul className="space-y-1">
        {docs.map((doc) => (
          <li key={doc}>
            <button
              className="w-full flex items-center gap-2 text-xs py-1 text-left hover:text-foreground transition-colors disabled:opacity-50"
              onClick={() => toggle(doc)}
              disabled={saving}
            >
              {local[doc]
                ? <CheckSquare className="h-3.5 w-3.5 text-green-600 shrink-0" />
                : <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              }
              <span className={local[doc] ? 'line-through text-muted-foreground' : ''}>{doc}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Convenio Detail Panel ────────────────────────────────────────────────────

function ConvenioDetail({
  convenio,
  onClose,
  onAction,
}: {
  convenio: ConvenioDto;
  onClose: () => void;
  onAction: () => void;
}) {
  const [showParcialidad, setShowParcialidad] = useState(false);
  const [canceling, setCanceling] = useState(false);

  async function handleCancel() {
    setCanceling(true);
    try {
      await cancelarConvenio(convenio.id);
      onAction();
    } catch (err) { console.error(err); } finally { setCanceling(false); }
  }

  const pagado = Number(convenio.montoPagado);
  const total = Number(convenio.montoTotal);
  const progreso = total > 0 ? Math.min(100, (pagado / total) * 100) : 0;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {convenio.contrato?.nombre ?? convenio.contratoId}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {convenio.tipo} · {convenio.numParcialidades} parcialidades
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'px-2 py-0.5 rounded-full text-xs font-medium',
            ESTADO_CONFIG[convenio.estado] ?? 'bg-gray-100 text-gray-800',
          )}>
            {convenio.estado}
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Progreso */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Pagado: {formatCurrency(pagado)}</span>
          <span>Total: {formatCurrency(total)}</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${progreso}%` }}
          />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{progreso.toFixed(0)}% completado</span>
          {convenio.parcialidadesRestantes > 0 && (
            <span className="text-muted-foreground">
              {convenio.parcialidadesRestantes} restante{convenio.parcialidadesRestantes !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Datos */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          { label: 'Monto parcialidad', value: formatCurrency(Number(convenio.montoParcialidad)) },
          { label: 'Saldo a favor', value: formatCurrency(Number(convenio.saldoAFavor)) },
          { label: 'Inicio', value: formatDate(convenio.fechaInicio) },
          { label: 'Vencimiento', value: formatDate(convenio.fechaVencimiento) },
          ...(convenio.montoAnticipo
            ? [{ label: 'Anticipo', value: `${formatCurrency(Number(convenio.montoAnticipo))}${convenio.anticipoPagado ? ' ✓' : ' (pendiente)'}` }]
            : []),
        ].map((item) => (
          <div key={item.label} className="rounded border p-2">
            <div className="text-muted-foreground">{item.label}</div>
            <div className="font-medium mt-0.5">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Pagos realizados */}
      {convenio.pagos && convenio.pagos.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Pagos realizados
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {convenio.pagos.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs rounded border px-2.5 py-1.5">
                <span className="text-muted-foreground">{formatDate(p.fecha)} · {p.tipo}</span>
                <span className="font-medium text-green-600">{formatCurrency(Number(p.monto))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checklist documental */}
      <div className="border-t pt-3">
        <ChecklistPanel convenio={convenio} onUpdated={onAction} />
      </div>

      {/* Acciones */}
      {convenio.estado === 'Activo' && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={() => setShowParcialidad(true)} className="gap-1.5">
            <CreditCard className="h-3.5 w-3.5" /> Aplicar parcialidad
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancel}
            disabled={canceling}
            className="text-destructive hover:text-destructive"
          >
            {canceling ? 'Cancelando...' : 'Cancelar convenio'}
          </Button>
        </div>
      )}

      <AplicarParcialidadDialog
        convenio={convenio}
        open={showParcialidad}
        onOpenChange={setShowParcialidad}
        onApplied={() => { setShowParcialidad(false); onAction(); }}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const Convenios = () => {
  const [convenios, setConvenios] = useState<ConvenioDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');
  const [filtroContrato, setFiltroContrato] = useState<ContratoSearch | null>(null);
  const [selected, setSelected] = useState<ConvenioDto | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getConvenios({
        estado: filtroEstado !== 'todos' ? filtroEstado : undefined,
        contratoId: filtroContrato?.id,
        limit: 50,
      });
      setConvenios(res.data);
      setTotal(res.total);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [filtroEstado, filtroContrato, refreshKey]);

  useEffect(() => { load(); }, [load]);

  function handleAction() {
    setSelected(null);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Convenios de Pago</h1>
      </div>

      {/* Filters + actions */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtroEstado} onValueChange={setFiltroEstado}>
            <SelectTrigger className="h-8 text-sm w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {ESTADOS_CONVENIO.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="w-72">
            <ContractSearch
              value={filtroContrato}
              onSelect={setFiltroContrato}
              placeholder="Filtrar por contrato..."
            />
          </div>

          {(filtroEstado !== 'todos' || filtroContrato) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => { setFiltroEstado('todos'); setFiltroContrato(null); }}
            >
              Limpiar filtros
            </Button>
          )}

          <Button variant="ghost" size="sm" className="h-8" onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <Button onClick={() => setShowNew(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nuevo convenio
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List */}
        <div className={cn('space-y-3', selected ? 'lg:col-span-2' : 'lg:col-span-3')}>
          {loading ? (
            <div className="text-sm text-muted-foreground py-4">Cargando convenios...</div>
          ) : convenios.length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
              No hay convenios con los filtros seleccionados.
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Contrato</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Tipo</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Total</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Pagado</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground hidden md:table-cell">Parcialidades</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Estado</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {convenios.map((c) => (
                      <tr
                        key={c.id}
                        className={cn(
                          'cursor-pointer hover:bg-accent/40 transition-colors',
                          selected?.id === c.id ? 'bg-accent/60' : '',
                        )}
                        onClick={() => setSelected(selected?.id === c.id ? null : c)}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-xs">{c.contrato?.nombre ?? c.contratoId}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{c.contratoId}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">{c.tipo}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-xs">
                          {formatCurrency(Number(c.montoTotal))}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-green-600 tabular-nums hidden sm:table-cell">
                          {formatCurrency(Number(c.montoPagado))}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-muted-foreground hidden md:table-cell">
                          {c.parcialidadesRestantes}/{c.numParcialidades}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn(
                            'px-2 py-0.5 rounded text-xs font-medium',
                            ESTADO_CONFIG[c.estado] ?? 'bg-gray-100 text-gray-800',
                          )}>
                            {c.estado}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ChevronRight className={cn(
                            'h-4 w-4 text-muted-foreground transition-transform',
                            selected?.id === c.id ? 'rotate-90' : '',
                          )} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                {convenios.length} de {total} convenio{total !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>

        {/* Detail */}
        {selected && (
          <div>
            <ConvenioDetail
              convenio={selected}
              onClose={() => setSelected(null)}
              onAction={handleAction}
            />
          </div>
        )}
      </div>

      <NuevoConvenioDialog
        open={showNew}
        onOpenChange={setShowNew}
        onCreated={() => { setShowNew(false); setRefreshKey((k) => k + 1); }}
      />
    </div>
  );
};

export default Convenios;
