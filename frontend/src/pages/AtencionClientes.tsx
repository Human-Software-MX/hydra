import { useState, useMemo, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, BookOpen, Copy, ExternalLink, FileText, FileWarning, ListChecks, MessageSquare, Plus, RefreshCw, Search, User } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import StatusBadge from '@/components/StatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import BusquedaContrato from './atencion/BusquedaContrato';
import ContextoRapido from './atencion/ContextoRapido';
import TabQuejas from './atencion/TabQuejas';
import QuejaDialog from './atencion/QuejaDialog';
import QuejaDetalle from './atencion/QuejaDetalle';
import type { QuejaAclaracion, QuejaAreaAsignada, SeguimientoTipo } from '@/context/DataContext';
import type { ContratoSearch } from '@/api/atencion';
import { updateQueja, addSeguimientoQueja } from '@/api/atencion';
import { fetchContrato, type ContratoDto } from '@/api/contratos';
import { fetchOrdenesByContrato, updateOrdenEstado, type OrdenDto } from '@/api/ordenes';
import SeguimientoPanel from '@/components/SeguimientoPanel';
import { usePermissions } from '@/hooks/usePermissions';

// --- Types for Atención a Clientes (view / mock) ---
export interface OrdenRow {
  id: string;
  contratoId: string;
  fechaOrden: string;
  estadoOrden: string;
  tipoOrden: string;
  motivoOrden: string;
  generaOrden: string;
  fechaEjecucion: string;
  fechaCertificacion: string;
  observaciones: string;
}

export interface ObservacionRow {
  quien: string;
  fecha: string;
  observacion: string;
  vigencia: string;
}

