import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useData } from '@/context/DataContext';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { timbrarPeriodo, type ResultadoTimbradoPeriodo } from '@/api/timbrado';
import { useToast } from '@/components/ui/use-toast';

const TimbradoPage = () => {
  const { timbrados, addTimbrado, updateTimbrado, preFacturas, contratos, zonas, allowedZonaIds } = useData();
  const [zonaId, setZonaId] = useState<string>('all');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [periodoTimbrado, setPeriodoTimbrado] = useState(new Date().toISOString().slice(0, 7));
  const [resultado, setResultado] = useState<ResultadoTimbradoPeriodo | null>(null);

  const timbrarPeriodoMut = useMutation({
    mutationFn: () => timbrarPeriodo({ periodo: periodoTimbrado }),
    onSuccess: (data) => {
      setResultado(data);
      queryClient.invalidateQueries({ queryKey: ['timbrados'] });
      toast({
        title: 'Timbrado ejecutado',
        description: `${data.timbrados}/${data.procesados} timbrados${data.conError ? ` · ${data.conError} con error` : ''}`,
      });
    },
    onError: (e: Error) => toast({ title: 'Error al timbrar', description: e.message, variant: 'destructive' }),
  });

  const contratoIdsZona = useMemo(() => {
    if (zonaId === 'all') return new Set(contratos.map(c => c.id));
    return new Set(contratos.filter(c => c.zonaId === zonaId).map(c => c.id));
  }, [contratos, zonaId]);

  const preFacturasZona = useMemo(() => preFacturas.filter(pf => contratoIdsZona.has(pf.contratoId)), [preFacturas, contratoIdsZona]);
  const aceptadas = useMemo(() =>
    preFacturasZona.filter(pf => pf.estado === 'Aceptada' && !timbrados.some(t => t.preFacturaId === pf.id)),
    [preFacturasZona, timbrados]
  );
  const timbradosFiltrados = useMemo(() => timbrados.filter(t => contratoIdsZona.has(t.contratoId)), [timbrados, contratoIdsZona]);

  const timbrar = (pf: typeof preFacturas[0]) => {
    const exito = Math.random() > 0.3;
    addTimbrado({
      preFacturaId: pf.id,
      contratoId: pf.contratoId,
      uuid: exito ? `UUID-${Date.now().toString(36).toUpperCase()}` : '',
      estado: exito ? 'Timbrada OK' : 'Error PAC',
      error: exito ? undefined : 'Error de conexión con PAC: timeout',
      fecha: new Date().toISOString().split('T')[0],
    });
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Monitor de Timbrado</h1>
        <SearchableSelect
          value={zonaId}
          onValueChange={setZonaId}
          options={[{ value: 'all', label: 'Todas las zonas' }, ...(allowedZonaIds ? zonas.filter(z => allowedZonaIds.includes(z.id)) : zonas).map(z => ({ value: z.id, label: z.nombre }))]}
          placeholder="Zona"
          searchPlaceholder="Buscar zona…"
          className="w-[180px]"
        />
      </div>

      <div className="mb-6 widget-card">
        <h3 className="section-title">Timbrado del periodo (CFDI 4.0)</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Timbra ante el PAC todos los comprobantes pendientes del periodo (estado Pendiente o Error PAC).
          Genera el XML CFDI 4.0 con UUID y sellos.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="periodo-timbrado">Periodo (YYYY-MM)</Label>
            <Input
              id="periodo-timbrado"
              type="month"
              value={periodoTimbrado}
              onChange={(e) => { setPeriodoTimbrado(e.target.value); setResultado(null); }}
              className="w-[180px]"
            />
          </div>
          <Button onClick={() => timbrarPeriodoMut.mutate()} disabled={timbrarPeriodoMut.isPending || !periodoTimbrado}>
            {timbrarPeriodoMut.isPending ? 'Timbrando…' : 'Timbrar periodo'}
          </Button>
        </div>
        {resultado && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-md border bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Procesados</p><p className="text-lg font-semibold">{resultado.procesados}</p></div>
            <div className="rounded-md border bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Timbrados</p><p className="text-lg font-semibold">{resultado.timbrados}</p></div>
            <div className="rounded-md border bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Con error</p><p className="text-lg font-semibold">{resultado.conError}</p></div>
            {resultado.conError > 0 && (
              <div className="col-span-2 md:col-span-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <ul className="list-disc pl-5 text-muted-foreground">
                  {resultado.errores.slice(0, 5).map((e) => <li key={e.timbradoId}>{e.timbradoId}: {e.error}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {aceptadas.length > 0 && (
        <div className="mb-6">
          <h3 className="section-title">Pre-facturas listas para timbrar</h3>
          <div className="flex gap-2 flex-wrap">
            {aceptadas.map(pf => (
              <Button key={pf.id} size="sm" onClick={() => timbrar(pf)}>
                Timbrar {pf.id} (${pf.total.toFixed(2)})
              </Button>
            ))}
            <Button variant="outline" onClick={() => aceptadas.forEach(timbrar)}>Timbrar todas</Button>
          </div>
        </div>
      )}

      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>ID</th><th>Pre-factura</th><th>Contrato</th><th>UUID</th><th>Estado</th><th>Error</th><th></th></tr></thead>
          <tbody>
            {timbradosFiltrados.map(t => (
              <tr key={t.id}>
                <td className="font-mono text-xs">{t.id}</td>
                <td className="font-mono text-xs">{t.preFacturaId}</td>
                <td className="font-mono text-xs">{t.contratoId}</td>
                <td className="font-mono text-xs">{t.uuid || '—'}</td>
                <td><StatusBadge status={t.estado} /></td>
                <td className="text-xs text-destructive">{t.error || '—'}</td>
                <td>
                  {t.estado === 'Error PAC' && (
                    <Button size="sm" variant="outline" onClick={() => {
                      const exito = Math.random() > 0.3;
                      updateTimbrado(t.id, {
                        estado: exito ? 'Timbrada OK' : 'Error PAC',
                        uuid: exito ? `UUID-${Date.now().toString(36).toUpperCase()}` : '',
                        error: exito ? undefined : 'Reintento fallido',
                      });
                    }}>Reintentar</Button>
                  )}
                </td>
              </tr>
            ))}
            {timbradosFiltrados.length === 0 && <tr><td colSpan={7} className="text-center text-muted-foreground py-8">No hay timbrados en esta zona</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TimbradoPage;
