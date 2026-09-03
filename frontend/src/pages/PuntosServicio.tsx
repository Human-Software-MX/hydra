import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';

import {
  fetchCalibres,
  fetchEstructurasTecnicas,
  fetchTiposCorte,
  fetchTiposSuministro,
} from '@/api/catalogos';
import { createPuntoServicio, darBajaPuntoServicio, fetchPuntosServicio } from '@/api/puntos-servicio';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/ui/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ── Catálogos hardcodeados ────────────────────────────────────────────────────

const ADMINISTRACIONES = [
  { id: '1', nombre: 'QUERÉTARO' },
  { id: '2', nombre: 'SANTA ROSA JÁUREGUI' },
  { id: '3', nombre: 'CORREGIDORA' },
  { id: '4', nombre: 'PEDRO ESCOBEDO' },
  { id: '5', nombre: 'TEQUISQUIAPAN' },
  { id: '6', nombre: 'EZEQUIEL MONTES' },
  { id: '7', nombre: 'AMEALCO DE BONFIL' },
  { id: '8', nombre: 'HUIMILPAN' },
  { id: '9', nombre: 'CADEREYTA DE MONTES-SAN JOAQUÍN' },
  { id: '10', nombre: 'COLÓN-TOLIMÁN' },
  { id: '11', nombre: 'JALPAN DE SERRA-LANDA DE MATAMOROS-ARROYO SECO' },
  { id: '12', nombre: 'EL MARQUÉS' },
  { id: '13', nombre: 'PINAL DE AMOLES-PEÑAMILLER' },
];