export interface PagoOperacionRow {
  operacion: string;
  oficinaPago: string;
  fechaPago: string;
  horaPago: string;
  formaPago: string;
  tipoOperacion: string;
  importePago: number;
  uuidTimbrado: string;
  fechaTimbrado: string;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Mock data per contrato for Observaciones, PagoOperacion

const MOCK_OBSERVACIONES: ObservacionRow[] = [
  { quien: 'CONVERSION', fecha: '2019-07-28', observacion: '442 245 13 52', vigencia: '' },
  { quien: 'CONVERSION', fecha: '2019-07-28', observacion: 'Activa Habitada', vigencia: '' },
  { quien: 'CONVERSION', fecha: '2019-07-28', observacion: 'ARBUSTO NO 19', vigencia: '' },
];

function buildPagoOperacionRows(
  pagos: { id: string; contratoId: string; monto: number; fecha: string; tipo: string }[],
  timbrados: { id: string; contratoId: string; uuid: string; fecha: string }[],
  contratoId: string
): PagoOperacionRow[] {
  const filtered = pagos.filter((p) => p.contratoId === contratoId);
  return filtered.map((p, i) => {
    const t = timbrados.find((x) => x.contratoId === contratoId);
    return {
      operacion: String(108506539 - i),
      oficinaPago: i === 0 ? 'MATRIZ AMEALCO CAJA 1' : 'OFICINA CENTRAL CEA',
      fechaPago: p.fecha,
      horaPago: i === 0 ? '11:44:27' : '15:29:12',
      formaPago: 'METALICO',
      tipoOperacion: 'COBRO',
      importePago: p.monto,
      uuidTimbrado: t?.uuid ?? '—',
      fechaTimbrado: t?.fecha ?? p.fecha,
    };
  });
}

const TAB_VALUES = ['general', 'facturas', 'lecturas', 'ordenes', 'pagos', 'observaciones', 'convenios', 'quejas'] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(s: string | null): s is TabValue {
  return s !== null && TAB_VALUES.includes(s as TabValue);
}

const AtencionClientes = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    contratos,
    medidores,
    rutas,
    zonas,
    distritos,
    administraciones,
    lecturas,
    timbrados,
    recibos,
    preFacturas,
    pagos,
    pagosParcialidad,
    tramitesAsignados,
    clausulasContrato,
    costosContrato,
    convenios,
    addConvenio,
    quejasAclaraciones,
    addQuejaAclaracion,
    updateContrato,
    updateMedidor,
    tarifas,
    calcularTarifa,
  } = useData();

  const { can } = usePermissions();

  const [contratoInput, setContratoInput] = useState('');
  const [contratoId, setContratoId] = useState<string | null>(null);

  const tabFromUrl = searchParams.get('tab');
  const activeTab = isTabValue(tabFromUrl) ? tabFromUrl : 'general';
  const setActiveTab = useCallback(
    (value: string) => {
      if (!isTabValue(value)) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === 'general') next.delete('tab');
          else next.set('tab', value);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [detalleFacturaId, setDetalleFacturaId] = useState<string | null>(null);
  const [detalleLecturaPeriodo, setDetalleLecturaPeriodo] = useState<string | null>(null);
  const [detalleOrdenId, setDetalleOrdenId] = useState<string | null>(null);
  const [detallePagoKey, setDetallePagoKey] = useState<string | null>(null);
  const [detalleObservacionIndex, setDetalleObservacionIndex] = useState<number | null>(null);
  const [convenioDialogOpen, setConvenioDialogOpen] = useState(false);
  const [newConvenio, setNewConvenio] = useState({ tipo: '', area: 'Atención a clientes' as const, importeTotal: '', numeroParcialidades: '1', fechaInicio: '', fechaVencimiento: '', observaciones: '' });
  const [bajaTemporalDialogOpen, setBajaTemporalDialogOpen] = useState(false);
  const [bajaDefinitivaDialogOpen, setBajaDefinitivaDialogOpen] = useState(false);
  const [fechaReconexionPrevista, setFechaReconexionPrevista] = useState('');
  const [tramiteSeguimientoId, setTramiteSeguimientoId] = useState<string | null>(null);
  const [quejaDialogOpen, setQuejaDialogOpen] = useState(false);
  const [quejaDetalleOpen, setQuejaDetalleOpen] = useState(false);
  const [quejaSeleccionada, setQuejaSeleccionada] = useState<QuejaAclaracion | null>(null);
  const [quejaRefreshKey, setQuejaRefreshKey] = useState(0);
  const [contratoSeleccionadoSearch, setContratoSeleccionadoSearch] = useState<ContratoSearch | null>(null);
  /** URL para el modal grande de foto/sistema externo de lectura */
  const [lecturaModalUrl, setLecturaModalUrl] = useState<string | null>(null);
  const [contratoFromApi, setContratoFromApi] = useState<ContratoDto | null>(null);
  const [ordenesApi, setOrdenesApi] = useState<OrdenDto[] | null>(null);
  const [ordenesLoading, setOrdenesLoading] = useState(false);
  const [ordenesRefreshKey, setOrdenesRefreshKey] = useState(0);

  useEffect(() => {
    if (contratos.length && !contratoId) {
      setContratoId(contratos[0].id);
      setContratoInput(contratos[0].id);
    }
  }, [contratos, contratoId]);

  const contratoFromMock = useMemo(
    () => (contratoId ? contratos.find((c) => c.id === contratoId) ?? null : null),
    [contratos, contratoId]
  );

  // Cuando el contratoId no está en el mock (contrato real de la BD), cargarlo via API
  useEffect(() => {
    if (contratoId && !contratoFromMock) {
      fetchContrato(contratoId)
        .then(setContratoFromApi)
        .catch(() => setContratoFromApi(null));
    } else {
      setContratoFromApi(null);
    }
  }, [contratoId, contratoFromMock]);

  // Load real orders from API when contratoId or tab changes
  useEffect(() => {
    if (!contratoId) return;
    setOrdenesLoading(true);
    fetchOrdenesByContrato(contratoId)
      .then(setOrdenesApi)
      .catch(() => setOrdenesApi(null))
      .finally(() => setOrdenesLoading(false));
  }, [contratoId, ordenesRefreshKey]);

  const contrato = contratoFromMock ?? contratoFromApi;

  const handleBuscar = () => {
    const id = contratoInput.trim().toUpperCase();
    const found = contratos.some((c) => c.id.toUpperCase() === id);
    setContratoId(found ? id : contratoId ?? contratos[0]?.id ?? null);
    if (!found && contratos.length) setContratoInput(contratos[0].id);
  };

  const medidor = useMemo(
    () => (contrato?.medidorId ? medidores.find((m) => m.id === contrato.medidorId) : null),
    [contrato, medidores]
  );
  const ruta = useMemo(
    () => (contrato?.rutaId ? rutas.find((r) => r.id === contrato.rutaId) : null),
    [contrato, rutas]
  );
  const zona = useMemo(
    () => (contrato?.zonaId ? zonas.find((z) => z.id === contrato.zonaId) : null),
    [contrato, zonas]
  );
  const distrito = useMemo(
    () => (zona?.distritoIds?.[0] ? distritos.find((d) => d.id === zona.distritoIds[0]) : null),
    [zona, distritos]
  );
  const administracion = useMemo(
    () => (zona ? administraciones.find((a) => a.id === zona.administracionId) : null),
    [zona, administraciones]
  );

  const facturasRows = useMemo(() => {
    if (!contratoId) return [];
    return timbrados
      .filter((t) => t.contratoId === contratoId)
      .map((t) => {
        const recibo = recibos.find((r) => r.timbradoId === t.id);
        const pf = preFacturas.find((p) => p.id === t.preFacturaId);
        const total = recibo ? recibo.saldoVigente + recibo.saldoVencido : pf?.total ?? 0;
        const periodo = pf?.periodo ?? '';
        const periodoDisplay = periodo ? periodo.replace(/-(\d{2})$/, '/$1') : '—';
        return {
          idFactura: t.id,
          periodo,
          periodoDisplay,
          fechaFac: t.fecha,
          vencimiento: recibo?.fechaVencimiento ?? '—',
          noFactura: `W12024A101119952`,
          importe: total,
          estado: recibo ? 'COBRADA' : 'PENDIENTE',
          motivo: 'Periodica',
          origen: 'Lecturas-Facturar',
          causaAbonoRefactura: '',
          uuid: t.uuid,
          fechaTimbrado: t.fecha,
        };
      })
      .sort((a, b) => (b.periodo ?? '').localeCompare(a.periodo ?? ''));
  }, [contratoId, timbrados, recibos, preFacturas]);

  const lecturasRows = useMemo(() => {
    if (!contratoId) return [];
    return lecturas
      .filter((l) => l.contratoId === contratoId)
      .map((l) => {
        const [y, m] = (l.periodo ?? '').split('-');
        const periodoDisplay = y && m ? `${y}/${parseInt(m, 10)}` : '—';
        const fechaLecAnt = l.fecha ? `${l.fecha.slice(0, 8)}01` : '—';
        const dias = 29;
        return {
          periodo: l.periodo,
          periodoDisplay,
          fechaLec: l.fecha,
          fechaLecAnt,
          dias,
          lectura: l.lecturaActual,
          consumo: l.consumo,
          origen: 'L - Lectura',
          observacion: '',
          metodoVerificacion: '',
          metodoEstimacion: '',
          ajusteEstimado: 0,
          bolsa: 0,
          averia: 'NO',
          usuario: 'JNUNEZ',
          urlFoto: 'https://lectura.ceaqueretaro.gob.mx/imagen.php?id=' + l.id,
        };
      })
      .sort((a, b) => (b.periodo ?? '').localeCompare(a.periodo ?? ''));
  }, [contratoId, lecturas]);

  const observacionesRows = useMemo(
    () => (contratoId ? MOCK_OBSERVACIONES : []),
    [contratoId]
  );
  const pagosOperacionRows = useMemo(
    () =>
      contratoId
        ? buildPagoOperacionRows(pagos, timbrados, contratoId)
        : [],
    [contratoId, pagos, timbrados]
  );

  const parcialidadesVencidas = useMemo(() => {
    if (!contratoId) return 0;
    const pp = pagosParcialidad.filter(
      (p) => p.contratoId === contratoId && p.estado === 'Pendiente'
    );
    const hoy = new Date().toISOString().split('T')[0];
    return pp.filter((p) => p.fechaVencimiento < hoy).reduce((s, p) => s + p.monto, 0);
  }, [contratoId, pagosParcialidad]);

  const deudaTotal = useMemo(() => {
    if (!contratoId) return { importeServicios: 0, iva: 0, recargos: 0, saldoFavor: 0, total: 0 };
    const recs = recibos.filter((r) => r.contratoId === contratoId);
    // saldoVencido es arrastre de recibos anteriores: sumarlo por recibo duplicaría la deuda
    const totalRecibos = recs.reduce((s, r) => s + r.saldoVigente, 0);
    const totalPagos = pagos.filter((p) => p.contratoId === contratoId).reduce((s, p) => s + p.monto, 0);
    const saldo = totalRecibos - totalPagos;
    const importeServicios = totalRecibos;
    const iva = Math.round(importeServicios * 0.16 * 100) / 100;
    return {
      importeServicios,
      iva,
      recargos: 0,
      saldoFavor: saldo < 0 ? Math.abs(saldo) : 0,
      total: Math.max(0, saldo),
    };
  }, [contratoId, recibos, pagos]);

  const tramitesDelContrato = useMemo(
    () => (contratoId ? tramitesAsignados.filter((t) => t.contratoId === contratoId).sort((a, b) => a.fechaAsignacion.localeCompare(b.fechaAsignacion)) : []),
    [contratoId, tramitesAsignados]
  );
  const clausulasDelContrato = useMemo(
    () => (contratoId ? clausulasContrato.filter((c) => c.contratoId === contratoId).sort((a, b) => a.orden - b.orden) : []),
    [contratoId, clausulasContrato]
  );
  const conceptosFacturacion = useMemo(() => {
    if (!contrato || !contratoId) return [];
    const ultimaPf = preFacturas.filter((p) => p.contratoId === contratoId).sort((a, b) => b.periodo.localeCompare(a.periodo))[0];
    if (!ultimaPf) {
      const { subtotal, cargoFijo, total } = calcularTarifa(contrato.tipoServicio, 0);
      return [
        { concepto: 'Cargo fijo', importe: cargoFijo, periodo: '—' },
        { concepto: 'Consumo (m³)', importe: 0, periodo: '—' },
        { concepto: 'Subtotal', importe: subtotal, periodo: '—' },
        { concepto: 'Total', importe: total, periodo: '—' },
      ];
    }
    const { cargoFijo } = calcularTarifa(contrato.tipoServicio, ultimaPf.consumoM3);
    const subtotalConsumo = ultimaPf.subtotal - cargoFijo;
    return [
      { concepto: 'Cargo fijo', importe: cargoFijo, periodo: ultimaPf.periodo },
      { concepto: 'Consumo (m³)', importe: subtotalConsumo, periodo: ultimaPf.periodo },
      { concepto: 'Subtotal', importe: ultimaPf.subtotal, periodo: ultimaPf.periodo },
      { concepto: 'Descuento', importe: ultimaPf.descuento, periodo: ultimaPf.periodo },
      { concepto: 'Total', importe: ultimaPf.total, periodo: ultimaPf.periodo },
    ];
  }, [contratoId, contrato, preFacturas, calcularTarifa]);
  const variablesFacturacion = useMemo(() => {
    if (!contrato) return [];
    const tipo = contrato.tipoServicio === 'Doméstico' ? 'Doméstico' : contrato.tipoServicio === 'Comercial' ? 'Comercial' : 'Industrial';
    const aplicables = tarifas.filter((t) => t.tipo === tipo);
    const tarifa = aplicables[0];
    return [
      { nombre: 'Tarifa aplicada', valor: `DOMÉSTICA ${contrato.tipoServicio}` },
      { nombre: 'Zona facturación', valor: contrato.zonaId ? zona?.nombre ?? contrato.zonaId : '—' },
      { nombre: 'Cargo fijo', valor: tarifa ? formatCurrency(tarifa.cargoFijo) : '—' },
      { nombre: 'Precio por m³ (rango aplicable)', valor: tarifa ? `${formatCurrency(tarifa.precioPorM3)} (${tarifa.rangoMin}-${tarifa.rangoMax} m³)` : '—' },
    ];
  }, [contrato, tarifas, zona]);
  const costosDelContrato = useMemo(
    () => (contratoId ? costosContrato.filter((c) => c.contratoId === contratoId) : []),
    [contratoId, costosContrato]
  );
  const conveniosDelContrato = useMemo(
    () => (contratoId ? convenios.filter((c) => c.contratoId === contratoId).sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio)) : []),
    [contratoId, convenios]
  );
  const quejasDelContrato = useMemo(
    () => (contratoId ? quejasAclaraciones.filter((q) => q.contratoId === contratoId).sort((a, b) => b.fecha.localeCompare(a.fecha)) : []),
    [contratoId, quejasAclaraciones]
  );

  const showContent = contrato != null;

  return (
    <div className="space-y-6">
      <div className="page-header flex-wrap gap-4">
        <h1 className="page-title">Módulo de Atención a Clientes</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <User className="h-4 w-4" />
          <span>jgodinez</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <BusquedaContrato
          contratoSeleccionado={contratoSeleccionadoSearch}
          onSelect={(c) => {
            setContratoSeleccionadoSearch(c);
            setContratoId(c.id);
            setContratoInput(c.id);
          }}
        />
        <Button variant="outline" aria-label="Consulta Sige" className="shrink-0">
          Consulta Sige
        </Button>
      </div>

      {!showContent && (
        <div className="widget-card text-center py-12 text-muted-foreground">
          Ingrese un contrato y pulse Buscar para ver la información.
        </div>
      )}

      {showContent && (
        <>
          <div
            className="rounded-lg border bg-muted/50 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
            role="region"
            aria-label="Resumen del contrato"
          >
            <span>
              <span className="text-muted-foreground">Contrato:</span>{' '}
              <strong>{contrato?.id}</strong>
            </span>
            <span className="text-muted-foreground">·</span>
            <span>
              <span className="text-muted-foreground">Titular:</span>{' '}
              <span className="min-w-0 truncate max-w-[200px] sm:max-w-none inline-block align-bottom">
                {contrato?.nombre ?? '—'}
              </span>
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground">Estado:</span>{' '}
              <StatusBadge status="Activo" />
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="tabular-nums">
              <span className="text-muted-foreground">Deuda actual:</span>{' '}
              <strong>{formatCurrency(deudaTotal.total)}</strong>
            </span>
            {parcialidadesVencidas > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="tabular-nums text-destructive font-semibold">
                  Parcialidades vencidas: {formatCurrency(parcialidadesVencidas)}
                </span>
              </>
            )}
          </div>
          {parcialidadesVencidas > 0 && (
            <Alert variant="destructive" aria-live="polite">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <AlertTitle>Parcialidades vencidas</AlertTitle>
              <AlertDescription>
                Este contrato tiene parcialidades vencidas por{' '}
                <span className="font-semibold tabular-nums">
                  {formatCurrency(parcialidadesVencidas)}
                </span>
                .
              </AlertDescription>
            </Alert>
          )}
          <ContextoRapido
            contratoId={contrato.id}
            onVerQuejas={() => setActiveTab('quejas')}
            refreshKey={quejaRefreshKey}
          />
        </>
      )}

      {showContent && (
        <TooltipProvider>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="flex flex-wrap h-auto gap-1 cursor-pointer">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="facturas">Facturas</TabsTrigger>
              <TabsTrigger value="lecturas">Lecturas</TabsTrigger>
              <TabsTrigger value="ordenes">Órdenes</TabsTrigger>
              <TabsTrigger value="pagos">Pagos</TabsTrigger>
              <TabsTrigger value="observaciones">Observaciones</TabsTrigger>
              <TabsTrigger value="convenios">Convenios de pago</TabsTrigger>
              <TabsTrigger value="quejas">Aclaraciones/Quejas</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-6">
              <Accordion type="multiple" collapsible defaultValue={['datos-contrato']} className="space-y-2">
                <AccordionItem value="datos-contrato" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Detalles de contrato
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                    <h4 className="section-subtitle">Identificación</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <Row label="Contrato" value={contrato?.id} />
                  <Row label="Contrato SIGE" value="011034644" />
                  <Row label="Administración" value={administracion?.nombre} />
                  <Row label="Fecha Alta" value={contrato?.fecha} />
                  <Row label="Tipo Contrato" value={contrato?.tipoContrato} />
                  <Row label="Estado" value={<StatusBadge status="ALIA" />} />
                  <Row label="Estado Toma" value={<StatusBadge status="Activo" />} />
                  <Row label="Fecha Baja" value="" />
                </dl>
                <h4 className="section-subtitle">Titular y toma</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <Row label="Propietario" value={contrato?.nombre} />
                  <Row label="Domicilio Toma" value={contrato?.direccion} />
                  <Row label="Tipo de Servicio" value={contrato?.tipoServicio} />
                  <Row label="No tomas contratadas" value="1" />
                </dl>
                <h4 className="section-subtitle">Ubicación</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <Row label="Distrito" value={distrito?.nombre} />
                  <Row label="Sector" value={ruta ? `S.H-006 ${ruta.sector}` : undefined} />
                  <Row label="Georeferencia" value="Latitud: 355763.4127, Longitud: 2279706.6171" />
                </dl>
                <h4 className="section-subtitle">Otros</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <Row label="Categoría" value="" />
                  <Row label="Reparte consumo" value="NO APLICA" />
                  <Row label="Actividad" value="" />
                </dl>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="tramites-asignados" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Trámites asignados
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  Domiciliación, cláusulas del contrato, estatus y otros trámites vinculados a este contrato.
                </p>
                <div className="overflow-x-auto min-w-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Fecha asignación</TableHead>
                        <TableHead>Vencimiento</TableHead>
                        <TableHead>Observaciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tramitesDelContrato.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground">
                            No hay trámites asignados para este contrato.
                          </TableCell>
                        </TableRow>
                      ) : (
                        tramitesDelContrato.map((t) => (
                          <TableRow
                            key={t.id}
                            className="cursor-pointer hover:bg-accent/40"
                            onClick={() => setTramiteSeguimientoId(t.id)}
                            title="Ver seguimiento del trámite"
                          >
                            <TableCell>{t.tipo}</TableCell>
                            <TableCell>
                              <StatusBadge status={t.estado === 'Completado' ? 'Activo' : t.estado === 'Rechazado' ? 'Inactivo' : 'Pendiente'} />
                            </TableCell>
                            <TableCell className="tabular-nums">{t.fechaAsignacion}</TableCell>
                            <TableCell className="tabular-nums">{t.fechaVencimiento ?? '—'}</TableCell>
                            <TableCell className="max-w-[200px] truncate">{t.observaciones ?? '—'}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                  </AccordionContent>
                </AccordionItem>

              {clausulasDelContrato.length > 0 && (
                <AccordionItem value="clausulas-contrato" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Cláusulas del contrato
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                  <Accordion type="single" collapsible className="w-full">
                    {clausulasDelContrato.map((c) => (
                      <AccordionItem key={c.id} value={c.id}>
                        <AccordionTrigger className="text-left">{c.titulo}</AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground pb-4">
                          {c.texto}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                  </AccordionContent>
                </AccordionItem>
              )}

                <AccordionItem value="datos-fiscales" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Datos Fiscales
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                <h4 className="section-subtitle">Fiscal</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <Row label="RFC" value={contrato?.rfc} />
                  <Row label="Domicilio fiscal" value="76160" />
                  <Row label="Uso CFDI" value="S01 - Sin efectos fiscales" />
                  <Row label="Régimen Fiscal" value="616 Sin obligaciones fiscales" />
                </dl>
                <h4 className="section-subtitle">Contacto</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <Row label="Nombre" value={contrato?.nombre} />
                  <Row label="Domicilio" value={contrato?.direccion} />
                  <Row label="Correo" value="jalvarezr@ceaqueretaro.gob.mx, jgodinez@ceaqueretaro.gob.mx" />
                  <Row label="Teléfono" value={contrato?.contacto} />
                </dl>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="datos-facturacion" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Datos Facturación
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                <h4 className="section-subtitle">Tarifa y zona</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <Row label="Tarifa" value={contrato?.tipoServicio ? `DOMÉSTICA ${contrato.tipoServicio}` : undefined} />
                  <Row label="Exento de Facturación" value="NO" />
                  <Row label="Zona facturación" value="M01" />
                  <Row label="Domiciliado" value={contrato?.domiciliado === true ? 'Sí' : contrato?.domiciliado === false ? 'No' : '—'} />
                  <Row label="Pensionado" value="" />
                  <Row label="Descripción" value="" />
                </dl>
                <h4 className="section-subtitle">Opciones de recibo</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <Row label="Impresión Recibo" value="SI" />
                  <Row label="Quien exenta" value="" />
                </dl>
                <h4 className="section-subtitle">Fechas y límites</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <Row label="Código recorrido" value="103-01201/00/20-30" />
                  <Row label="Importe límite" value="0" />
                  <Row label="Desde" value="" />
                  <Row label="Hasta" value="" />
                  <Row label="Fecha de Inicio" value="" />
                  <Row label="Fecha de fin" value="" />
                </dl>
                <h4 className="section-subtitle mt-4">Variables usadas para el cálculo</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  Tarifa, zona y parámetros que impactan el importe de la factura.
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  {variablesFacturacion.map((v) => (
                    <Row key={v.nombre} label={v.nombre} value={v.valor} />
                  ))}
                </dl>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="conceptos-factura" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Conceptos que factura este contrato
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  Desglose por concepto según la última prefactura o tarifa aplicable.
                </p>
                <div className="overflow-x-auto min-w-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Concepto</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                        <TableHead>Periodo ref.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {conceptosFacturacion.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell>{c.concepto}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(c.importe)}</TableCell>
                          <TableCell>{c.periodo}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="costos-contrato" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Costos de contrato
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  Conceptos fijos y cargos asociados a este contrato.
                </p>
                <div className="overflow-x-auto min-w-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Concepto</TableHead>
                        <TableHead>Periodo</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {costosDelContrato.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground">
                            Sin costos registrados.
                          </TableCell>
                        </TableRow>
                      ) : (
                        costosDelContrato.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>{c.concepto}</TableCell>
                            <TableCell>{c.periodo ?? '—'}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(c.monto)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="datos-medidores" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Medidores
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                <div className="overflow-x-auto min-w-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Marca</TableHead>
                        <TableHead>Modelo</TableHead>
                        <TableHead>Calibre</TableHead>
                        <TableHead>No. Serie</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Fecha Alta</TableHead>
                        <TableHead>Fecha Baja</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {medidor ? (
                        <TableRow>
                          <TableCell>BADGER METER</TableCell>
                          <TableCell>25 RECORDALL</TableCell>
                          <TableCell>13</TableCell>
                          <TableCell>{medidor.serie}</TableCell>
                          <TableCell>
                            <StatusBadge status={medidor.estado} />
                          </TableCell>
                          <TableCell className="tabular-nums">2008-02-08</TableCell>
                          <TableCell>—</TableCell>
                        </TableRow>
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground">
                            Sin medidor asignado
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="resumen-deuda" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Deuda
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
                  <span className="tabular-nums">
                    <span className="text-muted-foreground text-sm">Deuda actual:</span>{' '}
                    <strong className="text-base">{formatCurrency(deudaTotal.total)}</strong>
                  </span>
                  {parcialidadesVencidas > 0 && (
                    <span className="tabular-nums text-destructive font-semibold">
                      Parcialidades vencidas: {formatCurrency(parcialidadesVencidas)}
                    </span>
                  )}
                  {deudaTotal.saldoFavor > 0 && (
                    <span className="tabular-nums text-muted-foreground">
                      Saldo a favor: {formatCurrency(deudaTotal.saldoFavor)}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm border-t pt-3">
                  <Row label="Meses en adeudo" value="0" />
                  <Row label="Bloqueo de cobro" value="" />
                  <Row label="Abogado Externo" value="" />
                </dl>
                <details className="mt-3">
                  <summary className="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors duration-200">
                    Ver desglose (deuda total, convenio)
                  </summary>
                  <div className="grid gap-4 sm:grid-cols-2 mt-3">
                    <div className="rounded-md border p-4">
                      <h4 className="font-semibold text-sm mb-2">Deuda total</h4>
                      <dl className="space-y-1 text-sm">
                        <Row label="Importe Servicios" value={formatCurrency(deudaTotal.importeServicios)} />
                        <Row label="IVA" value={formatCurrency(deudaTotal.iva)} />
                        <Row label="Recargos" value={formatCurrency(deudaTotal.recargos)} />
                        <Row label="Saldo a favor" value={formatCurrency(deudaTotal.saldoFavor)} />
                        <div className="pt-2 font-semibold tabular-nums">
                          Total: {formatCurrency(deudaTotal.total)}
                        </div>
                      </dl>
                    </div>
                    <div className="rounded-md border p-4">
                      <h4 className="font-semibold text-sm mb-2">Convenio / Diferida</h4>
                      <dl className="space-y-1 text-sm">
                        <Row label="Importe Convenio" value={formatCurrency(0)} />
                        <Row label="Pagos Convenio" value={formatCurrency(0)} />
                        <Row label="Deuda Convenio" value={formatCurrency(0)} />
                        <Row label="Facturas Diferidas" value={formatCurrency(0)} />
                        <div className="pt-2 font-semibold tabular-nums">
                          Total en convenio: {formatCurrency(0)}
                        </div>
                      </dl>
                    </div>
                  </div>
                </details>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="cambio-nombre" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Cambio de nombre
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                    <p className="text-sm text-muted-foreground mb-3">
                      Solicitud de cambio de nombre del titular del contrato. Requiere documentación que acredite la nueva titularidad.
                    </p>
                    <Button variant="outline" size="sm" disabled>
                      Solicitar cambio de nombre
                    </Button>
                    <span className="ml-2 text-xs text-muted-foreground">Próximamente</span>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="carta-no-deuda" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Carta de no deuda
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                    <p className="text-sm text-muted-foreground mb-3">
                      Certificado que acredita que el contrato no tiene adeudos. Se emite una vez verificada la liquidación de saldos.
                    </p>
                    <Button variant="outline" size="sm" disabled>
                      Solicitar carta de no deuda
                    </Button>
                    <span className="ml-2 text-xs text-muted-foreground">Próximamente</span>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="alta-renovacion-descuentos" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Alta/Renovación descuentos
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                    <p className="text-sm text-muted-foreground mb-3">
                      Alta o renovación de descuentos (ej. jubilado/pensionado). Requiere documentos; una vez aprobado se aplica el descuento con vigencia aproximada de 1 año.
                    </p>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/app/contratos">Gestionar descuentos en Contratos</Link>
                    </Button>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="bajas-temporales-permanentes" className={cn('widget-card border-b-0 mb-2 last:mb-0')}>
                  <AccordionTrigger className="section-title hover:no-underline py-4 [&[data-state=open]]:pb-2">
                    Bajas Temporales/Permanentes
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                    <p className="text-sm text-muted-foreground mb-3">
                      Solicitud de baja temporal (suspensión del servicio) o baja permanente (cancelación del contrato).
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setBajaTemporalDialogOpen(true)} aria-label="Solicitar baja temporal">
                        Baja temporal
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setBajaDefinitivaDialogOpen(true)} aria-label="Solicitar baja definitiva" className="text-destructive hover:text-destructive">
                        Baja definitiva
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </TabsContent>

            <TabsContent value="facturas" className="space-y-4">
              <div className="widget-card">
                <h3 className="section-title">Facturas</h3>
                <div className="overflow-x-auto min-w-0">
                  <table className="data-table data-table-interactive" aria-label="Facturas del contrato">
                    <thead>
                      <tr>
                        <th>ID Factura</th>
                        <th>Periodo</th>
                        <th>Fecha Fac.</th>
                        <th>Vencimiento</th>
                        <th>No. Factura</th>
                        <th>Importe</th>
                        <th>Estado</th>
                        <th>Motivo</th>
                        <th>Origen</th>
                        <th>Causa Abono/Refactura</th>
                        <th>UUID</th>
                        <th>Fecha Timbrado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facturasRows.map((f) => (
                        <tr
                          key={f.idFactura}
                          role="button"
                          tabIndex={0}
                          aria-label={`Ver detalle de factura ${f.periodoDisplay}`}
                          onClick={() => setDetalleFacturaId(f.idFactura)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setDetalleFacturaId(f.idFactura);
                            }
                          }}
                          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset min-h-[44px]"
                        >
                          <td className="font-mono text-primary">{f.idFactura}</td>
                          <td className="text-primary">{f.periodoDisplay}</td>
                          <td>{f.fechaFac}</td>
                          <td>{f.vencimiento}</td>
                          <td className="text-primary">{f.noFactura}</td>
                          <td className="tabular-nums">{formatCurrency(f.importe)}</td>
                          <td>
                            <span
                              className={
                                f.estado === 'COBRADA'
                                  ? 'status-badge status-success'
                                  : 'status-badge status-warning'
                              }
                            >
                              {f.estado}
                            </span>
                          </td>
                          <td>{f.motivo}</td>
                          <td>{f.origen}</td>
                          <td>{f.causaAbonoRefactura || '—'}</td>
                          <td className="font-mono text-xs max-w-[120px] truncate" title={f.uuid}>
                            {f.uuid}
                          </td>
                          <td>{f.fechaTimbrado}</td>
                        </tr>
                      ))}
                      {facturasRows.length === 0 && (
                        <tr>
                          <td colSpan={12} className="text-center text-muted-foreground py-8">
                            <EmptyState icon={FileText} message="No hay facturas para este contrato." description="Aparecerán cuando se generen y timbren recibos para el contrato." />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="lecturas" className="space-y-4">
              <div className="widget-card">
                <h3 className="section-title">Lecturas</h3>
                <div className="overflow-x-auto min-w-0">
                  <table className="data-table data-table-interactive" aria-label="Lecturas del contrato">
                    <thead>
                      <tr>
                        <th>Periodo</th>
                        <th>Fecha Lec.</th>
                        <th>Fecha Lec.Ant.</th>
                        <th>Dias</th>
                        <th>Lectura</th>
                        <th>Consumo</th>
                        <th>Origen</th>
                        <th>Observación</th>
                        <th>Metodo Verificación</th>
                        <th>Metodo Estimación</th>
                        <th>Ajuste Estimado</th>
                        <th>Bolsa</th>
                        <th>Averia</th>
                        <th>Usuario</th>
                        <th>Url Foto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lecturasRows.map((l, i) => (
                        <tr
                          key={l.periodo ?? i}
                          role="button"
                          tabIndex={0}
                          aria-label={`Ver detalle de lectura ${l.periodoDisplay}`}
                          onClick={() => setDetalleLecturaPeriodo(l.periodo ?? null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setDetalleLecturaPeriodo(l.periodo ?? null);
                            }
                          }}
                          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset min-h-[44px]"
                        >
                          <td>{l.periodoDisplay}</td>
                          <td>{l.fechaLec}</td>
                          <td>{l.fechaLecAnt}</td>
                          <td>{l.dias}</td>
                          <td>{l.lectura}</td>
                          <td>{l.consumo}</td>
                          <td>{l.origen}</td>
                          <td>{l.observacion || '—'}</td>
                          <td>{l.metodoVerificacion || '—'}</td>
                          <td>{l.metodoEstimacion || '—'}</td>
                          <td>{l.ajusteEstimado}</td>
                          <td>{l.bolsa}</td>
                          <td>{l.averia}</td>
                          <td>{l.usuario}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setLecturaModalUrl(l.urlFoto)}
                              className="text-primary underline hover:no-underline text-xs cursor-pointer"
                            >
                              Ver foto
                            </button>
                          </td>
                        </tr>
                      ))}
                      {lecturasRows.length === 0 && (
                        <tr>
                          <td colSpan={15} className="text-center text-muted-foreground py-8">
                            <EmptyState icon={BookOpen} message="No hay lecturas para este contrato." description="Las lecturas se muestran cuando el medidor ha sido leído en cada periodo." />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="ordenes" className="space-y-4">
              <div className="widget-card">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <h3 className="section-title mb-0">Órdenes de trabajo</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOrdenesRefreshKey((k) => k + 1)}
                    disabled={ordenesLoading}
                    aria-label="Refrescar órdenes"
                  >
                    <RefreshCw className={cn('h-4 w-4', ordenesLoading && 'animate-spin')} />
                  </Button>
                </div>
                {ordenesLoading && <p className="text-sm text-muted-foreground">Cargando órdenes...</p>}
                {!ordenesLoading && (
                  <div className="overflow-x-auto min-w-0">
                    <table className="data-table data-table-interactive" aria-label="Órdenes del contrato">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Tipo</th>
                          <th>Estado</th>
                          <th>Prioridad</th>
                          <th>Fecha solicitud</th>
                          <th>Fecha programada</th>
                          <th>Fecha ejecución</th>
                          <th>Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(ordenesApi ?? []).map((o) => (
                          <tr
                            key={o.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`Orden ${o.id} - ${o.tipo}`}
                            onClick={() => setDetalleOrdenId(o.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setDetalleOrdenId(o.id);
                              }
                            }}
                            className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset min-h-[44px]"
                          >
                            <td className="font-mono text-primary">{o.id.slice(-8)}</td>
                            <td>{o.tipo}</td>
                            <td>
                              <span className={cn(
                                'status-badge',
                                o.estado === 'Completada' && 'status-success',
                                o.estado === 'Pendiente' && 'status-warning',
                                o.estado === 'EnProceso' && 'status-info',
                                o.estado === 'Cancelada' && 'status-error',
                              )}>
                                {o.estado}
                              </span>
                            </td>
                            <td>{o.prioridad}</td>
                            <td>{o.fechaSolicitud?.slice(0, 10)}</td>
                            <td>{o.fechaProgramada?.slice(0, 10) ?? '—'}</td>
                            <td>{o.fechaEjecucion?.slice(0, 10) ?? '—'}</td>
                            <td className="max-w-[220px]">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="line-clamp-2 cursor-help">{o.notas ?? '—'}</span>
                                </TooltipTrigger>
                                {o.notas && (
                                  <TooltipContent side="left" className="max-w-sm">
                                    {o.notas}
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            </td>
                          </tr>
                        ))}
                        {(ordenesApi ?? []).length === 0 && !ordenesLoading && (
                          <tr>
                            <td colSpan={8} className="text-center text-muted-foreground py-8">
                              <EmptyState icon={ListChecks} message="No hay órdenes para este contrato." description="Las órdenes de trabajo (reconexión, reparación, etc.) se muestran aquí." />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="pagos" className="space-y-4">
              <div className="widget-card">
                <h3 className="section-title">Pagos</h3>
                <div className="overflow-x-auto min-w-0">
                  <table className="data-table data-table-interactive" aria-label="Pagos del contrato">
                    <thead>
                      <tr>
                        <th>Operación</th>
                        <th>Oficina del pago</th>
                        <th>Fecha del pago</th>
                        <th>Hora del pago</th>
                        <th>Forma de pago</th>
                        <th>Tipo de Operación</th>
                        <th>Importe de Pago</th>
                        <th>UUID Timbrado</th>
                        <th>F. Timbrado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagosOperacionRows.map((p, i) => (
                        <tr
                          key={`${p.operacion}-${i}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Ver detalle de pago operación ${p.operacion}`}
                          onClick={() => setDetallePagoKey(`${p.operacion}-${i}`)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setDetallePagoKey(`${p.operacion}-${i}`);
                            }
                          }}
                          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset min-h-[44px]"
                        >
                          <td className="font-mono text-primary">{p.operacion}</td>
                          <td>{p.oficinaPago}</td>
                          <td>{p.fechaPago}</td>
                          <td>{p.horaPago}</td>
                          <td>{p.formaPago}</td>
                          <td>{p.tipoOperacion}</td>
                          <td className="tabular-nums">{formatCurrency(p.importePago)}</td>
                          <td className="font-mono text-xs max-w-[140px] truncate" title={p.uuidTimbrado}>
                            {p.uuidTimbrado}
                          </td>
                          <td>{p.fechaTimbrado}</td>
                        </tr>
                      ))}
                      {pagosOperacionRows.length === 0 && (
                        <tr>
                          <td colSpan={9} className="text-center text-muted-foreground py-8">
                            <EmptyState icon={FileWarning} message="No hay pagos para este contrato." description="Los pagos registrados contra este contrato se listan aquí." />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="observaciones" className="space-y-4">
              <div className="widget-card">
                <h3 className="section-title">Observaciones</h3>
                <div className="overflow-x-auto min-w-0">
                  <table className="data-table data-table-interactive" aria-label="Observaciones del contrato">
                    <thead>
                      <tr>
                        <th>Quien</th>
                        <th>Fecha</th>
                        <th>Observación</th>
                        <th>Vigencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {observacionesRows.map((o, i) => (
                        <tr
                          key={i}
                          role="button"
                          tabIndex={0}
                          aria-label={`Ver detalle de observación ${o.quien} ${o.fecha}`}
                          onClick={() => setDetalleObservacionIndex(i)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setDetalleObservacionIndex(i);
                            }
                          }}
                          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset min-h-[44px]"
                        >
                          <td>{o.quien}</td>
                          <td>{o.fecha}</td>
                          <td>{o.observacion}</td>
                          <td>{o.vigencia || '—'}</td>
                        </tr>
                      ))}
                      {observacionesRows.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center text-muted-foreground py-8">
                            <EmptyState icon={MessageSquare} message="No hay observaciones para este contrato." description="Las anotaciones o comentarios asociados al contrato se listan aquí." />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="convenios" className="space-y-4">
              <div className="widget-card">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <h3 className="section-title mb-0">Convenios</h3>
                  {can('convenios.create') && (
                    <Button size="sm" onClick={() => setConvenioDialogOpen(true)} aria-label="Nuevo convenio">
                      Nuevo convenio
                    </Button>
                  )}
                </div>
                <div className="overflow-x-auto min-w-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Área</TableHead>
                        <TableHead>Importe total</TableHead>
                        <TableHead>Pagos realizados</TableHead>
                        <TableHead>Fecha inicio</TableHead>
                        <TableHead>Vencimiento</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {conveniosDelContrato.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                            No hay convenios para este contrato.
                          </TableCell>
                        </TableRow>
                      ) : (
                        conveniosDelContrato.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>{c.tipo}</TableCell>
                            <TableCell>{c.area}</TableCell>
                            <TableCell className="tabular-nums">{formatCurrency(c.importeTotal)}</TableCell>
                            <TableCell className="tabular-nums">{formatCurrency(c.pagosRealizados)}</TableCell>
                            <TableCell className="tabular-nums">{c.fechaInicio}</TableCell>
                            <TableCell className="tabular-nums">{c.fechaVencimiento}</TableCell>
                            <TableCell><StatusBadge status={c.estado} /></TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="quejas" className="space-y-4">
              <div className="widget-card">
                <TabQuejas
                  contratoId={contratoId ?? ''}
                  onNuevaQueja={() => setQuejaDialogOpen(true)}
                  onVerDetalle={(q) => { setQuejaSeleccionada(q as any); setQuejaDetalleOpen(true); }}
                  refreshKey={quejaRefreshKey}
                />
              </div>
            </TabsContent>
          </Tabs>

          <QuejaDialog
            open={quejaDialogOpen}
            onOpenChange={setQuejaDialogOpen}
            contratoId={contratoId ?? ''}
            usuarioActual="jgodinez"
            onCreated={() => setQuejaRefreshKey((k) => k + 1)}
          />

          <QuejaDetalle
            queja={quejaSeleccionada}
            open={quejaDetalleOpen}
            onOpenChange={setQuejaDetalleOpen}
            usuarioActual="jgodinez"
            onCambiarEstado={async (quejaId, nuevoEstado, motivo) => {
              try {
                await updateQueja(quejaId, {
                  estado: nuevoEstado,
                  ...(motivo ? { motivoCierre: motivo } : {}),
                });
                if (quejaSeleccionada?.id === quejaId) {
                  setQuejaSeleccionada(prev =>
                    prev ? { ...prev, estado: nuevoEstado, ...(motivo ? { motivoCierre: motivo } : {}) } : null
                  );
                }
                setQuejaRefreshKey((k) => k + 1);
              } catch (err) {
                console.error('Error al cambiar estado de la queja:', err);
              }
            }}
            onReasignar={async (quejaId, area) => {
              try {
                await updateQueja(quejaId, { areaAsignada: area });
                if (quejaSeleccionada?.id === quejaId) {
                  setQuejaSeleccionada(prev => (prev ? { ...prev, areaAsignada: area } : null));
                }
                setQuejaRefreshKey((k) => k + 1);
              } catch (err) {
                console.error('Error al reasignar queja:', err);
              }
            }}
            onAgregarNota={async (quejaId, nota, tipo) => {
              try {
                await addSeguimientoQueja(quejaId, {
                  nota,
                  usuario: 'jgodinez',
                  tipo,
                });
                if (quejaSeleccionada?.id === quejaId) {
                  setQuejaSeleccionada(prev =>
                    prev
                      ? {
                          ...prev,
                          seguimientos: [
                            ...(prev.seguimientos ?? []),
                            {
                              id: `tmp-${Date.now()}`,
                              quejaId,
                              fecha: new Date().toISOString(),
                              nota,
                              usuario: 'jgodinez',
                              tipo,
                            },
                          ],
                        }
                      : null
                  );
                }
                setQuejaRefreshKey((k) => k + 1);
              } catch (err) {
                console.error('Error al agregar seguimiento:', err);
              }
            }}
          />

          <Dialog open={convenioDialogOpen} onOpenChange={setConvenioDialogOpen}>
            <DialogContent className="sm:max-w-md" aria-describedby="nuevo-convenio-desc">
              <DialogHeader>
                <DialogTitle>Nuevo convenio</DialogTitle>
                <DialogDescription id="nuevo-convenio-desc">
                  Registrar un convenio o plan de pagos para el contrato {contratoId}.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div>
                  <Label htmlFor="conv-tipo">Tipo</Label>
                  <Input
                    id="conv-tipo"
                    value={newConvenio.tipo}
                    onChange={(e) => setNewConvenio((p) => ({ ...p, tipo: e.target.value }))}
                    placeholder="Ej. Diferido 6 meses"
                  />
                </div>
                <div>
                  <Label htmlFor="conv-area">Área</Label>
                  <Select
                    value={newConvenio.area}
                    onValueChange={(v) => setNewConvenio((p) => ({ ...p, area: v as 'Atención a clientes' | 'Cartera' | 'Jurídico' | 'Facturación' }))}
                  >
                    <SelectTrigger id="conv-area">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Atención a clientes">Atención a clientes</SelectItem>
                      <SelectItem value="Cartera">Cartera</SelectItem>
                      <SelectItem value="Jurídico">Jurídico</SelectItem>
                      <SelectItem value="Facturación">Facturación</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="conv-importe">Importe total (MXN)</Label>
                  <Input
                    id="conv-importe"
                    type="number"
                    min={0}
                    value={newConvenio.importeTotal}
                    onChange={(e) => setNewConvenio((p) => ({ ...p, importeTotal: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="conv-parcialidades">Número de parcialidades</Label>
                  <Input
                    id="conv-parcialidades"
                    type="number"
                    min={1}
                    value={newConvenio.numeroParcialidades}
                    onChange={(e) => setNewConvenio((p) => ({ ...p, numeroParcialidades: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="conv-inicio">Fecha inicio</Label>
                  <Input
                    id="conv-inicio"
                    type="date"
                    value={newConvenio.fechaInicio}
                    onChange={(e) => setNewConvenio((p) => ({ ...p, fechaInicio: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="conv-vencimiento">Fecha vencimiento</Label>
                  <Input
                    id="conv-vencimiento"
                    type="date"
                    value={newConvenio.fechaVencimiento}
                    onChange={(e) => setNewConvenio((p) => ({ ...p, fechaVencimiento: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="conv-obs">Observaciones</Label>
                  <Input
                    id="conv-obs"
                    value={newConvenio.observaciones}
                    onChange={(e) => setNewConvenio((p) => ({ ...p, observaciones: e.target.value }))}
                    placeholder="Opcional"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConvenioDialogOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => {
                    if (!contratoId || !newConvenio.tipo.trim() || !newConvenio.importeTotal || !newConvenio.fechaInicio || !newConvenio.fechaVencimiento) return;
                    addConvenio({
                      contratoId,
                      tipo: newConvenio.tipo.trim(),
                      area: newConvenio.area,
                      importeTotal: Number(newConvenio.importeTotal) || 0,
                      pagosRealizados: 0,
                      fechaInicio: newConvenio.fechaInicio,
                      fechaVencimiento: newConvenio.fechaVencimiento,
                      estado: 'Vigente',
                      numeroParcialidades: Number(newConvenio.numeroParcialidades) || 1,
                      observaciones: newConvenio.observaciones || undefined,
                    });
                    setNewConvenio({ tipo: '', area: 'Atención a clientes', importeTotal: '', numeroParcialidades: '1', fechaInicio: '', fechaVencimiento: '', observaciones: '' });
                    setConvenioDialogOpen(false);
                  }}
                  disabled={!newConvenio.tipo.trim() || !newConvenio.importeTotal || !newConvenio.fechaInicio || !newConvenio.fechaVencimiento}
                >
                  Crear convenio
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={bajaTemporalDialogOpen} onOpenChange={setBajaTemporalDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Baja temporal</DialogTitle>
                <DialogDescription>
                  Suspensión del servicio hasta la fecha de reconexión. El contrato pasará a estado Suspendido.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div>
                  <Label htmlFor="fecha-reconexion">Fecha prevista de reconexión</Label>
                  <Input
                    id="fecha-reconexion"
                    type="date"
                    value={fechaReconexionPrevista}
                    onChange={(e) => setFechaReconexionPrevista(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBajaTemporalDialogOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => {
                    if (contratoId) {
                      updateContrato(contratoId, { estado: 'Suspendido', fechaReconexionPrevista: fechaReconexionPrevista || undefined });
                      setFechaReconexionPrevista('');
                      setBajaTemporalDialogOpen(false);
                    }
                  }}
                >
                  Solicitar baja temporal
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={bajaDefinitivaDialogOpen} onOpenChange={setBajaDefinitivaDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Baja definitiva</DialogTitle>
                <DialogDescription>
                  Baja permanente del servicio: liquidación de deuda, orden de corte, última lectura y retiro de medidor y toma. El contrato pasará a estado Cancelado.
                </DialogDescription>
              </DialogHeader>
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Atención</AlertTitle>
                <AlertDescription>
                  Esta acción es irreversible. Verifique que la deuda esté liquidada antes de confirmar.
                </AlertDescription>
              </Alert>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBajaDefinitivaDialogOpen(false)}>Cancelar</Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (contratoId && contrato) {
                      updateContrato(contratoId, { estado: 'Cancelado' });
                      if (contrato.medidorId) updateMedidor(contrato.medidorId, { estado: 'Inactivo' });
                      setBajaDefinitivaDialogOpen(false);
                    }
                  }}
                >
                  Confirmar baja definitiva
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Sheet Detalle Factura */}
          <Sheet open={!!detalleFacturaId} onOpenChange={(open) => !open && setDetalleFacturaId(null)}>
            <SheetContent side="right" className="sm:max-w-md flex flex-col">
              <SheetHeader>
                <SheetTitle>Detalle de factura</SheetTitle>
              </SheetHeader>
              {(() => {
                const f = facturasRows.find((r) => r.idFactura === detalleFacturaId);
                if (!f) return null;
                const timbrado = timbrados.find((t) => t.id === f.idFactura);
                const pf = timbrado ? preFacturas.find((p) => p.id === timbrado.preFacturaId) : null;
                const cargoFijo = contrato && pf ? calcularTarifa(contrato.tipoServicio, pf.consumoM3).cargoFijo : 0;
                const subtotalConsumo = pf ? pf.subtotal - cargoFijo : 0;
                const periodoMes = f.fechaFac?.slice(0, 7);
                const pagosDelPeriodo = contratoId && periodoMes
                  ? pagos.filter((p) => p.contratoId === contratoId && p.fecha.slice(0, 7) === periodoMes)
                  : [];
                return (
                  <ScrollArea className="flex-1 -mx-6 px-6">
                    <div className="space-y-4 text-sm">
                      <dl className="grid grid-cols-1 gap-2">
                        <DetailRow label="ID Factura" value={f.idFactura} mono />
                        <DetailRow label="Periodo" value={f.periodoDisplay} />
                        <DetailRow label="Fecha factura" value={f.fechaFac} />
                        <DetailRow label="Vencimiento" value={f.vencimiento} />
                        <DetailRow label="No. Factura" value={f.noFactura} />
                        <DetailRow label="Importe" value={formatCurrency(f.importe)} />
                        <DetailRow label="Estado" value={<span className={f.estado === 'COBRADA' ? 'status-badge status-success' : 'status-badge status-warning'}>{f.estado}</span>} />
                        <DetailRow label="Motivo" value={f.motivo} />
                        <DetailRow label="Origen" value={f.origen} />
                        <DetailRow label="Causa abono/refactura" value={f.causaAbonoRefactura || '—'} />
                        <DetailRow label="Fecha timbrado" value={f.fechaTimbrado} />
                        <div>
                          <dt className="text-muted-foreground text-xs mb-1">UUID</dt>
                          <dd className="flex items-center gap-2 flex-wrap">
                            <code className="font-mono text-xs break-all bg-muted px-2 py-1 rounded">{f.uuid}</code>
                            <Button variant="ghost" size="sm" className="shrink-0 h-8" onClick={() => copyToClipboard(f.uuid)} aria-label="Copiar UUID">
                              <Copy className="h-4 w-4" aria-hidden />
                            </Button>
                          </dd>
                        </div>
                      </dl>
                      {pf && (
                        <>
                          <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground pt-2 border-t">Desglose por conceptos</h4>
                          <dl className="grid grid-cols-1 gap-1 text-sm">
                            <DetailRow label="Cargo fijo" value={formatCurrency(cargoFijo)} />
                            <DetailRow label="Consumo (m³)" value={formatCurrency(subtotalConsumo)} />
                            <DetailRow label="Subtotal" value={formatCurrency(pf.subtotal)} />
                            <DetailRow label="Descuento" value={formatCurrency(pf.descuento)} />
                            <DetailRow label="Total" value={formatCurrency(pf.total)} />
                          </dl>
                        </>
                      )}
                      {pagosDelPeriodo.length > 0 && (
                        <>
                          <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground pt-2 border-t">Pagos asociados al periodo</h4>
                          <ul className="space-y-1">
                            {pagosDelPeriodo.map((p) => (
                              <li key={p.id} className="flex justify-between">
                                <span>{p.fecha} · {p.concepto}</span>
                                <span className="tabular-nums">{formatCurrency(p.monto)}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      <div className="pt-2 border-t flex gap-2">
                        <Button variant="outline" size="sm" disabled>Descargar PDF</Button>
                        <Button variant="outline" size="sm" disabled>Reenviar</Button>
                      </div>
                    </div>
                  </ScrollArea>
                );
              })()}
            </SheetContent>
          </Sheet>

          {/* Sheet Detalle Lectura */}
          <Sheet open={!!detalleLecturaPeriodo} onOpenChange={(open) => !open && setDetalleLecturaPeriodo(null)}>
            <SheetContent side="right" className="sm:max-w-md flex flex-col">
              <SheetHeader>
                <SheetTitle>Detalle de lectura</SheetTitle>
              </SheetHeader>
              {(() => {
                const l = lecturasRows.find((r) => r.periodo === detalleLecturaPeriodo);
                if (!l) return null;
                return (
                  <ScrollArea className="flex-1 -mx-6 px-6">
                    <div className="space-y-4 text-sm">
                      <dl className="grid grid-cols-1 gap-2">
                        <DetailRow label="Periodo" value={l.periodoDisplay} />
                        <DetailRow label="Fecha lectura" value={l.fechaLec} />
                        <DetailRow label="Fecha lectura anterior" value={l.fechaLecAnt} />
                        <DetailRow label="Días" value={String(l.dias)} />
                        <DetailRow label="Lectura" value={String(l.lectura)} />
                        <DetailRow label="Consumo" value={String(l.consumo)} />
                        <DetailRow label="Origen" value={l.origen} />
                        <DetailRow label="Observación" value={l.observacion || '—'} />
                        <DetailRow label="Método verificación" value={l.metodoVerificacion || '—'} />
                        <DetailRow label="Método estimación" value={l.metodoEstimacion || '—'} />
                        <DetailRow label="Ajuste estimado" value={String(l.ajusteEstimado)} />
                        <DetailRow label="Bolsa" value={String(l.bolsa)} />
                        <DetailRow label="Avería" value={l.averia} />
                        <DetailRow label="Usuario" value={l.usuario} />
                      </dl>
                      <div className="space-y-2">
                        <p className="text-muted-foreground text-xs font-medium">Foto de lectura</p>
                        <div className="rounded-md border overflow-hidden bg-muted/30">
                          <img src={l.urlFoto} alt={`Lectura periodo ${l.periodoDisplay}`} className="w-full h-auto max-h-64 object-contain cursor-pointer hover:opacity-90" loading="lazy" onClick={() => setLecturaModalUrl(l.urlFoto)} />
                        </div>
                        <button
                          type="button"
                          onClick={() => setLecturaModalUrl(l.urlFoto)}
                          className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          Abrir en pantalla grande
                        </button>
                      </div>
                    </div>
                  </ScrollArea>
                );
              })()}
            </SheetContent>
          </Sheet>

          {/* Modal grande: foto / sistema externo de lectura */}
          <Dialog open={!!lecturaModalUrl} onOpenChange={(open) => !open && setLecturaModalUrl(null)}>
            <DialogContent
              className="max-w-[95vw] w-full max-h-[95vh] flex flex-col gap-0 p-0 overflow-hidden"
              aria-describedby={undefined}
            >
              <DialogHeader className="sr-only">
                <DialogTitle>Foto de lectura / Sistema externo</DialogTitle>
              </DialogHeader>
              {lecturaModalUrl && (
                <>
                  <div className="flex items-center justify-end gap-2 px-3 py-2 border-b bg-muted/40 shrink-0">
                    <a
                      href={lecturaModalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir en nueva pestaña
                    </a>
                  </div>
                  <iframe
                    src={lecturaModalUrl}
                    title="Foto de lectura"
                    className="w-full flex-1 min-h-[70vh] border-0"
                  />
                </>
              )}
            </DialogContent>
          </Dialog>

          {/* Sheet Detalle Orden */}
          <Sheet open={!!detalleOrdenId} onOpenChange={(open) => !open && setDetalleOrdenId(null)}>
            <SheetContent side="right" className="sm:max-w-lg flex flex-col">
              <SheetHeader>
                <SheetTitle>Detalle de orden</SheetTitle>
              </SheetHeader>
              {(() => {
                const o = (ordenesApi ?? []).find((r) => r.id === detalleOrdenId);
                if (!o) return null;
                return (
                  <ScrollArea className="flex-1 -mx-6 px-6">
                    <div className="space-y-4 text-sm">
                      <dl className="grid grid-cols-1 gap-2">
                        <DetailRow label="ID Orden" value={o.id} mono />
                        <DetailRow label="Tipo" value={o.tipo} />
                        <DetailRow label="Estado" value={o.estado} />
                        <DetailRow label="Prioridad" value={o.prioridad} />
                        <DetailRow label="Fecha solicitud" value={o.fechaSolicitud?.slice(0, 10)} />
                        <DetailRow label="Fecha programada" value={o.fechaProgramada?.slice(0, 10) ?? '—'} />
                        <DetailRow label="Fecha ejecución" value={o.fechaEjecucion?.slice(0, 10) ?? '—'} />
                        <DetailRow label="Referencia externa" value={o.externalRef ?? '—'} />
                        {o.notas && (
                          <div>
                            <dt className="text-muted-foreground text-xs mb-1">Notas</dt>
                            <dd className="text-foreground break-words">{o.notas}</dd>
                          </div>
                        )}
                      </dl>
                      {o.seguimientos && o.seguimientos.length > 0 && (
                        <>
                          <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground pt-2 border-t">
                            Seguimiento
                          </h4>
                          <ul className="space-y-2">
                            {o.seguimientos.map((s) => (
                              <li key={s.id} className="rounded-md border p-2 text-xs space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">{s.estadoAnterior ?? '—'} → {s.estadoNuevo ?? '—'}</span>
                                  <span className="text-muted-foreground tabular-nums">{s.fecha?.slice(0, 10)}</span>
                                </div>
                                {s.nota && <p className="text-muted-foreground">{s.nota}</p>}
                                {s.usuario && <p className="text-muted-foreground">Por: {s.usuario}</p>}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {can('ordenes.changeEstado') && (
                        <div className="pt-2 border-t flex flex-wrap gap-2">
                          {(['Pendiente', 'EnProceso', 'Completada', 'Cancelada'] as const).map((estado) => (
                            <Button
                              key={estado}
                              variant="outline"
                              size="sm"
                              disabled={o.estado === estado}
                              onClick={async () => {
                                await updateOrdenEstado(o.id, estado);
                                setOrdenesRefreshKey((k) => k + 1);
                                setDetalleOrdenId(null);
                              }}
                            >
                              → {estado}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                );
              })()}
            </SheetContent>
          </Sheet>

          {/* Sheet Detalle Pago */}
          <Sheet open={!!detallePagoKey} onOpenChange={(open) => !open && setDetallePagoKey(null)}>
            <SheetContent side="right" className="sm:max-w-md flex flex-col">
              <SheetHeader>
                <SheetTitle>Detalle de pago</SheetTitle>
              </SheetHeader>
              {(() => {
                const p = pagosOperacionRows.find((r, i) => `${r.operacion}-${i}` === detallePagoKey);
                if (!p) return null;
                return (
                  <ScrollArea className="flex-1 -mx-6 px-6">
                    <div className="space-y-4 text-sm">
                      <dl className="grid grid-cols-1 gap-2">
                        <DetailRow label="Operación" value={p.operacion} mono />
                        <DetailRow label="Oficina de pago" value={p.oficinaPago} />
                        <DetailRow label="Fecha de pago" value={p.fechaPago} />
                        <DetailRow label="Hora de pago" value={p.horaPago} />
                        <DetailRow label="Forma de pago" value={p.formaPago} />
                        <DetailRow label="Tipo de operación" value={p.tipoOperacion} />
                        <DetailRow label="Importe" value={formatCurrency(p.importePago)} />
                        <DetailRow label="Fecha timbrado" value={p.fechaTimbrado} />
                        <div>
                          <dt className="text-muted-foreground text-xs mb-1">UUID Timbrado</dt>
                          <dd className="flex items-center gap-2 flex-wrap">
                            <code className="font-mono text-xs break-all bg-muted px-2 py-1 rounded">{p.uuidTimbrado}</code>
                            <Button variant="ghost" size="sm" className="shrink-0 h-8" onClick={() => copyToClipboard(p.uuidTimbrado)} aria-label="Copiar UUID">
                              <Copy className="h-4 w-4" aria-hidden />
                            </Button>
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </ScrollArea>
                );
              })()}
            </SheetContent>
          </Sheet>

          {/* Sheet Seguimiento Trámite */}
          <Sheet open={!!tramiteSeguimientoId} onOpenChange={(open) => !open && setTramiteSeguimientoId(null)}>
            <SheetContent side="right" className="sm:max-w-md flex flex-col">
              <SheetHeader>
                <SheetTitle>Seguimiento del trámite</SheetTitle>
              </SheetHeader>
              {tramiteSeguimientoId && (
                <div className="flex-1 overflow-y-auto px-0 py-2">
                  <SeguimientoPanel
                    tramiteId={tramiteSeguimientoId}
                    usuarioActual="jgodinez"
                  />
                </div>
              )}
            </SheetContent>
          </Sheet>

          {/* Sheet Detalle Observación */}
          <Sheet open={detalleObservacionIndex !== null} onOpenChange={(open) => !open && setDetalleObservacionIndex(null)}>
            <SheetContent side="right" className="sm:max-w-md flex flex-col">
              <SheetHeader>
                <SheetTitle>Detalle de observación</SheetTitle>
              </SheetHeader>
              {detalleObservacionIndex !== null && observacionesRows[detalleObservacionIndex] && (() => {
                const o = observacionesRows[detalleObservacionIndex];
                return (
                  <ScrollArea className="flex-1 -mx-6 px-6">
                    <div className="space-y-4 text-sm">
                      <dl className="grid grid-cols-1 gap-2">
                        <DetailRow label="Quien" value={o.quien} />
                        <DetailRow label="Fecha" value={o.fecha} />
                        <DetailRow label="Vigencia" value={o.vigencia || '—'} />
                        <div>
                          <dt className="text-muted-foreground text-xs mb-1">Observación</dt>
                          <dd className="text-foreground break-words">{o.observacion || '—'}</dd>
                        </div>
                      </dl>
                    </div>
                  </ScrollArea>
                );
              })()}
            </SheetContent>
          </Sheet>
        </TooltipProvider>
      )}
    </div>
  );
};

function EmptyState({
  icon: Icon,
  message,
  description,
}: {
  icon: LucideIcon;
  message: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/70" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
      {description && <p className="text-xs text-muted-foreground max-w-sm">{description}</p>}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  const isEmpty =
    value == null ||
    value === '' ||
    (typeof value === 'string' && value.trim() === '');
  const display = isEmpty ? '—' : value;
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground shrink-0">{label}:</dt>
      <dd className="min-w-0">{display}</dd>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  const isEmpty =
    value == null ||
    value === '' ||
    (typeof value === 'string' && value.trim() === '');
  const display = isEmpty ? '—' : value;
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground text-xs shrink-0">{label}</dt>
      <dd className={cn('min-w-0 break-words', mono && 'font-mono text-xs')}>{display}</dd>
    </div>
  );
}

export default AtencionClientes;
