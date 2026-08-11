import { Fragment, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Filter, Search } from 'lucide-react';
import {
  useData,
  TIPOS_AJUSTE_FACTURACION,
  type TipoAjusteFacturacionId,
  type AjusteFacturaParams,
  type AjusteFacturaRegistro,
} from '@/context/DataContext';
import { hasApi } from '@/api/client';
import { fetchAjustesTarifarios, crearAjusteTarifario } from '@/api/tarifas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import StatusBadge from '@/components/StatusBadge';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

function formatFecha(iso: string) {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

/** Entrada de kardex normalizada (proviene del backend o de los registros locales) */
interface KardexRow {
  id: string;
  fecha: string;
  tipoLabel: string;
  area: string;
  detalle: string;
  totalAnterior: number;
  totalNuevo: number;
  observacion?: string;
  /** El ajuste se aplicó a la prefactura pero el POST al servidor falló */
  sinSincronizar?: boolean;
}

/** Resumen legible del cambio que produjo un ajuste local */
function detalleAjusteLocal(a: AjusteFacturaRegistro) {
  if (a.consumoNuevo != null) return `Consumo ${a.consumoAnterior ?? '—'} → ${a.consumoNuevo} m³`;
  if (a.descuentoAplicado != null) return `Descuento ${formatCurrency(a.descuentoAplicado)}`;
  if (a.tipoAjusteId === 'corte_reconexion') return 'Corte / Reconexión — solo registro';
  return '—';
}

type FiltroAjuste = 'todas' | 'con' | 'sin';
const PILLS: { value: FiltroAjuste; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'con', label: 'Con ajuste' },
  { value: 'sin', label: 'Sin ajuste' },
];