const SECTORES_HIDRAULICOS = [
  { id: '161', nombre: 'S.H - 001  LAS ROSAS' },
  { id: '162', nombre: 'S.H - 002 LOS MOLINOS' },
  { id: '163', nombre: 'S.H - 003 TECNOLOGICO - EL PORVENIR' },
  { id: '164', nombre: 'S.H - 004 CERRITO - LA ESPAÑA' },
  { id: '165', nombre: 'S.H - 005 SAN PABLO TECNOLOGICO' },
  { id: '166', nombre: 'S.H - 006 ALAMOS' },
  { id: '167', nombre: 'S.H - 007 BALCONES' },
  { id: '168', nombre: 'S.H - 008 ARBOLEDAS GAMITOS' },
  { id: '169', nombre: 'S.H - 009 JARDINES DEL PARQUE' },
  { id: '170', nombre: 'S.H - 010 MENCHACA' },
  { id: '171', nombre: 'S.H - 011 PEÑUELAS' },
  { id: '172', nombre: 'S.H - 012 SAN PABLO P/A' },
  { id: '173', nombre: 'S.H - 013 SAN PABLO P/B' },
  { id: '174', nombre: 'S.H - 015 VIRREYES - ENSUEÑO' },
  { id: '175', nombre: 'S.H - 016 LAS CAMPANAS - CENTRO' },
  { id: '176', nombre: 'S.H - 017 CENTRO' },
  { id: '177', nombre: 'S.H - 018 LA CRUZ P/B' },
  { id: '178', nombre: 'S.H - 019 CALESA' },
  { id: '179', nombre: 'S.H - 020 HERCULES' },
  { id: '180', nombre: 'S.H - 021 EL CARRIZAL' },
  { id: '181', nombre: 'S.H - 022 LA CRUZ P/A' },
  { id: '182', nombre: 'S.H - 023 CARRETAS' },
  { id: '183', nombre: 'S.H - 024 LOMA DORADA P/B' },
  { id: '184', nombre: 'S.H - 025 MILENIO III FASE B P/A' },
  { id: '185', nombre: 'S.H - 026 CASABLANCA - CIMATARIO I' },
  { id: '186', nombre: 'S.H - 027 CIMATARIO - LA ESTRELLA' },
  { id: '187', nombre: 'S.H - 028 ALAMEDAS - VILLAS DEL SOL' },
  { id: '188', nombre: 'S.H - 029 MARQUES INFONAVIT' },
  { id: '189', nombre: 'S.H - 030 CENTRO EXPOSITOR' },
  { id: '190', nombre: 'S.H - 031 VISTA ALEGRE' },
  { id: '191', nombre: 'S.H - 032 LA ALHAMBRA' },
  { id: '192', nombre: 'S.H - 033 LAZARO CARDENAS' },
  { id: '193', nombre: 'S.H - 034 COLINAS DEL CIMATARIO II' },
  { id: '194', nombre: 'S.H - 035 LOMA DORADA P/A' },
  { id: '195', nombre: 'S.H - 036 VISTA HERMOSA' },
  { id: '196', nombre: 'S.H - 037 MILENIO III FASE A' },
  { id: '197', nombre: 'S.H - 038 UNIDAD NACIONAL-VILLAS DE SANTIAGO NORTE' },
  { id: '198', nombre: 'S.H - 039 VILLAS DE SANTIAGO SUR' },
  { id: '199', nombre: 'S.H - 041 VERGEL - SAN PEDRITO LOS ARCOS' },
  { id: '200', nombre: 'S.H - 042 LOMAS DE SAN PEDRITO I' },
  { id: '201', nombre: 'S.H - 043 LOMAS DE SAN PEDRITO II' },
  { id: '202', nombre: 'S.H - 044 LOMAS DE SAN PEDRITO III' },
  { id: '203', nombre: 'S.H - 045 VALLE DE SAN PEDRITO' },
  { id: '204', nombre: 'S.H - 046 MENCHACA II P/B' },
  { id: '205', nombre: 'S.H - 047 SAN PEDRITO IV' },
  { id: '206', nombre: 'S.H - 048 MENCHACA II P/A' },
  { id: '207', nombre: 'S.H - 049 RENACIMIENTO' },
  { id: '208', nombre: 'S.H - 050 PREPA NORTE' },
  { id: '209', nombre: 'S.H - 051 LAS AMERICAS' },
  { id: '210', nombre: 'S.H - 052 BOLAÑOS I' },
  { id: '211', nombre: 'S.H - 053 BOLAÑOS II' },
  { id: '212', nombre: 'S.H - 054 COLINAS DEL PARQUE' },
  { id: '213', nombre: 'S.H - 055 LOMAS DEL MARQUES' },
  { id: '214', nombre: 'S.H - 056 PEDREGAL' },
  { id: '215', nombre: 'S.H - 057 RANCHO SAN ANTONIO' },
  { id: '216', nombre: 'S.H - 058 JURICA CAPILLA' },
  { id: '217', nombre: 'S.H - 059 JURICA MEZQUITE I' },
  { id: '218', nombre: 'S.H - 060 JURICA MEZQUITE II' },
  { id: '219', nombre: 'S.H - 061 LOMA BONITA II' },
  { id: '220', nombre: 'S.H - 062 LOMA BONITA I' },
  { id: '221', nombre: 'S.H - 063 CERRITO COLORADO II' },
  { id: '222', nombre: 'S.H - 064 LA LOMA' },
  { id: '223', nombre: 'S.H - 065 AZUCENAS' },
  { id: '224', nombre: 'S.H - 066 CERRITO COLORADO I' },
  { id: '225', nombre: 'S.H - 067 SATELITE' },
  { id: '226', nombre: 'S.H - 068 PARQUE INDUSTRIAL BENITO JUAREZ' },
  { id: '227', nombre: 'S.H - 069 SAUCES - INSURGENTES' },
  { id: '228', nombre: 'S.H - 070 LA ESMERALDA' },
  { id: '229', nombre: 'S.H - 071 EL ROCIO - EL SOL' },
  { id: '230', nombre: 'S.H - 072 EL TINTERO' },
  { id: '231', nombre: 'S.H - 073 CARRILLO' },
  { id: '232', nombre: 'S.H - 074 LA OBRERA' },
  { id: '233', nombre: 'S.H - 075 SANTA MONICA' },
  { id: '234', nombre: 'S.H - 076 CARRILLO PUERTO II' },
  { id: '235', nombre: 'S.H - 077 GENERAL ARTEAGA' },
  { id: '236', nombre: 'S.H - 078 SANTA MARIA MAGDALENA' },
  { id: '237', nombre: 'S.H - 079 LAS TERESAS' },
  { id: '238', nombre: 'S.H - 080 LOMAS DE CASABLANCA P/B' },
  { id: '239', nombre: 'S.H - 081 LOMAS DE CASABLANCA P/A' },
  { id: '240', nombre: 'S.H - 082 REFORMA AGRARIA P/A' },
  { id: '241', nombre: 'S.H - 083 REFORMA AGRARIA P/B' },
  { id: '242', nombre: 'S.H - 084 LA JOYA' },
  { id: '243', nombre: 'S.H - 085 JARDINES DE LA HACIENDA' },
  { id: '244', nombre: 'S.H - 086 EL POCITO' },
  { id: '245', nombre: 'S.H - 087 FORTIN BATAN' },
  { id: '246', nombre: 'S.H - 088 CANDILES' },
  { id: '247', nombre: 'S.H - 089 SAN CARLOS' },
  { id: '248', nombre: 'S.H - 090 FRANCISCO VILLA' },
  { id: '249', nombre: 'S.H - 091 TEJEDA III' },
  { id: '250', nombre: 'S.H - 092 TEJEDA I' },
  { id: '251', nombre: 'S.H - 093 TEJEDA II' },
  { id: '252', nombre: 'S.H - 094 PUEBLO NUEVO' },
  { id: '253', nombre: 'S.H - 096 COLINAS DEL SUR - CUMBRES DEL ROBLE' },
  { id: '254', nombre: 'S.H - 097 CUMBRES DEL CIMATARIO' },
  { id: '255', nombre: 'S.H - 098 RINCONADA - LOMAS DEL CIMATARIO' },
  { id: '256', nombre: 'S.H - 099 PRADOS DEL CIMATARIO - PRADERAS DEL SOL' },
  { id: '257', nombre: 'S.H - 100 TAQ - CENTRO SUR' },
  { id: '258', nombre: 'S.H - 101 CUESTA BONITA - SANTA FE' },
  { id: '259', nombre: 'S.H - 102 MILENIO III FASE B P/B' },
  { id: '260', nombre: 'S.H - 103 LA CAÑADA SUR' },
  { id: '261', nombre: 'S.H - 104 2 ABRIL' },
  { id: '262', nombre: 'S.H - 105 CAMPESTRE ITALIANA' },
  { id: '263', nombre: 'S.H - 106 CENTRO SUR' },
  { id: '264', nombre: 'S.H - 107 MILENIO III FASE B P/M' },
  { id: '265', nombre: 'S.H - 108 LA CAÑADA NORTE' },
  { id: '266', nombre: 'S.H - 109 LOS ROBLES - JARDINES DE LA ALBORADA' },
  { id: '267', nombre: 'S.H - 110 VALLE DE SAN PABLO' },
  { id: '268', nombre: 'S.H - Sin Sector Hid.' },
  { id: '15546', nombre: 'S.H - 000 SIN SECTOR' },
  { id: '269', nombre: 'S.H - 014 JURICA PUEBLO' },
  { id: '270', nombre: 'S.H - 040 SAN JOSE EL ALTO' },
  { id: '271', nombre: 'S.H - Sin Sector Hid.' },
  { id: '272', nombre: 'S.H - 095 SAN JOSE DE LOS OLVERA' },
  { id: '273', nombre: 'S.H - Sin Sector Hid.' },
  { id: '274', nombre: 'S.H - Sin Sector Hid.' },
  { id: '275', nombre: 'S.H - Sin Sector Hid.' },
  { id: '276', nombre: 'S.H - Sin Sector Hid.' },
  { id: '277', nombre: 'S.H - Sin Sector Hid.' },
  { id: '278', nombre: 'S.H - Sin Sector Hid.' },
  { id: '279', nombre: 'S.H - Sin Sector Hid.' },
  { id: '280', nombre: 'S.H - Sin Sector Hid.' },
  { id: '281', nombre: 'S.H - 01 CHUVEJE-MANANTIAL' },
  { id: '282', nombre: 'S.H - Sin Sector Hid.' },
  { id: '283', nombre: 'S.H - Sin Sector' },
  { id: '284', nombre: 'S.H - Sin Sector Hid.' },
];

