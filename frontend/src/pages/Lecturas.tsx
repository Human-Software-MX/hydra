import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useData } from '@/context/DataContext';
import { fetchLecturas, hasApi } from '@/api/lecturas';
import { fetchRutas, type RutaDto } from '@/api/rutas';
import StatusBadge from '@/components/StatusBadge';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { SlidersHorizontal, CheckCircle2, XCircle, Clock } from 'lucide-react';

const PAGE_SIZE = 20;
const RANGO_MIN = 0;
const RANGO_MAX = 200;

const Lecturas = () => {
  const useApi = hasApi();
  const { lecturas: contextLecturas, addLectura, rutas: contextRutas, contratos, medidores, zonas, allowedZonaIds } = useData();
  const { data: apiLecturas = [] } = useQuery({
    queryKey: ['lecturas'],
    queryFn: fetchLecturas,
    enabled: useApi,
  });
  const { data: apiRutas = [] } = useQuery({
    queryKey: ['rutas'],
    queryFn: () => fetchRutas(),
    enabled: useApi,
    staleTime: 5 * 60_000,
  });
  const lecturas = useApi ? apiLecturas : contextLecturas;
  const getZonaNombre = (zonaId: string) => zonas.find(z => z.id === zonaId)?.nombre ?? zonaId;

  const rutas: (typeof contextRutas[0] | RutaDto)[] = useApi ? apiRutas : contextRutas;
  const rutasVisibles = useMemo(() =>
    !allowedZonaIds ? rutas : rutas.filter(r => r.zonaId && allowedZonaIds.includes(r.zonaId)),
    [rutas, allowedZonaIds]
  );
  const contratoIdsVisibles = useMemo(() => {
    if (!allowedZonaIds) return new Set(contratos.map(c => c.id));
    return new Set(contratos.filter(c => c.zonaId && allowedZonaIds.includes(c.zonaId)).map(c => c.id));
  }, [contratos, allowedZonaIds]);
  // When using real API, backend already handles zone access; skip mock-contract filter
  const lecturasVisibles = useMemo(() =>
    useApi ? lecturas : lecturas.filter(l => contratoIdsVisibles.has(l.contratoId)),
    [lecturas, contratoIdsVisibles, useApi]
  );

  const [selectedRuta, setSelectedRuta] = useState('');
  const [captureContratoId, setCaptureContratoId] = useState('');
  const [lecturaActual, setLecturaActual] = useState('');
  const [incidencia, setIncidencia] = useState('');

  // Filtros historial
  const [filtroRuta, setFiltroRuta] = useState('all');
  const [filtroZona, setFiltroZona] = useState('all');
  const [filtroContrato, setFiltroContrato] = useState('all');
  const [filtroEstado, setFiltroEstado] = useState('all');
  const [filtroPeriodo, setFiltroPeriodo] = useState('');
  const [filtroFecha, setFiltroFecha] = useState('');
  const [page, setPage] = useState(1);

  const ruta = rutasVisibles.find(r => r.id === selectedRuta);
  const rutaContratos = ruta ? contratos.filter(c => ruta.contratoIds.includes(c.id) && contratoIdsVisibles.has(c.id)) : [];

  // Lectura anterior que se usará para el contrato seleccionado (para mostrar en captura)
  const lecturaAnteriorParaCaptura = useMemo(() => {
    if (!captureContratoId) return null;
    const medidor = medidores.find(m => m.contratoId === captureContratoId);
    const lastLectura = lecturasVisibles.filter(l => l.contratoId === captureContratoId).sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))[0];
    return lastLectura ? lastLectura.lecturaActual : (medidor?.lecturaInicial ?? 0);
  }, [captureContratoId, medidores, lecturasVisibles]);

  const handleCapture = () => {
    if (useApi) return;
    const medidor = medidores.find(m => m.contratoId === captureContratoId);
    const lastLectura = lecturasVisibles.filter(l => l.contratoId === captureContratoId).sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))[0];
    const anterior = lastLectura ? lastLectura.lecturaActual : (medidor?.lecturaInicial || 0);
    const actual = Number(lecturaActual);
    const consumo = actual - anterior;
    const esValida = consumo >= RANGO_MIN && consumo <= RANGO_MAX && actual >= anterior;
    const motivo = !esValida ? (consumo > RANGO_MAX ? 'Excede máximo zona' : consumo < RANGO_MIN ? 'Bajo mínimo' : 'Fuera de rango') : undefined;

    addLectura({
      contratoId: captureContratoId,
      rutaId: selectedRuta,
      lecturaAnterior: anterior,
      lecturaActual: actual,
      consumo,
      estado: esValida ? 'Válida' : 'No válida',
      incidencia: incidencia || motivo || '',
      fecha: new Date().toISOString().split('T')[0],
      periodo: new Date().toISOString().slice(0, 7),
      lecturaMinZona: RANGO_MIN,
      lecturaMaxZona: RANGO_MAX,
      simuladoMensual: !esValida ? Math.min(Math.max(consumo, 0), 50) : undefined,
      motivoInvalidacion: motivo,
    });
    setLecturaActual('');
    setIncidencia('');
    setCaptureContratoId('');
  };

  // Datos para gráfica por estado
  const porEstado = useMemo(() => {
    const counts = { Válida: 0, 'No válida': 0, Pendiente: 0 };
    lecturasVisibles.forEach(l => { counts[l.estado] = (counts[l.estado] ?? 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [lecturasVisibles]);

  const COLORS = { Válida: '#22c55e', 'No válida': '#ef4444', Pendiente: '#eab308' };

  // Lecturas que exceden máximo o están bajo mínimo (más recientes primero)
  const fueraRango = useMemo(() => {
    return lecturasVisibles
      .filter(l => {
        const min = l.lecturaMinZona ?? RANGO_MIN;
        const max = l.lecturaMaxZona ?? RANGO_MAX;
        return l.consumo > max || l.consumo < min;
      })
      .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '') || (b.periodo ?? '').localeCompare(a.periodo ?? ''));
  }, [lecturasVisibles]);

  // Lecturas no válidas con simulado (más recientes primero)
  const noValidasConSimulado = useMemo(() => {
    return lecturasVisibles
      .filter(l => l.estado === 'No válida')
      .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '') || (b.periodo ?? '').localeCompare(a.periodo ?? ''));
  }, [lecturasVisibles]);

  // Historial filtrado y paginado (más nuevo al más viejo)
  const historialFiltrado = useMemo(() => {
    return lecturasVisibles
      .filter(l => {
        if (filtroRuta !== 'all' && l.rutaId !== filtroRuta) return false;
        const contrato = contratos.find(c => c.id === l.contratoId);
        if (filtroZona !== 'all' && contrato?.zonaId !== filtroZona) return false;
        if (filtroContrato !== 'all' && l.contratoId !== filtroContrato) return false;
        if (filtroEstado !== 'all' && l.estado !== filtroEstado) return false;
        if (filtroPeriodo && l.periodo !== filtroPeriodo) return false;
        if (filtroFecha && l.fecha !== filtroFecha) return false;
        return true;
      })
      .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '') || (b.periodo ?? '').localeCompare(a.periodo ?? ''));
  }, [lecturasVisibles, contratos, filtroRuta, filtroZona, filtroContrato, filtroEstado, filtroPeriodo, filtroFecha]);

  const totalPages = Math.max(1, Math.ceil(historialFiltrado.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return historialFiltrado.slice(start, start + PAGE_SIZE);
  }, [historialFiltrado, page]);

  const totalValidas = lecturasVisibles.filter(l => l.estado === 'Válida').length;
  const totalNoValidas = lecturasVisibles.filter(l => l.estado === 'No válida').length;
  const totalPendientes = lecturasVisibles.filter(l => l.estado === 'Pendiente').length;

  return (
    <div>
      <PageHeader
        title="App de Lecturas"
        subtitle="Gestión centralizada de rutas, validación de consumos e historial de mediciones."
        breadcrumbs={[{ label: 'Servicios' }, { label: 'Lecturas' }]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total lecturas"
          value={lecturasVisibles.length}
          sub="En zonas asignadas"
          accent="primary"
        />
        <KpiCard
          label="Válidas"
          value={totalValidas}
          sub={lecturasVisibles.length > 0 ? `${Math.round((totalValidas / lecturasVisibles.length) * 100)}% del total` : '—'}
          accent="success"
          icon={CheckCircle2}
        />
        <KpiCard
          label="No válidas"
          value={totalNoValidas}
          sub="Requieren revisión"
          accent={totalNoValidas > 0 ? 'danger' : 'default'}
          icon={XCircle}
        />
        <KpiCard
          label="Pendientes"
          value={totalPendientes}
          sub="Sin procesar"
          accent={totalPendientes > 0 ? 'warning' : 'default'}
          icon={Clock}
        />
      </div>

      <Tabs defaultValue="captura" className="space-y-4">
        <TabsList>
          <TabsTrigger value="captura">Captura</TabsTrigger>
          <TabsTrigger value="validaciones">Validaciones</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="captura" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="bg-white rounded-xl border border-border/50 shadow-sm p-5">
              <h3 className="text-sm font-semibold mb-3">Captura de lectura</h3>
              <div className="space-y-3">
            <Select
              value={selectedRuta}
              onValueChange={(v) => {
                setSelectedRuta(v);
                setCaptureContratoId('');
              }}
            >
              <SelectTrigger><SelectValue placeholder="Seleccionar ruta" /></SelectTrigger>
              <SelectContent>{rutasVisibles.map(r => <SelectItem key={r.id} value={r.id}>{getZonaNombre(r.zonaId)} - {r.sector} ({r.lecturista})</SelectItem>)}</SelectContent>
            </Select>
                {ruta && (
                  <>
                    <Select value={captureContratoId} onValueChange={setCaptureContratoId}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar contrato" /></SelectTrigger>
                      <SelectContent>{rutaContratos.map(c => <SelectItem key={c.id} value={c.id}>{c.id} - {c.nombre}</SelectItem>)}</SelectContent>
                    </Select>
                    {lecturaAnteriorParaCaptura != null && (
                      <p className="text-sm text-muted-foreground">Lectura anterior para este contrato: <strong>{lecturaAnteriorParaCaptura} m³</strong></p>
                    )}
                    <Input type="number" placeholder="Lectura actual" value={lecturaActual} onChange={e => setLecturaActual(e.target.value)} />
                    <Input placeholder="Incidencia (opcional)" value={incidencia} onChange={e => setIncidencia(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Rango válido: {RANGO_MIN} - {RANGO_MAX} m³.</p>
                    <Button onClick={handleCapture} disabled={useApi || !captureContratoId || !lecturaActual} className="w-full">Registrar lectura</Button>
                  </>
                )}
              </div>
            </div>
            <div />
          </div>
        </TabsContent>

        <TabsContent value="validaciones" className="space-y-6">
          <h3 className="text-sm font-semibold mb-1">Lecturas por estado</h3>
          <div className="h-64 w-full max-w-md">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porEstado} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" radius={4}>
                  {porEstado.map((entry, i) => (
                    <Cell key={entry.name} fill={COLORS[entry.name as keyof typeof COLORS] ?? '#888'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h3 className="text-sm font-semibold mb-1">Fuera de rango (mín/máx zona)</h3>
          <div className="bg-white rounded-xl border border-border/50 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Contrato</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Periodo</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Consumo</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Mín zona</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Máx zona</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Estado</th>
                </tr>
              </thead>
              <tbody>
                {fueraRango.slice(0, 50).map(l => (
                  <tr key={l.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3.5 font-mono text-xs text-[#007BFF] font-medium">{l.contratoId}</td>
                    <td className="px-4 py-3.5">{l.periodo}</td>
                    <td className="px-4 py-3.5 font-semibold">{l.consumo} m³</td>
                    <td className="px-4 py-3.5">{l.lecturaMinZona ?? RANGO_MIN}</td>
                    <td className="px-4 py-3.5">{l.lecturaMaxZona ?? RANGO_MAX}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={l.estado} /></td>
                  </tr>
                ))}
                {fueraRango.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground py-4">Ninguna lectura fuera de rango</td></tr>}
              </tbody>
            </table>
          </div>

          <h3 className="text-sm font-semibold mb-1">Lecturas no válidas (simulado mensual / mínimo zona)</h3>
          <div className="bg-white rounded-xl border border-border/50 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Contrato</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Periodo</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Consumo</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Simulado mensual</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Motivo</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Estado</th>
                </tr>
              </thead>
              <tbody>
                {noValidasConSimulado.slice(0, 50).map(l => (
                  <tr key={l.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3.5 font-mono text-xs text-[#007BFF] font-medium">{l.contratoId}</td>
                    <td className="px-4 py-3.5">{l.periodo}</td>
                    <td className="px-4 py-3.5">{l.consumo} m³</td>
                    <td className="px-4 py-3.5">{l.simuladoMensual != null ? `${l.simuladoMensual} m³` : '—'}</td>
                    <td className="px-4 py-3.5 text-xs">{l.motivoInvalidacion || l.incidencia || '—'}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={l.estado} /></td>
                  </tr>
                ))}
                {noValidasConSimulado.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground py-4">No hay lecturas no válidas</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="historial" className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={filtroRuta} onValueChange={v => { setFiltroRuta(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Ruta" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las rutas</SelectItem>
                {rutasVisibles.map(r => <SelectItem key={r.id} value={r.id}>{getZonaNombre(r.zonaId)} - {r.sector}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroZona} onValueChange={v => { setFiltroZona(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Zona" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {zonas.map(z => <SelectItem key={z.id} value={z.id}>{z.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroContrato} onValueChange={v => { setFiltroContrato(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Contrato" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {contratos.map(c => <SelectItem key={c.id} value={c.id}>{c.id}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroEstado} onValueChange={v => { setFiltroEstado(v); setPage(1); }}>
              <SelectTrigger className="w-[130px]"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="Válida">Válida</SelectItem>
                <SelectItem value="No válida">No válida</SelectItem>
                <SelectItem value="Pendiente">Pendiente</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Periodo (YYYY-MM)" className="w-32" value={filtroPeriodo} onChange={e => { setFiltroPeriodo(e.target.value); setPage(1); }} />
            <Input placeholder="Fecha" type="date" className="w-40" value={filtroFecha} onChange={e => { setFiltroFecha(e.target.value); setPage(1); }} />
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm"><SlidersHorizontal className="h-4 w-4 mr-1" /> Filtrar</Button>
              <Button variant="ghost" size="sm">Exportar</Button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border/50 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Contrato</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Ruta</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Anterior</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Actual</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Consumo</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Estado</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Periodo</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 bg-muted/40">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(l => {
                  const r = rutasVisibles.find(x => x.id === l.rutaId) ?? rutas.find(x => x.id === l.rutaId);
                  return (
                    <tr key={l.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3.5 font-mono text-xs text-[#007BFF] font-medium">{l.contratoId}</td>
                      <td className="px-4 py-3.5 text-xs">{r ? getZonaNombre(r.zonaId) : l.rutaId}</td>
                      <td className="px-4 py-3.5">{l.lecturaAnterior}</td>
                      <td className="px-4 py-3.5">{l.lecturaActual}</td>
                      <td className="px-4 py-3.5 font-semibold">{l.consumo} m³</td>
                      <td className="px-4 py-3.5"><StatusBadge status={l.estado} /></td>
                      <td className="px-4 py-3.5">{l.periodo}</td>
                      <td className="px-4 py-3.5 text-muted-foreground">{l.fecha}</td>
                    </tr>
                  );
                })}
                {paginated.length === 0 && <tr><td colSpan={8} className="text-center text-muted-foreground py-8">Sin resultados</td></tr>}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => { e.preventDefault(); if (page > 1) setPage(p => p - 1); }}
                    className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = i + 1;
                  return (
                    <PaginationItem key={p}>
                      <PaginationLink isActive={page === p} href="#" onClick={(e) => { e.preventDefault(); setPage(p); }}>{p}</PaginationLink>
                    </PaginationItem>
                  );
                })}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => { e.preventDefault(); if (page < totalPages) setPage(p => p + 1); }}
                    className={page >= totalPages ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
          <p className="text-sm text-muted-foreground">Mostrando {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, historialFiltrado.length)} de {historialFiltrado.length}</p>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Lecturas;
