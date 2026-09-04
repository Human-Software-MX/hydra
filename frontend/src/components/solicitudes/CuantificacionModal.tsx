/**
 * CuantificacionModal — Formulario de cuantificación / cotización.
 *
 * Secciones:
 *  - Encabezado: administración, folio, certificado, contratante, fechas, forma de pago
 *  - Ubicación del servicio: domicilio, materiales (si hay inspección)
 *  - Requerimientos: diámetros, longitudes, tarifa, unidades, elabora, observaciones
 *  - Agua (si aplica): tipo, periodo, meses, consumo m³
 *
 * El cálculo detallado se implementará en una tarea posterior.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { fetchAdministraciones } from '@/api/catalogos';
import { fetchSolicitud } from '@/api/solicitudes';
import { inspeccionDtoToOrdenData } from '@/lib/cotizacion';
import {
  fetchInegiMunicipiosCatalogo,
  fetchInegiLocalidadesCatalogo,
  fetchInegiColoniasCatalogo,
} from '@/api/domicilios-inegi';
import {
  getTiposTarifa,
  resolveAdministracion,
  calcularCargoPeriodo,
  RECARGO_MENSUAL,
} from '@/lib/tarifas';
import {
  calcularCargoAguaPeriodoApi,
  getReglasPorcentuales,
  REGLAS_PORCENTUALES_FALLBACK,
  type ReglasPorcentuales,
} from '@/lib/cotizacion-motor';
import { fetchTipoContratacion } from '@/api/tipos-contratacion';
import { hasApi } from '@/api/client';
import type { SolicitudRecord, OrdenInspeccionData } from '@/types/solicitudes';

// ── Constantes ────────────────────────────────────────────────────────────────

const TARIFAS_FIJAS = [
  'BENEFICENCIA',
  'COMERCIAL',
  'DOMÉSTICA MEDIO',
  'DOMÉSTICO APOYO SOCIAL',
  'DOMESTICO ECONOMICO',
  'DOMESTICO ZONA RURAL',
  'HIDRANTE',
  'INDUSTRIAL',
  'PÚBLICO CONCESIONADO',
  'SANTA MARIA MAGDALENA',
];

const DIAMETROS_TOMA = ["1/2\"", "3/4\"", "1\"", "1.5\"", "2\"", "3\"", "4\""];

// Materiales del catálogo CSV (claves que entiende cotizacion-tarifas.ts)
const MATERIALES_CALLE = [
  { value: 'concreto_hidraulico', label: 'Concreto hidráulico' },
  { value: 'losa',                label: 'Losa' },
  { value: 'adoquin',             label: 'Adoquín' },
  { value: 'concreto_asfaltico',  label: 'Concreto asfáltico' },
  { value: 'empedrado',           label: 'Empedrado' },
  { value: 'tierra',              label: 'Terracería / tierra' },
];

const MATERIALES_BANQUETA = [
  { value: 'concreto',            label: 'Concreto' },
  { value: 'concreto_hidraulico', label: 'Concreto hidráulico' },
  { value: 'asfalto',             label: 'Asfalto' },
  { value: 'adoquin',             label: 'Adoquín' },
  { value: 'adocreto',            label: 'Adocreto' },
  { value: 'empedrado',           label: 'Empedrado' },
  { value: 'tierra',              label: 'Terracería / tierra' },
  { value: 'cantera',             label: 'Cantera' },
];


const FORMAS_PAGO = [
  { value: 'contado',   label: 'Contado' },
  { value: '3_meses',   label: '3 meses' },
  { value: '6_meses',   label: '6 meses' },
  { value: '9_meses',   label: '9 meses' },
  { value: '12_meses',  label: '12 meses' },
];

const TIPO_AGUA_OPTS = [
  { value: 'individual',  label: 'Individual' },
  { value: 'condominal',  label: 'Condominal' },
];


const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });

/** 0.10 → "10%" (hasta 2 decimales significativos). */
function pctLabel(fraccion: number): string {
  return `${Number((fraccion * 100).toFixed(2))}%`;
}


