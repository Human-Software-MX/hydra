import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useData } from '@/context/DataContext';
import { fetchMedidores, fetchMedidoresBodega, hasApi, type MedidorDto } from '@/api/medidores';
import StatusBadge from '@/components/StatusBadge';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Package, Gauge, SlidersHorizontal } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const useApi = hasApi();

const Medidores = () => {
  const {
    medidores: contextMedidores,
    medidoresBodega: contextBodega,
    contratos,
    zonas,
    addMedidor,
    updateMedidor,
    addMedidorBodega,
    updateMedidorBodega,
    assignMedidorFromBodega,
    allowedZonaIds,
  } = useData();

  const { data: apiMedidores = [] } = useQuery({
    queryKey: ['medidores'],
    queryFn: () => fetchMedidores(),
    enabled: useApi,
    staleTime: 60_000,
  });
  const { data: apiBodega = [] } = useQuery({
    queryKey: ['medidores-bodega'],
    queryFn: () => fetchMedidoresBodega(),
    enabled: useApi,
    staleTime: 60_000,
  });

  const medidores = useApi ? apiMedidores : contextMedidores;
  const medidoresBodega = useApi ? apiBodega : contextBodega;

  const contratosVisibles = useMemo(() =>
    !allowedZonaIds ? contratos : contratos.filter(c => c.zonaId && allowedZonaIds.includes(c.zonaId)),
    [contratos, allowedZonaIds]
  );
  const [showAddBodega, setShowAddBodega] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [bodegaForm, setBodegaForm] = useState({ serie: '', estado: 'Disponible' as 'Disponible' | 'En reparación' });
  const [assignForm, setAssignForm] = useState({ medidorBodegaId: '', contratoId: '', zonaId: '', lecturaInicial: 0 });

  // Filtros asignados
  const [filtroZona, setFiltroZona] = useState<string>('all');
  const [filtroEstado, setFiltroEstado] = useState<string>('all');
  const [filtroSerie, setFiltroSerie] = useState('');

  // Filtros bodega
  const [filtroBodegaEstado, setFiltroBodegaEstado] = useState<string>('all');
  const [filtroBodegaSerie, setFiltroBodegaSerie] = useState('');

  const pendientes = contratosVisibles.filter(c => c.estado === 'Pendiente de alta');
  const disponiblesBodega = medidoresBodega.filter(m => m.estado === 'Disponible');

  // Zona del medidor: preferir el contrato embebido que trae la API; caer al contrato demo del contexto.
  const zonaIdDeMedidor = (m: typeof medidores[number]): string | null =>
    (m as MedidorDto).contrato?.zonaId ?? contratosVisibles.find(c => c.id === m.contratoId)?.zonaId ?? null;

  const medidoresFiltrados = useMemo(() => {
    return medidores.filter(m => {
      const zonaId = zonaIdDeMedidor(m);
      // Multi-tenancy: si el usuario tiene zonas restringidas, la del medidor debe estar permitida.
      if (allowedZonaIds && (!zonaId || !allowedZonaIds.includes(zonaId))) return false;
      if (filtroZona !== 'all' && zonaId !== filtroZona) return false;
      if (filtroEstado !== 'all' && m.estado !== filtroEstado) return false;
      if (filtroSerie && !m.serie.toLowerCase().includes(filtroSerie.toLowerCase())) return false;
      return true;
    });
  }, [medidores, contratosVisibles, allowedZonaIds, filtroZona, filtroEstado, filtroSerie]);

  const bodegaFiltrados = useMemo(() => {
    return medidoresBodega.filter(m => {
      if (filtroBodegaEstado !== 'all' && m.estado !== filtroBodegaEstado) return false;
      if (filtroBodegaSerie && !m.serie.toLowerCase().includes(filtroBodegaSerie.toLowerCase())) return false;
      return true;
    });
  }, [medidoresBodega, filtroBodegaEstado, filtroBodegaSerie]);

  const handleAddBodega = () => {
    addMedidorBodega({ serie: bodegaForm.serie, estado: bodegaForm.estado });
    setBodegaForm({ serie: '', estado: 'Disponible' });
    setShowAddBodega(false);
  };

  const handleAssign = () => {
    assignMedidorFromBodega(assignForm.medidorBodegaId, assignForm.contratoId, assignForm.lecturaInicial, assignForm.zonaId);
    setAssignForm({ medidorBodegaId: '', contratoId: '', zonaId: '', lecturaInicial: 0 });
    setShowAssign(false);
  };

  const enReparacion = medidoresBodega.filter(m => m.estado === 'En reparación');

  return (
    <div>
      <PageHeader
        title="Inventario de Medidores"
        subtitle="Gestión centralizada de dispositivos de medición."
        breadcrumbs={[{ label: 'Servicios' }, { label: 'Medidores' }]}
        actions={
          <>
            <Button variant="outline" onClick={() => setShowAddBodega(true)}>
              <Plus className="h-4 w-4 mr-1" /> Alta en bodega
            </Button>
            <Button
              className="bg-[#007BFF] hover:bg-blue-600 text-white"
              onClick={() => setShowAssign(true)}
              disabled={disponiblesBodega.length === 0 || pendientes.length === 0}
            >
              <Gauge className="h-4 w-4 mr-1" /> Asignar a contrato
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total inventario"
          value={medidores.length + medidoresBodega.length}
          sub="Asignados + bodega"
          accent="primary"
          icon={Gauge}
        />
        <KpiCard
          label="Asignados"
          value={medidores.length}
          sub="En uso en contratos"
          accent="success"
        />
        <KpiCard
          label="En bodega"
          value={medidoresBodega.length}
          sub={`${disponiblesBodega.length} disponibles`}
          accent="default"
          icon={Package}
        />
        <KpiCard
          label="Pendientes de contrato"
          value={pendientes.length}
          sub="Contratos sin medidor"
          accent={pendientes.length > 0 ? 'warning' : 'default'}
        />
      </div>

      {pendientes.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          Hay <strong>{pendientes.length}</strong> contrato(s) pendientes de activación (requieren medidor).
        </div>
      )}

      <Tabs defaultValue="asignados" className="space-y-4">
        <TabsList>
          <TabsTrigger value="asignados">
            <Gauge className="h-4 w-4 mr-1" /> Asignados ({medidores.length})
          </TabsTrigger>
          <TabsTrigger value="bodega">
            <Package className="h-4 w-4 mr-1" /> En bodega ({medidoresBodega.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="asignados" className="space-y-4">
          <div className="flex gap-2 flex-wrap items-center">
            <SearchableSelect
              value={filtroZona}
              onValueChange={setFiltroZona}
              options={[{ value: 'all', label: 'Todas las zonas' }, ...zonas.map(z => ({ value: z.id, label: z.nombre }))]}
              placeholder="Zona"
              searchPlaceholder="Buscar zona…"
              className="w-[160px]"
            />
            <Select value={filtroEstado} onValueChange={setFiltroEstado}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="Activo">Activo</SelectItem>
                <SelectItem value="Inactivo">Inactivo</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Filtrar por serie" className="w-48" value={filtroSerie} onChange={e => setFiltroSerie(e.target.value)} />
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm"><SlidersHorizontal className="h-4 w-4 mr-1" /> Filtrar</Button>
              <Button variant="ghost" size="sm">Exportar</Button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border/50 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">ID</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Serie</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Contrato</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Zona</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Estado</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Cobro diferido</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Lectura inicial</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {medidoresFiltrados.map(m => {
                  const zonaId = zonaIdDeMedidor(m);
                  const zona = zonaId ? zonas.find(z => z.id === zonaId) : null;
                  return (
                    <tr key={m.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3.5 font-mono text-xs text-[#007BFF] font-medium">{m.id}</td>
                      <td className="px-4 py-3.5">{m.serie}</td>
                      <td className="px-4 py-3.5 font-mono text-xs text-[#007BFF] font-medium">{m.contratoId}</td>
                      <td className="px-4 py-3.5 text-sm">{zona?.nombre ?? zonaId ?? '—'}</td>
                      <td className="px-4 py-3.5"><StatusBadge status={m.estado} /></td>
                      <td className="px-4 py-3.5">{m.cobroDiferido ? 'Sí' : 'No'}</td>
                      <td className="px-4 py-3.5">{m.lecturaInicial}</td>
                      <td className="px-4 py-3.5">
                        {m.estado === 'Activo' && <Button size="sm" variant="outline" onClick={() => updateMedidor(m.id, { estado: 'Inactivo' })}>Desactivar</Button>}
                        {m.estado === 'Inactivo' && <Button size="sm" className="bg-[#007BFF] hover:bg-blue-600 text-white" onClick={() => updateMedidor(m.id, { estado: 'Activo' })}>Activar</Button>}
                      </td>
                    </tr>
                  );
                })}
                {medidoresFiltrados.length === 0 && <tr><td colSpan={8} className="text-center text-muted-foreground py-8">No hay medidores asignados</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="bodega" className="space-y-4">
          <div className="flex gap-2 flex-wrap items-center">
            <Select value={filtroBodegaEstado} onValueChange={setFiltroBodegaEstado}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="Disponible">Disponible</SelectItem>
                <SelectItem value="En reparación">En reparación</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Filtrar por serie" className="w-48" value={filtroBodegaSerie} onChange={e => setFiltroBodegaSerie(e.target.value)} />
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm"><SlidersHorizontal className="h-4 w-4 mr-1" /> Filtrar</Button>
              <Button variant="ghost" size="sm">Exportar</Button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border/50 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">ID</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Serie</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Zona</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Estado</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {bodegaFiltrados.map(m => {
                  const zona = m.zonaId ? zonas.find(z => z.id === m.zonaId) : null;
                  return (
                  <tr key={m.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3.5 font-mono text-xs text-[#007BFF] font-medium">{m.id}</td>
                    <td className="px-4 py-3.5">{m.serie}</td>
                    <td className="px-4 py-3.5 text-sm">{zona?.nombre ?? '—'}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={m.estado} /></td>
                    <td className="px-4 py-3.5">
                      <Select value={m.estado} onValueChange={(v: 'Disponible' | 'En reparación') => updateMedidorBodega(m.id, { estado: v })}>
                        <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Disponible">Disponible</SelectItem>
                          <SelectItem value="En reparación">En reparación</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                  );
                })}
                {bodegaFiltrados.length === 0 && <tr><td colSpan={5} className="text-center text-muted-foreground py-8">No hay medidores en bodega</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showAddBodega} onOpenChange={setShowAddBodega}>
        <DialogContent>
          <DialogHeader><DialogTitle>Alta de medidor en bodega</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bodega-serie">Serie del medidor</Label>
              <Input id="bodega-serie" placeholder="Ej. MED-2025-00001" value={bodegaForm.serie} onChange={e => setBodegaForm({ ...bodegaForm, serie: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={bodegaForm.estado} onValueChange={(v: 'Disponible' | 'En reparación') => setBodegaForm({ ...bodegaForm, estado: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Disponible">Disponible</SelectItem>
                  <SelectItem value="En reparación">En reparación</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddBodega} disabled={!bodegaForm.serie.trim()} className="w-full">Agregar a bodega</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent>
          <DialogHeader><DialogTitle>Asignar medidor a contrato</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Medidor disponible en bodega</Label>
              <SearchableSelect
                value={assignForm.medidorBodegaId || ''}
                onValueChange={v => setAssignForm({ ...assignForm, medidorBodegaId: v })}
                options={disponiblesBodega.map(m => ({ value: m.id, label: m.serie }))}
                placeholder="Seleccione un medidor"
                searchPlaceholder="Buscar por serie…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contrato pendiente</Label>
              <SearchableSelect
                value={assignForm.contratoId || ''}
                onValueChange={v => setAssignForm({ ...assignForm, contratoId: v })}
                options={pendientes.map(c => ({ value: c.id, label: `${c.id} – ${c.nombre}` }))}
                placeholder="Seleccione un contrato"
                searchPlaceholder="Buscar contrato…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Zona (se asigna al contrato)</Label>
              <SearchableSelect
                value={assignForm.zonaId || ''}
                onValueChange={v => setAssignForm({ ...assignForm, zonaId: v })}
                options={(allowedZonaIds ? zonas.filter(z => allowedZonaIds.includes(z.id)) : zonas).map(z => ({ value: z.id, label: z.nombre }))}
                placeholder="Seleccione una zona"
                searchPlaceholder="Buscar zona…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-lectura">Lectura inicial</Label>
              <Input id="assign-lectura" type="number" placeholder="0" value={assignForm.lecturaInicial || ''} onChange={e => setAssignForm({ ...assignForm, lecturaInicial: Number(e.target.value) || 0 })} />
            </div>
            <p className="text-xs text-muted-foreground">El contrato pasará a estado <strong>Activo</strong> y se le asignará la zona elegida.</p>
            <Button onClick={handleAssign} disabled={!assignForm.medidorBodegaId || !assignForm.contratoId || !assignForm.zonaId} className="w-full">Asignar y activar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Medidores;
