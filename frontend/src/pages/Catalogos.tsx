import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/StatusBadge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  fetchActividades,
  fetchGruposActividad,
  fetchCategorias,
  fetchTiposRelacionPS,
  fetchConceptosCobro,
  fetchClausulas,
  fetchTiposCorte,
  fetchTiposSuministro,
  fetchEstructurasTecnicas,
  fetchZonasFacturacion,
  fetchCodigosRecorrido,
  fetchMarcasMedidor,
  fetchCalibres,
  fetchEmplazamientos,
  fetchTiposContador,
  fetchFormasPago,
  fetchTiposOficina,
  fetchSectoresHidraulicos,
  fetchClasesContrato,
  fetchTiposVia,
  fetchTiposVariable,
  fetchCatalogoSat,
  fetchAdministraciones,
  fetchDistritos,
  fetchZonasTerritoriales,
  type AdministracionCatalogo,
  type DistritoCatalogo,
  type ZonaTerritorialCatalogo,
  type CatalogoSatItem,
  type CatalogoActividad,
  type CatalogoGrupoActividad,
  type CatalogoCategoria,
  type CatalogoTipoRelacionPS,
  type ConceptoCobro,
  type ClausulaContractual,
  type CatalogoTipoCorte,
  type CatalogoCodigoDescripcion,
  type CatalogoCodigoRecorrido,
  type CatalogoMarcaMedidor,
  type CatalogoCalibre,
  type FormaPago,
  type SectorHidraulico,
  type ClaseContrato,
  type TipoVariable,
} from '@/api/catalogos';
import {
  fetchInegiResumen,
  fetchInegiEstados,
  fetchInegiMunicipiosCatalogo,
  fetchInegiLocalidadesCatalogo,
  fetchInegiColoniasCatalogo,
  type CatalogoEstadoINEGI,
  type CatalogoMunicipioINEGIRow,
  type CatalogoLocalidadINEGIRow,
  type CatalogoColoniaINEGIRow,
} from '@/api/domicilios-inegi';
import { hasApi } from '@/api/contratos';
import {
  BookOpen,
  Tag,
  Share2,
  Layers,
  Receipt,
  FileText,
  Scissors,
  Zap,
  Building2,
  MapPin,
  Route,
  Globe2,
  Landmark,
  MapPinned,
  Home,
  Gauge,
  Ruler,
  CreditCard,
  Droplets,
  SquareStack,
  Signpost,
  Variable,
  Scale,
  Landmark,
  LayoutGrid,
  Map as MapIcon,
} from 'lucide-react';

// ── Static fallback data ──────────────────────────────────────────────────────

const FALLBACK_GRUPOS: CatalogoGrupoActividad[] = [
  { id: 'ga01', codigo: 'GA01', descripcion: 'Agricultura y cultivos', activo: true },
  { id: 'ga02', codigo: 'GA02', descripcion: 'Ganadería y cría de animales', activo: true },
  { id: 'ga03', codigo: 'GA03', descripcion: 'Agroindustria', activo: true },
  { id: 'ga04', codigo: 'GA04', descripcion: 'Pesca y acuicultura', activo: true },
  { id: 'ga05', codigo: 'GA05', descripcion: 'Minería y extracción', activo: true },
  { id: 'ga06', codigo: 'GA06', descripcion: 'Manufactura e industria', activo: true },
  { id: 'ga07', codigo: 'GA07', descripcion: 'Construcción', activo: true },
  { id: 'ga08', codigo: 'GA08', descripcion: 'Comercio al por menor', activo: true },
  { id: 'ga09', codigo: 'GA09', descripcion: 'Comercio al por mayor', activo: true },
  { id: 'ga10', codigo: 'GA10', descripcion: 'Transporte y logística', activo: true },
  { id: 'ga11', codigo: 'GA11', descripcion: 'Hospedaje y turismo', activo: true },
  { id: 'ga12', codigo: 'GA12', descripcion: 'Servicios profesionales', activo: true },
  { id: 'ga13', codigo: 'GA13', descripcion: 'Servicios gubernamentales', activo: true },
  { id: 'ga14', codigo: 'GA14', descripcion: 'Educación', activo: true },
  { id: 'ga15', codigo: 'GA15', descripcion: 'Salud y asistencia social', activo: true },
  { id: 'ga16', codigo: 'GA16', descripcion: 'Recreación y cultura', activo: true },
  { id: 'ga17', codigo: 'GA17', descripcion: 'Culto religioso', activo: true },
  { id: 'ga18', codigo: 'GA18', descripcion: 'Habitacional privada', activo: true },
  { id: 'ga19', codigo: 'GA19', descripcion: 'Uso mixto', activo: true },
];

const FALLBACK_ACTIVIDADES: CatalogoActividad[] = [
  { id: 'a01', codigo: 'HAB_UNIFAM', descripcion: 'Habitacional unifamiliar', grupoId: 'ga18', activo: true },
  { id: 'a02', codigo: 'HAB_MULTIFAM', descripcion: 'Habitacional multifamiliar', grupoId: 'ga18', activo: true },
  { id: 'a03', codigo: 'COM_REST', descripcion: 'Comercio / Restaurante', grupoId: 'ga08', activo: true },
  { id: 'a04', codigo: 'IND_ALIM', descripcion: 'Industria alimentaria', grupoId: 'ga06', activo: true },
  { id: 'a05', codigo: 'GOB_ESCUELA', descripcion: 'Gobierno / Escuela', grupoId: 'ga13', activo: true },
  { id: 'a06', codigo: 'SALUD_HOSP', descripcion: 'Salud / Hospital', grupoId: 'ga15', activo: true },
  { id: 'a07', codigo: 'HOSP_HOTEL', descripcion: 'Hospedaje / Hotel', grupoId: 'ga11', activo: true },
  { id: 'a08', codigo: 'CONST_PROV', descripcion: 'Construcción provisional', grupoId: 'ga07', activo: true },
];

