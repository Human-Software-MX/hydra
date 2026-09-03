import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams, useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  getPortalConsumos,
  getPortalTimbrados,
  getPortalPagos,
  getPortalSaldos,
  descargarPortalCfdiXml,
  crearPortalReporteFuga,
  getPortalReportesFuga,
  type PortalConsumo,
  type PortalTimbrado,
  type PortalPago,
  type PortalSaldos,
} from '@/api/portal';
import { getCeaDeuda, getCeaConsumos, type CeaConsumo } from '@/api/cea';
import type { PortalContextValue } from '@/components/PortalLayout';
import PagarEnLinea from '@/components/portal/PagarEnLinea';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  FileText,
  BarChart3,
  Receipt,
  CreditCard,
  Building2,
  UserPlus,
  PowerOff,
  UserMinus,
  Plug,
  FilePlus,
  BadgePercent,
  Download,
  Calendar,
  RefreshCw,
  Phone,
  MessageCircle,
  ChevronRight,
  Lock,
  AlertCircle,
  Plus,
  HelpCircle,
  Droplets,
  CheckCircle2,
} from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

function Breadcrumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-gray-400 mb-4">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          {item.onClick ? (
            <button onClick={item.onClick} className="hover:text-blue-600 transition-colors">
              {item.label}
            </button>
          ) : (
            <span className={i === items.length - 1 ? 'text-gray-700 font-medium' : ''}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    Pagada: 'bg-green-100 text-green-700',
    Pendiente: 'bg-yellow-100 text-yellow-700',
    Vencida: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

function FugaEstadoPill({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    Registrada: 'bg-blue-100 text-blue-700',
    'En proceso': 'bg-yellow-100 text-yellow-700',
    'En atención': 'bg-yellow-100 text-yellow-700',
    Resuelta: 'bg-green-100 text-green-700',
    Cerrada: 'bg-green-100 text-green-700',
    Cancelada: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[estado] ?? 'bg-gray-100 text-gray-600'}`}>
      {estado}
    </span>
  );
}

// ─── Tab values ─────────────────────────────────────────────────────────────

const FACTURAS_POR_PAGINA = 10;

const TAB_VALUES = ['inicio', 'consumo', 'facturas', 'recibos', 'pagar', 'metodos-pago', 'tramites-digitales'] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTab(s: string | null): s is TabValue {
  return s !== null && (TAB_VALUES as readonly string[]).includes(s);
}

// ─── Main component ──────────────────────────────────────────────────────────

const PortalCliente = () => {
  const { contratos, contratoId, loadingContratos } = useOutletContext<PortalContextValue>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const tabFromUrl = searchParams.get('tab');
  const activeTab: TabValue = isTab(tabFromUrl) ? tabFromUrl : 'inicio';

  const setTab = useCallback(
    (tab: TabValue) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', tab);
        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  // Per-tab data (from hydra backend)
  const [consumos, setConsumos] = useState<PortalConsumo[]>([]);
  const [timbrados, setTimbrados] = useState<PortalTimbrado[]>([]);
  const [pagos, setPagos] = useState<PortalPago[]>([]);
  const [saldos, setSaldos] = useState<PortalSaldos>({ vencido: 0, vigente: 0, total: 0, intereses: 0 });
  const [loadingData, setLoadingData] = useState(false);

  // CEA live data (real-time from Aquacis)
  const [ceaConsumos, setCeaConsumos] = useState<CeaConsumo[]>([]);
  const [ceaNombreCliente, setCeaNombreCliente] = useState<string | null>(null);
  const [ceaExplotacion, setCeaExplotacion] = useState<string | null>(null);
  const [ceaSaldosLoading, setCeaSaldosLoading] = useState(false);
  const [ceaConsumosFetched, setCeaConsumosFetched] = useState(false);
  const [ceaConsumosLoading, setCeaConsumosLoading] = useState(false);

  // Search/filter state
  const [folioSearch, setFolioSearch] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [consumoAnioFiltro, setConsumoAnioFiltro] = useState('todos');
  const [recibosSubtab, setRecibosSubtab] = useState<'recientes' | 'historico' | 'pendientes' | 'facturas'>('recientes');
  const [facturasPagina, setFacturasPagina] = useState(1);
  const [consumosPagina, setConsumosPagina] = useState(1);

  // Descarga CFDI (XML) desde el portal
  const [descargandoXmlId, setDescargandoXmlId] = useState<string | null>(null);
  const [xmlError, setXmlError] = useState<string | null>(null);

  // Reporte de fugas
  const [fugaDescripcion, setFugaDescripcion] = useState('');
  const [fugaUbicacion, setFugaUbicacion] = useState('');
  const [fugaFolio, setFugaFolio] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const contrato = useMemo(
    () => (contratoId ? contratos.find((c) => c.id === contratoId) ?? null : null),
    [contratos, contratoId]
  );

  // Fetch hydra backend data
  useEffect(() => {
    if (!contratoId) return;
    setLoadingData(true);
    Promise.all([
      getPortalConsumos(contratoId),
      getPortalTimbrados(contratoId),
      getPortalPagos(contratoId),
      getPortalSaldos(contratoId),
    ]).then(([c, t, p, s]) => {
      setConsumos(c);
      setTimbrados(t);
      setPagos(p);
      setSaldos(s);
    }).catch(() => {
      setConsumos([]);
      setTimbrados([]);
      setPagos([]);
      setSaldos({ vencido: 0, vigente: 0, total: 0, intereses: 0 });
    }).finally(() => setLoadingData(false));
  }, [contratoId]);

  // Fetch CEA live saldos (debt) when a CEA contract number is linked
  useEffect(() => {
    if (!contrato?.ceaNumContrato) return;
    setCeaSaldosLoading(true);
    getCeaDeuda(contrato.ceaNumContrato)
      .then((deuda) => {
        if (!deuda) return;
        const vencido = parseFloat(deuda.deuda ?? '0');
        const intereses = parseFloat(deuda.deudaComision ?? '0');
        const total = parseFloat(deuda.deudaTotal ?? '0');
        const saldoAnt = parseFloat(deuda.saldoAnterior ?? '0');
        // "vigente" = current period amount not yet overdue
        const vigente = Math.max(0, saldoAnt - vencido);
        setSaldos({ vencido, vigente, total, intereses });
        if (deuda.nombreCliente) setCeaNombreCliente(deuda.nombreCliente);
        if (deuda.explotacion) setCeaExplotacion(deuda.explotacion);
      })
      .catch(() => { /* keep hydra backend saldos on error */ })
      .finally(() => setCeaSaldosLoading(false));
  }, [contrato?.ceaNumContrato]);

  // Fetch CEA consumos on demand when tab is active (consumo or facturas)
  // Wait for ceaExplotacion from getCeaDeuda before fetching
  useEffect(() => {
    if (!contrato?.ceaNumContrato || !ceaExplotacion || ceaConsumosFetched) return;
    if (activeTab !== 'consumo' && activeTab !== 'facturas') return;
    setCeaConsumosFetched(true);
    setCeaConsumosLoading(true);
    getCeaConsumos(contrato.ceaNumContrato, ceaExplotacion)
      .then((data) => setCeaConsumos(data))
      .catch(() => setCeaConsumos([]))
      .finally(() => setCeaConsumosLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, contrato?.ceaNumContrato, ceaExplotacion]);

  // Reset CEA cache when contract changes
  useEffect(() => {
    setCeaConsumos([]);
    setCeaConsumosFetched(false);
    setCeaNombreCliente(null);
    setCeaExplotacion(null);
    setConsumoAnioFiltro('todos');
    setFugaFolio(null);
    setXmlError(null);
  }, [contratoId]);

  const loading = loadingContratos || loadingData || ceaSaldosLoading;

  // Derived: CEA consumos stats + year filter
  const aniosDisponibles = useMemo(
    () => [...new Set(ceaConsumos.map((c) => c.ano).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [ceaConsumos]
  );

  const ceaConsumosFiltrados = useMemo(
    () => (consumoAnioFiltro === 'todos' ? ceaConsumos : ceaConsumos.filter((c) => c.ano === consumoAnioFiltro)),
    [ceaConsumos, consumoAnioFiltro]
  );

  const consumoStats = useMemo(() => {
    const vals = ceaConsumosFiltrados.map((c) => c.metrosCubicos);
    if (vals.length === 0) return { promedio: 0, maximo: 0, minimo: 0, total: 0, count: 0 };
    const positivos = vals.filter((v) => v > 0);
    return {
      promedio: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      maximo: Math.max(...vals),
      minimo: positivos.length > 0 ? Math.min(...positivos) : 0,
      total: vals.reduce((a, b) => a + b, 0),
      count: vals.length,
    };
  }, [ceaConsumosFiltrados]);

  // Derived: facturas rows
  const facturasRows = useMemo(() => {
    const hoy = new Date().toISOString().split('T')[0];
    return timbrados.map((t) => {
      const recibo = t.recibos?.[0];
      const saldoVigente = recibo ? Number(recibo.saldoVigente) : 0;
      const saldoVencido = recibo ? Number(recibo.saldoVencido) : 0;
      const saldo = saldoVigente + saldoVencido;
      const vencimiento = recibo?.fechaVencimiento ?? t.fechaVencimiento;
      const estado = saldo <= 0 ? 'Pagada' : vencimiento && vencimiento < hoy ? 'Vencida' : 'Pendiente';
      const periodoDisplay = t.periodo ? t.periodo.replace(/-(\d{2})$/, '/$1') : '—';
      return {
        id: t.id,
        periodo: t.periodo,
        periodoDisplay,
        fechaFac: t.fechaEmision,
        vencimiento: vencimiento || '—',
        importe: Number(t.total),
        saldo,
        estado,
        uuid: t.uuid,
      };
    });
  }, [timbrados]);

  const facturasFiltradas = useMemo(() => {
    return facturasRows.filter((f) => {
      const matchFolio = folioSearch === '' || f.id.toLowerCase().includes(folioSearch.toLowerCase());
      const matchEstado = filtroEstado === 'todos' || f.estado === filtroEstado;
      return matchFolio && matchEstado;
    });
  }, [facturasRows, folioSearch, filtroEstado]);

  const ultimaFactura = facturasRows[0] ?? null;

  // When ceaNumContrato is linked, always use CEA consumos as facturas source.
  // Hydra DB timbrados may be seed data and are not authoritative.
  const useCeaForFacturas = !!(contrato?.ceaNumContrato && ceaConsumos.length > 0);

  const facturasFromCea = useMemo(() => {
    if (!useCeaForFacturas) return [];
    return ceaConsumos.map((c, i) => ({
      id: `cea-${i}`,
      periodoDisplay: c.periodo || '—',
      fechaFac: c.fechaInicio || '—',
      vencimiento: c.fechaFin || '—',
      importe: c.importeTotal,
      estado: 'Histórico',
      uuid: '',
      conceptos: c.conceptos,
    }));
  }, [ceaConsumos, useCeaForFacturas]);

  // CEA takes priority when linked; fall back to hydra timbrados
  const facturasEfectivas = useCeaForFacturas
    ? facturasFromCea.filter((f) =>
        folioSearch === '' || f.periodoDisplay.toLowerCase().includes(folioSearch.toLowerCase())
      )
    : facturasFiltradas;

  const facturasTotalPaginas = Math.ceil(facturasEfectivas.length / FACTURAS_POR_PAGINA);

  const facturasPaginadas = useMemo(() => {
    const start = (facturasPagina - 1) * FACTURAS_POR_PAGINA;
    return facturasEfectivas.slice(start, start + FACTURAS_POR_PAGINA);
  }, [facturasEfectivas, facturasPagina]);

  // CEA consumos take priority when available; fall back to hydra backend
  const consumosRows = useMemo(() => {
    if (ceaConsumosFiltrados.length > 0) {
      return ceaConsumosFiltrados.map((c, i) => ({
        id: `cea-${i}`,
        periodoDisplay: c.periodo || '—',
        m3: c.metrosCubicos,
        tipo: 'Real',
        importe: c.importeTotal,
        fechaInicio: c.fechaInicio,
        fechaFin: c.fechaFin,
      }));
    }
    if (consumoAnioFiltro === 'todos') {
      return consumos.map((c) => ({
        id: c.id,
        periodoDisplay: c.periodo ? c.periodo.replace(/-(\d{2})$/, '/$1') : '—',
        m3: Number(c.m3),
        tipo: c.tipo,
        importe: undefined as undefined,
        fechaInicio: undefined as undefined,
        fechaFin: undefined as undefined,
      }));
    }
    return [];
  }, [ceaConsumosFiltrados, consumos, consumoAnioFiltro]);

  const consumosTotalPaginas = Math.ceil(consumosRows.length / FACTURAS_POR_PAGINA);

  const consumosPaginados = useMemo(() => {
    const start = (consumosPagina - 1) * FACTURAS_POR_PAGINA;
    return consumosRows.slice(start, start + FACTURAS_POR_PAGINA);
  }, [consumosRows, consumosPagina]);

  // Descarga del XML CFDI vía fetch con JWT → blob (window.open directo da 401)
  const handleDescargarXml = useCallback(async (timbradoId: string) => {
    setXmlError(null);
    setDescargandoXmlId(timbradoId);
    try {
      await descargarPortalCfdiXml(timbradoId);
    } catch (e) {
      setXmlError(e instanceof Error ? e.message : 'No se pudo descargar el XML');
    } finally {
      setDescargandoXmlId(null);
    }
  }, []);

  // Gráfica: últimos 12 periodos de consumo (m³), CEA cuando está vinculado
  const consumoChartData = useMemo(() => {
    const parseCeaKey = (c: CeaConsumo): number => {
      const f = c.fechaInicio ?? '';
      const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(f);
      if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]).getTime();
      const iso = /^\d{4}-\d{2}-\d{2}/.test(f) ? new Date(f).getTime() : NaN;
      if (!Number.isNaN(iso)) return iso;
      const ano = parseInt(c.ano || '0', 10);
      const per = parseInt((c.periodo || '').replace(/\D/g, '') || '0', 10);
      return ano * 100 + per;
    };
    const rows =
      ceaConsumos.length > 0
        ? [...ceaConsumos]
            .sort((a, b) => parseCeaKey(a) - parseCeaKey(b))
            .map((c) => ({ periodo: c.periodo || '—', m3: c.metrosCubicos, estimado: false }))
        : [...consumos]
            .sort((a, b) => (a.periodo ?? '').localeCompare(b.periodo ?? ''))
            .map((c) => ({
              periodo: c.periodo ? c.periodo.replace(/-(\d{2})$/, '/$1') : '—',
              m3: Number(c.m3),
              estimado: /estimad/i.test(c.tipo ?? ''),
            }));
    return rows.slice(-12);
  }, [ceaConsumos, consumos]);

  const hayEstimados = consumoChartData.some((d) => d.estimado);

  // Reportes de fuga del contrato
  const reportesFugaQ = useQuery({
    queryKey: ['portal-reportes-fuga', contratoId],
    queryFn: () => getPortalReportesFuga(contratoId!),
    enabled: !!contratoId,
  });

  const crearFugaMutation = useMutation({
    mutationFn: (data: { descripcion: string; ubicacion?: string }) =>
      crearPortalReporteFuga(contratoId!, data),
    onSuccess: (reporte) => {
      setFugaFolio(reporte.id);
      setFugaDescripcion('');
      setFugaUbicacion('');
      queryClient.invalidateQueries({ queryKey: ['portal-reportes-fuga', contratoId] });
    },
  });

  const handleEnviarReporteFuga = () => {
    if (!fugaDescripcion.trim() || !contratoId) return;
    setFugaFolio(null);
    crearFugaMutation.mutate({
      descripcion: fugaDescripcion.trim(),
      ...(fugaUbicacion.trim() ? { ubicacion: fugaUbicacion.trim() } : {}),
    });
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading && !contrato) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Cargando información…</p>
        </div>
      </div>
    );
  }

  if (!contrato && !loadingContratos) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">Seleccione un contrato para continuar.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* ── INICIO ─────────────────────────────────────────────────────────── */}
      {activeTab === 'inicio' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Bienvenido, {ceaNombreCliente || contrato?.nombre || '—'}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Consulta tu consumo, facturas, pagos y gestiona tus trámites desde aquí.
            </p>
          </div>

          {/* Saldos */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Vencido', value: saldos.vencido, color: 'text-red-600' },
              { label: 'Vigente', value: saldos.vigente, color: 'text-green-600' },
              { label: 'Total', value: saldos.total, color: 'text-gray-900' },
              { label: 'Intereses', value: saldos.intereses, color: 'text-gray-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white border border-gray-200 rounded-xl p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</p>
                <p className={`text-2xl font-bold tabular-nums ${color}`}>{fmt(value)}</p>
                <p className="text-xs text-gray-400 mt-0.5">MXN</p>
              </div>
            ))}
          </div>

          {/* Contract details */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Datos del Contrato</p>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Dirección</p>
                <p className="text-sm text-gray-800">{contrato?.direccion || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Fecha de Alta</p>
                <p className="text-sm text-gray-800">{contrato?.fecha || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">RFC / NIF</p>
                <p className="text-sm font-mono text-gray-800">{contrato?.rfc || '—'}</p>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: 'Pagar en línea', tab: 'pagar' as TabValue, icon: CreditCard, desc: 'Paga tu saldo por SPEI, OXXO o tarjeta' },
              { label: 'Ver mis facturas', tab: 'facturas' as TabValue, icon: FileText, desc: 'Historial y estado de tus facturas' },
              { label: 'Mis recibos', tab: 'recibos' as TabValue, icon: Receipt, desc: 'Pagos realizados y comprobantes' },
              { label: 'Trámites digitales', tab: 'tramites-digitales' as TabValue, icon: BarChart3, desc: 'Solicitudes y gestión de servicio' },
            ].map(({ label, tab, icon: Icon, desc }) => (
              <button
                key={tab}
                onClick={() => setTab(tab)}
                className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-blue-300 hover:shadow-sm transition-all group"
              >
                <div className="h-10 w-10 bg-blue-50 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition-colors">
                  <Icon className="h-5 w-5 text-blue-600" aria-hidden />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-300 ml-auto group-hover:text-blue-500 transition-colors" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── CONSUMO ────────────────────────────────────────────────────────── */}
      {activeTab === 'consumo' && (
        <div className="space-y-6">
          <Breadcrumb items={[{ label: 'Portal', onClick: () => setTab('inicio') }, { label: 'Consumo' }]} />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Mi Consumo</h1>
              <p className="mt-1 text-sm text-gray-500">Historial de lecturas de consumo de agua potable.</p>
            </div>
          </div>

          {/* Loading spinner while fetching CEA consumos */}
          {ceaConsumosLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-500">Cargando consumos…</p>
              </div>
            </div>
          )}

          {!ceaConsumosLoading && ceaConsumos.length > 0 && (
            <>
              {/* Filtro por año */}
              {aniosDisponibles.length > 1 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700">Filtrar por año:</span>
                  <SearchableSelect
                    options={[{ value: 'todos', label: 'Todos los años' }, ...aniosDisponibles.map((a) => ({ value: a, label: a }))]}
                    value={consumoAnioFiltro}
                    onValueChange={(v) => { setConsumoAnioFiltro(v); setConsumosPagina(1); }}
                    placeholder="Todos los años"
                    searchPlaceholder="Buscar año…"
                    className="w-44"
                  />
                </div>
              )}

              {/* Stats cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Promedio Mensual', value: `${consumoStats.promedio} m³`, sub: `${consumoStats.count} períodos` },
                  { label: 'Consumo Máximo', value: `${consumoStats.maximo} m³`, sub: 'Pico registrado' },
                  { label: 'Consumo Mínimo', value: `${consumoStats.minimo} m³`, sub: 'Menor consumo' },
                  { label: 'Consumo Total', value: `${consumoStats.total} m³`, sub: 'Suma de períodos' },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="bg-white border border-gray-200 rounded-xl p-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</p>
                    <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Gráfica de consumo histórico (últimos 12 periodos) */}
          {!ceaConsumosLoading && consumoChartData.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                <h2 className="text-base font-semibold text-gray-900">
                  Consumo Histórico (últimos {consumoChartData.length} periodos)
                </h2>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-blue-500 inline-block" />
                    Lectura real
                  </span>
                  {hayEstimados && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-amber-400 inline-block" />
                      Consumo estimado
                    </span>
                  )}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={consumoChartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="periodo"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    label={{ value: 'm³', position: 'insideTopLeft', offset: 0, fontSize: 11, fill: '#94a3b8' }}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(59,130,246,0.06)' }}
                    formatter={(value, _name, entry) => [
                      `${value} m³${(entry?.payload as { estimado?: boolean } | undefined)?.estimado ? ' (estimado)' : ''}`,
                      'Consumo',
                    ]}
                    labelFormatter={(label) => `Periodo ${label}`}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="m3" radius={[4, 4, 0, 0]} maxBarSize={48}>
                    {consumoChartData.map((d, i) => (
                      <Cell key={i} fill={d.estimado ? '#fbbf24' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabla de consumos */}
          {!ceaConsumosLoading && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">
                  Histórico de Consumo{consumosRows.length > 0 ? ` (${consumosRows.length})` : ''}
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Periodo</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Fechas</th>
                    <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Consumo (m³)</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Tipo</th>
                    {ceaConsumos.length > 0 && (
                      <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Importe</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {consumosRows.length === 0 ? (
                    <tr>
                      <td colSpan={ceaConsumos.length > 0 ? 5 : 4} className="px-5 py-10 text-center text-gray-400 text-sm">
                        {ceaExplotacion
                          ? 'No hay consumos registrados para este contrato.'
                          : 'Cargando datos del contrato…'}
                      </td>
                    </tr>
                  ) : (
                    consumosPaginados.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-4 font-medium text-gray-800">{r.periodoDisplay}</td>
                        <td className="px-5 py-4 text-gray-500 text-xs">
                          {r.fechaInicio ? (
                            <span>{r.fechaInicio}{r.fechaFin ? ` → ${r.fechaFin}` : ''}</span>
                          ) : '—'}
                        </td>
                        <td className="px-5 py-4 text-right tabular-nums font-semibold text-gray-800">{r.m3}</td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">
                            {r.tipo}
                          </span>
                        </td>
                        {ceaConsumos.length > 0 && (
                          <td className="px-5 py-4 text-right tabular-nums text-gray-700">
                            {r.importe != null ? fmt(r.importe) : '—'}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {consumosRows.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2 text-sm text-gray-500">
                  <span>
                    Mostrando {(consumosPagina - 1) * FACTURAS_POR_PAGINA + 1}–{Math.min(consumosPagina * FACTURAS_POR_PAGINA, consumosRows.length)} de {consumosRows.length} períodos
                  </span>
                  {consumosTotalPaginas > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setConsumosPagina((p) => Math.max(1, p - 1))}
                        disabled={consumosPagina === 1}
                        className="px-2 py-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        &lt;
                      </button>
                      {Array.from({ length: consumosTotalPaginas }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === consumosTotalPaginas || Math.abs(p - consumosPagina) <= 1)
                        .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                          if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…');
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((item, idx) =>
                          item === '…' ? (
                            <span key={`ellipsis-${idx}`} className="px-1 text-gray-400 text-xs">…</span>
                          ) : (
                            <button
                              key={item}
                              onClick={() => setConsumosPagina(item as number)}
                              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                                consumosPagina === item
                                  ? 'bg-blue-600 text-white'
                                  : 'text-gray-500 hover:bg-gray-100'
                              }`}
                            >
                              {item}
                            </button>
                          )
                        )}
                      <button
                        onClick={() => setConsumosPagina((p) => Math.min(consumosTotalPaginas, p + 1))}
                        disabled={consumosPagina === consumosTotalPaginas}
                        className="px-2 py-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        &gt;
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── FACTURAS ───────────────────────────────────────────────────────── */}
      {activeTab === 'facturas' && (
        <div className="space-y-6">
          <Breadcrumb items={[{ label: 'Portal de Clientes', onClick: () => setTab('inicio') }, { label: 'Mis Facturas' }]} />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Mis Facturas</h1>
              <p className="mt-1 text-sm text-gray-500">Historial de períodos facturados del servicio de agua potable.</p>
            </div>
          </div>

          {/* Loading while waiting for explotacion or consumos */}
          {(ceaSaldosLoading || ceaConsumosLoading) && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-500">Cargando información…</p>
              </div>
            </div>
          )}

          {/* Summary banner — Estado de cuenta + última factura generada */}
          {!ceaSaldosLoading && !ceaConsumosLoading && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
                <div className="p-6 sm:w-56 shrink-0">
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-2">Estado de Cuenta</p>
                  <p className="text-4xl font-bold text-gray-900 tabular-nums">{fmt(saldos.total)}</p>
                  {saldos.vencido > 0 ? (
                    <span className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">
                      <AlertCircle className="h-3 w-3" aria-hidden /> Pendiente de Pago
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                      Al corriente
                    </span>
                  )}
                </div>
                <div className="p-6 flex-1">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-base font-semibold text-gray-900">Última Factura Generada</p>
                      <p className="text-sm text-gray-500 mt-0.5">
                        Periodo: {facturasEfectivas[0]?.periodoDisplay ?? '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Fecha de Vencimiento</p>
                      <p className="text-sm font-bold text-gray-800 mt-0.5">
                        {facturasEfectivas[0]?.vencimiento ?? '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-5 flex-wrap">
                    <button
                      onClick={() => setTab('pagar')}
                      className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
                    >
                      <CreditCard className="h-4 w-4" aria-hidden />
                      Pagar Ahora
                    </button>
                    <button
                      disabled
                      className="flex items-center gap-2 border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold opacity-50 cursor-not-allowed"
                    >
                      <Download className="h-4 w-4" aria-hidden />
                      Descargar PDF
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Historial */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 mr-1">
                <RefreshCw className="h-4 w-4 text-blue-600" aria-hidden />
                <h2 className="text-base font-semibold text-gray-900">
                  {facturasFromCea.length > 0
                    ? `Períodos de Facturación (${facturasFromCea.length})`
                    : 'Historial de Facturación'}
                </h2>
              </div>
              {facturasFromCea.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Datos en tiempo real
                </span>
              )}
              {facturasRows.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Buscar por folio..."
                      value={folioSearch}
                      onChange={(e) => { setFolioSearch(e.target.value); setFacturasPagina(1); }}
                      className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-48"
                    />
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <select
                    value={filtroEstado}
                    onChange={(e) => { setFiltroEstado(e.target.value); setFacturasPagina(1); }}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="todos">Todos los estados</option>
                    <option value="Pagada">Pagada</option>
                    <option value="Pendiente">Pendiente</option>
                    <option value="Vencida">Vencida</option>
                  </select>
                </div>
              )}
            </div>

            {/* Loading */}
            {ceaConsumosLoading && (
              <div className="px-5 py-10 text-center">
                <div className="h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm text-gray-400">Cargando información…</p>
              </div>
            )}

            {/* Error de descarga de CFDI */}
            {xmlError && (
              <div className="mx-5 mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-red-700">{xmlError}</p>
              </div>
            )}

            {!ceaConsumosLoading && facturasFromCea.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Periodo</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Fecha Inicio</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Fecha Fin</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Importe</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Conceptos</th>
                  </tr>
                </thead>
                <tbody>
                  {facturasPaginadas.map((f) => (
                    <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4 font-medium text-gray-800">{f.periodoDisplay}</td>
                      <td className="px-5 py-4 text-gray-600">{f.fechaFac}</td>
                      <td className="px-5 py-4 text-gray-600">{f.vencimiento}</td>
                      <td className="px-5 py-4 text-right tabular-nums font-semibold text-gray-800">{fmt(f.importe)}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {('conceptos' in f ? f.conceptos : []).slice(0, 2).map((c: { descripcion: string }, i: number) => (
                            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                              {c.descripcion || '—'}
                            </span>
                          ))}
                          {('conceptos' in f ? f.conceptos : []).length > 2 && (
                            <span className="text-xs text-gray-400">+{('conceptos' in f ? f.conceptos : []).length - 2}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!ceaConsumosLoading && facturasFromCea.length === 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Folio</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Fecha de Emisión</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Periodo</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Monto</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Estado</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {facturasEfectivas.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-gray-400 text-sm">
                        {ceaExplotacion
                          ? 'No hay facturas registradas para este contrato.'
                          : 'Cargando datos del contrato…'}
                      </td>
                    </tr>
                  ) : (
                    (facturasPaginadas as typeof facturasFiltradas).map((f) => (
                      <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-4 font-mono text-blue-600 font-medium">{f.id}</td>
                        <td className="px-5 py-4 text-gray-600">{f.fechaFac}</td>
                        <td className="px-5 py-4 text-blue-500 font-medium">{f.periodoDisplay}</td>
                        <td className="px-5 py-4 text-right tabular-nums font-semibold text-gray-800">{fmt(f.importe)}</td>
                        <td className="px-5 py-4"><StatusPill status={f.estado} /></td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            {f.uuid ? (
                              <button
                                onClick={() => handleDescargarXml(f.id)}
                                disabled={descargandoXmlId === f.id}
                                title="Descargar CFDI (XML)"
                                className="flex items-center gap-1.5 text-blue-600 text-xs font-semibold px-2 py-1.5 rounded-md hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
                              >
                                {descargandoXmlId === f.id ? (
                                  <span className="h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" aria-hidden />
                                ) : (
                                  <Download className="h-3.5 w-3.5" aria-hidden />
                                )}
                                CFDI (XML)
                              </button>
                            ) : (
                              <button
                                disabled
                                title="El comprobante aún no está timbrado"
                                className="flex items-center gap-1.5 text-gray-400 text-xs font-semibold px-2 py-1.5 rounded-md opacity-40 cursor-not-allowed"
                              >
                                <Download className="h-3.5 w-3.5" aria-hidden />
                                CFDI (XML)
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {facturasEfectivas.length > 0 && (
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2 text-sm text-gray-500">
                <span>
                  Mostrando {(facturasPagina - 1) * FACTURAS_POR_PAGINA + 1}–{Math.min(facturasPagina * FACTURAS_POR_PAGINA, facturasEfectivas.length)} de {facturasEfectivas.length} {facturasFromCea.length > 0 ? 'períodos' : 'facturas'}
                </span>
                {facturasTotalPaginas > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setFacturasPagina((p) => Math.max(1, p - 1))}
                      disabled={facturasPagina === 1}
                      className="px-2 py-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      &lt;
                    </button>
                    {Array.from({ length: facturasTotalPaginas }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === facturasTotalPaginas || Math.abs(p - facturasPagina) <= 1)
                      .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                        if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…');
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((item, idx) =>
                        item === '…' ? (
                          <span key={`ellipsis-${idx}`} className="px-1 text-gray-400 text-xs">…</span>
                        ) : (
                          <button
                            key={item}
                            onClick={() => setFacturasPagina(item as number)}
                            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                              facturasPagina === item
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            {item}
                          </button>
                        )
                      )}
                    <button
                      onClick={() => setFacturasPagina((p) => Math.min(facturasTotalPaginas, p + 1))}
                      disabled={facturasPagina === facturasTotalPaginas}
                      className="px-2 py-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      &gt;
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RECIBOS ────────────────────────────────────────────────────────── */}
      {activeTab === 'recibos' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Mis Recibos</h1>
              <p className="mt-1 text-sm text-gray-500">Gestiona y visualiza tu historial de pagos del servicio de agua potable.</p>
            </div>
            <button
              disabled
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold opacity-50 cursor-not-allowed"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo Pago
            </button>
          </div>

          {/* Sub-tabs pill */}
          <div className="bg-white border border-gray-200 rounded-xl p-1.5 flex gap-1">
            {(['recientes', 'historico', 'pendientes', 'facturas'] as const).map((st) => {
              const labels = { recientes: 'Recientes', historico: 'Histórico', pendientes: 'Pendientes', facturas: 'Facturas' };
              return (
                <button
                  key={st}
                  onClick={() => setRecibosSubtab(st)}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
                    recibosSubtab === st
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {labels[st]}
                </button>
              );
            })}
          </div>

          {/* Table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Fecha</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Concepto</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Forma de Pago</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Monto</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pagos.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-gray-400 text-sm">
                      No hay recibos registrados para este contrato.
                    </td>
                  </tr>
                ) : (
                  pagos.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                            <Calendar className="h-4 w-4 text-blue-500" aria-hidden />
                          </div>
                          <span className="tabular-nums text-gray-700">{p.fecha}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-800">{p.concepto}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 text-gray-500">
                          <CreditCard className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                          {p.tipo}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums font-semibold text-gray-800">
                        {fmt(Number(p.monto))}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button disabled className="flex items-center gap-1.5 text-blue-600 text-sm font-medium opacity-40 cursor-not-allowed ml-auto">
                          <Download className="h-4 w-4" aria-hidden />
                          Descargar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {pagos.length > 0 && (
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                <span>Mostrando {pagos.length} de {pagos.length} recibos</span>
                <div className="flex items-center gap-1">
                  <button disabled className="px-2 py-1 rounded text-gray-300 cursor-not-allowed">&lt;</button>
                  <button className="px-3 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold">1</button>
                  <button disabled className="px-2 py-1 rounded text-gray-300 cursor-not-allowed">&gt;</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PAGAR EN LÍNEA ─────────────────────────────────────────────────── */}
      {activeTab === 'pagar' && contratoId && (
        <div className="space-y-6">
          <Breadcrumb items={[{ label: 'Portal', onClick: () => setTab('inicio') }, { label: 'Pagar en línea' }]} />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Pagar en Línea</h1>
            <p className="mt-1 text-sm text-gray-500">
              Genera una referencia de pago por SPEI, OXXO o tarjeta y liquida tu saldo sin salir de casa.
            </p>
          </div>
          <PagarEnLinea contratoId={contratoId} />
        </div>
      )}

      {/* ── MÉTODOS DE PAGO ────────────────────────────────────────────────── */}
      {activeTab === 'metodos-pago' && (
        <div className="space-y-6">
          <Breadcrumb items={[{ label: 'Inicio', onClick: () => setTab('inicio') }, { label: 'Gestión de Pagos' }]} />
          <h1 className="text-3xl font-bold text-gray-900">Métodos de Pago</h1>
          <p className="text-sm text-gray-500 -mt-4">Administra tus tarjetas y servicios de domiciliación bancaria de forma segura.</p>

          {/* Cards grid */}
          <div className="grid lg:grid-cols-2 gap-5">
            {/* Tarjetas */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-blue-600" aria-hidden />
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Tarjetas de Crédito y Débito</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Usa tus tarjetas para pagos manuales o programados.</p>
                  </div>
                </div>
                <button
                  disabled
                  className="flex items-center gap-1.5 text-sm font-semibold border border-blue-200 text-blue-600 px-3 py-1.5 rounded-lg opacity-50 cursor-not-allowed hover:bg-blue-50"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Añadir
                </button>
              </div>
              <div className="flex-1 px-5 py-8 flex flex-col items-center justify-center text-center">
                <div className="h-14 w-14 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                  <CreditCard className="h-7 w-7 text-gray-400" aria-hidden />
                </div>
                <p className="text-sm font-medium text-gray-600">No tienes tarjetas registradas</p>
                <p className="text-xs text-gray-400 mt-1">Añade una tarjeta para realizar pagos en línea</p>
              </div>
              <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-1.5 text-xs text-gray-400">
                <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Tus datos están protegidos con encriptación bancaria de 256 bits.
              </div>
            </div>

            {/* Domiciliación */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-blue-600" aria-hidden />
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Domiciliación Bancaria</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Configura el cargo automático a tu cuenta de cheques o ahorros.</p>
                  </div>
                </div>
              </div>
              <div className="flex-1 px-5 py-6 flex flex-col items-center justify-center text-center">
                <div className="h-14 w-14 bg-blue-50 rounded-full flex items-center justify-center mb-3">
                  <RefreshCw className="h-7 w-7 text-blue-400" aria-hidden />
                </div>
                <p className="text-sm font-semibold text-gray-800">Ahorra tiempo y evita recargos</p>
                <p className="text-xs text-gray-500 mt-1 max-w-xs">
                  Al activar la domiciliación, tus recibos se pagarán automáticamente en la fecha de vencimiento.
                </p>
                <div className="mt-4 w-full border border-dashed border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-500">Estado del servicio:</span>
                    <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded">INACTIVO</span>
                  </div>
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold opacity-50 cursor-not-allowed"
                  >
                    <span className="text-base">⚙</span>
                    Configurar Domiciliación
                  </button>
                </div>
              </div>
              <div className="mx-5 mb-4 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5">
                <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-yellow-700">
                  Recuerda que debes tener una tarjeta o CLABE registrada para activar este servicio.
                </p>
              </div>
            </div>
          </div>

          {/* Actividad reciente */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-600" aria-hidden />
              <h2 className="text-base font-semibold text-gray-900">Actividad Reciente</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Fecha</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Acción</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Método</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-gray-400 text-sm">
                    No hay actividad reciente registrada.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TRÁMITES DIGITALES ─────────────────────────────────────────────── */}
      {activeTab === 'tramites-digitales' && (
        <div className="space-y-8">
          <Breadcrumb items={[{ label: 'Portal CEA', onClick: () => setTab('inicio') }, { label: 'Trámites Digitales' }]} />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Trámites Digitales</h1>
              <p className="mt-1 text-sm text-gray-500 max-w-lg">
                Gestiona tus servicios de agua potable, alcantarillado y saneamiento de manera eficiente y segura desde cualquier lugar.
              </p>
            </div>
            <button
              disabled
              className="flex items-center gap-2 border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium opacity-60 cursor-not-allowed"
            >
              <HelpCircle className="h-4 w-4" aria-hidden />
              Guía de Trámites
            </button>
          </div>

          {/* CONTRATOS */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-6 w-6 bg-blue-50 rounded flex items-center justify-center shrink-0">
                <FileText className="h-3.5 w-3.5 text-blue-600" aria-hidden />
              </div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-700">Contratos</h2>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { icon: FilePlus, title: 'Alta de Contrato', desc: 'Solicita un nuevo servicio de agua potable para uso doméstico o comercial.', cta: 'Iniciar trámite', active: false },
                { icon: UserPlus, title: 'Cambio de Propietario', desc: 'Actualiza los datos del titular del contrato por compra-venta o herencia.', cta: 'Iniciar trámite', active: true, href: '/portal/tramites/cambio-propietario' },
                { icon: PowerOff, title: 'Baja Temporal', desc: 'Suspende el servicio por un período definido sin cancelar el contrato.', cta: 'Iniciar trámite', active: true, href: '/portal/tramites/baja-temporal' },
                { icon: UserMinus, title: 'Baja Permanente', desc: 'Cancelación definitiva del contrato de suministro y retiro de medidor.', cta: 'Iniciar trámite', active: true, href: '/portal/tramites/baja-definitiva' },
              ].map(({ icon: Icon, title, desc, cta, active, href }) => (
                <div key={title} className={`bg-white border rounded-xl p-5 flex flex-col gap-3 transition-colors ${active ? 'border-gray-200 hover:border-blue-300 hover:shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="h-10 w-10 bg-gray-100 rounded-full flex items-center justify-center">
                    <Icon className="h-5 w-5 text-gray-600" aria-hidden />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-gray-900">{title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{desc}</p>
                  </div>
                  {active ? (
                    <button
                      onClick={() => navigate(href!)}
                      className="flex items-center gap-1 text-sm font-semibold text-blue-600 hover:gap-2 transition-all"
                    >
                      {cta} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : (
                    <button disabled className="flex items-center gap-1 text-sm font-semibold text-blue-600 opacity-30 cursor-not-allowed">
                      {cta} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* DESCUENTOS */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-6 w-6 bg-blue-50 rounded flex items-center justify-center shrink-0">
                <BadgePercent className="h-3.5 w-3.5 text-blue-600" aria-hidden />
              </div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-700">Descuentos</h2>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 hover:border-gray-300 transition-colors">
                <div className="h-10 w-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <BadgePercent className="h-5 w-5 text-gray-600" aria-hidden />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-gray-900">Jubilado / Pensionado</h3>
                  <p className="text-xs text-gray-500 mt-1">Solicitud de tarifa especial para adultos mayores o personas jubiladas.</p>
                </div>
                <button disabled className="flex items-center gap-1 text-sm font-semibold text-blue-600 opacity-50 cursor-not-allowed">
                  Aplicar ahora <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          </section>

          {/* SOLICITUDES */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-6 w-6 bg-blue-50 rounded flex items-center justify-center shrink-0">
                <Receipt className="h-3.5 w-3.5 text-blue-600" aria-hidden />
              </div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-700">Solicitudes</h2>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 hover:border-gray-300 transition-colors">
                <div className="h-10 w-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <Plug className="h-5 w-5 text-gray-600" aria-hidden />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-gray-900">Reconexión</h3>
                  <p className="text-xs text-gray-500 mt-1">Solicita la reactivación del servicio tras haber cubierto adeudos pendientes.</p>
                </div>
                <button disabled className="flex items-center gap-1 text-sm font-semibold text-blue-600 opacity-50 cursor-not-allowed">
                  Solicitar <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          </section>

          {/* REPORTE DE FUGAS */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-6 w-6 bg-blue-50 rounded flex items-center justify-center shrink-0">
                <Droplets className="h-3.5 w-3.5 text-blue-600" aria-hidden />
              </div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-700">Reporte de Fugas</h2>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="grid lg:grid-cols-2 gap-5">
              {/* Formulario */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Reportar una fuga de agua</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Describe la fuga y, si es posible, una referencia de ubicación. Nuestro equipo de operación la atenderá a la brevedad.
                  </p>
                </div>

                {fugaFolio && (
                  <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-xs text-green-700">
                      Reporte recibido. Tu folio de seguimiento es{' '}
                      <span className="font-mono font-bold">{fugaFolio}</span>.
                    </p>
                  </div>
                )}

                {crearFugaMutation.isError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-xs text-red-700">
                      {crearFugaMutation.error instanceof Error
                        ? crearFugaMutation.error.message
                        : 'No se pudo enviar el reporte. Intenta de nuevo.'}
                    </p>
                  </div>
                )}

                <div>
                  <label htmlFor="fuga-descripcion" className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Descripción de la fuga <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="fuga-descripcion"
                    value={fugaDescripcion}
                    onChange={(e) => setFugaDescripcion(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="Ej. Fuga de agua en la banqueta frente a mi domicilio, brota constantemente…"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>
                <div>
                  <label htmlFor="fuga-ubicacion" className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Referencia de ubicación <span className="text-gray-400 normal-case font-normal">(opcional)</span>
                  </label>
                  <input
                    id="fuga-ubicacion"
                    type="text"
                    value={fugaUbicacion}
                    onChange={(e) => setFugaUbicacion(e.target.value)}
                    maxLength={500}
                    placeholder="Ej. Esquina de Av. Universidad y calle Hidalgo, junto al poste de luz"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={handleEnviarReporteFuga}
                  disabled={!fugaDescripcion.trim() || crearFugaMutation.isPending}
                  className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {crearFugaMutation.isPending ? (
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden />
                  ) : (
                    <Droplets className="h-4 w-4" aria-hidden />
                  )}
                  Enviar reporte
                </button>
              </div>

              {/* Historial de reportes */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-bold text-gray-900">
                    Mis reportes{reportesFugaQ.data && reportesFugaQ.data.length > 0 ? ` (${reportesFugaQ.data.length})` : ''}
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">Seguimiento del estado de tus reportes de fuga.</p>
                </div>
                <div className="flex-1 overflow-y-auto max-h-96 divide-y divide-gray-50">
                  {reportesFugaQ.isLoading && (
                    <div className="px-5 py-10 text-center">
                      <div className="h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-sm text-gray-400">Cargando reportes…</p>
                    </div>
                  )}
                  {!reportesFugaQ.isLoading && (reportesFugaQ.data?.length ?? 0) === 0 && (
                    <div className="px-5 py-10 text-center text-sm text-gray-400">
                      No has registrado reportes de fuga para este contrato.
                    </div>
                  )}
                  {(reportesFugaQ.data ?? []).map((r) => (
                    <div key={r.id} className="px-5 py-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-xs font-mono text-blue-600 font-medium">{r.id}</span>
                        <FugaEstadoPill estado={r.estado} />
                      </div>
                      <p className="text-sm text-gray-700 mt-1.5 whitespace-pre-line line-clamp-3">{r.descripcion}</p>
                      <p className="text-xs text-gray-400 mt-1.5 tabular-nums">
                        {r.fecha ? new Date(r.fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Help banner */}
          <div className="bg-blue-600 rounded-2xl p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="text-white">
              <h2 className="text-xl font-bold">¿Necesitas ayuda con tu trámite?</h2>
              <p className="text-blue-200 text-xs font-semibold uppercase tracking-wider mt-1">Nuestro agente usa inteligencia artificial</p>
              <p className="text-blue-100 text-sm mt-2">
                María está especializada en trámites de agua potable, alcantarillado y saneamiento. Te guía paso a paso, resuelve tus dudas y procesa tus solicitudes al instante.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 shrink-0">
              <a
                href="https://wa.me/524424700013"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-white text-blue-700 px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-50 transition-colors shadow-sm"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                Habla con María
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalCliente;