/** Formatea Date a dd/mm/aaaa con ceros al inicio */
function formatFechaES(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const aaaa = d.getFullYear();
  return `${dd}/${mm}/${aaaa}`;
}

function toMonthInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(yyyymm: string, n: number): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return toMonthInput(d);
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}

function diffMonths(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);
}

// ── Tipos internos ────────────────────────────────────────────────────────────

export interface CuantificacionData {
  folioCuantificacion: string;
  adminNombre: string;       // nombre legible para lookups de tarifas
  noCertConexion: string;
  elabora: string;
  observaciones: string;
  fechaEmision: string;       // ISO date string
  fechaVigencia: string;      // ISO date string
  formaPago: string;
  // Requerimientos
  diametroToma: string;
  diametroDescarga: string;
  tarifa: string;
  unidadesServidas: number;
  // Materiales y longitudes (de inspección o capturadas manual)
  matCalle: string;
  matBanqueta: string;
  mlToma: number;
  mlDescarga: number;
  // Medidor
  // Agua
  incluirAgua: boolean;
  tipoAgua: 'individual' | 'condominal';
  periodoInicio: string;      // YYYY-MM
  periodoFin: string;         // YYYY-MM (auto-computed from inicio + numMeses)
  numMeses: number;
  consumoM3: number;
  aplicaAgua: boolean;
  aplicaAlcantarillado: boolean;
  aplicaSaneamiento: boolean;
}

export interface CuantificacionModalProps {
  record: SolicitudRecord | null;
  open: boolean;
  onClose: () => void;
  tipoContratacionNombre?: string;
  /** Llamado al guardar — el padre persiste los datos */
  onGuardar: (data: CuantificacionData) => Promise<void>;
  /** Llamado al avanzar a aceptar cotización */
  onAceptar: (data: CuantificacionData) => void;
}

// ── Componente ────────────────────────────────────────────────────────────────