const FALLBACK_CATEGORIAS: CatalogoCategoria[] = [
  { id: 'c01', codigo: 'DOM_A', descripcion: 'Doméstico A (0–10 m³)', activo: true },
  { id: 'c02', codigo: 'DOM_B', descripcion: 'Doméstico B (11–20 m³)', activo: true },
  { id: 'c03', codigo: 'DOM_C', descripcion: 'Doméstico C (21–30 m³)', activo: true },
  { id: 'c04', codigo: 'DOM_D', descripcion: 'Doméstico D (>30 m³)', activo: true },
  { id: 'c05', codigo: 'COM_PEQ', descripcion: 'Comercial pequeño', activo: true },
  { id: 'c06', codigo: 'COM_MED', descripcion: 'Comercial mediano', activo: true },
  { id: 'c07', codigo: 'COM_GDE', descripcion: 'Comercial grande', activo: true },
  { id: 'c08', codigo: 'IND_PEQ', descripcion: 'Industrial pequeño', activo: true },
  { id: 'c09', codigo: 'IND_MED', descripcion: 'Industrial mediano', activo: true },
  { id: 'c10', codigo: 'IND_GDE', descripcion: 'Industrial grande', activo: true },
  { id: 'c11', codigo: 'GOB_FED', descripcion: 'Gobierno federal', activo: true },
  { id: 'c12', codigo: 'GOB_ESTATAL', descripcion: 'Gobierno estatal', activo: true },
  { id: 'c13', codigo: 'GOB_MPAL', descripcion: 'Gobierno municipal', activo: true },
  { id: 'c14', codigo: 'SERV_PUB', descripcion: 'Servicio público', activo: true },
  { id: 'c15', codigo: 'SOCIAL', descripcion: 'Social / Asistencial', activo: true },
  { id: 'c16', codigo: 'RELIG', descripcion: 'Religioso', activo: true },
  { id: 'c17', codigo: 'AGRO', descripcion: 'Agropecuario', activo: true },
  { id: 'c18', codigo: 'CONST_PROV', descripcion: 'Construcción provisional', activo: true },
  { id: 'c19', codigo: 'MIXTO', descripcion: 'Mixto', activo: true },
  { id: 'c20', codigo: 'CONDOM', descripcion: 'Condominio', activo: true },
  { id: 'c21', codigo: 'ESPECIAL', descripcion: 'Especial / Otro', activo: true },
];

const FALLBACK_TIPOS_RELACION: CatalogoTipoRelacionPS[] = [
  { id: 'r01', codigo: 'CONDOM_MAESTRO', descripcion: 'Medidor maestro de condominio', metodo: 'maestro', reparteConsumo: true, activo: true },
  { id: 'r02', codigo: 'CONDOM_INDIVIDUAL', descripcion: 'Unidad individual de condominio', metodo: 'individual', reparteConsumo: false, activo: true },
  { id: 'r03', codigo: 'SUBMEDICION', descripcion: 'Submedición de consumo', metodo: 'submedicion', reparteConsumo: false, activo: true },
  { id: 'r04', codigo: 'RIEGO_COMUN', descripcion: 'Riego de área común', metodo: 'prorrateo', reparteConsumo: true, activo: true },
  { id: 'r05', codigo: 'USO_MIX_PADRE', descripcion: 'PS padre de uso mixto', metodo: 'padre', reparteConsumo: true, activo: true },
  { id: 'r06', codigo: 'USO_MIX_HIJO', descripcion: 'PS hijo de uso mixto', metodo: 'hijo', reparteConsumo: false, activo: true },
];

function fmtMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
}

