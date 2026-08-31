import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, X, Eye, Printer, CreditCard, Plus, RefreshCw, CheckCircle2, Clock, Download, Bell,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { buscarContratos, type ContratoSearch } from '@/api/atencion';
import {
  getRecibos, getReciboPreview, marcarImpreso, getMensajesRecibo, createMensajeRecibo,
  type ReciboDto, type ReciboPreviewDto, type MensajeReciboDto,
} from '@/api/recibos';
import { getCajaActiva, abrirCaja, cerrarCaja, type SesionCajaDto } from '@/api/caja';
import { abrirReciboImprimible, notificarRecibo } from '@/api/notificaciones';
import { useToast } from '@/components/ui/use-toast';
import { apiRequest } from '@/api/client';

const TIPOS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia', 'SPEI', 'OXXO'] as const;

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
  selected,
  onSelect,
}: {
  selected: ContratoSearch | null;
  onSelect: (c: ContratoSearch | null) => void;
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

  return (
    <div ref={containerRef} className="relative w-full max-w-lg">
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Buscar contrato, nombre, dirección..."
            className="pl-9 pr-8"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]); setOpen(false); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {selected && (
          <Button variant="ghost" size="sm" onClick={() => onSelect(null)} className="shrink-0 text-muted-foreground gap-1">
            <X className="h-4 w-4" /> Limpiar
          </Button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden">
          <ul className="py-1 max-h-64 overflow-y-auto">
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
          <div className="border-t px-3 py-1.5 text-xs text-muted-foreground bg-muted/40">
            {results.length} resultado{results.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
      {loading && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md px-4 py-3 text-sm text-muted-foreground">
          Buscando...
        </div>
      )}
    </div>
  );
}

// ─── Preview Dialog ───────────────────────────────────────────────────────────

