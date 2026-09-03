import { useState } from 'react';
import { useData } from '@/context/DataContext';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';

const Tomas = () => {
  const { tomas, addToma, construcciones } = useData();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ construccionId: '', ubicacion: '', tipo: '' as any });

  const finalizadas = construcciones.filter(c => c.estado === 'Finalizada');

  const handleCreate = () => {
    addToma({ ...form, estado: 'Disponible' });
    setForm({ construccionId: '', ubicacion: '', tipo: '' });
    setShowCreate(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Tomas (Puntos de Servicio)</h1>
        <Button onClick={() => setShowCreate(true)} disabled={finalizadas.length === 0}><Plus className="h-4 w-4 mr-1" /> Nueva toma</Button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>ID</th><th>Ubicación</th><th>Tipo</th><th>Estado</th></tr></thead>
          <tbody>
            {tomas.map(t => (
              <tr key={t.id}>
                <td className="font-mono text-xs">{t.id}</td>
                <td>{t.ubicacion}</td>
                <td>{t.tipo}</td>
                <td><StatusBadge status={t.estado} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva Toma</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <SearchableSelect
              value={form.construccionId}
              onValueChange={v => setForm({ ...form, construccionId: v })}
              options={finalizadas.map(c => ({ value: c.id, label: `${c.id} - ${c.nombre}` }))}
              placeholder="Construcción finalizada"
              searchPlaceholder="Buscar construcción…"
            />
            <Input placeholder="Ubicación" value={form.ubicacion} onChange={e => setForm({ ...form, ubicacion: e.target.value })} />
            <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v as any })}>
              <SelectTrigger><SelectValue placeholder="Tipo de toma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Agua">Agua</SelectItem>
                <SelectItem value="Saneamiento">Saneamiento</SelectItem>
                <SelectItem value="Alcantarillado">Alcantarillado</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleCreate} disabled={!form.construccionId || !form.ubicacion || !form.tipo} className="w-full">Crear toma</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Tomas;
