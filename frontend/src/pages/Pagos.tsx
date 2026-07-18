import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useData } from '@/context/DataContext';
import type { TipoPago } from '@/context/DataContext';
import { fetchPagos, fetchPagosExternos, hasApi } from '@/api/pagos';
import { fetchRecibos } from '@/api/recibos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const TIPOS_PAGO: TipoPago[] = [
  'Efectivo', 'Transferencia', 'Tarjeta',
  'SPEI', 'OXXO', 'CODI', 'CAJERO', 'CHATBOT', 'WEB', 'CAJAS POPULARES', 'Link de pago',
];

const Pagos = () => {
  const useApi = hasApi();
  const {
    pagos: contextPagos,
    addPago,
    contratos,
    recibos: contextRecibos,
    allowedZonaIds,
    pagosExternos: contextPagosExternos,
    conciliarPagoExterno,
  } = useData();
  const { data: apiPagos = [] } = useQuery({ queryKey: ['pagos'], queryFn: fetchPagos, enabled: useApi });
  const { data: apiPagosExternos = [] } = useQuery({ queryKey: ['pagos-externos'], queryFn: fetchPagosExternos, enabled: useApi });
  const { data: apiRecibos = [] } = useQuery({ queryKey: ['recibos'], queryFn: fetchRecibos, enabled: useApi });
  const pagos = useApi ? apiPagos : contextPagos;
  const pagosExternos = useApi ? apiPagosExternos : contextPagosExternos;
  const recibos = useApi ? apiRecibos : contextRecibos;
  const [form, setForm] = useState({ contratoId: '', monto: '', tipo: '' as TipoPago | '', concepto: '' });
  const [conciliarExternoId, setConciliarExternoId] = useState<string | null>(null);
  const [conciliarContratoId, setConciliarContratoId] = useState('');

  const contratosVisibles = useMemo(() =>
    !allowedZonaIds ? contratos : contratos.filter(c => c.zonaId && allowedZonaIds.includes(c.zonaId)),
    [contratos, allowedZonaIds]
  );
  const activos = contratosVisibles.filter(c => c.estado === 'Activo');
  const contratoIdsVisibles = useMemo(() => new Set(contratosVisibles.map(c => c.id)), [contratosVisibles]);
  const pagosVisibles = useMemo(() => useApi ? pagos : pagos.filter(p => contratoIdsVisibles.has(p.contratoId)), [pagos, contratoIdsVisibles, useApi]);
  const pagosNativosAplicados = useMemo(() =>
    pagosVisibles.filter(p => p.origen === 'nativo' || p.tipo === 'Link de pago'),
    [pagosVisibles]
  );
  const externosPorConciliar = useMemo(() =>
    pagosExternos.filter(pe => pe.estado === 'pendiente_conciliar'),
    [pagosExternos]
  );

  const handlePago = () => {
    if (useApi) return;
    addPago({
      contratoId: form.contratoId,
      monto: Number(form.monto),
      fecha: new Date().toISOString().split('T')[0],
      tipo: form.tipo as TipoPago,
      concepto: form.concepto,
    });
    setForm({ contratoId: '', monto: '', tipo: '', concepto: '' });
  };

  const handleConciliar = () => {
    if (useApi) return;
    if (conciliarExternoId && conciliarContratoId) {
      conciliarPagoExterno(conciliarExternoId, conciliarContratoId);
      setConciliarExternoId(null);
      setConciliarContratoId('');
    }
  };

  const adeudos = activos.map(c => {
    const recibosContrato = recibos.filter(r => r.contratoId === c.id);
    const pagosContrato = pagosVisibles.filter(p => p.contratoId === c.id);
    // saldoVencido es arrastre de recibos anteriores: sumarlo por recibo duplicaría la deuda
    const totalRecibos = recibosContrato.reduce((s, r) => s + Number(r.saldoVigente), 0);
    const totalPagos = pagosContrato.reduce((s, p) => s + Number(p.monto), 0);
    return { contrato: c, saldo: totalRecibos - totalPagos };
  }).filter(a => a.saldo > 0);

  const peConciliar = conciliarExternoId ? pagosExternos.find(pe => pe.id === conciliarExternoId) : null;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pagos y Adeudos</h1>
      </div>

      <Tabs defaultValue="registrar" className="space-y-4">
        <TabsList>
          <TabsTrigger value="registrar">Registrar pago</TabsTrigger>
          <TabsTrigger value="externos">Recaudación externa ({externosPorConciliar.length})</TabsTrigger>
          <TabsTrigger value="aplicados">Pagos aplicados (Link / nativos)</TabsTrigger>
        </TabsList>

        <TabsContent value="registrar" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="widget-card">
              <h3 className="section-title">Registrar pago</h3>
              <div className="space-y-3">
                <Select value={form.contratoId} onValueChange={v => setForm({ ...form, contratoId: v })}>
                  <SelectTrigger><SelectValue placeholder="Contrato" /></SelectTrigger>
                  <SelectContent>{activos.map(c => <SelectItem key={c.id} value={c.id}>{c.id} - {c.nombre}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="Monto" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} />
                <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v as TipoPago })}>
                  <SelectTrigger><SelectValue placeholder="Tipo de pago" /></SelectTrigger>
                  <SelectContent>
                    {TIPOS_PAGO.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Concepto" value={form.concepto} onChange={e => setForm({ ...form, concepto: e.target.value })} />
                <Button onClick={handlePago} disabled={useApi || !form.contratoId || !form.monto || !form.tipo} className="w-full">Registrar pago</Button>
              </div>
            </div>
            <div>
              <h3 className="section-title">Adeudos</h3>
              {adeudos.length > 0 ? (
                <div className="space-y-2">
                  {adeudos.map(a => (
                    <div key={a.contrato.id} className="widget-card flex items-center justify-between">
                      <div>
                        <p className="font-medium">{a.contrato.nombre}</p>
                        <p className="text-xs text-muted-foreground">{a.contrato.id}</p>
                      </div>
                      <span className="text-lg font-bold text-destructive">${a.saldo.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">Sin adeudos pendientes</p>
              )}
            </div>
          </div>
          <h3 className="section-title">Historial de pagos</h3>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Contrato</th><th>Monto</th><th>Tipo</th><th>Fecha</th></tr></thead>
              <tbody>
                {pagosVisibles.slice().reverse().map(p => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.contratoId}</td>
                    <td className="font-semibold text-success">${Number(p.monto).toFixed(2)}</td>
                    <td>{p.tipo}</td>
                    <td className="text-muted-foreground">{p.fecha}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="externos" className="space-y-4">
          <p className="text-sm text-muted-foreground">Pagos de recaudación externa (webservice) por conciliar. Confirma la sugerencia o busca el contrato/adeudo a conciliar.</p>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr><th>Referencia</th><th>Monto</th><th>Tipo</th><th>Fecha</th><th>Sugerencia (AI)</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {externosPorConciliar.map(pe => {
                  const contratoSug = pe.contratoIdSugerido ? contratos.find(c => c.id === pe.contratoIdSugerido) : null;
                  return (
                    <tr key={pe.id}>
                      <td className="font-mono text-xs">{pe.referencia}</td>
                      <td className="font-semibold">${Number(pe.monto).toFixed(2)}</td>
                      <td>{pe.tipo}</td>
                      <td>{pe.fecha}</td>
                      <td className="text-xs">
                        {pe.contratoIdSugerido ? (
                          <span>{pe.contratoIdSugerido} {contratoSug ? `- ${contratoSug.nombre}` : ''}</span>
                        ) : (
                          <span className="text-muted-foreground">Sin asignar</span>
                        )}
                      </td>
                      <td>
                        <Button size="sm" variant="outline" onClick={() => { setConciliarExternoId(pe.id); setConciliarContratoId(pe.contratoIdSugerido || ''); }}>
                          {pe.contratoIdSugerido ? 'Confirmar conciliación' : 'Buscar contrato'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {externosPorConciliar.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground py-8">No hay pagos externos por conciliar</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="aplicados" className="space-y-4">
          <p className="text-sm text-muted-foreground">Pagos nativos y Link de pago ya aplicados.</p>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Contrato</th><th>Monto</th><th>Tipo</th><th>Fecha</th><th>Concepto</th></tr></thead>
              <tbody>
                {pagosNativosAplicados.slice().reverse().map(p => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.contratoId}</td>
                    <td className="font-semibold text-success">${Number(p.monto).toFixed(2)}</td>
                    <td>{p.tipo}</td>
                    <td>{p.fecha}</td>
                    <td className="text-xs">{p.concepto}</td>
                  </tr>
                ))}
                {pagosNativosAplicados.length === 0 && <tr><td colSpan={5} className="text-center text-muted-foreground py-8">No hay pagos aplicados</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!conciliarExternoId} onOpenChange={() => { setConciliarExternoId(null); setConciliarContratoId(''); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Conciliar pago externo</DialogTitle></DialogHeader>
          {peConciliar && (
            <div className="space-y-3">
              <p className="text-sm"><strong>Referencia:</strong> {peConciliar.referencia} · <strong>Monto:</strong> ${Number(peConciliar.monto).toFixed(2)}</p>
              <Select value={conciliarContratoId} onValueChange={setConciliarContratoId}>
                <SelectTrigger><SelectValue placeholder="Contrato / adeudo a conciliar" /></SelectTrigger>
                <SelectContent>
                  {activos.map(c => <SelectItem key={c.id} value={c.id}>{c.id} - {c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={handleConciliar} disabled={useApi || !conciliarContratoId}>Confirmar conciliación</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Pagos;