const DISTRITOS = [
  { id: '1', nombre: '01-DISTRITO NORORIENTE' },
  { id: '2', nombre: '02-DISTRITO NORPONIENTE' },
  { id: '3', nombre: '03-ZONA SURORIENTE' },
  { id: '4', nombre: '04-ZONA SURPONIENTE' },
];

const TIPOS_PUNTO_SERVICIO = [
  { id: '1', nombre: 'DOMESTICO APOYO SOCIAL' },
  { id: '2', nombre: 'COMERCIAL' },
  { id: '3', nombre: 'INDUSTRIAL' },
  { id: '4', nombre: 'GANADERO' },
  { id: '5', nombre: 'PUBLICO OFICIAL' },
  { id: '6', nombre: 'PUBLICO CONCESIONADO' },
  { id: '7', nombre: 'HIDRANTE' },
  { id: '8', nombre: 'INST. DE BENEFICIENCIA' },
  { id: '9', nombre: 'DOMÉSTICO ECONÓMICO' },
  { id: '10', nombre: 'DOMÉSTICO MEDIO' },
  { id: '11', nombre: 'DOMÉSTICO ALTO' },
  { id: '12', nombre: 'DOMÉSTICO ZONA RURAL' },
  { id: '13', nombre: 'DOMÉSTICO CABECERA ECONÓMICA' },
  { id: '14', nombre: 'DOMÉSTICO CABECERA MEDIA' },
];

