import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchSolicitudes,
  aceptarSolicitud as apiAceptarSolicitud,
  cancelarSolicitud as apiCancelarSolicitud,
  retormarSolicitud as apiRetormarSolicitud,
  updateSolicitud as apiUpdateSolicitud,
  upsertInspeccion,
  type SolicitudDto,
  type SolicitudInspeccionDto,
} from '@/api/solicitudes';
import { fetchTiposContratacion } from '@/api/tipos-contratacion';
import {
  ClipboardPlus,
  ClipboardList,
  Pencil,
  Search,
  ClipboardCheck,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  FileText,
  ArrowRight,
  Receipt,
  CalendarClock,
  Wand2,
  WifiOff,
  Ban,
  RotateCcw,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { calcularCotizacion, MATERIAL_LABEL as MAT_LABEL } from '@/lib/cotizacion';
import {
  calcularDerechosAgua,
  calcularDerechosDrenaje,
  calcularInstalacionMedidor,
  resolveMatCalle,
  resolveMatBanqueta,
} from '@/lib/cotizacion-tarifas';
import { uploadCotizacionPdf, openCotizacionPdf } from '@/api/solicitudes';
import { pdf } from '@react-pdf/renderer';
// PDF document components loaded lazily (dynamic import) to avoid Rollup TDZ init issues
import { ADMINISTRACIONES, getTiposTarifa, resolveAdministracion, resolveTipoTarifa } from '@/lib/tarifas';
import { formatearCoordenadas } from '@/lib/geo-picker';
import type { SolicitudRecord, OrdenInspeccionData, SolicitudEstado } from '@/types/solicitudes';
import { CuantificacionModal, type CuantificacionData } from '@/components/solicitudes/CuantificacionModal';

// ── DTO → local record mappers ────────────────────────────────────────────────

function inspDtoToOrden(insp: SolicitudInspeccionDto): OrdenInspeccionData {
  return {
    estado: insp.estado as OrdenInspeccionData['estado'],
    fechaInspeccion: insp.fechaInspeccion ?? undefined,
    numeroOficial: insp.numeroOficial ?? undefined,
    tipoUso: insp.tipoUso ?? undefined,
    giro: insp.giro ?? undefined,
    areaTerreno: insp.areaTerreno ?? undefined,
    condicionToma: insp.condicionToma ?? undefined,
    condicionesPredio: insp.condicionesPredio ?? undefined,
    infraHidraulicaExterna: (insp.infraHidraulicaExterna as 'si' | 'no' | '') ?? '',
    infraSanitaria: (insp.infraSanitaria as 'si' | 'no' | '') ?? '',
    materialCalle: insp.materialCalle ?? undefined,
    materialBanqueta: insp.materialBanqueta ?? undefined,
    metrosRupturaAguaBanqueta: insp.metrosRupturaAguaBanqueta ?? undefined,
    metrosRupturaAguaCalle: insp.metrosRupturaAguaCalle ?? undefined,
    metrosRupturaDrenajeBanqueta: insp.metrosRupturaDrenajeBanqueta ?? undefined,
    metrosRupturaDrenajeCalle: insp.metrosRupturaDrenajeCalle ?? undefined,
    observaciones: insp.observaciones ?? undefined,
    evidencias: (insp.evidencias as string[]) ?? undefined,
    resultadoEjecucion: insp.resultadoEjecucion ?? undefined,
    resultadoInspeccion: insp.resultadoInspeccion ?? undefined,
    inspectorNumEmpleado: insp.inspectorNumEmpleado ?? undefined,
    inspectorNombre: insp.inspectorNombre ?? undefined,
    firmaInspector: insp.firmaInspector ?? undefined,
    inspectoresAdicionales: (insp.inspectoresAdicionales as OrdenInspeccionData['inspectoresAdicionales']) ?? undefined,
    inicio: insp.inicio ?? undefined,
    fin: insp.fin ?? undefined,
    tipoOrdenCorrecto: (insp.tipoOrdenCorrecto as 'si' | 'no' | '') ?? '',
    // Legacy
    inspector: insp.inspector ?? undefined,
    diametroToma: insp.diametroToma ?? undefined,
    medidorExistente: (insp.medidorExistente as 'si' | 'no' | '') ?? '',
    numMedidorExistente: insp.numMedidorExistente ?? undefined,
    metrosRupturaCalle: insp.metrosRupturaCalle ?? undefined,
    metrosRupturaBanqueta: insp.metrosRupturaBanqueta ?? undefined,
    existeRed: (insp.existeRed as 'si' | 'no' | '') ?? '',
  };
}

function dtoToRecord(dto: SolicitudDto): SolicitudRecord {
  const fd = dto.formData as any;
  const tipoFromForm = typeof fd?.tipoContratacionId === 'string' ? fd.tipoContratacionId.trim() : '';
  return {
    id: dto.id,
    folio: dto.folio,
    fechaSolicitud: new Date(dto.fechaSolicitud).toLocaleDateString('es-MX', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }),
    propNombreCompleto: dto.propNombreCompleto,
    propTelefono: dto.propTelefono ?? '—',
    predioResumen: dto.predioResumen,
    adminId: fd?.adminId ?? '',
    tipoContratacionId: (dto.tipoContratacionId ?? tipoFromForm) || '',
    usoDomestico: (fd?.usoDomestico as 'si' | 'no' | '') ?? '',
    estado: dto.estado as SolicitudEstado,
    ordenInspeccion: dto.inspeccion ? inspDtoToOrden(dto.inspeccion) : undefined,
    formData: dto.formData,
    contratoId: dto.contratoId ?? undefined,
    createdAt: dto.createdAt,
  };
}

// ── Catalogues for inspection form ───────────────────────────────────────────

const MATERIAL_CALLE = [
  { id: 'empedrado', label: 'Empedrado' },
  { id: 'concreto_hidraulico', label: 'Concreto hidráulico' },
  { id: 'concreto_asfaltico', label: 'Concreto asfáltico' },
  { id: 'tierra', label: 'Tierra' },
  { id: 'adoquin', label: 'Adoquín' },
  { id: 'otro', label: 'Otro' },
];

const MATERIAL_BANQUETA = [
  { id: 'concreto', label: 'Concreto' },
  { id: 'concreto_hidraulico', label: 'Concreto hidráulico' },
  { id: 'tierra', label: 'Tierra' },
  { id: 'adoquin', label: 'Adoquín' },
  { id: 'otro', label: 'Otro' },
];

const CONDICION_TOMA = [
  { id: 'no_tiene', label: 'No tiene' },
  { id: 'buena', label: 'Buena' },
  { id: 'regular', label: 'Regular' },
  { id: 'mala', label: 'Mala' },
  { id: 'registrada', label: 'Registrada' },
];

const CONDICIONES_PREDIO = [
  { id: 'baldio', label: 'Baldío' },
  { id: 'construido', label: 'Construido' },
  { id: 'en_construccion', label: 'En construcción' },
  { id: 'fraccionamiento', label: 'Fraccionamiento' },
];

const TIPO_USO = [
  { id: 'domestico', label: 'Doméstico' },
  { id: 'no_domestico', label: 'No Doméstico' },
  { id: 'baldio', label: 'Baldío' },
  { id: 'comercial', label: 'Comercial' },
  { id: 'industrial', label: 'Industrial' },
];

const RESULTADO_EJECUCION = [
  { id: 'visitada_ejecutada', label: 'Visitada y Ejecutada' },
  { id: 'no_ejecutada', label: 'No Ejecutada' },
  { id: 'cancelada', label: 'Cancelada' },
];

const RESULTADO_INSPECCION = [
  { id: 'ejecutada', label: 'Ejecutada' },
  { id: 'no_ejecutada', label: 'No Ejecutada' },
  { id: 'pendiente', label: 'Pendiente' },
];

// ── Status badge ──────────────────────────────────────────────────────────────