const AjustesFacturacion = () => {
  const useApi = hasApi();
  const {
    preFacturas,
    contratos,
    aplicarAjusteFactura,
    ajustesFactura,
    calcularTarifa,
    timbrados,
  } = useData();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [contratoIdFilter, setContratoIdFilter] = useState<string>('');
  const [busqueda, setBusqueda] = useState('');
  const [filtroAjuste, setFiltroAjuste] = useState<FiltroAjuste>('todas');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [filtroPeriodo, setFiltroPeriodo] = useState('todos');
  const [expandidos, setExpandidos] = useState<string[]>([]);
  const [preFacturaSeleccionada, setPreFacturaSeleccionada] = useState<typeof preFacturas[0] | null>(null);
  const [tipoAjusteId, setTipoAjusteId] = useState<TipoAjusteFacturacionId | ''>('');
  const [consumoM3, setConsumoM3] = useState('');
  const [descuentoAdicional, setDescuentoAdicional] = useState('');
  const [observacion, setObservacion] = useState('');
  const [mensaje, setMensaje] = useState<'ok' | 'error' | null>(null);
  const [enviando, setEnviando] = useState(false);
  /** Ajustes ya aplicados a la prefactura cuyo registro en el servidor falló (solo en memoria) */
  const [ajustesNoSincronizados, setAjustesNoSincronizados] = useState<(KardexRow & { preFacturaId: string })[]>([]);

  const { data: ajustesApi = [] } = useQuery({
    queryKey: ['ajustes-tarifarios'],
    queryFn: () => fetchAjustesTarifarios(),
    enabled: useApi,
  });

  const crearAjusteMut = useMutation({
    mutationFn: crearAjusteTarifario,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ajustes-tarifarios'] }),
  });

  const preFacturasNoTimbradas = useMemo(
    () => preFacturas.filter(
      (pf) => !timbrados.some((t) => t.preFacturaId === pf.id)
    ),
    [preFacturas, timbrados]
  );

  /** Kardex por prefactura: backend (contrato + periodo) o registros locales en modo demo */
  const kardexPorPreFactura = useMemo(() => {
    const map = new Map<string, KardexRow[]>();
    /** Los ajustes que no llegaron al servidor se muestran igual, marcados como sin sincronizar */
    const agregarNoSincronizados = () => {
      for (const { preFacturaId, ...row } of ajustesNoSincronizados) {
        const arr = map.get(preFacturaId);
        if (arr) arr.push(row);
        else map.set(preFacturaId, [row]);
      }
      return map;
    };
    if (useApi) {
      const porClave = new Map<string, KardexRow[]>();
      for (const a of ajustesApi) {
        const meta = TIPOS_AJUSTE_FACTURACION.find((t) => t.id === a.tipo);
        const row: KardexRow = {
          id: a.id,
          fecha: a.createdAt,
          tipoLabel: meta?.label ?? a.tipo,
          area: meta?.area ?? '—',
          detalle: a.concepto,
          totalAnterior: Number(a.montoOriginal),
          totalNuevo: Number(a.montoAjustado),
          observacion: a.motivo,
        };
        const clave = `${a.contratoId}|${a.periodo}`;
        const arr = porClave.get(clave);
        if (arr) arr.push(row);
        else porClave.set(clave, [row]);
      }
      for (const pf of preFacturasNoTimbradas) {
        const rows = porClave.get(`${pf.contratoId}|${pf.periodo}`);
        if (rows?.length) map.set(pf.id, rows);
      }
      return agregarNoSincronizados();
    }
    for (const a of ajustesFactura) {
      const row: KardexRow = {
        id: a.id,
        fecha: a.fecha,
        tipoLabel: a.tipoLabel,
        area: a.area || '—',
        detalle: detalleAjusteLocal(a),
        totalAnterior: a.totalAnterior,
        totalNuevo: a.totalNuevo,
        observacion: a.observacion,
      };
      const arr = map.get(a.preFacturaId);
      if (arr) arr.push(row);
      else map.set(a.preFacturaId, [row]);
    }
    return agregarNoSincronizados();
  }, [useApi, ajustesApi, ajustesFactura, preFacturasNoTimbradas, ajustesNoSincronizados]);

  const estadosDisponibles = useMemo(
    () => Array.from(new Set(preFacturasNoTimbradas.map((pf) => pf.estado))),
    [preFacturasNoTimbradas]
  );
  const periodosDisponibles = useMemo(
    () => Array.from(new Set(preFacturasNoTimbradas.map((pf) => pf.periodo))).sort(),
    [preFacturasNoTimbradas]
  );

  const hasFiltrosActivos =
    Boolean(contratoIdFilter) ||
    busqueda.trim() !== '' ||
    filtroAjuste !== 'todas' ||
    filtroEstado !== 'todos' ||
    filtroPeriodo !== 'todos';

  const limpiarFiltros = () => {
    setContratoIdFilter('');
    setBusqueda('');
    setFiltroAjuste('todas');
    setFiltroEstado('todos');
    setFiltroPeriodo('todos');
  };

  const preFacturasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return preFacturasNoTimbradas.filter((pf) => {
      if (contratoIdFilter && pf.contratoId !== contratoIdFilter) return false;
      if (filtroEstado !== 'todos' && pf.estado !== filtroEstado) return false;
      if (filtroPeriodo !== 'todos' && pf.periodo !== filtroPeriodo) return false;
      const numAjustes = kardexPorPreFactura.get(pf.id)?.length ?? 0;
      if (filtroAjuste === 'con' && numAjustes === 0) return false;
      if (filtroAjuste === 'sin' && numAjustes > 0) return false;
      if (q) {
        const nombre = contratos.find((c) => c.id === pf.contratoId)?.nombre ?? '';
        if (!`${pf.id} ${pf.contratoId} ${nombre}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [
    preFacturasNoTimbradas,
    contratoIdFilter,
    filtroEstado,
    filtroPeriodo,
    filtroAjuste,
    busqueda,
    kardexPorPreFactura,
    contratos,
  ]);

  const toggleExpandido = (id: string) =>
    setExpandidos((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const abrirDialogo = (pf: typeof preFacturas[0]) => {
    setPreFacturaSeleccionada(pf);
    setTipoAjusteId('');
    setConsumoM3(String(pf.consumoM3));
    setDescuentoAdicional('');
    setObservacion('');
    setMensaje(null);
  };

  const cerrarDialogo = () => {
    setPreFacturaSeleccionada(null);
    setTipoAjusteId('');
    setMensaje(null);
    setEnviando(false);
  };

  /** Persiste el ajuste como AjusteTarifario (contrato + periodo, monto original → ajustado) */
  const registrarAjusteEnServidor = (
    pf: typeof preFacturas[0],
    tipo: TipoAjusteFacturacionId,
    params: AjusteFacturaParams
  ) => {
    const meta = TIPOS_AJUSTE_FACTURACION.find((t) => t.id === tipo);
    const label = meta?.label ?? tipo;
    let concepto = `${label} (solo registro)`;
    let totalNuevo = pf.total;
    if ((tipo === 'actualizacion_datos' || tipo === 'correccion_lectura') && params.consumoM3 != null) {
      const contrato = contratos.find((c) => c.id === pf.contratoId);
      // mismo algoritmo que aplicarAjusteFactura para conocer el total resultante
      const { subtotal, cargoFijo } = calcularTarifa(contrato?.tipoServicio ?? '', params.consumoM3);
      totalNuevo = Math.max(0, subtotal + cargoFijo - pf.descuento);
      concepto = `${label}: consumo ${pf.consumoM3} → ${params.consumoM3} m³`;
    } else if (tipo !== 'corte_reconexion') {
      const descuento = params.descuentoAdicional ?? 0;
      totalNuevo = Math.max(0, pf.total - descuento);
      concepto = `${label}: descuento adicional ${formatCurrency(descuento)}`;
    }
    const motivo = observacion || label;
    crearAjusteMut.mutate(
      {
        contratoId: pf.contratoId,
        periodo: pf.periodo,
        tipo,
        concepto,
        montoOriginal: pf.total,
        montoAjustado: totalNuevo,
        motivo,
      },
      {
        onError: (err: Error) => {
          setAjustesNoSincronizados((prev) => [
            ...prev,
            {
              id: `sin-sync-${pf.id}-${Date.now()}`,
              preFacturaId: pf.id,
              fecha: new Date().toISOString(),
              tipoLabel: label,
              area: meta?.area ?? '—',
              detalle: concepto,
              totalAnterior: pf.total,
              totalNuevo,
              observacion: motivo,
              sinSincronizar: true,
            },
          ]);
          toast({
            title: 'El ajuste se aplicó a la prefactura pero no se pudo guardar en el servidor',
            description: err.message,
            variant: 'destructive',
          });
        },
      }
    );
  };

  const enviarAjuste = () => {
    if (!preFacturaSeleccionada || !tipoAjusteId || enviando) return;
    setEnviando(true);
    const pf = preFacturaSeleccionada;
    const tipo = tipoAjusteId as TipoAjusteFacturacionId;
    const params: AjusteFacturaParams = {
      tipoAjusteId: tipo,
      preFacturaId: pf.id,
      observacion: observacion || undefined,
    };
    if (consumoM3 !== '' && !Number.isNaN(Number(consumoM3))) {
      params.consumoM3 = Number(consumoM3);
    }
    if (descuentoAdicional !== '' && !Number.isNaN(Number(descuentoAdicional))) {
      params.descuentoAdicional = Number(descuentoAdicional);
    }
    const ok = aplicarAjusteFactura(params);
    setMensaje(ok ? 'ok' : 'error');
    if (!ok) {
      setEnviando(false);
      return;
    }
    if (useApi) registrarAjusteEnServidor(pf, tipo, params);
    setTimeout(cerrarDialogo, 1200);
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Ajustes a la facturación</h1>
      </div>

      <div className="widget-card">
        <h2 className="section-title">Catálogo de tipos de ajuste</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Cada tipo de ajuste aplica un algoritmo distinto al modificar la factura (actualización de datos, corrección por lectura, descuento por área, etc.).
        </p>
        <div className="overflow-x-auto min-w-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Área</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TIPOS_AJUSTE_FACTURACION.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.label}</TableCell>
                  <TableCell className="text-muted-foreground">{t.area}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="widget-card">
        <h2 className="section-title">Modificar factura (prefactura)</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Seleccione una prefactura no timbrada y el tipo de ajuste; se aplicará el algoritmo correspondiente.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por ID o contrato…"
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="inline-flex rounded-md border p-0.5">
            {PILLS.map((p) => (
              <Button
                key={p.value}
                variant={filtroAjuste === p.value ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setFiltroAjuste(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Select value={contratoIdFilter || 'all'} onValueChange={(v) => setContratoIdFilter(v === 'all' ? '' : v)}>
            <SelectTrigger id="ajuste-contrato" className="h-8 text-sm w-40">
              <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Contrato" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los contratos</SelectItem>
              {contratos.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filtroEstado} onValueChange={setFiltroEstado}>
            <SelectTrigger className="h-8 text-sm w-40">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {estadosDisponibles.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filtroPeriodo} onValueChange={setFiltroPeriodo}>
            <SelectTrigger className="h-8 text-sm w-36">
              <SelectValue placeholder="Periodo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los periodos</SelectItem>
              {periodosDisponibles.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {preFacturasFiltradas.length} de {preFacturasNoTimbradas.length} prefacturas
          </span>
          {hasFiltrosActivos && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={limpiarFiltros}
            >
              Limpiar filtros
            </Button>
          )}
        </div>
        <div className="overflow-x-auto min-w-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Contrato</TableHead>
                <TableHead>Periodo</TableHead>
                <TableHead>Consumo m³</TableHead>
                <TableHead>Subtotal</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preFacturasFiltradas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    {preFacturasNoTimbradas.length === 0 ? (
                      'No hay prefacturas pendientes de timbrar para ajustar.'
                    ) : (
                      <>
                        Sin resultados para los filtros aplicados.{' '}
                        <button type="button" className="underline" onClick={limpiarFiltros}>
                          limpiar filtros
                        </button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                preFacturasFiltradas.map((pf) => {
                  const kardex = kardexPorPreFactura.get(pf.id) ?? [];
                  const abierto = expandidos.includes(pf.id);
                  return (
                    <Fragment key={pf.id}>
                      <TableRow>
                        <TableCell className="p-0 pl-2">
                          {kardex.length > 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              aria-label={abierto ? 'Ocultar kardex' : 'Ver kardex de ajustes'}
                              onClick={() => toggleExpandido(pf.id)}
                            >
                              {abierto
                                ? <ChevronDown className="h-4 w-4" />
                                : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{pf.id}</TableCell>
                        <TableCell>{pf.contratoId}</TableCell>
                        <TableCell>{pf.periodo}</TableCell>
                        <TableCell className="tabular-nums">{pf.consumoM3}</TableCell>
                        <TableCell className="tabular-nums">{formatCurrency(pf.subtotal)}</TableCell>
                        <TableCell className="tabular-nums">{formatCurrency(pf.total)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={pf.estado} />
                            {kardex.length > 0 && (
                              <Badge variant="secondary" className="text-[10px] font-medium">
                                Ajustado ({kardex.length})
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => abrirDialogo(pf)}>
                            Ajustar
                          </Button>
                        </TableCell>
                      </TableRow>
                      {abierto && kardex.length > 0 && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={9} className="py-3">
                            <p className="text-xs font-semibold mb-2">Kardex de ajustes</p>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs h-8">Fecha</TableHead>
                                  <TableHead className="text-xs h-8">Tipo de ajuste</TableHead>
                                  <TableHead className="text-xs h-8">Área</TableHead>
                                  <TableHead className="text-xs h-8">Detalle</TableHead>
                                  <TableHead className="text-xs h-8">Total</TableHead>
                                  <TableHead className="text-xs h-8">Observación</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {kardex.map((a) => (
                                  <TableRow key={a.id}>
                                    <TableCell className="text-xs whitespace-nowrap">{formatFecha(a.fecha)}</TableCell>
                                    <TableCell className="text-xs">
                                      {a.tipoLabel}
                                      {a.sinSincronizar && (
                                        <span className="ml-1 text-destructive">(sin sincronizar)</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{a.area}</TableCell>
                                    <TableCell className="text-xs">{a.detalle}</TableCell>
                                    <TableCell className="text-xs tabular-nums whitespace-nowrap">
                                      {formatCurrency(a.totalAnterior)} → {formatCurrency(a.totalNuevo)}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{a.observacion || '—'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!preFacturaSeleccionada} onOpenChange={(open) => !open && cerrarDialogo()}>
        <DialogContent className="sm:max-w-md" aria-describedby="ajuste-desc">
          <DialogHeader>
            <DialogTitle>Aplicar ajuste a prefactura</DialogTitle>
            <DialogDescription id="ajuste-desc">
              {preFacturaSeleccionada && (
                <>Prefactura {preFacturaSeleccionada.id} · Contrato {preFacturaSeleccionada.contratoId} · Periodo {preFacturaSeleccionada.periodo}</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label htmlFor="tipo-ajuste">Tipo de ajuste</Label>
              <Select value={tipoAjusteId} onValueChange={(v) => setTipoAjusteId(v as TipoAjusteFacturacionId)}>
                <SelectTrigger id="tipo-ajuste">
                  <SelectValue placeholder="Seleccione tipo" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_AJUSTE_FACTURACION.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label} ({t.area})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(tipoAjusteId === 'actualizacion_datos' || tipoAjusteId === 'correccion_lectura') && (
              <div>
                <Label htmlFor="consumo-m3">Nuevo consumo (m³)</Label>
                <Input
                  id="consumo-m3"
                  type="number"
                  min={0}
                  value={consumoM3}
                  onChange={(e) => setConsumoM3(e.target.value)}
                />
              </div>
            )}
            {(tipoAjusteId === 'deuda' || tipoAjusteId === 'juridica' || tipoAjusteId === 'convenio' || tipoAjusteId === 'atencion_publico') && (
              <div>
                <Label htmlFor="descuento">Descuento adicional (MXN)</Label>
                <Input
                  id="descuento"
                  type="number"
                  min={0}
                  value={descuentoAdicional}
                  onChange={(e) => setDescuentoAdicional(e.target.value)}
                />
              </div>
            )}
            <div>
              <Label htmlFor="observacion">Observación</Label>
              <Input
                id="observacion"
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                placeholder="Motivo del ajuste (opcional)"
              />
            </div>
          </div>
          <DialogFooter>
            {mensaje === 'ok' && <span className="text-sm text-green-600">Ajuste aplicado.</span>}
            {mensaje === 'error' && <span className="text-sm text-destructive">No se pudo aplicar el ajuste.</span>}
            <Button variant="outline" onClick={cerrarDialogo}>Cancelar</Button>
            <Button onClick={enviarAjuste} disabled={!tipoAjusteId || enviando}>Aplicar ajuste</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AjustesFacturacion;