const ESTADOS_SUMINISTRO = [
  'Sin contrato',
  'Con servicio',
  'Cortado por deuda',
  'Cortado baja temporal',
];

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  codigo: string;
  claveCatastral: string;
  folioExpediente: string;
  administracion: string;
  estructuraTecnicaId: string;
  sectorHidraulicoId: string;
  calibreId: string;
  tipoPuntoServicio: string;
  tipoSuministroId: string;
  zonaFacturacion: string;
  distritoId: string;
  codigoRecorrido: string;
  tipoCorteId: string;
  estadoSuministro: string;
  fechaInstalacion: string;
  fechaCorte: string;
  coordenadaLat: string;
  coordenadaLon: string;
  libreta: string;
  cortePosible: boolean;
  noAccesible: boolean;
  deshabitado: boolean;
  posibilidadFraude: boolean;
  ningunIndicador: boolean;
}

const INITIAL_FORM: FormState = {
  codigo: '',
  claveCatastral: '',
  folioExpediente: '',
  administracion: '',
  estructuraTecnicaId: '',
  sectorHidraulicoId: '',
  calibreId: '',
  tipoPuntoServicio: '',
  tipoSuministroId: '',
  zonaFacturacion: '',
  distritoId: '',
  codigoRecorrido: '',
  tipoCorteId: '',
  estadoSuministro: '',
  fechaInstalacion: '',
  fechaCorte: '',
  coordenadaLat: '',
  coordenadaLon: '',
  libreta: '',
  cortePosible: false,
  noAccesible: false,
  deshabitado: false,
  posibilidadFraude: false,
  ningunIndicador: false,
};

const REQUIRED_FIELDS: (keyof FormState)[] = [
  'codigo',
  'administracion',
  'estructuraTecnicaId',
  'sectorHidraulicoId',
  'tipoPuntoServicio',
  'tipoSuministroId',
  'estadoSuministro',
];

function resolveById<T extends { id: string; nombre: string }>(list: T[], id: string | null | undefined): string {
  if (!id) return '—';
  return list.find((x) => x.id === String(id))?.nombre ?? id;
}