const ESTADO_CONFIG: Record<SolicitudEstado, { label: string; icon: React.ElementType; className: string }> = {
  borrador: {
    label: 'Pendiente de inspección',
    icon: Clock,
    className: 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  },
  inspeccion_pendiente: {
    label: 'Pendiente de inspección',
    icon: Clock,
    className: 'border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  inspeccion_en_proceso: {
    label: 'Pendiente de inspección',
    icon: AlertCircle,
    className: 'border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  inspeccion_completada: {
    label: 'En cotización',
    icon: FileText,
    className: 'border-blue-400/60 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  },
  en_cotizacion: {
    label: 'En cotización',
    icon: FileText,
    className: 'border-blue-400/60 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  },
  aceptada: {
    label: 'Alta de contrato iniciada',
    icon: CheckCircle2,
    className: 'border-emerald-500/60 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  rechazada: {
    label: 'Rechazada',
    icon: XCircle,
    className: 'border-red-400/60 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  },
  cancelada: {
    label: 'Cancelada',
    icon: Ban,
    className: 'border-slate-400/60 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-400',
  },
  cotizado: {
    label: 'En cotización',
    icon: ClipboardCheck,
    className: 'border-blue-400/60 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  },
  contratado: {
    label: 'Alta de contrato iniciada',
    icon: CheckCircle2,
    className: 'border-emerald-500/60 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
};

function EstadoBadge({ estado }: { estado: SolicitudEstado }) {
  const cfg = ESTADO_CONFIG[estado];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn('flex w-fit items-center gap-1 text-xs', cfg.className)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

// ── Inspection detail helpers ─────────────────────────────────────────────────

const MATERIAL_LABEL: Record<string, string> = {
  empedrado: 'Empedrado',
  concreto_hidraulico: 'Concreto hidráulico',
  concreto_asfaltico: 'Concreto asfáltico',
  concreto: 'Concreto',
  tierra: 'Tierra',
  adoquin: 'Adoquín',
  otro: 'Otro',
};

const CATALOG_LABEL = (list: { id: string; label: string }[], id?: string) =>
  list.find((x) => x.id === id)?.label ?? id ?? '—';

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

// ── Inspection mock data (3 presets for demo cycling) ────────────────────────

const MOCK_INSPECCIONES: OrdenInspeccionData[] = [
  // 1. Residencial — toma nueva, ruptura moderada
  {
    estado: 'completada',
    fechaInspeccion: '2026-04-10',
    numeroOficial: '45',
    tipoUso: 'domestico',
    giro: 'Casa habitación',
    areaTerreno: '120',
    condicionToma: 'no_tiene',
    condicionesPredio: 'construido',
    infraHidraulicaExterna: 'si',
    infraSanitaria: 'si',
    materialCalle: 'concreto_asfaltico',
    materialBanqueta: 'concreto',
    metrosRupturaAguaBanqueta: '3',
    metrosRupturaAguaCalle: '2',
    metrosRupturaDrenajeBanqueta: '3',
    metrosRupturaDrenajeCalle: '0',
    observaciones: 'Predio con construcción terminada. Sin toma de agua existente. Se identifican preparaciones previas de agua y drenaje.',
    resultadoEjecucion: 'visitada_ejecutada',
    resultadoInspeccion: 'ejecutada',
    inspectorNumEmpleado: '180076',
    inspectorNombre: 'Sergio Leonardo Nuñez López',
    inicio: '2026-04-10T09:00:00',
    fin: '2026-04-10T09:18:45',
    tipoOrdenCorrecto: 'si',
  },
  // 2. Baldío — sin toma, ruptura drenaje
  {
    estado: 'completada',
    fechaInspeccion: '2026-04-13',
    numeroOficial: 'No marcado',
    tipoUso: 'baldio',
    giro: 'Baldío',
    areaTerreno: '180',
    condicionToma: 'no_tiene',
    condicionesPredio: 'baldio',
    infraHidraulicaExterna: 'si',
    infraSanitaria: 'si',
    materialCalle: 'empedrado',
    materialBanqueta: 'concreto',
    metrosRupturaAguaBanqueta: '2',
    metrosRupturaAguaCalle: '0',
    metrosRupturaDrenajeBanqueta: '2',
    metrosRupturaDrenajeCalle: '3',
    observaciones: 'Solar baldío físicamente no se aprecian las preparaciones de agua y drenaje, se marcan metros de ruptura.',
    resultadoEjecucion: 'visitada_ejecutada',
    resultadoInspeccion: 'ejecutada',
    inspectorNumEmpleado: '180076',
    inspectorNombre: 'Sergio Leonardo Nuñez López',
    inicio: '2026-04-13T13:15:09',
    fin: '2026-04-13T13:19:25',
    tipoOrdenCorrecto: 'si',
  },
  // 3. Comercial — toma en mal estado, ruptura mayor, inspector adicional
  {
    estado: 'completada',
    fechaInspeccion: '2026-04-14',
    numeroOficial: '201 A',
    tipoUso: 'comercial',
    giro: 'Restaurante',
    areaTerreno: '320',
    condicionToma: 'mala',
    condicionesPredio: 'construido',
    infraHidraulicaExterna: 'si',
    infraSanitaria: 'si',
    materialCalle: 'concreto_hidraulico',
    materialBanqueta: 'concreto_hidraulico',
    metrosRupturaAguaBanqueta: '4',
    metrosRupturaAguaCalle: '5',
    metrosRupturaDrenajeBanqueta: '4',
    metrosRupturaDrenajeCalle: '6',
    observaciones: 'Local comercial con toma existente en mal estado. Se requiere cambio completo de la toma y reposición de banqueta y calle por obras previas.',
    resultadoEjecucion: 'visitada_ejecutada',
    resultadoInspeccion: 'ejecutada',
    inspectorNumEmpleado: '110152',
    inspectorNombre: 'María Elena Guerrero Vázquez',
    inspectoresAdicionales: [{ noEmpleado: '180076', nombre: 'Sergio Leonardo Nuñez López' }],
    inicio: '2026-04-14T10:30:00',
    fin: '2026-04-14T10:55:10',
    tipoOrdenCorrecto: 'si',
  },
];

// ── Inspection Sheet ──────────────────────────────────────────────────────────

function OrdenInspeccionSheet({
  record,
  open,
  onClose,
  onAceptar,
  onRechazar,
}: {
  record: SolicitudRecord | null;
  open: boolean;
  onClose: () => void;
  onAceptar: (id: string, campoData?: { materialCalle: string; materialBanqueta: string; metrosRupturaAguaCalle: string; metrosRupturaAguaBanqueta: string; metrosRupturaDrenajeCalle: string; metrosRupturaDrenajeBanqueta: string }) => void;
  onRechazar: (id: string) => void;
}) {
  const [mockIdx, setMockIdx] = useState(0);
  const [editandoCampo, setEditandoCampo] = useState(false);
  const [fMatCalle, setFMatCalle] = useState('');
  const [fMatBanqueta, setFMatBanqueta] = useState('');
  const [fMlAguaCalle, setFMlAguaCalle] = useState('');
  const [fMlAguaBanqueta, setFMlAguaBanqueta] = useState('');
  const [fMlDrenajeCalle, setFMlDrenajeCalle] = useState('');
  const [fMlDrenajeBanqueta, setFMlDrenajeBanqueta] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!record) return;
    // Use real inspection data if available, otherwise fall back to current mock
    const o = record.ordenInspeccion ?? MOCK_INSPECCIONES[mockIdx];
    setFMatCalle(o?.materialCalle ?? '');
    setFMatBanqueta(o?.materialBanqueta ?? '');
    setFMlAguaCalle(o?.metrosRupturaAguaCalle != null ? String(o.metrosRupturaAguaCalle) : '');
    setFMlAguaBanqueta(o?.metrosRupturaAguaBanqueta != null ? String(o.metrosRupturaAguaBanqueta) : '');
    setFMlDrenajeCalle(o?.metrosRupturaDrenajeCalle != null ? String(o.metrosRupturaDrenajeCalle) : '');
    setFMlDrenajeBanqueta(o?.metrosRupturaDrenajeBanqueta != null ? String(o.metrosRupturaDrenajeBanqueta) : '');
    setEditandoCampo(false);
  }, [record?.id, mockIdx]);

  const guardarCampoMut = useMutation({
    mutationFn: () => {
      // Base: prefer real inspection, else use mock as starting point so all fields are saved
      const base = record!.ordenInspeccion ?? MOCK_INSPECCIONES[mockIdx];
      return upsertInspeccion(record!.id, {
        ...base,
        estado: base?.estado ?? 'completada',
        // Override with user-edited values
        materialCalle: fMatCalle || undefined,
        materialBanqueta: fMatBanqueta || undefined,
        metrosRupturaAguaCalle: fMlAguaCalle || undefined,
        metrosRupturaAguaBanqueta: fMlAguaBanqueta || undefined,
        metrosRupturaDrenajeCalle: fMlDrenajeCalle || undefined,
        metrosRupturaDrenajeBanqueta: fMlDrenajeBanqueta || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solicitudes'] });
      queryClient.invalidateQueries({ queryKey: ['solicitud', record?.id] });
      setEditandoCampo(false);
      toast.success('Datos de campo guardados');
    },
    onError: () => toast.error('Error al guardar datos de campo'),
  });

  if (!record) return null;

  // For demo: use mock data if no real inspection data exists
  const orden = record.ordenInspeccion;
  const demoOrden = MOCK_INSPECCIONES[mockIdx];

  function cycleMock() {
    setMockIdx((i) => (i + 1) % MOCK_INSPECCIONES.length);
  }

  function InspeccionView({ data }: { data: OrdenInspeccionData }) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          {data.estado === 'completada' ? (
            <>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span className="font-medium">Inspección completada</span>
            </>
          ) : (
            <Badge variant="secondary" className="gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              En proceso
            </Badge>
          )}
        </div>

        <Separator />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Información general</p>
        <div className="grid grid-cols-2 gap-4">
          <DetailRow label="Fecha de inspección" value={data.fechaInspeccion} />
          <DetailRow label="Número oficial" value={data.numeroOficial} />
          <DetailRow label="Tipo de uso" value={CATALOG_LABEL(TIPO_USO, data.tipoUso)} />
          <DetailRow label="Giro" value={data.giro} />
          <DetailRow label="Área terreno (m²)" value={data.areaTerreno ? `${data.areaTerreno} m²` : undefined} />
          <DetailRow label="Condición de la toma" value={CATALOG_LABEL(CONDICION_TOMA, data.condicionToma)} />
          <DetailRow label="Condiciones del predio" value={CATALOG_LABEL(CONDICIONES_PREDIO, data.condicionesPredio)} />
        </div>

        {data.observaciones && (
          <>
            <Separator />
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observaciones</p>
              <p className="text-sm">{data.observaciones}</p>
            </div>
          </>
        )}

        {data.evidencias && data.evidencias.length > 0 && (
          <>
            <Separator />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidencia fotográfica</p>
            <div className="grid grid-cols-2 gap-2">
              {data.evidencias.map((src, i) => (
                <img key={i} src={src} alt={`Evidencia ${i + 1}`} className="w-full rounded-md border object-cover aspect-video" />
              ))}
            </div>
          </>
        )}

        <Separator />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resultados</p>
        <div className="grid grid-cols-2 gap-4">
          <DetailRow label="Resultado de ejecución" value={CATALOG_LABEL(RESULTADO_EJECUCION, data.resultadoEjecucion)} />
          <DetailRow label="Resultado de inspección" value={CATALOG_LABEL(RESULTADO_INSPECCION, data.resultadoInspeccion)} />
        </div>

        <Separator />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inspector asignado</p>
        <div className="grid grid-cols-2 gap-4">
          <DetailRow label="No. Empleado" value={data.inspectorNumEmpleado} />
          <DetailRow label="Nombre" value={data.inspectorNombre} />
        </div>
        {data.firmaInspector && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Firma del inspector</p>
            <img src={data.firmaInspector} alt="Firma inspector" className="max-h-28 rounded-md border bg-white p-2" />
          </div>
        )}

        {data.inspectoresAdicionales && data.inspectoresAdicionales.length > 0 && (
          <>
            <Separator />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inspectores adicionales</p>
            {data.inspectoresAdicionales.map((insp, i) => (
              <div key={i} className="rounded-md border p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <DetailRow label="No. Empleado" value={insp.noEmpleado} />
                  <DetailRow label="Nombre" value={insp.nombre} />
                </div>
                {insp.firma && (
                  <img src={insp.firma} alt={`Firma inspector ${i + 2}`} className="max-h-28 rounded-md border bg-white p-2" />
                )}
              </div>
            ))}
          </>
        )}

        <Separator />
        <div className="grid grid-cols-2 gap-4">
          <DetailRow label="Inicio" value={data.inicio} />
          <DetailRow label="Fin" value={data.fin} />
          <DetailRow label="Tipo de orden correcto" value={data.tipoOrdenCorrecto === 'si' ? 'Sí' : data.tipoOrdenCorrecto === 'no' ? 'No' : undefined} />
        </div>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[540px]">
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              Orden de inspección
            </SheetTitle>
            {!orden && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-dashed text-muted-foreground hover:text-foreground"
                onClick={cycleMock}
              >
                <Wand2 className="h-3 w-3" />
                Demo {mockIdx + 1}/{MOCK_INSPECCIONES.length}
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {record.folio} — {record.propNombreCompleto}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium">Domicilio del predio: </span>
            {record.predioResumen}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Editable campo section */}
          <div className="mb-5 rounded-md border px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Datos de campo</p>
              {!editandoCampo ? (
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => setEditandoCampo(true)}>
                  <Pencil className="h-3 w-3" /> Editar
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setEditandoCampo(false)}>Cancelar</Button>
                  <Button type="button" size="sm" className="h-7" onClick={() => guardarCampoMut.mutate()} disabled={guardarCampoMut.isPending}>Guardar</Button>
                </div>
              )}
            </div>

            {editandoCampo ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Material de calle</Label>
                  <SearchableSelect
                    value={fMatCalle}
                    onValueChange={setFMatCalle}
                    placeholder="Seleccionar..."
                    searchPlaceholder="Buscar material…"
                    options={MATERIAL_CALLE.map(m => ({ value: m.id, label: m.label }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Material de banqueta</Label>
                  <SearchableSelect
                    value={fMatBanqueta}
                    onValueChange={setFMatBanqueta}
                    placeholder="Seleccionar..."
                    searchPlaceholder="Buscar material…"
                    options={MATERIAL_BANQUETA.map(m => ({ value: m.id, label: m.label }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ruptura agua — calle (ml)</Label>
                  <Input type="number" min={0} step={0.1} className="h-8 text-xs" value={fMlAguaCalle} onChange={e => setFMlAguaCalle(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ruptura agua — banqueta (ml)</Label>
                  <Input type="number" min={0} step={0.1} className="h-8 text-xs" value={fMlAguaBanqueta} onChange={e => setFMlAguaBanqueta(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ruptura drenaje — calle (ml)</Label>
                  <Input type="number" min={0} step={0.1} className="h-8 text-xs" value={fMlDrenajeCalle} onChange={e => setFMlDrenajeCalle(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ruptura drenaje — banqueta (ml)</Label>
                  <Input type="number" min={0} step={0.1} className="h-8 text-xs" value={fMlDrenajeBanqueta} onChange={e => setFMlDrenajeBanqueta(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground text-xs">Material calle: </span>{fMatCalle ? (MATERIAL_CALLE.find(m => m.id === fMatCalle)?.label ?? fMatCalle) : <span className="text-muted-foreground italic">Sin datos</span>}</div>
                <div><span className="text-muted-foreground text-xs">Material banqueta: </span>{fMatBanqueta ? (MATERIAL_BANQUETA.find(m => m.id === fMatBanqueta)?.label ?? fMatBanqueta) : <span className="text-muted-foreground italic">Sin datos</span>}</div>
                <div><span className="text-muted-foreground text-xs">Agua calle: </span>{fMlAguaCalle ? `${fMlAguaCalle} ml` : <span className="text-muted-foreground italic">—</span>}</div>
                <div><span className="text-muted-foreground text-xs">Agua banqueta: </span>{fMlAguaBanqueta ? `${fMlAguaBanqueta} ml` : <span className="text-muted-foreground italic">—</span>}</div>
                <div><span className="text-muted-foreground text-xs">Drenaje calle: </span>{fMlDrenajeCalle ? `${fMlDrenajeCalle} ml` : <span className="text-muted-foreground italic">—</span>}</div>
                <div><span className="text-muted-foreground text-xs">Drenaje banqueta: </span>{fMlDrenajeBanqueta ? `${fMlDrenajeBanqueta} ml` : <span className="text-muted-foreground italic">—</span>}</div>
              </div>
            )}
          </div>

          {/* No real data — show waiting state with demo data below */}
          {!orden && (
            <>
              <div className="mb-5 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                <WifiOff className="h-4 w-4 shrink-0" />
                <span>Pendiente de recibir datos del sistema externo. Se muestra un ejemplo de referencia.</span>
              </div>
              <InspeccionView data={demoOrden} />
            </>
          )}

          {/* Real data received */}
          {orden && <InspeccionView data={orden} />}
        </div>

        {/* Footer actions */}
        {record && (
          <div className="border-t px-6 py-4 space-y-3">
            {(record.estado === 'en_cotizacion' || record.estado === 'inspeccion_completada' ||
              record.estado === 'inspeccion_pendiente' || record.estado === 'inspeccion_en_proceso' ||
              record.estado === 'borrador') && (
              <Button
                type="button"
                className="w-full bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => onAceptar(record.id, {
                  materialCalle: fMatCalle,
                  materialBanqueta: fMatBanqueta,
                  metrosRupturaAguaCalle: fMlAguaCalle,
                  metrosRupturaAguaBanqueta: fMlAguaBanqueta,
                  metrosRupturaDrenajeCalle: fMlDrenajeCalle,
                  metrosRupturaDrenajeBanqueta: fMlDrenajeBanqueta,
                })}
              >
                <ArrowRight className="mr-1.5 h-4 w-4" />
                Continuar con cuantificación
              </Button>
            )}
            {(record.estado === 'aceptada' || record.estado === 'contratado') && (
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm font-medium">Solicitud aceptada — proceso de contratación iniciado</span>
              </div>
            )}
            {record.estado === 'cancelada' && (
              <div className="flex items-center gap-2 text-slate-600">
                <Ban className="h-4 w-4" />
                <span className="text-sm font-medium">Solicitud cancelada</span>
              </div>
            )}
            {record.estado === 'rechazada' && (
              <div className="flex items-center gap-2 text-red-700">
                <XCircle className="h-4 w-4" />
                <span className="text-sm font-medium">Solicitud rechazada</span>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Cobro Agua Config Dialog ──────────────────────────────────────────────────

interface CobroAguaConfig {
  administracion: string;
  tipoTarifa: string;
  consumoM3: number;
  unidades: number;
  periodoInicio: Date;
  periodoFin: Date;
  aplicaAgua: boolean;
  aplicaAlcantarillado: boolean;
  aplicaSaneamiento: boolean;
}

function CobroAguaConfigDialog({
  record,
  open,
  onClose,
  tipoContratacionNombre,
  onGenerar,
}: {
  record: SolicitudRecord | null;
  open: boolean;
  onClose: () => void;
  tipoContratacionNombre?: string;
  onGenerar: (config: CobroAguaConfig) => void;
}) {
  const vars = record?.formData?.variablesCapturadas ?? {};

  // Valores iniciales derivados del registro
  const adminInicial = resolveAdministracion(
    record?.formData?.adminId ?? undefined,
  ) ?? ADMINISTRACIONES[0] ?? 'QUERÉTARO';

  const tipoTarifaInicial = resolveTipoTarifa(tipoContratacionNombre, adminInicial) ?? getTiposTarifa(adminInicial)[0] ?? '';

  const hoy = new Date();
  const hace6Meses = new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1);

  const [admin, setAdmin]           = useState(adminInicial);
  const [tipoTarifa, setTipoTarifa] = useState(tipoTarifaInicial);
  const [m3, setM3]                 = useState(
    String(parseFloat(vars.consumoM3 ?? vars.consumo_m3 ?? vars.m3 ?? '15') || 15),
  );
  const [unidades, setUnidades]     = useState(
    String(parseInt(vars.unidadesServicio ?? vars.unidades ?? '1', 10) || 1),
  );
  const [pInicio, setPInicio]       = useState(
    hace6Meses.toISOString().slice(0, 7), // YYYY-MM
  );
  const [pFin, setPFin]             = useState(
    hoy.toISOString().slice(0, 7),
  );
  const [aplicaAgua, setAplicaAgua]                   = useState(true);
  const [aplicaAlcantarillado, setAplicaAlcantarillado] = useState(true);
  const [aplicaSaneamiento, setAplicaSaneamiento]       = useState(true);

  const tiposTarifa = getTiposTarifa(admin);

  // Cuando cambia admin, ajustar tipo tarifa si el actual no existe
  const handleAdminChange = (val: string) => {
    setAdmin(val);
    const tipos = getTiposTarifa(val);
    if (!tipos.includes(tipoTarifa)) setTipoTarifa(tipos[0] ?? '');
  };

  if (!record) return null;

  function handleSubmit() {
    const [iniAnio, iniMes] = pInicio.split('-').map(Number);
    const [finAnio, finMes] = pFin.split('-').map(Number);
    onGenerar({
      administracion: admin,
      tipoTarifa,
      consumoM3: parseFloat(m3) || 15,
      unidades: parseInt(unidades, 10) || 1,
      periodoInicio: new Date(iniAnio, iniMes - 1, 1),
      periodoFin:    new Date(finAnio, finMes - 1, 1),
      aplicaAgua,
      aplicaAlcantarillado,
      aplicaSaneamiento,
    });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurar detalle del cobro del agua</DialogTitle>
          <DialogDescription>
            Folio: {record.folio}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Administración */}
          <div className="grid grid-cols-3 items-center gap-2">
            <Label className="text-right text-sm">Administración</Label>
            <div className="col-span-2">
              <SearchableSelect
                className="w-full"
                value={admin}
                onValueChange={handleAdminChange}
                options={ADMINISTRACIONES.map((a) => ({ value: a, label: a }))}
              />
            </div>
          </div>

          {/* Tipo de tarifa */}
          <div className="grid grid-cols-3 items-center gap-2">
            <Label className="text-right text-sm">Tarifa</Label>
            <div className="col-span-2">
              <SearchableSelect
                className="w-full"
                value={tipoTarifa}
                onValueChange={setTipoTarifa}
                options={tiposTarifa.map((t) => ({ value: t, label: t }))}
              />
            </div>
          </div>

          {/* M3 y Unidades */}
          <div className="grid grid-cols-3 items-center gap-2">
            <Label className="text-right text-sm">Consumo M3</Label>
            <Input
              type="number"
              min={0}
              className="col-span-2"
              value={m3}
              onChange={(e) => setM3(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label className="text-right text-sm">Unidades servidas</Label>
            <Input
              type="number"
              min={1}
              className="col-span-2"
              value={unidades}
              onChange={(e) => setUnidades(e.target.value)}
            />
          </div>

          {/* Periodo */}
          <div className="grid grid-cols-3 items-center gap-2">
            <Label className="text-right text-sm">Periodo inicio</Label>
            <Input
              type="month"
              className="col-span-2"
              value={pInicio}
              onChange={(e) => setPInicio(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label className="text-right text-sm">Periodo fin</Label>
            <Input
              type="month"
              className="col-span-2"
              value={pFin}
              max={pFin}
              onChange={(e) => setPFin(e.target.value)}
            />
          </div>

          {/* Conceptos que aplican */}
          <div className="grid grid-cols-3 items-start gap-2">
            <Label className="text-right text-sm pt-1">Aplica</Label>
            <div className="col-span-2 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={aplicaAgua}
                  onCheckedChange={(v) => setAplicaAgua(Boolean(v))}
                />
                Agua
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={aplicaAlcantarillado}
                  onCheckedChange={(v) => setAplicaAlcantarillado(Boolean(v))}
                />
                Alcantarillado (10%)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={aplicaSaneamiento}
                  onCheckedChange={(v) => setAplicaSaneamiento(Boolean(v))}
                />
                Saneamiento (12%)
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!tipoTarifa}>
            <Download className="h-4 w-4 mr-1.5" />
            Generar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Ver Solicitud Dialog ──────────────────────────────────────────────────────

function VerSolicitudDialog({
  record,
  open,
  onClose,
  tipoContratacionNombre,
}: {
  record: SolicitudRecord | null;
  open: boolean;
  onClose: () => void;
  tipoContratacionNombre?: string;
}) {
  const ordenData = record?.ordenInspeccion ?? undefined;
  // Conceptos: primero desde inspección (si existe), luego desde cotizacionItems guardados al aceptar
  const conceptosFromInsp = ordenData ? calcularCotizacion(ordenData) : [];
  const cotizacionGuardada = record?.formData?.cotizacionItems ?? [];
  const conceptos = conceptosFromInsp.length > 0 ? conceptosFromInsp : cotizacionGuardada;

  const [generandoCotizPdf, setGenerandoCotizPdf] = useState(false);
  const [generandoCobroPdf, setGenerandoCobroPdf] = useState(false);
  const [cobroConfigOpen, setCobroConfigOpen]     = useState(false);

  // Auto-backfill cotizacionItems for solicitudes accepted before the persistent-save fix
  useEffect(() => {
    if (!record || !open) return;
    if (record.estado !== 'aceptada' && record.estado !== 'contratado') return;
    const alreadySaved = Array.isArray(record.formData?.cotizacionItems) && record.formData.cotizacionItems!.length > 0;
    if (alreadySaved || conceptosFromInsp.length === 0) return;
    apiUpdateSolicitud(record.id, {
      formData: { ...record.formData, cotizacionItems: conceptosFromInsp },
    }).catch(() => {});
  }, [record?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!record) return null;

  const fd = record.formData;
  const total = conceptos.reduce((s, c) => s + c.subtotal, 0);
  const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

  const esPersonaMoral = fd.propTipoPersona === 'moral';
  const nombrePropietario = esPersonaMoral
    ? fd.propRazonSocial
    : [fd.propPaterno, fd.propMaterno, fd.propNombre].filter(Boolean).join(' ');

  const domPredio = [
    fd.predioDir?.calle,
    fd.predioDir?.numExterior ? `#${fd.predioDir.numExterior}` : undefined,
    fd.predioDir?.codigoPostal ? `CP ${fd.predioDir.codigoPostal}` : undefined,
  ].filter(Boolean).join(' ') || record.predioResumen;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Solicitud — {record.folio}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {new Date(record.fechaSolicitud).toLocaleDateString('es-MX', { dateStyle: 'long' })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Propietario */}
          <div className="rounded-lg border p-4 space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Propietario / Titular</p>
            <p className="text-sm font-medium">{nombrePropietario || '—'}</p>
            {fd.propRfc ? <p className="text-sm text-muted-foreground">RFC: {fd.propRfc}</p> : null}
            {record.propTelefono ? <p className="text-sm text-muted-foreground">Tel: {record.propTelefono}</p> : null}
            {fd.propCorreo ? <p className="text-sm text-muted-foreground">Correo: {fd.propCorreo}</p> : null}
          </div>

          {/* Predio */}
          <div className="rounded-lg border p-4 space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Predio / Domicilio del servicio</p>
            <p className="text-sm">{domPredio || '—'}</p>
            {formatearCoordenadas(fd.predioDir?.gpsLat, fd.predioDir?.gpsLng) ? (
              <p className="text-sm text-muted-foreground">
                Ubicación GPS: {formatearCoordenadas(fd.predioDir?.gpsLat, fd.predioDir?.gpsLng)}
              </p>
            ) : null}
            {fd.claveCatastral ? <p className="text-sm text-muted-foreground">Clave catastral: {fd.claveCatastral}</p> : null}
            {fd.superficieTotal ? <p className="text-sm text-muted-foreground">Superficie total: {fd.superficieTotal} m²</p> : null}
          </div>

          {/* Estado */}
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Estado:</p>
            <EstadoBadge estado={record.estado} />
          </div>

          {/* Cotización / Cuantificación */}
          {conceptos.length > 0 ? (
            <div className="rounded-lg border overflow-hidden">
              <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/20">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Cuantificación y cotización</span>
              </div>
              {/* Datos de inspección relevantes (solo si existe inspección real) */}
              {ordenData && (ordenData.materialCalle || ordenData.materialBanqueta || ordenData.diametroToma) ? (
                <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm border-b bg-muted/10">
                  {ordenData.materialCalle ? (
                    <div>
                      <span className="text-muted-foreground">Material calle:</span>{' '}
                      <span className="font-medium">{MAT_LABEL[ordenData.materialCalle] ?? ordenData.materialCalle}</span>
                    </div>
                  ) : null}
                  {ordenData.materialBanqueta ? (
                    <div>
                      <span className="text-muted-foreground">Material banqueta:</span>{' '}
                      <span className="font-medium">{MAT_LABEL[ordenData.materialBanqueta] ?? ordenData.materialBanqueta}</span>
                    </div>
                  ) : null}
                  {ordenData.diametroToma ? (
                    <div>
                      <span className="text-muted-foreground">Diámetro toma:</span>{' '}
                      <span className="font-medium">{ordenData.diametroToma}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs bg-muted/5">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Concepto</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Cant.</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">P.U.</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {conceptos.map((c) => (
                    <tr key={c.descripcion} className="border-t">
                      <td className="px-4 py-2">{c.descripcion}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{c.cantidad} {c.unidad}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{mxn.format(c.precioUnitario)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{mxn.format(c.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/20">
                  <tr>
                    <td colSpan={3} className="px-4 py-2.5 text-right font-semibold">Total estimado</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold">{mxn.format(total)}</td>
                  </tr>
                </tfoot>
              </table>
              {ordenData?.observaciones ? (
                <div className="px-4 py-3 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Observaciones de inspección</p>
                  <p className="text-sm">{ordenData.observaciones}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
              Sin datos de cuantificación registrados.
            </div>
          )}

          {/* Botones PDF */}
          {conceptos.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={generandoCotizPdf}
                onClick={async () => {
                  setGenerandoCotizPdf(true);
                  // ordenData fallback: vacío pero tipado
                  const od = ordenData ?? { estado: 'completada' as const };
                  try {
                    await openCotizacionPdf(record.id);
                  } catch {
                    try {
                      const { CotizacionPdfDocument } = await import('@/lib/cotizacion-pdf');
                      const blob = await pdf(
                        <CotizacionPdfDocument record={record} ordenData={od} conceptos={conceptos} />
                      ).toBlob();
                      const url = URL.createObjectURL(blob);
                      window.open(url, '_blank');
                      setTimeout(() => URL.revokeObjectURL(url), 10_000);
                    } catch {
                      toast.error('No se pudo generar el PDF de cotización');
                    }
                  } finally {
                    setGenerandoCotizPdf(false);
                  }
                }}
              >
                <Download className="h-3.5 w-3.5" />
                {generandoCotizPdf ? 'Generando…' : 'PDF cotización'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setCobroConfigOpen(true)}
              >
                <Download className="h-3.5 w-3.5" />
                Detalle del cobro del agua
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>

      <CobroAguaConfigDialog
        record={record}
        open={cobroConfigOpen}
        onClose={() => setCobroConfigOpen(false)}
        tipoContratacionNombre={tipoContratacionNombre}
        onGenerar={async (cfg) => {
          setGenerandoCobroPdf(true);
          try {
            const { CobroAguaPdfDocument } = await import('@/lib/cobro-agua-pdf');
            const blob = await pdf(
              <CobroAguaPdfDocument
                record={record}
                administracionCatalogo={cfg.administracion}
                tipoTarifa={cfg.tipoTarifa}
                consumoM3={cfg.consumoM3}
                unidadesServidas={cfg.unidades}
                periodoInicio={cfg.periodoInicio}
                periodoFin={cfg.periodoFin}
                aplicaAgua={cfg.aplicaAgua}
                aplicaAlcantarillado={cfg.aplicaAlcantarillado}
                aplicaSaneamiento={cfg.aplicaSaneamiento}
              />
            ).toBlob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          } catch {
            toast.error('No se pudo generar el PDF de cobro');
          } finally {
            setGenerandoCobroPdf(false);
          }
        }}
      />
    </Dialog>
  );
}

// ── Cotización pricing engine ─────────────────────────────────────────────────

interface ConceptoCotizacion {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precioUnitario: number;
  subtotal: number;
  tasa?: number;    // IVA rate (0 = exento, 0.16 = 16%)
}

/**
 * Calcula los conceptos de cotización usando los datos capturados en CuantificacionModal.
 * Materiales y metros lineales se toman de la inspección (si existe).
 * Precios reales del catálogo CSV Feb-2026 via cotizacion-tarifas.ts.
 */
function calcularCotizacionDesdeCuantificacion(
  cuant: CuantificacionData,
  insp?: OrdenInspeccionData,
): ConceptoCotizacion[] {
  const conceptos: ConceptoCotizacion[] = [];
  const admin = cuant.adminNombre || 'QUERÉTARO';

  // Materiales: cuant tiene prioridad (capturados en el form), fallback a inspección
  const matCalle    = cuant.matCalle    || insp?.materialCalle    || '';
  const matBanqueta = cuant.matBanqueta || insp?.materialBanqueta || '';

  // Metros: cuant tiene prioridad, fallback a inspección
  const mlToma = cuant.mlToma > 0
    ? cuant.mlToma
    : parseFloat(insp?.metrosRupturaAguaCalle ?? insp?.metrosRupturaCalle ?? '0') || 0;
  const mlDescarga = cuant.mlDescarga > 0
    ? cuant.mlDescarga
    : parseFloat(insp?.metrosRupturaDrenajeCalle ?? '0') || 0;

  // ── 1. Derechos de conexión a red de agua ───────────────────────────────────
  if (mlToma > 0 && matCalle) {
    const r = calcularDerechosAgua(admin, matCalle, matBanqueta, mlToma);
    if (r) {
      const matLabel = `${resolveMatCalle(matCalle)}-${resolveMatBanqueta(matBanqueta)}`;
      conceptos.push({
        descripcion: `Derechos de conexión red de agua (${matLabel}, ${mlToma} ml)`,
        cantidad: 1, unidad: 'servicio',
        precioUnitario: r.precioNeto, subtotal: r.precioNeto, tasa: r.tasa,
      });
    }
  }

  // ── 2. Derechos de conexión a red de drenaje ──────────────────────────────
  if (mlDescarga > 0 && matCalle) {
    const r = calcularDerechosDrenaje(admin, matCalle, matBanqueta, mlDescarga);
    if (r) {
      const matLabel = `${resolveMatCalle(matCalle)}-${resolveMatBanqueta(matBanqueta)}`;
      conceptos.push({
        descripcion: `Derechos de conexión red de drenaje (${matLabel}, ${mlDescarga} ml)`,
        cantidad: 1, unidad: 'servicio',
        precioUnitario: r.precioNeto, subtotal: r.precioNeto, tasa: r.tasa,
      });
    }
  }

  // ── 3. Instalación de medidor ────────────────────────────────────────────────
  if (cuant.diametroToma) {
    const r = calcularInstalacionMedidor(admin, cuant.diametroToma);
    const precio = r?.precioNeto ?? 984.11;
    conceptos.push({
      descripcion: `Instalación de medidor ${cuant.diametroToma}`,
      cantidad: 1, unidad: 'pieza',
      precioUnitario: precio, subtotal: precio, tasa: r?.tasa ?? 0.16,
    });
  }

  return conceptos;
}

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

// ── Cotización Modal ──────────────────────────────────────────────────────────

function CotizacionModal({
  record,
  open,
  onClose,
  onAceptar,
  onRechazar,
  onVerInspeccion,
  onEditarCuantificacion,
  tipoContratacionNombre,
  cuantificacionData,
}: {
  record: SolicitudRecord | null;
  open: boolean;
  onClose: () => void;
  onAceptar: (id: string, contratoId?: string) => void;
  onRechazar: (id: string) => void;
  onVerInspeccion: (record: SolicitudRecord) => void;
  onEditarCuantificacion?: () => void;
  tipoContratacionNombre?: string;
  cuantificacionData?: CuantificacionData;
}) {
  const [aceptando, setAceptando] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [generandoCobroPdf, setGenerandoCobroPdf] = useState(false);
  const [cobroConfigOpen, setCobroConfigOpen]     = useState(false);

  if (!record) return null;

  // Datos de cuantificación: del prop (recién capturado) o del formData persistido
  const cuantData: CuantificacionData | undefined =
    cuantificacionData ?? (record.formData as any)?.cuantificacionData;

  // Inspección real (sin fallback a mock)
  const ordenData = record.ordenInspeccion;

  // Calcular conceptos: si hay datos de cuantificación, usarlos; si no, usar inspección real o mock
  const conceptos = cuantData
    ? calcularCotizacionDesdeCuantificacion(cuantData, ordenData)
    : calcularCotizacion(ordenData ?? MOCK_INSPECCIONES[0]);

  const total = conceptos.reduce((s, c) => s + c.subtotal, 0);
  const vigenciaDate = cuantData?.fechaVigencia
    ? new Date(cuantData.fechaVigencia)
    : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const vigencia = vigenciaDate.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

  async function handleAceptar() {
    setAceptando(true);
    try {
      // Backend /aceptar creates the Contrato and links it to this Solicitud
      const res = await apiAceptarSolicitud(record!.id);

      // Persist cotizacionItems to solicitud.formData so the wizard can preload them
      if (conceptos.length > 0) {
        apiUpdateSolicitud(record!.id, {
          formData: { ...record!.formData, cotizacionItems: conceptos },
        }).catch(() => { /* silent - wizard will fallback to inspeccion data */ });
      }

      // Generate PDF: open in new tab immediately + upload to server in background
      if (ordenData && conceptos.length > 0) {
        const { CotizacionPdfDocument } = await import('@/lib/cotizacion-pdf');
        const doc = (
          <CotizacionPdfDocument
            record={record!}
            ordenData={ordenData}
            conceptos={conceptos}
          />
        );
        pdf(doc).toBlob().then((blob) => {
          // Open in new tab right away
          const blobUrl = URL.createObjectURL(blob);
          window.open(blobUrl, '_blank');
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
          // Upload to server for later retrieval (silent)
          uploadCotizacionPdf(record!.id, blob).catch(() => {});
        }).catch(() => {});
      }

      onAceptar(record!.id, res.contratoId);
    } catch (err) {
      setAceptando(false);
      toast.error('Error al aceptar', { description: err instanceof Error ? err.message : 'No se pudo crear el contrato. Verifica la conexión con el servidor.' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[98vw] max-w-6xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-blue-600" />
            Cotización — {record.folio}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {record.propNombreCompleto} · {record.predioResumen}
          </DialogDescription>
        </DialogHeader>

        {/* Validity notice */}
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          Esta cotización tiene una vigencia de 5 días hábiles — vence el <span className="font-medium ml-1">{vigencia}</span>
        </div>

        {/* Concepts table */}
        <div className="overflow-hidden rounded-md border text-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Concepto</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Cant.</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">P.U.</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {conceptos.map((c) => (
                <tr key={c.descripcion}>
                  <td className="px-4 py-2.5">{c.descripcion}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{c.cantidad} {c.unidad}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{MXN.format(c.precioUnitario)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{MXN.format(c.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/20">
                <td colSpan={3} className="px-4 py-3 text-right font-semibold">Total estimado</td>
                <td className="px-4 py-3 text-right text-base font-bold tabular-nums">{MXN.format(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">* Los precios son estimados y pueden ajustarse según las condiciones del terreno.</p>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {onEditarCuantificacion && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                onClick={() => { onClose(); onEditarCuantificacion(); }}
              >
                ← Editar cuantificación
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={generandoPdf}
              onClick={async () => {
                setGenerandoPdf(true);
                try {
                  const { CotizacionPdfDocument } = await import('@/lib/cotizacion-pdf');
                  const doc = (
                    <CotizacionPdfDocument
                      record={record}
                      ordenData={ordenData}
                      conceptos={conceptos}
                    />
                  );
                  const blob = await pdf(doc).toBlob();
                  const url = URL.createObjectURL(blob);
                  window.open(url, '_blank');
                  setTimeout(() => URL.revokeObjectURL(url), 10_000);
                } catch {
                  toast.error('No se pudo generar el PDF');
                } finally {
                  setGenerandoPdf(false);
                }
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {generandoPdf ? 'Generando…' : 'Descargar PDF'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setCobroConfigOpen(true)}
            >
              <Download className="h-3.5 w-3.5" />
              Detalle del cobro del agua
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => { onClose(); onVerInspeccion(record); }}
            >
              <ClipboardList className="h-4 w-4" />
              Orden de inspección
            </Button>
          </div>
          <Button
            type="button"
            disabled={aceptando}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={handleAceptar}
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {aceptando ? 'Iniciando contrato…' : 'Cliente acepta la cotización'}
          </Button>
        </div>
      </DialogContent>

      <CobroAguaConfigDialog
        record={record}
        open={cobroConfigOpen}
        onClose={() => setCobroConfigOpen(false)}
        tipoContratacionNombre={tipoContratacionNombre}
        onGenerar={async (cfg) => {
          setGenerandoCobroPdf(true);
          try {
            const { CobroAguaPdfDocument } = await import('@/lib/cobro-agua-pdf');
            const blob = await pdf(
              <CobroAguaPdfDocument
                record={record}
                administracionCatalogo={cfg.administracion}
                tipoTarifa={cfg.tipoTarifa}
                consumoM3={cfg.consumoM3}
                unidadesServidas={cfg.unidades}
                periodoInicio={cfg.periodoInicio}
                periodoFin={cfg.periodoFin}
                aplicaAgua={cfg.aplicaAgua}
                aplicaAlcantarillado={cfg.aplicaAlcantarillado}
                aplicaSaneamiento={cfg.aplicaSaneamiento}
              />
            ).toBlob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          } catch {
            toast.error('No se pudo generar el PDF de cobro');
          } finally {
            setGenerandoCobroPdf(false);
          }
        }}
      />
    </Dialog>
  );
}

// ── Main list page ────────────────────────────────────────────────────────────

const ESTADO_FILTER_OPTIONS = [
  { value: 'todas', label: 'Todas las activas' },
  { value: 'inspeccion_pendiente', label: 'Pendiente de inspección' },
  { value: 'en_cotizacion', label: 'En cotización' },
  { value: 'aceptada', label: 'Alta de contrato' },
] as const;

export default function Solicitudes() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<string>('todas');
  const [tab, setTab] = useState<'activas' | 'canceladas'>('activas');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [inspRecord, setInspRecord] = useState<SolicitudRecord | null>(null);
  const [cotizandoRecord, setCotizandoRecord] = useState<SolicitudRecord | null>(null);
  const [cuantificandoRecord, setCuantificandoRecord] = useState<SolicitudRecord | null>(null);
  const [verRecord, setVerRecord] = useState<SolicitudRecord | null>(null);

  // ── Data fetching ─────────────────────────────────────────────────────
  const { data: solicitudesData } = useQuery({
    queryKey: ['solicitudes'],
    queryFn: () => fetchSolicitudes({ limit: 200 }),
  });
  const records = useMemo(
    () => (solicitudesData?.data ?? []).map(dtoToRecord),
    [solicitudesData],
  );

  const { data: tiposData } = useQuery({
    queryKey: ['tipos-contratacion', 'all'],
    queryFn: () => fetchTiposContratacion({ limit: 500 }),
    staleTime: 10 * 60 * 1000,
  });
  // Map tipoContratacionId → requiereInspeccion
  // esIndividualizacion types never require inspection even if the DB column
  // hasn't been updated yet (migration may be pending on the server).
  const tipoInspeccionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const t of tiposData?.data ?? []) {
      const requiere = (t.requiereInspeccion ?? true) && !t.esIndividualizacion;
      map.set(t.id, requiere);
    }
    return map;
  }, [tiposData]);

  // Map tipoContratacionId → nombre (for PDF generation)
  const tipoNombreMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tiposData?.data ?? []) map.set(t.id, t.nombre);
    return map;
  }, [tiposData]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const cancelarMutation = useMutation({
    mutationFn: (id: string) => apiCancelarSolicitud(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['solicitudes'] }),
  });

  const retormarMutation = useMutation({
    mutationFn: (id: string) => apiRetormarSolicitud(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['solicitudes'] }),
  });

  // Active = not cancelled/rejected
  const activeRecords = useMemo(
    () => records.filter((r) => r.estado !== 'cancelada' && r.estado !== 'rechazada'),
    [records],
  );
  const cancelledRecords = useMemo(
    () => records.filter((r) => r.estado === 'cancelada' || r.estado === 'rechazada'),
    [records],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = tab === 'canceladas' ? cancelledRecords : activeRecords;
    let result = base;
    if (estadoFiltro !== 'todas' && tab === 'activas') {
      result = result.filter((r) => {
        if (estadoFiltro === 'inspeccion_pendiente') return ['borrador', 'inspeccion_pendiente', 'inspeccion_en_proceso'].includes(r.estado);
        if (estadoFiltro === 'en_cotizacion') return ['inspeccion_completada', 'en_cotizacion', 'cotizado'].includes(r.estado);
        if (estadoFiltro === 'aceptada') return r.estado === 'aceptada' || r.estado === 'contratado';
        return r.estado === estadoFiltro;
      });
    }
    if (q) {
      result = result.filter(
        (r) =>
          r.folio.toLowerCase().includes(q) ||
          r.propNombreCompleto.toLowerCase().includes(q) ||
          r.predioResumen.toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortOrder === 'desc' ? -diff : diff;
    });
  }, [records, search, estadoFiltro, tab, activeRecords, cancelledRecords, sortOrder]);

  // KPI counts
  const total = activeRecords.length;
  const pendientesInsp = activeRecords.filter((r) =>
    ['borrador', 'inspeccion_pendiente', 'inspeccion_en_proceso'].includes(r.estado),
  ).length;
  const enCotizacion = activeRecords.filter((r) =>
    ['inspeccion_completada', 'en_cotizacion', 'cotizado'].includes(r.estado),
  ).length;
  const aceptadas = activeRecords.filter((r) => r.estado === 'aceptada' || r.estado === 'contratado').length;
  const canceladas = cancelledRecords.length;

  // Opens the cotización modal instead of navigating immediately
  function handleContinuarCuantificacion(id: string, campoData?: { materialCalle: string; materialBanqueta: string; metrosRupturaAguaCalle: string; metrosRupturaAguaBanqueta: string; metrosRupturaDrenajeCalle: string; metrosRupturaDrenajeBanqueta: string }) {
    const r = records.find((r) => r.id === id) ?? inspRecord;
    const base = r ?? null;
    if (base && campoData) {
      setCuantificandoRecord({
        ...base,
        ordenInspeccion: {
          ...(base.ordenInspeccion ?? { estado: 'completada' }),
          ...campoData,
        } as typeof base.ordenInspeccion,
      });
    } else {
      setCuantificandoRecord(base);
    }
    setInspRecord(null);
  }

  // Called from CotizacionModal when client accepts (API call is inside the modal)
  function handleConfirmarCotizacion(_id: string, contratoId?: string) {
    queryClient.invalidateQueries({ queryKey: ['solicitudes'] });
    queryClient.invalidateQueries({ queryKey: ['contratos'] });
    setCotizandoRecord(null);
    toast.success('Cotización aceptada — proceso de contratación iniciado');
    navigate(
      contratoId
        ? `/app/contratos?iniciarAlta=1&contratoId=${encodeURIComponent(contratoId)}&solicitudId=${encodeURIComponent(_id)}`
        : '/app/contratos',
    );
  }

  // Cancel solicitud (client doesn't continue, but can come back)
  function handleRechazar(id: string) {
    cancelarMutation.mutate(id);
    setInspRecord(null);
    setCotizandoRecord(null);
    toast.info('Solicitud cancelada — el cliente puede retomar el trámite en cualquier momento');
  }

  function handleRetomar(id: string) {
    retormarMutation.mutate(id);
    toast.success('Solicitud reactivada');
  }

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Solicitudes de Servicio</h1>
          <p className="text-sm text-muted-foreground">CEA-FUS01 — Registro de solicitudes de contratación en ventanilla</p>
        </div>
        <Button
          type="button"
          className="bg-[#007BFF] hover:bg-blue-600 text-white"
          onClick={() => navigate('/app/solicitudes/nueva')}
        >
          <ClipboardPlus className="mr-2 h-4 w-4" />
          Nueva solicitud
        </Button>
      </div>

      {/* ── Flow indicator ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <span>Flujo:</span>
        {[
          'Solicitud CEA-FUS01',
          'Inspección en campo',
          'Cotización (5 días vigencia)',
          'Contratación',
        ].map((step, i, arr) => (
          <span key={step} className="flex items-center gap-1.5">
            <span>{step}</span>
            {i < arr.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" />}
          </span>
        ))}
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Solicitudes activas', value: total, className: '' },
          { label: 'Pendientes de inspección', value: pendientesInsp, className: 'text-amber-600' },
          { label: 'En cotización', value: enCotizacion, className: 'text-blue-600' },
          { label: 'Alta de contrato', value: aceptadas, className: 'text-emerald-600' },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{kpi.label}</p>
              <p className={cn('text-3xl font-bold font-display tabular-nums mt-1', kpi.className)}>{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        <button
          type="button"
          onClick={() => { setTab('activas'); setEstadoFiltro('todas'); setSearch(''); }}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === 'activas' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ClipboardList className="h-4 w-4" />
          Activas
          {total > 0 && (
            <span className={cn('ml-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums', tab === 'activas' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
              {total}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => { setTab('canceladas'); setSearch(''); }}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === 'canceladas' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Ban className="h-4 w-4" />
          Canceladas
          {canceladas > 0 && (
            <span className={cn('ml-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums', tab === 'canceladas' ? 'bg-slate-200 text-slate-700' : 'bg-muted text-muted-foreground')}>
              {canceladas}
            </span>
          )}
        </button>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar por folio, propietario o domicilio…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex rounded-md border overflow-hidden">
            {tab === 'activas' && ESTADO_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEstadoFiltro(opt.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors border-r',
                  estadoFiltro === opt.value
                    ? 'bg-[#007BFF]/[0.08] text-[#007BFF]'
                    : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={sortOrder === 'desc' ? 'Más recientes primero' : 'Más antiguos primero'}
            >
              {sortOrder === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
              Fecha
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ClipboardList className="h-7 w-7" />
          </div>
          <div>
            <p className="font-medium">
              {tab === 'canceladas'
                ? 'No hay solicitudes canceladas'
                : records.length === 0
                  ? 'No hay solicitudes registradas'
                  : 'Sin resultados para este filtro'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === 'canceladas'
                ? 'Las solicitudes canceladas por el cliente aparecerán aquí y pueden ser retomadas.'
                : records.length === 0
                  ? 'Cuando llegue un cliente a ventanilla, usa el botón "Nueva solicitud" para empezar.'
                  : 'Ajusta la búsqueda o el filtro para encontrar solicitudes.'}
            </p>
          </div>
          {records.length === 0 && tab === 'activas' && (
            <Button type="button" onClick={() => navigate('/app/solicitudes/nueva')} className="bg-[#007BFF] hover:bg-blue-600 text-white">
              <ClipboardPlus className="mr-2 h-4 w-4" />
              Nueva solicitud
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Folio</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Propietario</th>
                <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground md:table-cell">Domicilio del predio</th>
                <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground sm:table-cell">Fecha</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{r.folio}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{r.propNombreCompleto}</span>
                    {r.propTelefono && r.propTelefono !== '—' && (
                      <span className="block text-xs text-muted-foreground">{r.propTelefono}</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                    {r.predioResumen}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                    {r.fechaSolicitud}
                  </td>
                  <td className="px-4 py-3">
                    <EstadoBadge estado={r.estado} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {tab === 'canceladas' ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => handleRetomar(r.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Retomar trámite
                        </Button>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5"
                            onClick={() => setVerRecord(r)}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Ver
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5"
                            onClick={() => navigate(`/app/solicitudes/${r.id}/editar`)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </Button>
                          {r.estado !== 'aceptada' && r.estado !== 'contratado' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => handleRechazar(r.id)}
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Cancelar
                            </Button>
                          )}
                          {(r.estado === 'aceptada' || r.estado === 'contratado') ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 border-emerald-500 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                              onClick={() => navigate(r.contratoId ? `/app/contratos?detail=${r.contratoId}` : '/app/contratos')}
                            >
                              <ArrowRight className="h-3.5 w-3.5" />
                              Ver contrato
                            </Button>
                          ) : (r.estado === 'en_cotizacion' || r.estado === 'inspeccion_completada' || r.estado === 'cotizado'
                              || (tipoInspeccionMap.get(r.tipoContratacionId) === false)) ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 gap-1.5 bg-blue-600 text-white hover:bg-blue-700"
                              onClick={() => setCuantificandoRecord(r)}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Cuantificación
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                              onClick={() => setInspRecord(r)}
                            >
                              <ClipboardList className="h-3.5 w-3.5" />
                              Inspección
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Ver Solicitud Dialog ─────────────────────────────────────── */}
      <VerSolicitudDialog
        record={verRecord}
        open={!!verRecord}
        onClose={() => setVerRecord(null)}
        tipoContratacionNombre={verRecord ? tipoNombreMap.get(verRecord.tipoContratacionId) : undefined}
      />

      {/* ── Inspection Sheet ──────────────────────────────────────────── */}
      <OrdenInspeccionSheet
        record={inspRecord}
        open={!!inspRecord}
        onClose={() => setInspRecord(null)}
        onAceptar={handleContinuarCuantificacion}
        onRechazar={handleRechazar}
      />

      {/* ── Cuantificación Modal ──────────────────────────────────────── */}
      <CuantificacionModal
        record={cuantificandoRecord}
        open={!!cuantificandoRecord}
        onClose={() => setCuantificandoRecord(null)}
        tipoContratacionNombre={cuantificandoRecord ? tipoNombreMap.get(cuantificandoRecord.tipoContratacionId) : undefined}
        onGuardar={async (data: CuantificacionData) => {
          if (!cuantificandoRecord) return;
          await apiUpdateSolicitud(cuantificandoRecord.id, {
            formData: { ...cuantificandoRecord.formData, cuantificacionData: data as any },
          });
          queryClient.invalidateQueries({ queryKey: ['solicitudes'] });
          toast.success('Cuantificación guardada');
        }}
        onAceptar={(data: CuantificacionData) => {
          if (!cuantificandoRecord) return;
          // Guardar silenciosamente y abrir cotización
          apiUpdateSolicitud(cuantificandoRecord.id, {
            formData: { ...cuantificandoRecord.formData, cuantificacionData: data as any },
          }).catch(() => {});
          setCuantificandoRecord(null);
          // Pass updated formData so CotizacionModal recalculates with the new cuantificación values
          setCotizandoRecord({
            ...cuantificandoRecord,
            formData: { ...cuantificandoRecord.formData, cuantificacionData: data as any },
          } as SolicitudRecord);
        }}
      />

      <CotizacionModal
        record={cotizandoRecord}
        open={!!cotizandoRecord}
        onClose={() => setCotizandoRecord(null)}
        onAceptar={(id, contratoId) => handleConfirmarCotizacion(id, contratoId)}
        onRechazar={handleRechazar}
        onVerInspeccion={(r) => { setCotizandoRecord(null); setInspRecord(r); }}
        onEditarCuantificacion={() => { setCuantificandoRecord(cotizandoRecord); setCotizandoRecord(null); }}
        tipoContratacionNombre={cotizandoRecord ? tipoNombreMap.get(cotizandoRecord.tipoContratacionId) : undefined}
        cuantificacionData={(cotizandoRecord?.formData as any)?.cuantificacionData}
      />
    </div>
  );
}
