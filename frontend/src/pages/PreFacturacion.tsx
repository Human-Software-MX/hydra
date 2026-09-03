import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useData } from '@/context/DataContext';
import { fetchPreFacturas, hasApi } from '@/api/prefacturacion';
import { fetchConsumos } from '@/api/consumos';
import { fetchTimbrados } from '@/api/recibos';
import { previewPeriodo, ejecutarPeriodo, type PreviewPeriodo } from '@/api/facturacion';
import { useToast } from '@/components/ui/use-toast';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type EtapaEstado = 'Pendiente' | 'Validada' | 'Aceptada';
type PreFacturaItem = ReturnType<typeof useData>['preFacturas'][0];

const PreFacturacion = () => {
  const useApi = hasApi();
  const { preFacturas: contextPreFacturas, addPreFactura, updatePreFactura, consumos: contextConsumos, contratos, calcularTarifa, zonas, allowedZonaIds, timbrados: contextTimbrados } = useData();
  const { data: apiPreFacturas = [] } = useQuery({ queryKey: ['prefacturas'], queryFn: fetchPreFacturas, enabled: useApi });
  const { data: apiConsumos = [] } = useQuery({ queryKey: ['consumos'], queryFn: fetchConsumos, enabled: useApi });
  const { data: apiTimbrados = [] } = useQuery({ queryKey: ['timbrados'], queryFn: fetchTimbrados, enabled: useApi });
  const preFacturas = useApi ? apiPreFacturas : contextPreFacturas;
  const consumos = useApi ? apiConsumos : contextConsumos;
  const timbrados = useApi ? apiTimbrados : contextTimbrados;
  const [zonaId, setZonaId] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingPf, setEditingPf] = useState<PreFacturaItem | null>(null);
  const [editM3, setEditM3] = useState('');
  const [editDescuento, setEditDescuento] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const defaultPeriodo = new Date().toISOString().slice(0, 7);
  const [periodoFactura, setPeriodoFactura] = useState(defaultPeriodo);
  const [preview, setPreview] = useState<PreviewPeriodo | null>(null);

  const zonaParam = zonaId !== 'all' ? zonaId : undefined;

  const previewMut = useMutation({
    mutationFn: () => previewPeriodo({ periodo: periodoFactura, zonaId: zonaParam }),
    onSuccess: (data) => {
      setPreview(data);
      toast({
        title: 'Previsualización lista',
        description: `${data.facturables} facturables · $${data.importeTotal.toFixed(2)} total${data.conError ? ` · ${data.conError} con error` : ''}`,
      });
    },
    onError: (e: Error) => toast({ title: 'Error al previsualizar', description: e.message, variant: 'destructive' }),
  });

  const ejecutarMut = useMutation({
    mutationFn: () => ejecutarPeriodo({ periodo: periodoFactura, zonaId: zonaParam }),
    onSuccess: (data) => {
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ['prefacturas'] });
      queryClient.invalidateQueries({ queryKey: ['timbrados'] });
      toast({
        title: 'Facturación ejecutada',
        description: `${data.generados} recibos generados · $${data.importeTotal.toFixed(2)}${data.conError ? ` · ${data.conError} con error` : ''}`,
      });
    },
    onError: (e: Error) => toast({ title: 'Error al facturar', description: e.message, variant: 'destructive' }),
  });

  const preFacturaIdsTimbradas = useMemo(
    () => new Set(timbrados.map(t => t.preFacturaId)),
    [timbrados]
  );

  const contratosConAcceso = useMemo(() =>
    !allowedZonaIds ? contratos : contratos.filter(c => c.zonaId && allowedZonaIds.includes(c.zonaId)),
    [contratos, allowedZonaIds]
  );
  const contratosEnZona = useMemo(() => {
    if (zonaId === 'all') return contratosConAcceso;
    return contratosConAcceso.filter(c => c.zonaId === zonaId);
  }, [contratosConAcceso, zonaId]);
  const contratoIdsZona = useMemo(() => new Set(contratosEnZona.map(c => c.id)), [contratosEnZona]);

  const consumosConfirmados = useMemo(() =>
    useApi
      ? consumos.filter(c => c.confirmado && !preFacturas.some(pf => pf.contratoId === c.contratoId && pf.periodo === c.periodo))
      : consumos.filter(c => c.confirmado && contratoIdsZona.has(c.contratoId) && !preFacturas.some(pf => pf.contratoId === c.contratoId && pf.periodo === c.periodo)),
    [consumos, contratoIdsZona, preFacturas, useApi]
  );
  const preFacturasFiltradas = useMemo(() =>
    useApi ? preFacturas : preFacturas.filter(pf => contratoIdsZona.has(pf.contratoId)),
    [preFacturas, contratoIdsZona, useApi]
  );

  const porEtapa = useMemo(() => {
    const pendiente = preFacturasFiltradas.filter(pf => pf.estado === 'Pendiente');
    const validada = preFacturasFiltradas.filter(pf => pf.estado === 'Validada');
    const aceptada = preFacturasFiltradas.filter(pf => pf.estado === 'Aceptada');
    return { pendiente, validada, aceptada };
  }, [preFacturasFiltradas]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInEtapa = (estado: EtapaEstado) => {
    const ids = porEtapa[estado.toLowerCase() as keyof typeof porEtapa].map(pf => pf.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = ids.every(id => next.has(id));
      ids.forEach(id => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const validarSeleccionadas = () => {
    if (useApi) return;
    selectedIds.forEach(id => updatePreFactura(id, { estado: 'Validada' }));
    setSelectedIds(new Set());
  };

  const aceptarSeleccionadas = () => {
    if (useApi) return;
    selectedIds.forEach(id => updatePreFactura(id, { estado: 'Aceptada' }));
    setSelectedIds(new Set());
  };

  const generarPreFactura = (consumo: typeof consumos[0]) => {
    if (useApi) return;
    const contrato = contratosConAcceso.find(c => c.id === consumo.contratoId);
    if (!contrato) return;
    const { subtotal, cargoFijo, total } = calcularTarifa(contrato.tipoServicio, consumo.m3);
    addPreFactura({
      contratoId: consumo.contratoId,
      periodo: consumo.periodo,
      consumoM3: consumo.m3,
      subtotal,
      descuento: 0,
      total,
      estado: 'Pendiente',
    });
  };

  const abrirEdicion = (pf: PreFacturaItem) => {
    setEditingPf(pf);
    setEditM3(String(pf.consumoM3));
    setEditDescuento(String(pf.descuento));
  };

  const guardarEdicion = () => {
    if (!editingPf || useApi) return;
    const contrato = contratosConAcceso.find(c => c.id === editingPf.contratoId);
    if (!contrato) return;
    const m3 = Number(editM3);
    const descuento = Number(editDescuento) || 0;
    if (Number.isNaN(m3) || m3 < 0) return;
    const { subtotal, cargoFijo } = calcularTarifa(contrato.tipoServicio, m3);
    const total = Math.max(0, subtotal + cargoFijo - descuento);
    updatePreFactura(editingPf.id, {
      consumoM3: m3,
      subtotal,
      descuento,
      total,
    });
    setEditingPf(null);
  };

  const revertirEstado = (pf: PreFacturaItem) => {
    if (useApi) return;
    if (pf.estado === 'Aceptada') updatePreFactura(pf.id, { estado: 'Validada' });
    else if (pf.estado === 'Validada') updatePreFactura(pf.id, { estado: 'Pendiente' });
  };

  const CardPreFactura = ({ pf, etapa, isTimbrada }: { pf: typeof preFacturasFiltradas[0]; etapa: EtapaEstado; isTimbrada: boolean }) => {
    const contrato = contratosConAcceso.find(c => c.id === pf.contratoId);
    const checked = selectedIds.has(pf.id);
    return (
      <div className="rounded-lg border bg-card p-3 flex items-start gap-3">
        <Checkbox checked={checked} onCheckedChange={() => toggleSelect(pf.id)} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between gap-2">
            <span className="font-mono text-xs">{pf.id}</span>
            <StatusBadge status={pf.estado} />
          </div>
          <p className="text-sm mt-1"><span className="text-muted-foreground">Contrato:</span> {pf.contratoId} · {contrato?.nombre}</p>
          <p className="text-sm"><span className="text-muted-foreground">Periodo:</span> {pf.periodo} · <span className="text-muted-foreground">m³:</span> {pf.consumoM3} · <strong>${pf.total.toFixed(2)}</strong></p>
          <div className="mt-2 flex flex-wrap gap-2">
            {isTimbrada ? (
              <Button size="sm" variant="outline" disabled title="Pre-factura ya timbrada; no editable">Editar</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => abrirEdicion(pf)} disabled={useApi}>Editar</Button>
            )}
            {etapa === 'Pendiente' && <Button size="sm" variant="outline" onClick={() => updatePreFactura(pf.id, { estado: 'Validada' })} disabled={useApi}>Validar</Button>}
            {etapa === 'Validada' && (
              <>
                <Button size="sm" onClick={() => updatePreFactura(pf.id, { estado: 'Aceptada' })} disabled={useApi}>Aceptar</Button>
                {!isTimbrada && <Button size="sm" variant="ghost" onClick={() => revertirEstado(pf)} disabled={useApi}>Revertir</Button>}
              </>
            )}
            {etapa === 'Aceptada' && !isTimbrada && <Button size="sm" variant="ghost" onClick={() => revertirEstado(pf)} disabled={useApi}>Revertir</Button>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pre-Facturación</h1>
        <SearchableSelect
          value={zonaId}
          onValueChange={setZonaId}
          options={[{ value: 'all', label: 'Todas las zonas' }, ...(allowedZonaIds ? zonas.filter(z => allowedZonaIds.includes(z.id)) : zonas).map(z => ({ value: z.id, label: z.nombre }))]}
          placeholder="Zona"
          searchPlaceholder="Buscar zona…"
          className="w-[180px]"
        />
      </div>

      {useApi && (
        <div className="mb-6 widget-card">
          <h3 className="section-title">Facturación del periodo</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Genera recibos reales (Timbrado + Recibo con importes de tarifa vigente) para los consumos
            confirmados aún no facturados{zonaParam ? ' de la zona seleccionada' : ''}. Previsualiza antes de ejecutar.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="periodo-factura">Periodo (YYYY-MM)</Label>
              <Input
                id="periodo-factura"
                type="month"
                value={periodoFactura}
                onChange={(e) => { setPeriodoFactura(e.target.value); setPreview(null); }}
                className="w-[180px]"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => previewMut.mutate()}
              disabled={previewMut.isPending || !periodoFactura}
            >
              {previewMut.isPending ? 'Calculando…' : 'Previsualizar'}
            </Button>
            <Button
              onClick={() => ejecutarMut.mutate()}
              disabled={ejecutarMut.isPending || !preview || preview.facturables === 0}
            >
              {ejecutarMut.isPending ? 'Facturando…' : `Ejecutar facturación${preview ? ` (${preview.facturables})` : ''}`}
            </Button>
          </div>
          {preview && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Facturables</p>
                <p className="text-lg font-semibold">{preview.facturables}</p>
              </div>
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Subtotal</p>
                <p className="text-lg font-semibold">${preview.importeSubtotal.toFixed(2)}</p>
              </div>
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">IVA</p>
                <p className="text-lg font-semibold">${preview.importeIva.toFixed(2)}</p>
              </div>
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-semibold">${preview.importeTotal.toFixed(2)}</p>
              </div>
              {preview.conError > 0 && (
                <div className="col-span-2 md:col-span-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <p className="font-medium text-destructive">{preview.conError} consumo(s) sin poder facturar</p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {preview.errores.slice(0, 5).map((e) => (
                      <li key={e.consumoId}>{e.contratoId}: {e.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!useApi && consumosConfirmados.length > 0 && (
        <div className="mb-6 widget-card">
          <h3 className="section-title">Facturación masiva</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Generar prefacturas para todos los consumos confirmados de la zona seleccionada que aún no tienen prefactura.
          </p>
          <Button
            onClick={() => consumosConfirmados.forEach(c => generarPreFactura(c))}
            className="mb-4"
            disabled={useApi}
          >
            Generar todas las prefacturas ({consumosConfirmados.length})
          </Button>
          <h4 className="section-subtitle">Consumos listos para facturar (individual)</h4>
          <div className="flex gap-2 flex-wrap">
            {consumosConfirmados.map(c => (
              <Button key={c.id} variant="outline" size="sm" onClick={() => generarPreFactura(c)} disabled={useApi}>
                Generar {c.contratoId} / {c.periodo}
              </Button>
            ))}
          </div>
        </div>
      )}

      <h3 className="section-title mb-2">Etapas de validación</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 min-h-[200px]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-muted-foreground">Pendiente</h4>
            <span className="text-sm text-muted-foreground">{porEtapa.pendiente.length}</span>
          </div>
          {porEtapa.pendiente.length > 0 && (
            <Button size="sm" variant="ghost" className="mb-2" onClick={() => selectAllInEtapa('Pendiente')}>
              Seleccionar todas
            </Button>
          )}
          {selectedIds.size > 0 && porEtapa.pendiente.some(pf => selectedIds.has(pf.id)) && (
            <Button size="sm" className="mb-2 w-full" onClick={validarSeleccionadas} disabled={useApi}>
              Validar seleccionadas ({Array.from(selectedIds).filter(id => porEtapa.pendiente.some(p => p.id === id)).length})
            </Button>
          )}
          <div className="space-y-2">
            {porEtapa.pendiente.map(pf => <CardPreFactura key={pf.id} pf={pf} etapa="Pendiente" isTimbrada={preFacturaIdsTimbradas.has(pf.id)} />)}
            {porEtapa.pendiente.length === 0 && <p className="text-sm text-muted-foreground">Sin pre-facturas pendientes</p>}
          </div>
        </div>

        <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 min-h-[200px]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-muted-foreground">Validada</h4>
            <span className="text-sm text-muted-foreground">{porEtapa.validada.length}</span>
          </div>
          {porEtapa.validada.length > 0 && (
            <Button size="sm" variant="ghost" className="mb-2" onClick={() => selectAllInEtapa('Validada')}>
              Seleccionar todas
            </Button>
          )}
          {selectedIds.size > 0 && porEtapa.validada.some(pf => selectedIds.has(pf.id)) && (
            <Button size="sm" className="mb-2 w-full" onClick={aceptarSeleccionadas} disabled={useApi}>
              Aceptar seleccionadas ({Array.from(selectedIds).filter(id => porEtapa.validada.some(p => p.id === id)).length})
            </Button>
          )}
          <div className="space-y-2">
            {porEtapa.validada.map(pf => <CardPreFactura key={pf.id} pf={pf} etapa="Validada" isTimbrada={preFacturaIdsTimbradas.has(pf.id)} />)}
            {porEtapa.validada.length === 0 && <p className="text-sm text-muted-foreground">Sin pre-facturas validadas</p>}
          </div>
        </div>

        <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 min-h-[200px]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-muted-foreground">Aceptada</h4>
            <span className="text-sm text-muted-foreground">{porEtapa.aceptada.length}</span>
          </div>
          <div className="space-y-2">
            {porEtapa.aceptada.map(pf => <CardPreFactura key={pf.id} pf={pf} etapa="Aceptada" isTimbrada={preFacturaIdsTimbradas.has(pf.id)} />)}
            {porEtapa.aceptada.length === 0 && <p className="text-sm text-muted-foreground">Sin pre-facturas aceptadas</p>}
          </div>
        </div>
      </div>

      <Dialog open={!!editingPf} onOpenChange={open => !open && setEditingPf(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar pre-factura</DialogTitle>
            <DialogDescription>
              Corrija consumo (m³) y descuento. El subtotal y total se recalculan con la tarifa del contrato.
            </DialogDescription>
          </DialogHeader>
          {editingPf && (() => {
            const contratoEdit = contratosConAcceso.find(c => c.id === editingPf.contratoId);
            const m3Preview = Number(editM3) || 0;
            const descuentoPreview = Number(editDescuento) || 0;
            const tarifaPreview = contratoEdit ? calcularTarifa(contratoEdit.tipoServicio, m3Preview) : null;
            const totalPreview = tarifaPreview ? Math.max(0, tarifaPreview.subtotal + tarifaPreview.cargoFijo - descuentoPreview) : 0;
            return (
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-m3">Consumo (m³)</Label>
                  <Input
                    id="edit-m3"
                    type="number"
                    min={0}
                    value={editM3}
                    onChange={e => setEditM3(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-descuento">Descuento ($)</Label>
                  <Input
                    id="edit-descuento"
                    type="number"
                    min={0}
                    value={editDescuento}
                    onChange={e => setEditDescuento(e.target.value)}
                  />
                </div>
                {tarifaPreview && (
                  <div className="rounded-md border bg-muted/40 p-3 space-y-1 text-sm">
                    <p className="font-medium text-muted-foreground">Total recalculado</p>
                    <div className="flex justify-between"><span>Subtotal</span><span>${tarifaPreview.subtotal.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Cargo fijo</span><span>${tarifaPreview.cargoFijo.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Descuento</span><span>-${descuentoPreview.toFixed(2)}</span></div>
                    <div className="flex justify-between font-semibold pt-1 border-t"><span>Total</span><span>${totalPreview.toFixed(2)}</span></div>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPf(null)}>Cancelar</Button>
            <Button onClick={guardarEdicion} disabled={useApi || !editingPf || editM3 === ''}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PreFacturacion;