function PreviewDialog({
  reciboId, open, onOpenChange, onPaid, onPrinted,
}: {
  reciboId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaid: () => void;
  onPrinted: () => void;
}) {
  const [preview, setPreview] = useState<ReciboPreviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const [payForm, setPayForm] = useState({ monto: '', tipo: 'Efectivo', concepto: '' });
  const [paying, setPaying] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [notificando, setNotificando] = useState(false);
  const { toast } = useToast();

  async function handleDescargar() {
    if (!preview) return;
    setDescargando(true);
    try {
      await abrirReciboImprimible(preview.recibo.id);
    } catch (err) {
      toast({ title: 'Error al generar recibo', description: (err as Error).message, variant: 'destructive' });
    } finally { setDescargando(false); }
  }

  async function handleNotificar() {
    if (!preview) return;
    setNotificando(true);
    try {
      const res = await notificarRecibo(preview.recibo.id);
      toast({
        title: 'Notificación enviada',
        description: `Email: ${res.email ? 'sí' : 'no'} · WhatsApp: ${res.whatsapp ? 'sí' : 'no'}`,
      });
    } catch (err) {
      toast({ title: 'Error al notificar', description: (err as Error).message, variant: 'destructive' });
    } finally { setNotificando(false); }
  }

  useEffect(() => {
    if (!reciboId || !open) return;
    setLoading(true);
    setPreview(null);
    setShowPayForm(false);
    getReciboPreview(reciboId)
      .then(setPreview)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [reciboId, open]);

  async function handlePay() {
    if (!preview) return;
    setPaying(true);
    try {
      await apiRequest('/pagos', {
        method: 'POST',
        body: JSON.stringify({
          contratoId: preview.recibo.contratoId,
          reciboId: preview.recibo.id,
          timbradoId: preview.recibo.timbradoId,
          monto: Number(payForm.monto),
          tipo: payForm.tipo,
          concepto: payForm.concepto || 'Pago en caja',
        }),
      });
      setShowPayForm(false);
      setPayForm({ monto: '', tipo: 'Efectivo', concepto: '' });
      onPaid();
      onOpenChange(false);
    } catch (err) { console.error(err); } finally { setPaying(false); }
  }

  async function handlePrint() {
    if (!preview) return;
    setPrinting(true);
    try {
      await marcarImpreso(preview.recibo.id);
      onPrinted();
      onOpenChange(false);
    } catch (err) { console.error(err); } finally { setPrinting(false); }
  }

  const r = preview?.recibo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Vista previa del recibo</DialogTitle>
          <DialogDescription>
            {r ? `${r.contrato.nombre} · ${r.timbrado?.periodo ?? ''}` : 'Cargando...'}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-8 text-center text-sm text-muted-foreground">Cargando recibo...</div>
        )}

        {r && (
          <div className="space-y-4 text-sm max-h-[60vh] overflow-y-auto pr-1">
            {/* Contrato */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-xs">
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">Contrato</span>
                <span className="font-medium">{r.contratoId} – {r.contrato.nombre}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">Dirección</span>
                <span>{r.contrato.direccion}</span>
              </div>
              {r.contrato.rfc && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">RFC</span>
                  <span>{r.contrato.rfc}</span>
                </div>
              )}
              {r.timbrado && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">UUID</span>
                  <code className="font-mono bg-muted px-1 rounded break-all">{r.timbrado.uuid}</code>
                </div>
              )}
            </div>

            {/* Saldos */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Saldo vigente', value: Number(r.saldoVigente), cls: '' },
                { label: 'Saldo vencido', value: Number(r.saldoVencido), cls: Number(r.saldoVencido) > 0 ? 'text-destructive' : '' },
                { label: 'Pendiente', value: preview.pendiente, cls: preview.pendiente > 0 ? 'text-amber-600' : 'text-green-600' },
              ].map((item) => (
                <div key={item.label} className="rounded border p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
                  <div className={cn('font-bold tabular-nums text-sm', item.cls)}>
                    {formatCurrency(item.value)}
                  </div>
                </div>
              ))}
            </div>

            {/* Timbrado */}
            {r.timbrado && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Periodo</span>
                  <div className="font-medium">{r.timbrado.periodo}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Subtotal</span>
                  <div className="font-medium">{formatCurrency(Number(r.timbrado.subtotal))}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">IVA</span>
                  <div className="font-medium">{formatCurrency(Number(r.timbrado.iva))}</div>
                </div>
              </div>
            )}

            {/* Pagos */}
            {r.pagos.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Pagos registrados
                </div>
                <div className="space-y-1">
                  {r.pagos.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground">{formatDate(p.fecha)} · {p.tipo}</span>
                      <span className="font-medium text-green-600">{formatCurrency(Number(p.monto))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mensajes */}
            {preview.mensajes.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Mensajes en recibo
                </div>
                {preview.mensajes.map((m) => (
                  <div key={m.id} className="rounded border bg-blue-50 px-3 py-1.5 text-xs text-blue-800 mb-1">
                    <span className="font-medium mr-1">[{m.tipo}]</span>{m.mensaje}
                  </div>
                ))}
              </div>
            )}

            {/* Pago form */}
            {showPayForm && (
              <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                <div className="text-sm font-medium">Registrar pago</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Monto</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={payForm.monto}
                      onChange={(e) => setPayForm((f) => ({ ...f, monto: e.target.value }))}
                      placeholder={formatCurrency(preview.pendiente)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo de pago</Label>
                    <Select value={payForm.tipo} onValueChange={(v) => setPayForm((f) => ({ ...f, tipo: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIPOS_PAGO.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Concepto (opcional)</Label>
                  <Input
                    value={payForm.concepto}
                    onChange={(e) => setPayForm((f) => ({ ...f, concepto: e.target.value }))}
                    placeholder="Pago en caja"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {!showPayForm ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
              {r && (
                <>
                  <Button variant="outline" onClick={handleDescargar} disabled={descargando} className="gap-1.5">
                    <Download className="h-4 w-4" />
                    {descargando ? 'Generando...' : 'Descargar / Imprimir'}
                  </Button>
                  <Button variant="outline" onClick={handleNotificar} disabled={notificando} className="gap-1.5">
                    <Bell className="h-4 w-4" />
                    {notificando ? 'Enviando...' : 'Notificar'}
                  </Button>
                </>
              )}
              {r && !r.impreso && (
                <>
                  <Button variant="outline" onClick={() => setShowPayForm(true)} className="gap-1.5">
                    <CreditCard className="h-4 w-4" /> Registrar pago
                  </Button>
                  <Button onClick={handlePrint} disabled={printing} className="gap-1.5">
                    <Printer className="h-4 w-4" />
                    {printing ? 'Procesando...' : 'Marcar impreso'}
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setShowPayForm(false)} disabled={paying}>
                Cancelar
              </Button>
              <Button onClick={handlePay} disabled={paying || !payForm.monto}>
                {paying ? 'Guardando...' : 'Confirmar pago'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Caja Section ─────────────────────────────────────────────────────────────

function CajaSection() {
  const [sesion, setSesion] = useState<SesionCajaDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [montoInicial, setMontoInicial] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSesion(await getCajaActiva()); } catch { setSesion(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAbrir() {
    setSaving(true);
    try {
      setSesion(await abrirCaja(Number(montoInicial) || 0));
      setMontoInicial('');
    } catch (err) { console.error(err); } finally { setSaving(false); }
  }

  async function handleCerrar() {
    if (!sesion) return;
    setSaving(true);
    try { setSesion(await cerrarCaja(sesion.id)); } catch (err) { console.error(err); } finally { setSaving(false); }
  }

  if (loading) return <div className="text-sm text-muted-foreground py-2">Cargando caja...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Estado de Caja</h3>
        <span className={cn(
          'px-2 py-0.5 rounded-full text-xs font-medium',
          sesion ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600',
        )}>
          {sesion ? 'Abierta' : 'Cerrada'}
        </span>
      </div>

      {sesion ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Total cobrado', value: sesion.totalCobrado },
              { label: 'Efectivo', value: sesion.totalEfectivo },
              { label: 'Transferencia', value: sesion.totalTransf },
              { label: 'Tarjeta', value: sesion.totalTarjeta },
            ].map((item) => (
              <div key={item.label} className="rounded border bg-card p-2.5">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="font-bold tabular-nums text-sm mt-0.5">{formatCurrency(Number(item.value))}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Apertura: {formatDate(sesion.apertura)}</p>
          <Button variant="destructive" size="sm" onClick={handleCerrar} disabled={saving}>
            {saving ? 'Cerrando...' : 'Cerrar caja'}
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label className="text-sm">Monto inicial</Label>
            <Input
              type="number"
              min="0"
              value={montoInicial}
              onChange={(e) => setMontoInicial(e.target.value)}
              placeholder="0.00"
              className="w-36"
            />
          </div>
          <Button onClick={handleAbrir} disabled={saving} size="sm">
            {saving ? 'Abriendo...' : 'Abrir caja'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Mensajes Section ─────────────────────────────────────────────────────────

function MensajesSection() {
  const [mensajes, setMensajes] = useState<MensajeReciboDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tipo: 'Global', mensaje: '', contratoId: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setMensajes(await getMensajesRecibo()); } catch { setMensajes([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    setSaving(true);
    try {
      await createMensajeRecibo({
        tipo: form.tipo,
        mensaje: form.mensaje,
        ...(form.tipo === 'Individual' && form.contratoId ? { contratoId: form.contratoId } : {}),
      });
      setForm({ tipo: 'Global', mensaje: '', contratoId: '' });
      setShowForm(false);
      load();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  }

  if (loading) return <div className="text-sm text-muted-foreground py-2">Cargando mensajes...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Mensajes en Recibos</h3>
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nuevo
        </Button>
      </div>

      {showForm && (
        <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Global">Global (todos)</SelectItem>
                  <SelectItem value="Individual">Individual (contrato)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.tipo === 'Individual' && (
              <div className="space-y-1">
                <Label className="text-xs">ID de contrato</Label>
                <Input
                  value={form.contratoId}
                  onChange={(e) => setForm((f) => ({ ...f, contratoId: e.target.value }))}
                  placeholder="CONTRATO-001"
                  className="h-8 text-sm"
                />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mensaje</Label>
            <Textarea
              value={form.mensaje}
              onChange={(e) => setForm((f) => ({ ...f, mensaje: e.target.value }))}
              placeholder="Mensaje para el recibo..."
              rows={2}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={saving || !form.mensaje.trim()}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {mensajes.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          No hay mensajes configurados.
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {mensajes.map((m) => (
            <div key={m.id} className="flex items-start gap-2.5 rounded border p-2.5">
              <span className={cn(
                'px-1.5 py-0.5 rounded text-xs font-medium shrink-0',
                m.tipo === 'Global' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800',
              )}>
                {m.tipo}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{m.mensaje}</p>
                {m.contratoId && (
                  <p className="text-xs text-muted-foreground mt-0.5">Contrato: {m.contratoId}</p>
                )}
              </div>
              <span className={cn('text-xs font-medium shrink-0', m.activo ? 'text-green-600' : 'text-muted-foreground')}>
                {m.activo ? 'Activo' : 'Inactivo'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const Recibos = () => {
  const [contrato, setContrato] = useState<ContratoSearch | null>(null);
  const [recibos, setRecibos] = useState<ReciboDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtroImpreso, setFiltroImpreso] = useState<'todos' | 'pendientes' | 'impresos'>('todos');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!contrato) { setRecibos([]); return; }
    setLoading(true);
    getRecibos({ contratoId: contrato.id, limit: 50 })
      .then((res) => setRecibos(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [contrato, refreshKey]);

  const recibosVisibles = recibos.filter((r) => {
    if (filtroImpreso === 'pendientes') return !r.impreso;
    if (filtroImpreso === 'impresos') return r.impreso;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Recibos e Impresión</h1>
      </div>

      {/* Búsqueda de contrato */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Buscar contrato</h3>
        <div className="flex flex-wrap items-center gap-3">
          <ContractSearch selected={contrato} onSelect={setContrato} />
          {contrato && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{contrato.nombre}</span>
              <span className={cn(
                'px-2 py-0.5 rounded-full text-xs font-medium',
                contrato.estado === 'Activo' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600',
              )}>
                {contrato.estado}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tabla de recibos */}
      {contrato && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              Recibos
              {recibos.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({recibos.length})
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2">
              <Select value={filtroImpreso} onValueChange={(v) => setFiltroImpreso(v as typeof filtroImpreso)}>
                <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendientes">Pendientes</SelectItem>
                  <SelectItem value="impresos">Impresos</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground py-4">Cargando recibos...</div>
          ) : recibosVisibles.length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
              {recibos.length === 0
                ? 'No hay recibos para este contrato.'
                : 'Sin recibos con el filtro seleccionado.'}
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Periodo</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Saldo vigente</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Saldo vencido</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Vencimiento</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Estado</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recibosVisibles.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/40 transition-colors">
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                        {r.timbrado?.periodo ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatCurrency(Number(r.saldoVigente))}
                      </td>
                      <td className={cn(
                        'px-3 py-2 text-right font-medium tabular-nums',
                        Number(r.saldoVencido) > 0 ? 'text-destructive' : '',
                      )}>
                        {formatCurrency(Number(r.saldoVencido))}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.fechaVencimiento}</td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                          r.impreso ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800',
                        )}>
                          {r.impreso
                            ? <><CheckCircle2 className="h-3 w-3" />Impreso</>
                            : <><Clock className="h-3 w-3" />Pendiente</>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPreviewId(r.id)}
                          className="gap-1.5"
                        >
                          <Eye className="h-3.5 w-3.5" /> Vista previa
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Caja + Mensajes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border bg-card p-4">
          <CajaSection />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <MensajesSection />
        </div>
      </div>

      <PreviewDialog
        reciboId={previewId}
        open={!!previewId}
        onOpenChange={(open) => { if (!open) setPreviewId(null); }}
        onPaid={() => setRefreshKey((k) => k + 1)}
        onPrinted={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
};

export default Recibos;