export function CuantificacionModal({
  record,
  open,
  onClose,
  tipoContratacionNombre,
  onGuardar,
  onAceptar,
}: CuantificacionModalProps) {
  const fd = record?.formData;

  // Fetch detalle completo para obtener datos de inspección (la lista no los incluye)
  const { data: solicitudDetalle } = useQuery({
    queryKey: ['solicitud', record?.id],
    queryFn: () => fetchSolicitud(record!.id),
    enabled: open && !!record?.id,
    staleTime: 5 * 60 * 1000,
  });

  const insp: OrdenInspeccionData | undefined =
    record?.ordenInspeccion ??
    (solicitudDetalle?.inspeccion
      ? (inspeccionDtoToOrdenData(solicitudDetalle.inspeccion as Record<string, unknown>))
      : undefined);
  const tieneInspeccion = Boolean(insp);

  // Catálogo de administraciones para mostrar nombre legible
  const { data: adminsData } = useQuery({
    queryKey: ['catalogos', 'administraciones'],
    queryFn: fetchAdministraciones,
    staleTime: 30 * 60 * 1000,
    enabled: open,
  });

  const { user } = useAuth();

  const adminNombre = useMemo(() => {
    if (!fd?.adminId) return '—';
    return adminsData?.find((a) => a.id === fd.adminId)?.nombre ?? fd.adminId;
  }, [adminsData, fd?.adminId]);

  // Tarifa: list from CSV catalog filtered to current admin
  const adminCatalogo = resolveAdministracion(adminNombre) ?? 'QUERÉTARO';
  const tiposTarifa = getTiposTarifa(adminCatalogo);

  // Unidades servidas: tomar condoViviendas si condominio, si no dejar vacío
  const unidadesDefault = useMemo(() => {
    if (!fd) return 0;
    if (fd.esCondominio === 'si') {
      return parseInt(fd.condoViviendas, 10) || 0;
    }
    return 0;
  }, [fd]);

  // Tarifa inicial: resolver desde tipoContratacionNombre
  const tarifaDefault = useMemo(() => {
    if (!tipoContratacionNombre) return TARIFAS_FIJAS[0] ?? '';
    // Busca coincidencia parcial en la lista fija
    const upper = tipoContratacionNombre.toUpperCase();
    return TARIFAS_FIJAS.find((t) => upper.includes(t.toUpperCase()) || t.toUpperCase().includes(upper))
      ?? TARIFAS_FIJAS[0] ?? '';
  }, [tipoContratacionNombre, tiposTarifa]);

  // variablesCapturadas de la solicitud (códigos reservados)
  const vc = (fd?.variablesCapturadas ?? {}) as Record<string, unknown>;

  // Defaults: inspección tiene prioridad, luego variablesCapturadas, luego vacío
  const matCalleDefault    = insp?.materialCalle    ?? String(vc.MATERIAL_CALLE    ?? '');
  const matBanquetaDefault = insp?.materialBanqueta ?? String(vc.MATERIAL_BANQUETA ?? '');
  const mlTomaDefault      = parseFloat(String(
    insp?.metrosRupturaAguaCalle ?? insp?.metrosRupturaCalle ?? vc.METROS_TOMA ?? '0'
  )) || 0;
  const mlDescargaDefault  = parseFloat(String(
    insp?.metrosRupturaDrenajeCalle ?? vc.METROS_DESCARGA ?? '0'
  )) || 0;
  const diametroTomaDefault   = insp?.diametroToma ?? String(vc.DIAMETRO_TOMA    ?? '');
  const diametroDescargaDefault =                      String(vc.DIAMETRO_DESCARGA ?? '');

  // ── Estado del formulario ──────────────────────────────────────────────────

  const hoy = new Date();
  const vigenciaDefault = new Date(hoy);
  vigenciaDefault.setDate(vigenciaDefault.getDate() + 5);

  const periodoFinDefault = toMonthInput(hoy);

  // Precarga periodo inicio desde fechaSolicitud; fallback a hoy
  const periodoInicioDefault = (() => {
    if (!record?.fechaSolicitud) return toMonthInput(hoy);
    const d = new Date(record.fechaSolicitud);
    return isNaN(d.getTime()) ? toMonthInput(hoy) : toMonthInput(d);
  })();

  const folio = record?.folio ?? '';
  const [periodoInicio, setPeriodoInicio] = useState(periodoInicioDefault);
  const [periodoFin, setPeriodoFin]       = useState(periodoFinDefault);
  const [noCertConexion, setNoCertConexion]   = useState('');
  const [elabora, setElabora]                 = useState(user?.name ?? '');
  const [observaciones, setObservaciones]     = useState('');
  const [fechaVigencia, setFechaVigencia]     = useState(vigenciaDefault.toISOString().slice(0, 10));
  const [formaPago, setFormaPago]             = useState('contado');
  const [diametroToma, setDiametroToma]       = useState(diametroTomaDefault);
  const [diametroDescarga, setDiametroDescarga] = useState(diametroDescargaDefault);
  const [matCalle, setMatCalle]               = useState(matCalleDefault);
  const [matBanqueta, setMatBanqueta]         = useState(matBanquetaDefault);
  const [mlToma, setMlToma]                   = useState(String(mlTomaDefault || ''));
  const [mlDescarga, setMlDescarga]           = useState(String(mlDescargaDefault || ''));
  const [tarifa, setTarifa]                   = useState(tarifaDefault);
  const [unidades, setUnidades]               = useState(unidadesDefault > 0 ? String(unidadesDefault) : '');
  const [incluirAgua, setIncluirAgua]           = useState(true);
  const [tipoAgua, setTipoAgua]                 = useState<'individual' | 'condominal'>(
    fd?.esCondominio === 'si' ? 'condominal' : 'individual',
  );
  const [consumoM3, setConsumoM3]               = useState('');
  const [aplicaAgua, setAplicaAgua]             = useState(true);
  const [aplicaAlcantarillado, setAplicaAlcantarillado] = useState(true);
  const [aplicaSaneamiento, setAplicaSaneamiento]       = useState(true);
  const [editandoInspeccion, setEditandoInspeccion]     = useState(false);
  // Sin inspección (tipos de individualización que saltan directo a cotización)
  // no hay datos de inspector que proteger: los campos abren editables.
  useEffect(() => {
    if (open) setEditandoInspeccion(!tieneInspeccion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id]);

  // ── Motor de tarifas versionado (API) con fallback offline ────────────────

  // Reglas porcentuales alcantarillado/saneamiento desde conceptos-cobro
  const [reglasPct, setReglasPct] = useState<ReglasPorcentuales>(REGLAS_PORCENTUALES_FALLBACK);
  useEffect(() => {
    let cancelado = false;
    getReglasPorcentuales().then((r) => { if (!cancelado) setReglasPct(r); });
    return () => { cancelado = true; };
  }, []);

  // Clase tarifaria del tipo de contratación (necesaria para cotizar agua vía API)
  const { data: tipoContratacionDetalle } = useQuery({
    queryKey: ['tipo-contratacion', record?.tipoContratacionId],
    queryFn: () => fetchTipoContratacion(record!.tipoContratacionId),
    enabled: open && Boolean(record?.tipoContratacionId) && hasApi(),
    staleTime: 30 * 60 * 1000,
  });
  const claseTarifaId =
    tipoContratacionDetalle?.claseTarifaId ?? tipoContratacionDetalle?.claseTarifa?.id;

  // Cargo de agua del periodo (todas las unidades, sin IVA) vía motor
  // versionado; null → se usa el cálculo offline del CSV del bundle.
  const [cargoAguaApi, setCargoAguaApi] = useState<number | null>(null);
  useEffect(() => {
    setCargoAguaApi(null);
    const m3 = parseFloat(consumoM3) || 0;
    const u = parseInt(unidades, 10) || 1;
    const adminId = fd?.adminId;
    if (!open || !incluirAgua || m3 <= 0 || !adminId || !claseTarifaId) return;
    let cancelado = false;
    calcularCargoAguaPeriodoApi(adminId, claseTarifaId, m3 / u)
      .then((r) => { if (!cancelado && r) setCargoAguaApi(r.agua * u); })
      .catch(() => { /* fallback offline */ });
    return () => { cancelado = true; };
  }, [open, incluirAgua, consumoM3, unidades, fd?.adminId, claseTarifaId]);

  const numMeses = useMemo(() => diffMonths(periodoInicio, periodoFin), [periodoInicio, periodoFin]);

  // Vista previa del cálculo de agua por mes
  const previewRows = useMemo(() => {
    if (!incluirAgua) return [];
    const m3 = parseFloat(consumoM3) || 0;
    if (m3 <= 0 || !tarifa) return [];
    const u = parseInt(unidades, 10) || 1;
    // Agua: motor versionado (API) primero; fallback al catálogo CSV offline
    const cargoOffline = calcularCargoPeriodo(adminCatalogo, tarifa, m3, u);
    const aguaBase = cargoAguaApi ?? cargoOffline?.agua;
    if (aguaBase == null) return [];
    const alcBase = aguaBase * reglasPct.alcantarillado;
    const sanBase = aguaBase * reglasPct.saneamiento;

    const rows: { mes: string; agua: number; alc: number; san: number; recargo: number; total: number }[] = [];
    let saldoVencido = 0;
    for (let i = 0; i < numMeses; i++) {
      const mes = monthLabel(addMonths(periodoInicio, i));
      const agua = aplicaAgua ? aguaBase : 0;
      const alc  = aplicaAlcantarillado ? alcBase : 0;
      const san  = aplicaSaneamiento ? sanBase : 0;
      const servicio = agua + alc + san;
      const recargo  = saldoVencido * RECARGO_MENSUAL;
      const total    = servicio + recargo;
      rows.push({ mes, agua, alc, san, recargo, total });
      saldoVencido += servicio;
    }
    return rows;
  }, [incluirAgua, consumoM3, unidades, adminCatalogo, tarifa, numMeses, periodoInicio, aplicaAgua, aplicaAlcantarillado, aplicaSaneamiento, cargoAguaApi, reglasPct]);

  // Re-aplicar defaults cuando cambia el record o cuando llega el detalle con inspección
  useEffect(() => {
    if (diametroTomaDefault)     setDiametroToma(diametroTomaDefault);
    if (diametroDescargaDefault) setDiametroDescarga(diametroDescargaDefault);
    if (matCalleDefault)         setMatCalle(matCalleDefault);
    if (matBanquetaDefault)      setMatBanqueta(matBanquetaDefault);
    if (mlTomaDefault > 0)       setMlToma(String(mlTomaDefault));
    if (mlDescargaDefault > 0)   setMlDescarga(String(mlDescargaDefault));
    setUnidades(unidadesDefault > 0 ? String(unidadesDefault) : '');
    setElabora(user?.name ?? '');
    setPeriodoInicio(periodoInicioDefault);
    setPeriodoFin(periodoFinDefault);
    // Auto-open edit mode when there's no material data so the user can enter it directly
    setEditandoInspeccion(!matCalleDefault && !matBanquetaDefault);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, insp?.materialCalle, insp?.materialBanqueta, insp?.diametroToma]);

  // Pre-llenar tarifa cuando carga el catálogo
  useEffect(() => {
    if (tarifaDefault) setTarifa(tarifaDefault);
  }, [tarifaDefault]);

  const [guardando, setGuardando] = useState(false);

  const requiresCert = fd?.tieneCertConexion === 'si';

  // ── Domicilio: resolver nombres desde IDs Aquasis ─────────────────────────
  const predioDir = fd?.predioDir;
  const estadoIdDir = predioDir?.estadoINEGIId;
  const mpioIdDir   = predioDir?.municipioINEGIId;
  const locIdDir    = predioDir?.localidadINEGIId;
  const colIdDir    = predioDir?.coloniaINEGIId;

  const { data: mpioResDir } = useQuery({
    queryKey: ['inegi-municipios', estadoIdDir],
    queryFn: () => fetchInegiMunicipiosCatalogo({ estadoId: estadoIdDir!, limit: 200 }),
    enabled: open && Boolean(estadoIdDir) && Boolean(mpioIdDir),
    staleTime: 10 * 60 * 1000,
  });
  const { data: locResDir } = useQuery({
    queryKey: ['inegi-localidades', mpioIdDir],
    queryFn: () => fetchInegiLocalidadesCatalogo({ municipioId: mpioIdDir!, limit: 500 }),
    enabled: open && Boolean(mpioIdDir) && Boolean(locIdDir),
    staleTime: 10 * 60 * 1000,
  });
  const { data: colResDir } = useQuery({
    queryKey: ['inegi-colonias', locIdDir],
    queryFn: () => fetchInegiColoniasCatalogo({ localidadId: locIdDir!, limit: 500 }),
    enabled: open && Boolean(locIdDir) && Boolean(colIdDir),
    staleTime: 10 * 60 * 1000,
  });

  const domicilio = useMemo(() => {
    const p = predioDir;
    if (!p?.calle) return record?.predioResumen ?? '—';
    const colNombre = colIdDir
      ? (colResDir?.data ?? []).find((c) => c.id === colIdDir)?.nombre ?? ''
      : '';
    const locNombre = locIdDir
      ? (locResDir?.data ?? []).find((l) => l.id === locIdDir)?.nombre ?? ''
      : '';
    const mpioNombre = mpioIdDir
      ? (mpioResDir?.data ?? []).find((m) => m.id === mpioIdDir)?.nombre ?? ''
      : '';
    return [
      p.calle,
      p.numExterior ? `#${p.numExterior}` : '',
      colNombre ? `Col. ${colNombre}` : '',
      locNombre,
      mpioNombre,
      p.codigoPostal ? `CP ${p.codigoPostal}` : '',
    ].filter(Boolean).join(', ') || record?.predioResumen || '—';
  }, [predioDir, colIdDir, locIdDir, mpioIdDir, colResDir, locResDir, mpioResDir, record]);

  // Nombre del contratante
  const contratante = useMemo(() => {
    if (!fd) return record?.propNombreCompleto ?? '—';
    if (fd.propTipoPersona === 'moral') return fd.propRazonSocial || record?.propNombreCompleto || '—';
    return [fd.propPaterno, fd.propMaterno, fd.propNombre].filter(Boolean).join(' ')
      || record?.propNombreCompleto || '—';
  }, [fd, record]);

  if (!record) return null;

  function buildData(): CuantificacionData {
    return {
      folioCuantificacion: folio,
      adminNombre,
      noCertConexion,
      elabora,
      observaciones,
      fechaEmision: hoy.toISOString().slice(0, 10),
      fechaVigencia,
      formaPago,
      diametroToma,
      diametroDescarga,
      tarifa,
      unidadesServidas: parseInt(unidades, 10) || 1,
      matCalle,
      matBanqueta,
      mlToma:   parseFloat(mlToma)    || 0,
      mlDescarga: parseFloat(mlDescarga) || 0,
      incluirAgua,
      tipoAgua,
      periodoInicio,
      periodoFin,
      numMeses,
      consumoM3: parseFloat(consumoM3) || 0,
      aplicaAgua,
      aplicaAlcantarillado,
      aplicaSaneamiento,
    };
  }

  async function handleGuardar() {
    setGuardando(true);
    try { await onGuardar(buildData()); }
    finally { setGuardando(false); }
  }

  function handleAceptar() {
    onAceptar(buildData());
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cuantificación</DialogTitle>
          <DialogDescription>{record.folio} · {contratante}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">

          {/* ── Encabezado ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">

            <Field label="Administración">
              <Input value={adminNombre} readOnly className="bg-muted/40" />
            </Field>

            <Field label="Folio cuantificación">
              <Input value={folio} readOnly className="bg-muted/40 font-mono text-sm" />
            </Field>

            <Field label="Contratante">
              <Input value={contratante} readOnly className="bg-muted/40" />
            </Field>

            <Field
              label="No. certificado de conexión"
              required={requiresCert}
              hint={!requiresCert ? 'No requerido según solicitud' : undefined}
            >
              <Input
                value={noCertConexion}
                onChange={(e) => setNoCertConexion(e.target.value)}
                placeholder={requiresCert ? 'Requerido' : 'Opcional'}
              />
            </Field>

            <Field label="Fecha de emisión">
              <Input value={formatFechaES(hoy)} readOnly className="bg-muted/40" />
            </Field>

            <Field label="Fecha de vigencia">
              <Input
                type="date"
                value={fechaVigencia}
                onChange={(e) => setFechaVigencia(e.target.value)}
              />
            </Field>

            <Field label="Forma de pago">
              <Select value={formaPago} onValueChange={setFormaPago}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORMAS_PAGO.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

          </div>

          <Separator />

          {/* ── Ubicación del servicio ─────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <SectionTitle>Ubicación del servicio</SectionTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setEditandoInspeccion((v) => !v)}
            >
              {editandoInspeccion
                ? 'Bloquear datos'
                : tieneInspeccion
                  ? 'Editar datos de inspección'
                  : 'Editar datos'}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Domicilio" className="col-span-2">
              <Input value={domicilio} readOnly className="bg-muted/40" />
            </Field>

            <Field label="Material de la calle" hint="Inspección">
              {editandoInspeccion ? (
                <SearchableSelect
                  value={matCalle}
                  onValueChange={setMatCalle}
                  placeholder="Seleccionar…"
                  searchPlaceholder="Buscar material…"
                  options={MATERIALES_CALLE}
                />
              ) : (
                <Input
                  value={MATERIALES_CALLE.find((m) => m.value === matCalle)?.label ?? matCalle}
                  readOnly
                  className="bg-muted/40"
                  placeholder="Sin datos"
                />
              )}
            </Field>

            <Field label="Material de la banqueta" hint="Inspección">
              {editandoInspeccion ? (
                <SearchableSelect
                  value={matBanqueta}
                  onValueChange={setMatBanqueta}
                  placeholder="Seleccionar…"
                  options={MATERIALES_BANQUETA}
                />
              ) : (
                <Input
                  value={MATERIALES_BANQUETA.find((m) => m.value === matBanqueta)?.label ?? matBanqueta}
                  readOnly
                  className="bg-muted/40"
                  placeholder="Sin datos"
                />
              )}
            </Field>

          </div>

          <Separator />

          {/* ── Requerimientos ─────────────────────────────────────────── */}
          <SectionTitle>Requerimientos de conexión</SectionTitle>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">

            {/* Diámetros */}
            <Field label="Diámetro de la toma">
              <SearchableSelect
                value={diametroToma}
                onValueChange={setDiametroToma}
                placeholder="Seleccionar…"
                options={DIAMETROS_TOMA.map((d) => ({ value: d, label: d }))}
              />
            </Field>

            <Field label="Diámetro de la descarga">
              <SearchableSelect
                value={diametroDescarga}
                onValueChange={setDiametroDescarga}
                placeholder="Seleccionar…"
                options={DIAMETROS_TOMA.map((d) => ({ value: d, label: d }))}
              />
            </Field>

            {/* Longitudes — inspección, editables con botón en sección superior */}
            <Field label="Longitud de la toma (m.l.)" hint="Inspección">
              <Input
                type="number"
                min={0}
                step={0.1}
                value={mlToma}
                readOnly={!editandoInspeccion}
                className={!editandoInspeccion ? 'bg-muted/40' : ''}
                onChange={(e) => setMlToma(e.target.value)}
                placeholder="0"
              />
            </Field>

            <Field label="Longitud de la descarga (m.l.)" hint="Inspección">
              <Input
                type="number"
                min={0}
                step={0.1}
                value={mlDescarga}
                readOnly={!editandoInspeccion}
                className={!editandoInspeccion ? 'bg-muted/40' : ''}
                onChange={(e) => setMlDescarga(e.target.value)}
                placeholder="0"
              />
            </Field>

            {/* Tarifa agua periódica y unidades */}
            <Field label="Tarifa periódica de agua">
              <SearchableSelect
                value={tarifa}
                onValueChange={setTarifa}
                placeholder="Seleccionar…"
                options={TARIFAS_FIJAS.map((t) => ({ value: t, label: t }))}
              />
            </Field>

            <Field label="Unidades servidas">
              <Input
                type="number"
                min={1}
                value={unidades}
                onChange={(e) => setUnidades(e.target.value)}
              />
            </Field>

            <Field label="Elabora" className="col-span-2">
              <Input
                value={elabora}
                onChange={(e) => setElabora(e.target.value)}
                placeholder="Nombre de quien elabora"
              />
            </Field>

            <Field label="Observaciones" className="col-span-2">
              <Textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Observaciones generales…"
                rows={3}
                className="resize-none"
              />
            </Field>

          </div>

          <Separator />

          {/* ── Agua ───────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <SectionTitle>Servicios de agua</SectionTitle>
            <button
              type="button"
              onClick={() => setIncluirAgua((v) => !v)}
              className="text-xs text-blue-600 hover:underline"
            >
              {incluirAgua ? 'Quitar sección' : '+ Incluir agua'}
            </button>
          </div>

          {incluirAgua && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">

                <Field label="Tipo">
                  <Select value={tipoAgua} onValueChange={(v) => setTipoAgua(v as 'individual' | 'condominal')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPO_AGUA_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Consumo (m³)">
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={consumoM3}
                    onChange={(e) => setConsumoM3(e.target.value)}
                    placeholder="m³"
                  />
                </Field>

                <Field label="Periodo inicio">
                  <Input
                    type="month"
                    value={periodoInicio}
                    onChange={(e) => setPeriodoInicio(e.target.value)}
                  />
                </Field>

                <Field label="Periodo fin">
                  <Input
                    type="month"
                    value={periodoFin}
                    onChange={(e) => setPeriodoFin(e.target.value)}
                  />
                </Field>

                <Field label="Total meses" className="col-span-2">
                  <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm tabular-nums">
                    {numMeses} {numMeses === 1 ? 'mes' : 'meses'}
                  </div>
                </Field>

              </div>

              {/* Checkboxes de conceptos */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Conceptos a incluir
                </p>
                <div className="flex flex-wrap gap-5">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={aplicaAgua}
                      onCheckedChange={(v) => setAplicaAgua(Boolean(v))}
                    />
                    Agua
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={aplicaAlcantarillado}
                      onCheckedChange={(v) => setAplicaAlcantarillado(Boolean(v))}
                    />
                    Alcantarillado ({pctLabel(reglasPct.alcantarillado)})
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={aplicaSaneamiento}
                      onCheckedChange={(v) => setAplicaSaneamiento(Boolean(v))}
                    />
                    Saneamiento ({pctLabel(reglasPct.saneamiento)})
                  </label>
                </div>
              </div>

              {/* Vista previa del cálculo */}
              {previewRows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Proyección de cobro
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Mes</th>
                          {aplicaAgua          && <th className="px-3 py-2 text-right font-medium">Agua</th>}
                          {aplicaAlcantarillado && <th className="px-3 py-2 text-right font-medium">Alcantarillado</th>}
                          {aplicaSaneamiento    && <th className="px-3 py-2 text-right font-medium">Saneamiento</th>}
                          <th className="px-3 py-2 text-right font-medium">Recargo</th>
                          <th className="px-3 py-2 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                            <td className="px-3 py-1.5 capitalize">{row.mes}</td>
                            {aplicaAgua          && <td className="px-3 py-1.5 text-right tabular-nums">{MXN.format(row.agua)}</td>}
                            {aplicaAlcantarillado && <td className="px-3 py-1.5 text-right tabular-nums">{MXN.format(row.alc)}</td>}
                            {aplicaSaneamiento    && <td className="px-3 py-1.5 text-right tabular-nums">{MXN.format(row.san)}</td>}
                            <td className="px-3 py-1.5 text-right tabular-nums text-orange-600">
                              {row.recargo > 0 ? MXN.format(row.recargo) : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium">{MXN.format(row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-muted/50 font-medium">
                        <tr>
                          <td className="px-3 py-2">Total</td>
                          {aplicaAgua          && <td className="px-3 py-2 text-right tabular-nums">{MXN.format(previewRows.reduce((s, r) => s + r.agua, 0))}</td>}
                          {aplicaAlcantarillado && <td className="px-3 py-2 text-right tabular-nums">{MXN.format(previewRows.reduce((s, r) => s + r.alc, 0))}</td>}
                          {aplicaSaneamiento    && <td className="px-3 py-2 text-right tabular-nums">{MXN.format(previewRows.reduce((s, r) => s + r.san, 0))}</td>}
                          <td className="px-3 py-2 text-right tabular-nums text-orange-600">{MXN.format(previewRows.reduce((s, r) => s + r.recargo, 0))}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{MXN.format(previewRows.reduce((s, r) => s + r.total, 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {incluirAgua && (!consumoM3 || parseFloat(consumoM3) <= 0) && (
                <p className="text-xs text-muted-foreground">
                  Ingresa el consumo en m³ para ver la proyección.
                </p>
              )}
            </div>
          )}

        </div>

        {/* ── Acciones ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleGuardar}
              disabled={guardando || (requiresCert && !noCertConexion)}
            >
              {guardando ? 'Guardando…' : 'Guardar borrador'}
            </Button>
            <Button
              onClick={handleAceptar}
              disabled={!tarifa || (requiresCert && !noCertConexion)}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              Ver cotización →
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function Field({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}
