import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useData } from '@/context/DataContext';
import { fetchRutas, hasApi } from '@/api/rutas';
import { fetchContratos } from '@/api/contratos';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, GripVertical, MapPin, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';

const CONTRATO_DRAG_TYPE = 'application/x-contrato-id';
const DROP_TARGET_SIN_RUTA = 'sin-ruta';

const useApi = hasApi();

const Rutas = () => {
  const { rutas: contextRutas, addRuta, contratos: contextContratos, zonas, moveContratoToRuta, allowedZonaIds } = useData();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ zonaId: '', sector: '', libreta: '', lecturista: '', contratoIds: [] as string[] });
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const { data: apiRutas = [] } = useQuery({
    queryKey: ['rutas'],
    queryFn: () => fetchRutas(),
    enabled: useApi,
    staleTime: 60_000,
  });
  const { data: apiContratos = [] } = useQuery({
    queryKey: ['contratos'],
    queryFn: fetchContratos,
    enabled: useApi,
    staleTime: 60_000,
  });

  const rutas = useApi ? apiRutas : contextRutas;
  const contratos = useApi ? apiContratos : contextContratos;

  const rutasVisibles = useMemo(() =>
    !allowedZonaIds ? rutas : rutas.filter(r => r.zonaId && allowedZonaIds.includes(r.zonaId)),
    [rutas, allowedZonaIds]
  );
  const contratosVisibles = useMemo(() =>
    !allowedZonaIds ? contratos : contratos.filter((c: { zonaId?: string | null }) => c.zonaId && allowedZonaIds!.includes(c.zonaId)),
    [contratos, allowedZonaIds]
  );
  const activos = contratosVisibles.filter((c: { estado: string; rutaId?: string | null }) => c.estado === 'Activo' && !c.rutaId);

  const handleCreate = () => {
    addRuta(form);
    setForm({ zonaId: '', sector: '', libreta: '', lecturista: '', contratoIds: [] });
    setShowCreate(false);
  };

  const getZonaNombre = (zonaId: string) => zonas.find(z => z.id === zonaId)?.nombre ?? zonaId;

  const toggleContrato = (id: string) => {
    setForm(prev => ({
      ...prev,
      contratoIds: prev.contratoIds.includes(id)
        ? prev.contratoIds.filter(c => c !== id)
        : [...prev.contratoIds, id]
    }));
  };

  const onDragStart = useCallback((e: React.DragEvent, contratoId: string) => {
    e.dataTransfer.setData(CONTRATO_DRAG_TYPE, contratoId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(targetId);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const onDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const contratoId = e.dataTransfer.getData(CONTRATO_DRAG_TYPE);
    if (!contratoId) return;
    const rutaId = targetId === DROP_TARGET_SIN_RUTA ? null : targetId;
    moveContratoToRuta(contratoId, rutaId);
  }, [moveContratoToRuta]);

  const contratosEnRutas = contratosVisibles.filter(c => c.rutaId);

  return (
    <div>
      <PageHeader
        title="Rutas y Lecturistas"
        subtitle="Gestión administrativa de recorridos y asignación de personal."
        breadcrumbs={[{ label: 'Servicios' }, { label: 'Rutas' }]}
        actions={
          <Button className="bg-[#007BFF] hover:bg-blue-600 text-white" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nueva ruta
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Total rutas"
          value={rutasVisibles.length}
          sub="En zonas asignadas"
          accent="primary"
          icon={MapPin}
        />
        <KpiCard
          label="Contratos en ruta"
          value={contratosEnRutas.length}
          sub="Con recorrido asignado"
          accent="success"
          icon={Users}
        />
        <KpiCard
          label="Sin ruta"
          value={activos.length}
          sub="Activos sin asignar"
          accent={activos.length > 0 ? 'warning' : 'default'}
        />
      </div>

      <p className="text-sm text-muted-foreground mb-4">Arrastra contratos a una ruta o a &quot;Sin ruta&quot; para asignar o quitar.</p>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contratos sin ruta - drop target */}
        <div
          className={`rounded-lg border-2 border-dashed p-4 min-h-[200px] transition-colors ${dragOverId === DROP_TARGET_SIN_RUTA ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}`}
          onDragOver={(e) => onDragOver(e, DROP_TARGET_SIN_RUTA)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, DROP_TARGET_SIN_RUTA)}
        >
          <h3 className="font-semibold mb-2 text-muted-foreground">Sin ruta ({activos.length})</h3>
          <div className="space-y-1">
            {activos.map(c => (
              <div
                key={c.id}
                draggable
                onDragStart={(e) => onDragStart(e, c.id)}
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm cursor-grab active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-xs">{c.id}</span>
                <span className="truncate">{c.nombre}</span>
              </div>
            ))}
            {activos.length === 0 && <p className="text-xs text-muted-foreground py-2">Ningún contrato sin ruta</p>}
          </div>
        </div>

        {/* Rutas - cada una es drop target y muestra sus contratos */}
        <div className="lg:col-span-2 space-y-4">
          {rutasVisibles.map(r => (
            <div
              key={r.id}
              className={`bg-white rounded-xl border border-border/50 shadow-sm p-5 min-h-[120px] transition-colors ${dragOverId === r.id ? 'ring-2 ring-primary' : ''}`}
              onDragOver={(e) => onDragOver(e, r.id)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, r.id)}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-semibold">{('zona' in r && r.zona?.nombre) ? r.zona.nombre : getZonaNombre(r.zonaId)} – {r.sector}</h3>
                  <p className="text-xs text-muted-foreground">Libreta: {r.libreta} · Lecturista: {r.lecturista}</p>
                </div>
                <span className="status-badge status-info">{r.contratoIds.length} contratos</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.contratoIds.map(cid => {
                  const c = contratosVisibles.find(x => x.id === cid) ?? contratos.find(x => x.id === cid);
                  if (!c) return null;
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, c.id)}
                      className="flex items-center gap-1 rounded border bg-muted/50 px-2 py-1 text-xs cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono">{c.id}</span>
                      <span className="truncate max-w-[100px]">{c.nombre}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {rutasVisibles.length === 0 && <p className="text-muted-foreground text-center py-8">No hay rutas en las zonas de tu acceso.</p>}
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva Ruta</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <SearchableSelect
              value={form.zonaId}
              onValueChange={v => setForm({ ...form, zonaId: v })}
              options={(allowedZonaIds ? zonas.filter(z => allowedZonaIds.includes(z.id)) : zonas).map(z => ({ value: z.id, label: z.nombre }))}
              placeholder="Zona"
              searchPlaceholder="Buscar zona…"
            />
            <Input placeholder="Sector" value={form.sector} onChange={e => setForm({ ...form, sector: e.target.value })} />
            <Input placeholder="Libreta" value={form.libreta} onChange={e => setForm({ ...form, libreta: e.target.value })} />
            <Input placeholder="Lecturista" value={form.lecturista} onChange={e => setForm({ ...form, lecturista: e.target.value })} />
            {activos.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Contratos sin ruta (opcional):</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {activos.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={form.contratoIds.includes(c.id)} onChange={() => toggleContrato(c.id)} />
                      {c.id} - {c.nombre}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Button onClick={handleCreate} disabled={!form.zonaId || !form.lecturista} className="w-full">Crear ruta</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Rutas;