function actividadGrupoId(a: CatalogoActividad): string | null {
  return a.grupoId ?? a.grupo?.id ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

const INEGI_PAGE_SIZE = 50;

const SAT_CFDI_TAB = 'sat-cfdi';

const Catalogos = () => {
  const location = useLocation();
  const isSatEntry = location.pathname.endsWith('/catalogos-sat');
  const useApi = hasApi();
  const [catalogTab, setCatalogTab] = useState(() => (isSatEntry ? SAT_CFDI_TAB : 'actividades'));

  useEffect(() => {
    if (isSatEntry) setCatalogTab(SAT_CFDI_TAB);
  }, [isSatEntry]);

  const [munPage, setMunPage] = useState(1);
  const [munEstadoId, setMunEstadoId] = useState('');
  const [munNombre, setMunNombre] = useState('');

  const [locPage, setLocPage] = useState(1);
  const [locMunicipioId, setLocMunicipioId] = useState('');
  const [locNombre, setLocNombre] = useState('');

  const [colPage, setColPage] = useState(1);
  const [colMunicipioId, setColMunicipioId] = useState('');
  const [colCp, setColCp] = useState('');
  const [colNombre, setColNombre] = useState('');

  const { data: grupos = FALLBACK_GRUPOS } = useQuery({
    queryKey: ['catalogos', 'grupos-actividad'],
    queryFn: fetchGruposActividad,
    enabled: useApi,
  });

  const { data: actividades = FALLBACK_ACTIVIDADES } = useQuery({
    queryKey: ['catalogos', 'actividades'],
    queryFn: fetchActividades,
    enabled: useApi,
  });

  const { data: categorias = FALLBACK_CATEGORIAS } = useQuery({
    queryKey: ['catalogos', 'categorias'],
    queryFn: fetchCategorias,
    enabled: useApi,
  });

  const { data: tiposRelacion = FALLBACK_TIPOS_RELACION } = useQuery({
    queryKey: ['catalogos', 'tipos-relacion-ps'],
    queryFn: fetchTiposRelacionPS,
    enabled: useApi,
  });

  const { data: conceptos = [] } = useQuery({
    queryKey: ['catalogos', 'conceptos-cobro'],
    queryFn: fetchConceptosCobro,
    enabled: useApi,
  });

  const { data: clausulas = [] } = useQuery({
    queryKey: ['catalogos', 'clausulas'],
    queryFn: fetchClausulas,
    enabled: useApi,
  });

  const { data: tiposCorte = [] } = useQuery({
    queryKey: ['catalogos', 'tipos-corte'],
    queryFn: fetchTiposCorte,
    enabled: useApi,
  });

  const { data: tiposSuministro = [] } = useQuery({
    queryKey: ['catalogos', 'tipos-suministro'],
    queryFn: fetchTiposSuministro,
    enabled: useApi,
  });

  const { data: estructuras = [] } = useQuery({
    queryKey: ['catalogos', 'estructuras-tecnicas'],
    queryFn: fetchEstructurasTecnicas,
    enabled: useApi,
  });

  const { data: zonasFacturacion = [] } = useQuery({
    queryKey: ['catalogos', 'zonas-facturacion'],
    queryFn: fetchZonasFacturacion,
    enabled: useApi,
  });

  const { data: codigosRecorrido = [] } = useQuery({
    queryKey: ['catalogos', 'codigos-recorrido'],
    queryFn: fetchCodigosRecorrido,
    enabled: useApi,
  });

  const { data: inegiResumen } = useQuery({
    queryKey: ['domicilios', 'catalogo-inegi', 'resumen'],
    queryFn: fetchInegiResumen,
    enabled: useApi,
  });

  const inegiCounts = inegiResumen ?? { estados: 0, municipios: 0, localidades: 0, colonias: 0 };

  const inegiEstadosEnabled =
    useApi && (catalogTab === 'inegi-estados' || catalogTab === 'inegi-municipios');

  const { data: inegiEstados = [] } = useQuery({
    queryKey: ['domicilios', 'estados'],
    queryFn: fetchInegiEstados,
    enabled: inegiEstadosEnabled,
  });

  const { data: munResult } = useQuery({
    queryKey: ['domicilios', 'catalogo-inegi', 'municipios', munPage, munEstadoId, munNombre],
    queryFn: () =>
      fetchInegiMunicipiosCatalogo({
        page: munPage,
        limit: INEGI_PAGE_SIZE,
        estadoId: munEstadoId || undefined,
        nombre: munNombre.trim() || undefined,
      }),
    enabled: useApi && catalogTab === 'inegi-municipios',
  });

  const { data: locResult } = useQuery({
    queryKey: ['domicilios', 'catalogo-inegi', 'localidades', locPage, locMunicipioId, locNombre],
    queryFn: () =>
      fetchInegiLocalidadesCatalogo({
        page: locPage,
        limit: INEGI_PAGE_SIZE,
        municipioId: locMunicipioId.trim() || undefined,
        nombre: locNombre.trim() || undefined,
      }),
    enabled: useApi && catalogTab === 'inegi-localidades',
  });

  const { data: colResult } = useQuery({
    queryKey: ['domicilios', 'catalogo-inegi', 'colonias', colPage, colMunicipioId, colCp, colNombre],
    queryFn: () =>
      fetchInegiColoniasCatalogo({
        page: colPage,
        limit: INEGI_PAGE_SIZE,
        municipioId: colMunicipioId.trim() || undefined,
        codigoPostal: colCp.trim() || undefined,
        nombre: colNombre.trim() || undefined,
      }),
    enabled: useApi && catalogTab === 'inegi-colonias',
  });

  // ── Catálogos Operativos ───────────────────────────────────────────────────

  const { data: marcasMedidor = [] } = useQuery<CatalogoMarcaMedidor[]>({
    queryKey: ['catalogos-op', 'marcas-medidor'],
    queryFn: fetchMarcasMedidor,
    enabled: useApi,
  });

  const { data: calibres = [] } = useQuery<CatalogoCalibre[]>({
    queryKey: ['catalogos-op', 'calibres'],
    queryFn: fetchCalibres,
    enabled: useApi,
  });

  const { data: emplazamientos = [] } = useQuery<CatalogoCodigoDescripcion[]>({
    queryKey: ['catalogos-op', 'emplazamientos'],
    queryFn: fetchEmplazamientos,
    enabled: useApi,
  });

  const { data: tiposContador = [] } = useQuery<CatalogoCodigoDescripcion[]>({
    queryKey: ['catalogos-op', 'tipos-contador'],
    queryFn: fetchTiposContador,
    enabled: useApi,
  });

  const { data: formasPago = [] } = useQuery<FormaPago[]>({
    queryKey: ['catalogos-op', 'formas-pago'],
    queryFn: fetchFormasPago,
    enabled: useApi,
  });

  const { data: tiposOficina = [] } = useQuery<CatalogoCodigoDescripcion[]>({
    queryKey: ['catalogos-op', 'tipos-oficina'],
    queryFn: fetchTiposOficina,
    enabled: useApi,
  });

  const { data: sectoresHidraulicos = [] } = useQuery<SectorHidraulico[]>({
    queryKey: ['catalogos-op', 'sectores-hidraulicos'],
    queryFn: fetchSectoresHidraulicos,
    enabled: useApi,
  });

  const { data: clasesContrato = [] } = useQuery<ClaseContrato[]>({
    queryKey: ['catalogos-op', 'clases-contrato'],
    queryFn: fetchClasesContrato,
    enabled: useApi,
  });

  const { data: tiposVia = [] } = useQuery<CatalogoCodigoDescripcion[]>({
    queryKey: ['catalogos-op', 'tipos-via'],
    queryFn: fetchTiposVia,
    enabled: useApi,
  });

  const { data: tiposVariable = [] } = useQuery<TipoVariable[]>({
    queryKey: ['catalogos-op', 'tipos-variable'],
    queryFn: fetchTiposVariable,
    enabled: useApi,
  });

  const { data: catalogoSat = [] } = useQuery<CatalogoSatItem[]>({
    queryKey: ['catalogos', 'sat'],
    queryFn: () => fetchCatalogoSat(),
    enabled: useApi,
  });
  const satRegimen = catalogoSat.filter((r) => r.tipo === 'REGIMEN_FISCAL');
  const satUsoCfdi = catalogoSat.filter((r) => r.tipo === 'USO_CFDI');

  const { data: administraciones = [] } = useQuery<AdministracionCatalogo[]>({
    queryKey: ['catalogos', 'administraciones'],
    queryFn: fetchAdministraciones,
    enabled: useApi,
  });

  const { data: zonasTerritoriales = [] } = useQuery<ZonaTerritorialCatalogo[]>({
    queryKey: ['catalogos', 'zonas-territoriales'],
    queryFn: fetchZonasTerritoriales,
    enabled: useApi,
  });

  const { data: distritosCatalogo = [] } = useQuery<DistritoCatalogo[]>({
    queryKey: ['catalogos', 'distritos', 'config'],
    queryFn: fetchDistritos,
    enabled: useApi,
  });

  const adminNombreById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of administraciones) m.set(a.id, a.nombre);
    return m;
  }, [administraciones]);

  const zonaNombreById = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zonasTerritoriales) m.set(z.id, z.nombre);
    return m;
  }, [zonasTerritoriales]);

  const kpiItems = [
    { label: 'Conceptos cobro', value: conceptos.length, icon: Receipt, color: '#0d9488' },
    { label: 'Cláusulas', value: clausulas.length, icon: FileText, color: '#7c3aed' },
    { label: 'Grupos actividad', value: grupos.length, icon: Layers, color: '#003366' },
    { label: 'Actividades', value: actividades.length, icon: BookOpen, color: '#007BFF' },
    { label: 'Categorías', value: categorias.length, icon: Tag, color: '#4A6278' },
    { label: 'Tipos relación PS', value: tiposRelacion.length, icon: Share2, color: '#059669' },
    { label: 'Tipos corte', value: tiposCorte.length, icon: Scissors, color: '#b45309' },
    { label: 'Tipos suministro', value: tiposSuministro.length, icon: Zap, color: '#ca8a04' },
    { label: 'Estructuras técnicas', value: estructuras.length, icon: Building2, color: '#475569' },
    { label: 'Zonas facturación', value: zonasFacturacion.length, icon: MapPin, color: '#be123c' },
    { label: 'Códigos recorrido', value: codigosRecorrido.length, icon: Route, color: '#0369a1' },
    { label: 'Administraciones', value: administraciones.length, icon: Landmark, color: '#0f172a' },
    { label: 'Zonas territorio', value: zonasTerritoriales.length, icon: LayoutGrid, color: '#155e75' },
    { label: 'Distritos', value: distritosCatalogo.length, icon: MapPinned, color: '#9a3412' },
    { label: 'INEGI Estados', value: inegiCounts.estados, icon: Globe2, color: '#0f766e' },
    { label: 'INEGI Municipios', value: inegiCounts.municipios, icon: MapIcon, color: '#115e59' },
    { label: 'INEGI Localidades', value: inegiCounts.localidades, icon: MapPinned, color: '#134e4a' },
    { label: 'INEGI Colonias', value: inegiCounts.colonias, icon: Home, color: '#042f2e' },
    { label: 'Marcas medidor', value: marcasMedidor.length, icon: Gauge, color: '#6d28d9' },
    { label: 'Calibres', value: calibres.length, icon: Ruler, color: '#a21caf' },
    { label: 'Formas pago', value: formasPago.length, icon: CreditCard, color: '#0891b2' },
    { label: 'Sectores hidráulicos', value: sectoresHidraulicos.length, icon: Droplets, color: '#2563eb' },
    { label: 'Clases contrato', value: clasesContrato.length, icon: SquareStack, color: '#d97706' },
    { label: 'Tipos vía', value: tiposVia.length, icon: Signpost, color: '#4f46e5' },
    { label: 'Tipos variable', value: tiposVariable.length, icon: Variable, color: '#dc2626' },
    {
      label: 'SAT · régimen / uso CFDI',
      value: `${satRegimen.length} / ${satUsoCfdi.length}`,
      icon: Scale,
      color: '#b91c1c',
    },
  ];

  const tabDefs: { value: string; label: string }[] = [
    { value: 'conceptos-cobro', label: 'Conceptos de cobro' },
    { value: 'clausulas', label: 'Cláusulas' },
    { value: 'actividades', label: 'Actividades por grupo' },
    { value: 'categorias', label: 'Categorías tarifarias' },
    { value: 'relaciones', label: 'Tipos relación PS' },
    { value: 'tipos-corte', label: 'Tipos de corte' },
    { value: 'tipos-suministro', label: 'Tipos suministro' },
    { value: 'estructuras-tecnicas', label: 'Estructuras técnicas' },
    { value: 'zonas-facturacion', label: 'Zonas facturación' },
    { value: 'codigos-recorrido', label: 'Códigos recorrido' },
    { value: 'administraciones', label: 'Administraciones' },
    { value: 'zonas-territoriales', label: 'Zonas (territorio)' },
    { value: 'distritos', label: 'Distritos' },
    { value: 'inegi-estados', label: 'INEGI · Estados' },
    { value: 'inegi-municipios', label: 'INEGI · Municipios' },
    { value: 'inegi-localidades', label: 'INEGI · Localidades' },
    { value: 'inegi-colonias', label: 'INEGI · Colonias' },
    { value: 'marcas-medidor', label: 'Marcas medidor' },
    { value: 'calibres', label: 'Calibres' },
    { value: 'emplazamientos', label: 'Emplazamientos' },
    { value: 'tipos-contador', label: 'Tipos contador' },
    { value: 'formas-pago', label: 'Formas de pago' },
    { value: 'tipos-oficina', label: 'Tipos oficina' },
    { value: 'sectores-hidraulicos', label: 'Sectores hidráulicos' },
    { value: 'clases-contrato', label: 'Clases contrato' },
    { value: 'tipos-via', label: 'Tipos de vía' },
    { value: 'tipos-variable', label: 'Tipos variable' },
    { value: 'sat-cfdi', label: 'SAT · CFDI' },
  ];

  return (
    <div>
      <PageHeader
        title={isSatEntry ? 'Catálogos SAT (CFDI)' : 'Catálogos'}
        subtitle={
          isSatEntry
            ? 'Régimen fiscal y uso del CFDI (Anexo 20). Consulta del catálogo sembrado desde el Excel SAT.'
            : 'Contratación, CIG2018, punto de servicio, administración y territorio (distritos), medidores, pagos, operativos e INEGI. Solo consulta.'
        }
        breadcrumbs={[
          { label: 'Configuración', href: '#' },
          isSatEntry ? { label: 'Catálogos SAT (CFDI)' } : { label: 'Catálogos' },
        ]}
      />

      {!isSatEntry && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
          {kpiItems.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl border border-border/50 shadow-sm p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium truncate">{label}</p>
                <p className="text-xl font-bold font-display" style={{ color }}>{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <Tabs value={catalogTab} onValueChange={setCatalogTab}>
        {!isSatEntry && (
          <TabsList className="mb-4 bg-white border border-slate-200/70 rounded-xl p-1 gap-1 h-auto flex flex-wrap justify-start">
            {tabDefs.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="rounded-lg data-[state=active]:bg-[#007BFF]/[0.08] data-[state=active]:text-[#007BFF] data-[state=active]:shadow-none text-xs sm:text-sm px-3 py-2"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        )}

        <TabsContent value="conceptos-cobro" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Nombre', 'Tipo', 'Monto base', 'IVA %', 'Fórmula', 'Estado'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conceptos.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      Sin registros. Verifica la API y el seed de conceptos de cobro.
                    </td>
                  </tr>
                ) : (
                  conceptos.map((c: ConceptoCobro, i: number) => (
                    <tr key={c.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#007BFF] font-medium whitespace-nowrap">{c.codigo}</td>
                      <td className="px-4 py-3 font-medium">{c.nombre}</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-xs font-mono">{c.tipo}</Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{fmtMoney(c.montoBase)}</td>
                      <td className="px-4 py-3 tabular-nums">{fmtMoney(c.ivaPct)}</td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <span className="text-xs text-muted-foreground line-clamp-2" title={c.formula ?? undefined}>
                          {c.formula ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.activo ? 'Activo' : 'Inactivo'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="clausulas" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Título', 'Versión', 'Contenido', 'Estado'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clausulas.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      Sin registros. Verifica la API y el seed de cláusulas.
                    </td>
                  </tr>
                ) : (
                  clausulas.map((cl: ClausulaContractual, i: number) => (
                    <tr key={cl.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors align-top`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#007BFF] font-medium whitespace-nowrap">{cl.codigo}</td>
                      <td className="px-4 py-3 font-medium max-w-[220px]">{cl.titulo}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant="outline" className="text-xs">{cl.version}</Badge>
                      </td>
                      <td className="px-4 py-3 max-w-xl">
                        <div className="text-xs text-muted-foreground max-h-36 overflow-y-auto whitespace-pre-wrap border border-border/40 rounded-md p-2 bg-muted/20">
                          {cl.contenido}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={cl.activo ? 'Activo' : 'Inactivo'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="actividades" className="mt-0 space-y-4">
          {grupos.map((grupo) => {
            const acts = actividades.filter((a) => actividadGrupoId(a) === grupo.id);
            return (
              <div key={grupo.id} className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3.5 bg-muted/30 border-b">
                  <Badge variant="outline" className="font-mono text-xs shrink-0">{grupo.codigo}</Badge>
                  <span className="font-semibold text-sm">{grupo.descripcion}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{acts.length} actividades</span>
                  <StatusBadge status={grupo.activo ? 'Activo' : 'Inactivo'} />
                </div>
                {acts.length > 0 ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {acts.map((a, j) => (
                        <tr key={a.id} className={j > 0 ? 'border-t border-border/40' : ''}>
                          <td className="px-5 py-2.5 w-36 font-mono text-xs text-[#007BFF] font-medium">{a.codigo}</td>
                          <td className="px-4 py-2.5">{a.descripcion}</td>
                          <td className="px-4 py-2.5 text-right">
                            <StatusBadge status={a.activo ? 'Activo' : 'Inactivo'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-5 py-3 text-xs text-muted-foreground italic">Sin actividades registradas en este grupo.</p>
                )}
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="categorias" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Descripción', 'Estado'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categorias.map((cat, i) => (
                  <tr key={cat.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                    <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium">{cat.codigo}</td>
                    <td className="px-5 py-3 font-medium">{cat.descripcion}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={cat.activo ? 'Activo' : 'Inactivo'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="relaciones" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Descripción', 'Método', 'Reparte consumo', 'Estado'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tiposRelacion.map((rel, i) => (
                  <tr key={rel.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#007BFF] font-medium">{rel.codigo}</td>
                    <td className="px-5 py-3.5 font-medium">{rel.descripcion}</td>
                    <td className="px-5 py-3.5">
                      <Badge variant="secondary" className="text-xs font-mono">{rel.metodo}</Badge>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-medium ${rel.reparteConsumo ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        {rel.reparteConsumo ? 'Sí' : 'No'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={rel.activo ? 'Activo' : 'Inactivo'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="tipos-corte" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Descripción', 'Impacto', 'Cuadrilla', 'Estado'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tiposCorte.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground text-sm">Sin registros.</td>
                  </tr>
                ) : (
                  tiposCorte.map((row: CatalogoTipoCorte, i: number) => (
                    <tr key={row.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium">{row.codigo}</td>
                      <td className="px-5 py-3 font-medium">{row.descripcion}</td>
                      <td className="px-5 py-3">
                        {row.impacto ? (
                          <Badge variant="secondary" className="text-xs font-mono">{row.impacto}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs">{row.requiereCuadrilla ? 'Sí' : 'No'}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={row.activo ? 'Activo' : 'Inactivo'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="tipos-suministro" className="mt-0">
          <SimpleCodigoDescripcionTable rows={tiposSuministro} emptyMessage="Sin tipos de suministro." />
        </TabsContent>

        <TabsContent value="estructuras-tecnicas" className="mt-0">
          <SimpleCodigoDescripcionTable rows={estructuras} emptyMessage="Sin estructuras técnicas." />
        </TabsContent>

        <TabsContent value="zonas-facturacion" className="mt-0">
          <SimpleCodigoDescripcionTable rows={zonasFacturacion} emptyMessage="Sin zonas de facturación." />
        </TabsContent>

        <TabsContent value="codigos-recorrido" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Descripción', 'Ruta', 'Estado'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {codigosRecorrido.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground text-sm">Sin códigos de recorrido.</td>
                  </tr>
                ) : (
                  codigosRecorrido.map((row: CatalogoCodigoRecorrido, i: number) => (
                    <tr key={row.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium">{row.codigo}</td>
                      <td className="px-5 py-3 font-medium">{row.descripcion}</td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{row.rutaId ?? '—'}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={row.activo ? 'Activo' : 'Inactivo'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="administraciones" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <p className="text-xs text-muted-foreground px-4 py-3 border-b border-border/40">
              Organismos / administración (alta de contratos y ámbito operativo). Origen: catálogo de punto de servicio.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Id', 'Nombre'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {administraciones.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-5 py-8 text-center text-muted-foreground text-sm">
                      Sin administraciones. Verifica la API y el seed.
                    </td>
                  </tr>
                ) : (
                  administraciones.map((a, i) => (
                    <tr key={a.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium whitespace-nowrap">{a.id}</td>
                      <td className="px-5 py-3 font-medium">{a.nombre}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="zonas-territoriales" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <p className="text-xs text-muted-foreground px-4 py-3 border-b border-border/40">
              Zonas bajo cada administración (relación con distritos). No confundir con &quot;Zonas facturación&quot;.
            </p>
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-muted/40">
                  {['Id', 'Nombre', 'Administración', 'Id administración'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zonasTerritoriales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground text-sm">
                      Sin zonas territoriales. Verifica el seed.
                    </td>
                  </tr>
                ) : (
                  zonasTerritoriales.map((z, i) => (
                    <tr key={z.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium whitespace-nowrap">{z.id}</td>
                      <td className="px-5 py-3 font-medium">{z.nombre}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {adminNombreById.get(z.administracionId) ?? '—'}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {z.administracionId}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="distritos" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <p className="text-xs text-muted-foreground px-4 py-3 border-b border-border/40">
              Distritos operativos (p. ej. hoja «Distrito» del catálogo de punto de servicio). Solo consulta.
            </p>
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-muted/40">
                  {['Id', 'Distrito', 'Zona (territorio)', 'Id zona'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {distritosCatalogo.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground text-sm">
                      Sin distritos. Ejecuta <code className="text-xs">npm run prisma:seed</code> o el import de distritos en el backend.
                    </td>
                  </tr>
                ) : (
                  distritosCatalogo.map((d, i) => (
                    <tr key={d.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium whitespace-nowrap">{d.id}</td>
                      <td className="px-5 py-3 font-medium">{d.nombre}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {zonaNombreById.get(d.zonaId) ?? '—'}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{d.zonaId}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="inegi-estados" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <p className="text-xs text-muted-foreground px-4 py-3 border-b border-border/40">
              Catálogo de entidades federativas (clave INEGI oficial).
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Clave INEGI', 'Nombre', 'Estado'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inegiEstados.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-muted-foreground text-sm">
                      Sin datos. Carga el catálogo INEGI en la base o revisa la API.
                    </td>
                  </tr>
                ) : (
                  inegiEstados.map((e: CatalogoEstadoINEGI, i: number) => (
                    <tr key={e.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-5 py-3 font-mono text-xs text-[#0f766e] font-medium">{e.claveINEGI}</td>
                      <td className="px-5 py-3 font-medium">{e.nombre}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={e.activo ? 'Activo' : 'Inactivo'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="inegi-municipios" className="mt-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-border/50 shadow-sm p-4">
            <div className="space-y-1.5 min-w-[200px]">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Estado</label>
              <SearchableSelect
                options={[
                  { value: '', label: 'Todos' },
                  ...inegiEstados.map((e) => ({ value: e.id, label: `${e.claveINEGI} — ${e.nombre}` })),
                ]}
                value={munEstadoId}
                onValueChange={(v) => {
                  setMunEstadoId(v);
                  setMunPage(1);
                }}
                placeholder="Todos"
                searchPlaceholder="Buscar estado…"
              />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[180px] max-w-sm">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Nombre (contiene)</label>
              <Input
                value={munNombre}
                placeholder="Ej. Monterrey"
                onChange={(e) => {
                  setMunNombre(e.target.value);
                  setMunPage(1);
                }}
              />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-muted/40">
                  {['Clave', 'Municipio', 'Entidad federativa', 'Clave entidad', 'Activo'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!munResult?.data.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      Sin resultados en esta página. Ajusta filtros o importa catálogo INEGI.
                    </td>
                  </tr>
                ) : (
                  munResult.data.map((row: CatalogoMunicipioINEGIRow, i: number) => (
                    <tr key={row.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#0f766e] font-medium whitespace-nowrap">{row.claveINEGI}</td>
                      <td className="px-4 py-3 font-medium">{row.nombre}</td>
                      <td className="px-4 py-3">{row.estado?.nombre ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.estado?.claveINEGI ?? '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.activo ? 'Activo' : 'Inactivo'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {munResult ? (
              <CatalogPagination
                page={munResult.page}
                limit={munResult.limit}
                total={munResult.total}
                onPageChange={setMunPage}
              />
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="inegi-localidades" className="mt-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-border/50 shadow-sm p-4">
            <div className="space-y-1.5 flex-1 min-w-[220px] max-w-md">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">ID municipio INEGI (opcional)</label>
              <Input
                value={locMunicipioId}
                placeholder="Pegar id del municipio desde la pestaña anterior"
                onChange={(e) => {
                  setLocMunicipioId(e.target.value);
                  setLocPage(1);
                }}
              />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[180px] max-w-sm">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Nombre (contiene)</label>
              <Input
                value={locNombre}
                onChange={(e) => {
                  setLocNombre(e.target.value);
                  setLocPage(1);
                }}
              />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-muted/40">
                  {['Clave', 'Localidad', 'Municipio', 'Entidad', 'Activo'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!locResult?.data.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      Sin resultados. Opcionalmente filtra por municipio o importa catálogo.
                    </td>
                  </tr>
                ) : (
                  locResult.data.map((row: CatalogoLocalidadINEGIRow, i: number) => (
                    <tr key={row.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#0f766e] font-medium whitespace-nowrap">{row.claveINEGI}</td>
                      <td className="px-4 py-3 font-medium">{row.nombre}</td>
                      <td className="px-4 py-3">{row.municipio?.nombre ?? '—'}</td>
                      <td className="px-4 py-3">{row.municipio?.estado?.nombre ?? '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.activo ? 'Activo' : 'Inactivo'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {locResult ? (
              <CatalogPagination
                page={locResult.page}
                limit={locResult.limit}
                total={locResult.total}
                onPageChange={setLocPage}
              />
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="inegi-colonias" className="mt-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-border/50 shadow-sm p-4">
            <div className="space-y-1.5 flex-1 min-w-[200px] max-w-sm">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">ID municipio (opcional)</label>
              <Input
                value={colMunicipioId}
                onChange={(e) => {
                  setColMunicipioId(e.target.value);
                  setColPage(1);
                }}
              />
            </div>
            <div className="space-y-1.5 w-28">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">C.P.</label>
              <Input
                value={colCp}
                onChange={(e) => {
                  setColCp(e.target.value);
                  setColPage(1);
                }}
              />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[180px] max-w-sm">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Nombre colonia</label>
              <Input
                value={colNombre}
                onChange={(e) => {
                  setColNombre(e.target.value);
                  setColPage(1);
                }}
              />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="bg-muted/40">
                  {['Clave', 'Nombre', 'C.P.', 'Municipio', 'Entidad', 'Activo'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!colResult?.data.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      Sin resultados. Usa C.P., municipio o nombre; el volumen es alto, siempre hay paginación.
                    </td>
                  </tr>
                ) : (
                  colResult.data.map((row: CatalogoColoniaINEGIRow, i: number) => (
                    <tr key={row.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                      <td className="px-4 py-3 font-mono text-xs text-[#0f766e] font-medium whitespace-nowrap">{row.claveINEGI}</td>
                      <td className="px-4 py-3 font-medium">{row.nombre}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.codigoPostal}</td>
                      <td className="px-4 py-3">{row.municipio?.nombre ?? '—'}</td>
                      <td className="px-4 py-3">{row.municipio?.estado?.nombre ?? '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.activo ? 'Activo' : 'Inactivo'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {colResult ? (
              <CatalogPagination
                page={colResult.page}
                limit={colResult.limit}
                total={colResult.total}
                onPageChange={setColPage}
              />
            ) : null}
          </div>
        </TabsContent>

        {/* ── Catálogos Operativos ──────────────────────────────────────────── */}

        <TabsContent value="marcas-medidor" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Nombre', 'Estado'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {marcasMedidor.length === 0 ? (
                  <tr><td colSpan={3} className="px-5 py-8 text-center text-muted-foreground text-sm">Sin marcas registradas</td></tr>
                ) : marcasMedidor.map((r, i) => (
                  <tr key={r.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                    <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium">{r.codigo}</td>
                    <td className="px-5 py-3 font-medium">{r.nombre}</td>
                    <td className="px-5 py-3"><StatusBadge status={r.activo ? 'Activo' : 'Inactivo'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="calibres" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Descripción', 'Diámetro (mm)', 'Estado'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calibres.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground text-sm">Sin calibres registrados</td></tr>
                ) : calibres.map((r, i) => (
                  <tr key={r.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                    <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium">{r.codigo}</td>
                    <td className="px-5 py-3 font-medium">{r.descripcion}</td>
                    <td className="px-5 py-3 tabular-nums">{r.diametroMm ?? '—'}</td>
                    <td className="px-5 py-3"><StatusBadge status={r.activo ? 'Activo' : 'Inactivo'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="emplazamientos" className="mt-0">
          <SimpleCodigoDescripcionTable rows={emplazamientos} emptyMessage="Sin emplazamientos registrados" />
        </TabsContent>

        <TabsContent value="tipos-contador" className="mt-0">
          <SimpleCodigoDescripcionTable rows={tiposContador} emptyMessage="Sin tipos de contador registrados" />
        </TabsContent>

        <TabsContent value="formas-pago" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Nombre', 'Tipo recaudación', 'Efectivo', 'Cheque', 'Tarjeta', 'Transf.', 'Ref.', 'Estado'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {formasPago.length === 0 ? (
                  <tr><td colSpan={9} className="px-5 py-8 text-center text-muted-foreground text-sm">Sin formas de pago registradas</td></tr>
                ) : formasPago.map((r, i) => (
                  <tr key={r.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                    <td className="px-4 py-3 font-mono text-xs text-[#007BFF] font-medium">{r.codigo}</td>
                    <td className="px-4 py-3 font-medium">{r.nombre}</td>
                    <td className="px-4 py-3"><Badge variant="secondary" className="text-xs">{r.tipoRecaudacion}</Badge></td>
                    <td className="px-4 py-3 text-center">{r.aceptaEfectivo ? '✓' : '—'}</td>
                    <td className="px-4 py-3 text-center">{r.aceptaCheque ? '✓' : '—'}</td>
                    <td className="px-4 py-3 text-center">{r.aceptaTarjeta ? '✓' : '—'}</td>
                    <td className="px-4 py-3 text-center">{r.aceptaTransf ? '✓' : '—'}</td>
                    <td className="px-4 py-3 text-center">{r.requiereReferencia ? '✓' : '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.activo ? 'Activo' : 'Inactivo'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="tipos-oficina" className="mt-0">
          <SimpleCodigoDescripcionTable rows={tiposOficina} emptyMessage="Sin tipos de oficina registrados" />
        </TabsContent>

        <TabsContent value="sectores-hidraulicos" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Nombre', 'Estado'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectoresHidraulicos.length === 0 ? (
                  <tr><td colSpan={3} className="px-5 py-8 text-center text-muted-foreground text-sm">Sin sectores registrados</td></tr>
                ) : sectoresHidraulicos.map((r, i) => (
                  <tr key={r.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                    <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium">{r.codigo}</td>
                    <td className="px-5 py-3 font-medium">{r.nombre}</td>
                    <td className="px-5 py-3"><StatusBadge status={r.activo ? 'Activo' : 'Inactivo'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="clases-contrato" className="mt-0">
          <SimpleCodigoDescripcionTable rows={clasesContrato} emptyMessage="Sin clases de contrato registradas" />
        </TabsContent>

        <TabsContent value="tipos-via" className="mt-0">
          <SimpleCodigoDescripcionTable rows={tiposVia} emptyMessage="Sin tipos de vía registrados" />
        </TabsContent>

        <TabsContent value="tipos-variable" className="mt-0">
          <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {['Código', 'Nombre', 'Tipo dato', 'Unidad', 'Estado'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tiposVariable.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground text-sm">Sin tipos de variable registrados</td></tr>
                ) : tiposVariable.map((r, i) => (
                  <tr key={r.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                    <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium">{r.codigo}</td>
                    <td className="px-5 py-3 font-medium">{r.nombre}</td>
                    <td className="px-5 py-3"><Badge variant="secondary" className="text-xs">{r.tipoDato}</Badge></td>
                    <td className="px-5 py-3 text-muted-foreground">{r.unidad ?? '—'}</td>
                    <td className="px-5 py-3"><StatusBadge status={r.activo ? 'Activo' : 'Inactivo'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="sat-cfdi" className="mt-0 space-y-8">
          <div>
            <h3 className="text-sm font-semibold text-[#003366] mb-3">c_RegimenFiscal</h3>
            <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-muted/40">
                    {['Clave', 'Descripción', 'Física', 'Moral', 'Vigencia inicio', 'Estado'].map((h) => (
                      <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {satRegimen.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        Sin datos. Ejecuta migración y <code className="text-xs">npm run prisma:seed</code> en el backend.
                      </td>
                    </tr>
                  ) : (
                    satRegimen.map((r, i) => (
                      <tr key={r.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                        <td className="px-4 py-3 font-mono text-xs text-[#007BFF] font-medium whitespace-nowrap">{r.clave}</td>
                        <td className="px-4 py-3 max-w-md">{r.descripcion}</td>
                        <td className="px-4 py-3">{r.aplicaFisica ? 'Sí' : 'No'}</td>
                        <td className="px-4 py-3">{r.aplicaMoral ? 'Sí' : 'No'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {r.vigenciaInicio
                            ? new Date(r.vigenciaInicio).toLocaleDateString('es-MX')
                            : '—'}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={r.activo ? 'Activo' : 'Inactivo'} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#003366] mb-3">c_UsoCFDI</h3>
            <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead>
                  <tr className="bg-muted/40">
                    {['Clave', 'Descripción', 'Física', 'Moral', 'Régimen receptor (referencia)', 'Estado'].map((h) => (
                      <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {satUsoCfdi.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                        Sin datos. Ejecuta migración y seed en el backend.
                      </td>
                    </tr>
                  ) : (
                    satUsoCfdi.map((r, i) => (
                      <tr key={r.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                        <td className="px-4 py-3 font-mono text-xs text-[#007BFF] font-medium whitespace-nowrap">{r.clave}</td>
                        <td className="px-4 py-3 max-w-xs">{r.descripcion}</td>
                        <td className="px-4 py-3">{r.aplicaFisica ? 'Sí' : 'No'}</td>
                        <td className="px-4 py-3">{r.aplicaMoral ? 'Sí' : 'No'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-lg">
                          <span className="line-clamp-3" title={r.regimenesReceptorPermitidos ?? undefined}>
                            {r.regimenesReceptorPermitidos ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={r.activo ? 'Activo' : 'Inactivo'} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

function CatalogPagination({
  page,
  limit,
  total,
  onPageChange,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="flex flex-wrap items-center gap-3 justify-between px-4 py-3 border-t border-border/50 bg-muted/20 text-sm">
      <span className="text-muted-foreground">
        {total === 0
          ? 'Sin resultados'
          : `${from.toLocaleString('es-MX')}–${to.toLocaleString('es-MX')} de ${total.toLocaleString('es-MX')} · Página ${page} / ${pageCount}`}
      </span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Anterior
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}

function SimpleCodigoDescripcionTable({
  rows,
  emptyMessage,
}: {
  rows: CatalogoCodigoDescripcion[];
  emptyMessage: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40">
            {['Código', 'Descripción', 'Estado'].map((h) => (
              <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-5 py-8 text-center text-muted-foreground text-sm">{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={row.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                <td className="px-5 py-3 font-mono text-xs text-[#007BFF] font-medium">{row.codigo}</td>
                <td className="px-5 py-3 font-medium">{row.descripcion}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={row.activo ? 'Activo' : 'Inactivo'} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default Catalogos;