export default function PuntosServicio() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [confirmCloseCreate, setConfirmCloseCreate] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setOpen(true);
      navigate('/app/puntos-servicio', { replace: true });
    }
  }, [searchParams, navigate]);

  const [submitted, setSubmitted] = useState(false);

  const set =
    (field: keyof FormState) =>
    (val: string | boolean) =>
      setForm((prev) => ({ ...prev, [field]: val }));

  // Returns true if the field is required AND empty (after submit attempt)
  const err = (field: keyof FormState) =>
    submitted && REQUIRED_FIELDS.includes(field) && !String(form[field]).trim();

  const isFormValid = REQUIRED_FIELDS.every((f) => String(form[f]).trim());

  const handleNingunIndicador = (checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      ningunIndicador: checked,
      ...(checked ? { cortePosible: false, noAccesible: false, deshabitado: false, posibilidadFraude: false } : {}),
    }));
  };

  const handleIndicador = (field: 'cortePosible' | 'noAccesible' | 'deshabitado' | 'posibilidadFraude') =>
    (checked: boolean) =>
      setForm((prev) => ({ ...prev, [field]: checked, ningunIndicador: false }));

  const closeDialog = () => {
    setOpen(false);
    setForm(INITIAL_FORM);
    setSubmitted(false);
  };

  const [confirmBaja, setConfirmBaja] = useState<{ id: string; codigo: string } | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['puntos-servicio', 'catalogo'],
    queryFn: () => fetchPuntosServicio({ page: 1, limit: 500 }),
  });

  const { data: estructuras = [] } = useQuery({
    queryKey: ['estructuras-tecnicas'],
    queryFn: fetchEstructurasTecnicas,
  });
  const { data: calibres = [] } = useQuery({
    queryKey: ['calibres'],
    queryFn: fetchCalibres,
  });
  const { data: tiposSuministroRaw = [] } = useQuery({
    queryKey: ['tipos-suministro'],
    queryFn: fetchTiposSuministro,
  });
  const tiposSuministro = tiposSuministroRaw.filter((t) => t.codigo !== 'MIXTO');
  const { data: tiposCorte = [] } = useQuery({
    queryKey: ['tipos-corte'],
    queryFn: fetchTiposCorte,
  });

  const bajaMut = useMutation({
    mutationFn: (id: string) => darBajaPuntoServicio(id),
    onSuccess: async (_, id) => {
      await queryClient.invalidateQueries({ queryKey: ['puntos-servicio'] });
      toast.success('Punto de servicio dado de baja', {
        description: `El registro fue marcado como Inactivo.`,
      });
      setConfirmBaja(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'No se pudo dar de baja.';
      toast.error('Error', { description: msg });
      setConfirmBaja(null);
    },
  });

  const rows = data?.data ?? [];

  const createMut = useMutation({
    mutationFn: () =>
      createPuntoServicio({
        codigo: form.codigo.trim(),
        administracion: form.administracion || undefined,
        tipoPuntoServicio: form.tipoPuntoServicio || undefined,
        estructuraTecnicaId: form.estructuraTecnicaId || undefined,
        sectorHidraulicoId: form.sectorHidraulicoId || undefined,
        calibreId: form.calibreId || undefined,
        tipoSuministroId: form.tipoSuministroId || undefined,
        tipoCorteId: form.tipoCorteId || undefined,
        estadoSuministro: form.estadoSuministro || undefined,
        fechaInstalacion: form.fechaInstalacion || undefined,
        fechaCorte: form.fechaCorte || undefined,
        coordenadaLat: form.coordenadaLat ? parseFloat(form.coordenadaLat) : undefined,
        coordenadaLon: form.coordenadaLon ? parseFloat(form.coordenadaLon) : undefined,
        libreta: form.libreta || undefined,
        claveCatastral: form.claveCatastral || undefined,
        folioExpediente: form.folioExpediente || undefined,
        distritoId: form.distritoId || undefined,
        cortePosible: form.cortePosible,
        noAccesible: form.noAccesible,
        deshabitado: form.deshabitado,
        posibilidadFraude: form.posibilidadFraude,
        estado: 'Activo',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['puntos-servicio'] });
      toast.success('Punto de servicio creado', {
        description: `Código ${form.codigo.trim()} registrado correctamente.`,
      });
      closeDialog();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'No se pudo crear el punto de servicio.';
      toast.error('Error al crear', { description: msg });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Puntos de servicio"
        subtitle="Catálogo operativo: altas y consulta de puntos de servicio (tomas)."
        breadcrumbs={[{ label: 'Infraestructura', href: '#' }, { label: 'Puntos de servicio' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Nuevo punto
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          Cargando puntos de servicio…
        </div>
      ) : null}

      {isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Error al cargar el catálogo.'}
        </div>
      ) : null}

      {!isLoading && !isError && rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No hay puntos de servicio registrados. Use &quot;Nuevo punto&quot; para crear el primero.
        </div>
      ) : null}

      {!isLoading && !isError && rows.length > 0 ? (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Administración</TableHead>
                <TableHead>Estructura técnica</TableHead>
                <TableHead>Sector hidráulico</TableHead>
                <TableHead>Tipo de PS</TableHead>
                <TableHead>Tipo suministro</TableHead>
                <TableHead>Estado suministro</TableHead>
                <TableHead>Calibre</TableHead>
                <TableHead>Creado</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((ps) => (
                <TableRow key={ps.id}>
                  <TableCell className="font-mono font-medium">{ps.codigo}</TableCell>
                  <TableCell className="text-sm">
                    {resolveById(ADMINISTRACIONES, ps.administracion)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ps.estructuraTecnica?.descripcion ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {resolveById(SECTORES_HIDRAULICOS, ps.sectorHidraulicoId)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {resolveById(TIPOS_PUNTO_SERVICIO, ps.tipoPuntoServicio)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ps.tipoSuministro?.descripcion ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ps.estadoSuministro ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ps.calibreId ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {ps.createdAt
                      ? new Date(ps.createdAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                    {ps.updatedAt && ps.updatedAt !== ps.createdAt && (
                      <span className="block text-[11px] opacity-70">
                        Act. {new Date(ps.updatedAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmBaja({ id: ps.id, codigo: ps.codigo })}
                      title="Dar de baja"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* ── Modal ── */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) setConfirmCloseCreate(true); else setOpen(true); }}>
        <DialogContent
          className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"
          onInteractOutside={(e) => { e.preventDefault(); setConfirmCloseCreate(true); }}
        >
          <DialogHeader>
            <DialogTitle>Nuevo punto de servicio</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">

            {/* Identificación */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Identificación
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="ps-codigo" className={err('codigo') ? 'text-destructive' : ''}>
                    Código <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="ps-codigo"
                    value={form.codigo}
                    onChange={(e) => set('codigo')(e.target.value)}
                    placeholder="Ej: PS-10001"
                    className={`font-mono ${err('codigo') ? 'border-destructive' : ''}`}
                    autoComplete="off"
                  />
                  {err('codigo') && <p className="text-xs text-destructive">Obligatorio</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ps-catastral">Clave catastral</Label>
                  <Input
                    id="ps-catastral"
                    value={form.claveCatastral}
                    onChange={(e) => set('claveCatastral')(e.target.value)}
                    placeholder="Clave catastral"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ps-folio">Folio de expediente</Label>
                  <Input
                    id="ps-folio"
                    value={form.folioExpediente}
                    onChange={(e) => set('folioExpediente')(e.target.value)}
                    placeholder="Solo factibilidades"
                    autoComplete="off"
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Clasificación */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Clasificación
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className={err('administracion') ? 'text-destructive' : ''}>
                    Administración <span className="text-destructive">*</span>
                  </Label>
                  <SearchableSelect
                    value={form.administracion}
                    onValueChange={set('administracion')}
                    options={ADMINISTRACIONES.map((a) => ({ value: a.id, label: `${a.id} – ${a.nombre}` }))}
                    placeholder="Seleccionar administración"
                    searchPlaceholder="Buscar administración…"
                    className={err('administracion') ? 'border-destructive' : ''}
                  />
                </div>
                <div className="space-y-1">
                  <Label className={err('estructuraTecnicaId') ? 'text-destructive' : ''}>
                    Tipo de estructura técnica <span className="text-destructive">*</span>
                  </Label>
                  <SearchableSelect
                    value={form.estructuraTecnicaId}
                    onValueChange={set('estructuraTecnicaId')}
                    options={estructuras.map((e) => ({ value: e.id, label: `${e.codigo} – ${e.descripcion}` }))}
                    placeholder="Seleccionar estructura"
                    searchPlaceholder="Buscar estructura…"
                    className={err('estructuraTecnicaId') ? 'border-destructive' : ''}
                  />
                </div>
                <div className="space-y-1">
                  <Label className={err('tipoSuministroId') ? 'text-destructive' : ''}>
                    Tipo de suministro <span className="text-destructive">*</span>
                  </Label>
                  <SearchableSelect
                    value={form.tipoSuministroId}
                    onValueChange={set('tipoSuministroId')}
                    options={tiposSuministro.map((t) => ({ value: t.id, label: `${t.codigo} – ${t.descripcion}` }))}
                    placeholder="Seleccionar tipo"
                    searchPlaceholder="Buscar tipo…"
                    className={err('tipoSuministroId') ? 'border-destructive' : ''}
                  />
                </div>
                <div className="space-y-1">
                  <Label className={err('tipoPuntoServicio') ? 'text-destructive' : ''}>
                    Tipo de punto de servicio <span className="text-destructive">*</span>
                  </Label>
                  <SearchableSelect
                    value={form.tipoPuntoServicio}
                    onValueChange={set('tipoPuntoServicio')}
                    options={TIPOS_PUNTO_SERVICIO.map((t) => ({ value: t.id, label: `${t.id} – ${t.nombre}` }))}
                    placeholder="Seleccionar tipo"
                    searchPlaceholder="Buscar tipo…"
                    className={err('tipoPuntoServicio') ? 'border-destructive' : ''}
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Ubicación */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ubicación
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className={err('sectorHidraulicoId') ? 'text-destructive' : ''}>
                    Sector hidráulico <span className="text-destructive">*</span>
                  </Label>
                  <SearchableSelect
                    value={form.sectorHidraulicoId}
                    onValueChange={set('sectorHidraulicoId')}
                    options={SECTORES_HIDRAULICOS.map((s) => ({ value: s.id, label: `${s.id} – ${s.nombre}` }))}
                    placeholder="Seleccionar sector"
                    searchPlaceholder="Buscar sector…"
                    className={err('sectorHidraulicoId') ? 'border-destructive' : ''}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ps-zona">Zona de facturación</Label>
                  <Input
                    id="ps-zona"
                    value={form.zonaFacturacion}
                    onChange={(e) => set('zonaFacturacion')(e.target.value)}
                    placeholder="Zona de facturación"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ps-lat">Latitud</Label>
                  <Input
                    id="ps-lat"
                    type="number"
                    step="any"
                    value={form.coordenadaLat}
                    onChange={(e) => set('coordenadaLat')(e.target.value)}
                    placeholder="Ej: 20.5881"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ps-lon">Longitud</Label>
                  <Input
                    id="ps-lon"
                    type="number"
                    step="any"
                    value={form.coordenadaLon}
                    onChange={(e) => set('coordenadaLon')(e.target.value)}
                    placeholder="Ej: -100.3899"
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Datos técnicos */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Datos técnicos
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Calibre de la toma</Label>
                  <SearchableSelect
                    value={form.calibreId}
                    onValueChange={set('calibreId')}
                    options={calibres.map((c) => ({ value: c.id, label: `${c.codigo} – ${c.descripcion}` }))}
                    placeholder="Seleccionar calibre"
                    searchPlaceholder="Buscar calibre…"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ps-recorrido">Código de recorrido</Label>
                  <Input
                    id="ps-recorrido"
                    value={form.codigoRecorrido}
                    onChange={(e) => set('codigoRecorrido')(e.target.value)}
                    placeholder="Código de recorrido"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ps-libreta">Libreta</Label>
                  <Input
                    id="ps-libreta"
                    value={form.libreta}
                    onChange={(e) => set('libreta')(e.target.value)}
                    placeholder="Número de libreta"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Distrito de atención de órdenes</Label>
                  <SearchableSelect
                    value={form.distritoId}
                    onValueChange={set('distritoId')}
                    options={DISTRITOS.map((d) => ({ value: d.id, label: d.nombre }))}
                    placeholder="Seleccionar distrito"
                    searchPlaceholder="Buscar distrito…"
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Estado del suministro */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Estado del suministro
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label className={err('estadoSuministro') ? 'text-destructive' : ''}>
                    Estado del suministro <span className="text-destructive">*</span>
                  </Label>
                  <Select value={form.estadoSuministro} onValueChange={set('estadoSuministro')}>
                    <SelectTrigger className={err('estadoSuministro') ? 'border-destructive' : ''}>
                      <SelectValue placeholder="Seleccionar estado" />
                    </SelectTrigger>
                    <SelectContent>
                      {ESTADOS_SUMINISTRO.map((e) => (
                        <SelectItem key={e} value={e}>
                          {e}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Tipo de corte</Label>
                  <SearchableSelect
                    value={form.tipoCorteId}
                    onValueChange={set('tipoCorteId')}
                    options={tiposCorte.map((t) => ({ value: t.id, label: `${t.codigo} – ${t.descripcion}` }))}
                    placeholder="Seleccionar tipo"
                    searchPlaceholder="Buscar tipo…"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ps-fecha-corte">Fecha de corte</Label>
                  <Input
                    id="ps-fecha-corte"
                    type="date"
                    value={form.fechaCorte}
                    onChange={(e) => set('fechaCorte')(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Fechas */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fechas
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ps-fecha-inst">Fecha de instalación</Label>
                  <Input
                    id="ps-fecha-inst"
                    type="date"
                    value={form.fechaInstalacion}
                    onChange={(e) => set('fechaInstalacion')(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Indicadores */}
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Indicadores
              </p>
              <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={form.cortePosible}
                    onCheckedChange={(v) => handleIndicador('cortePosible')(!!v)}
                  />
                  <span className="text-sm">Corte posible</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={form.noAccesible}
                    onCheckedChange={(v) => handleIndicador('noAccesible')(!!v)}
                  />
                  <span className="text-sm">No accesible</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={form.deshabitado}
                    onCheckedChange={(v) => handleIndicador('deshabitado')(!!v)}
                  />
                  <span className="text-sm">Deshabitado</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={form.posibilidadFraude}
                    onCheckedChange={(v) => handleIndicador('posibilidadFraude')(!!v)}
                  />
                  <span className="text-sm">Posibilidad de fraude</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={form.ningunIndicador}
                    onCheckedChange={(v) => handleNingunIndicador(!!v)}
                  />
                  <span className="text-sm text-muted-foreground">Ninguno</span>
                </label>
              </div>
            </section>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConfirmCloseCreate(true)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={createMut.isPending}
              onClick={() => {
                setSubmitted(true);
                if (isFormValid) createMut.mutate();
              }}
            >
              {createMut.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                'Crear'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación cerrar modal de creación */}
      <AlertDialog open={confirmCloseCreate} onOpenChange={setConfirmCloseCreate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar el registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Se perderán todos los datos capturados. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar capturando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmCloseCreate(false); closeDialog(); }}
            >
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmación dar de baja */}
      <AlertDialog open={!!confirmBaja} onOpenChange={(v) => { if (!v) setConfirmBaja(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dar de baja este punto de servicio?</AlertDialogTitle>
            <AlertDialogDescription>
              El punto <span className="font-mono font-semibold">{confirmBaja?.codigo}</span> será
              marcado como <strong>Inactivo</strong>. Podrá reactivarse posteriormente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmBaja && bajaMut.mutate(confirmBaja.id)}
              disabled={bajaMut.isPending}
            >
              {bajaMut.isPending ? 'Procesando…' : 'Dar de baja'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
