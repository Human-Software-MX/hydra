import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useData } from '@/context/DataContext';
import { fetchConsumos, hasApi } from '@/api/consumos';
import { fetchContratos } from '@/api/contratos';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Input } from '@/components/ui/input';

const Consumos = () => {
  const useApi = hasApi();
  const { consumos: contextConsumos, addConsumo, updateConsumo, contratos: contextContratos, allowedZonaIds } = useData();
  const { data: apiConsumos = [] } = useQuery({
    queryKey: ['consumos'],
    queryFn: fetchConsumos,
    enabled: useApi,
  });
  const { data: apiContratos = [] } = useQuery({
    queryKey: ['contratos'],
    queryFn: fetchContratos,
    enabled: useApi,
  });
  const consumos = useApi ? apiConsumos : contextConsumos;
  const contratos = useApi ? apiContratos : contextContratos;
  const [contratoId, setContratoId] = useState('');
  const [tipo, setTipo] = useState<any>('Promedio histórico');
  const [m3, setM3] = useState('');

  const contratosVisibles = useMemo(() =>
    !allowedZonaIds ? contratos : contratos.filter(c => c.zonaId && allowedZonaIds.includes(c.zonaId)),
    [contratos, allowedZonaIds]
  );
  const contratoIdsVisibles = useMemo(() => new Set(contratosVisibles.map(c => c.id)), [contratosVisibles]);
  // Con API el backend ya filtra por zona/permiso; no volver a cruzar con los contratos demo del contexto.
  const consumosVisibles = useMemo(
    () =>
      (useApi ? consumos : consumos.filter(c => contratoIdsVisibles.has(c.contratoId)))
        .slice()
        .sort((a, b) => (b.periodo ?? '').localeCompare(a.periodo ?? '')),
    [consumos, contratoIdsVisibles, useApi]
  );
  const activos = contratosVisibles.filter(c => c.estado === 'Activo');

  const handleEstimado = () => {
    if (useApi) return;
    addConsumo({
      contratoId,
      lecturaId: '',
      tipo,
      m3: Number(m3),
      periodo: new Date().toISOString().slice(0, 7),
      confirmado: false,
    });
    setContratoId('');
    setM3('');
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Consumos</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="section-title">Consumos confirmados</h3>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Contrato</th><th>Tipo</th><th>m³</th><th>Periodo</th><th>Confirmado</th><th></th></tr></thead>
              <tbody>
                {consumosVisibles.map(c => (
                  <tr key={c.id}>
                    <td className="font-mono text-xs">{c.contratoId}</td>
                    <td>{c.tipo}</td>
                    <td className="font-semibold">{c.m3}</td>
                    <td>{c.periodo}</td>
                    <td>{c.confirmado ? <span className="status-badge status-success">Sí</span> : <span className="status-badge status-warning">No</span>}</td>
                    <td>{!c.confirmado && <Button size="sm" onClick={() => !useApi && updateConsumo(c.id, { confirmado: true })} disabled={useApi}>Confirmar</Button>}</td>
                  </tr>
                ))}
                {consumosVisibles.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground py-8">No hay consumos</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="widget-card">
          <h3 className="section-title">Asignar consumo estimado</h3>
          <div className="space-y-3">
            <SearchableSelect
              options={activos.map(c => ({ value: c.id, label: `${c.id} - ${c.nombre}` }))}
              value={contratoId}
              onValueChange={setContratoId}
              placeholder="Contrato activo"
            />
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue placeholder="Tipo de consumo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Promedio histórico">Promedio histórico</SelectItem>
                <SelectItem value="Mixto">Mixto</SelectItem>
                <SelectItem value="Consumo fijo">Consumo fijo</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" placeholder="m³ estimados" value={m3} onChange={e => setM3(e.target.value)} />
            <Button onClick={handleEstimado} disabled={useApi || !contratoId || !m3} className="w-full">Asignar estimado</Button>
            {useApi && (
              <p className="text-xs text-muted-foreground">
                La asignación de consumo estimado aún no está disponible en línea (pendiente de endpoint en el backend).
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Consumos;
