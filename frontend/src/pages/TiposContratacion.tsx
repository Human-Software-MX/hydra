import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Plus, Pencil, Settings2, FileText, CheckCircle2 } from 'lucide-react';
import { hasApi } from '@/api/contratos';
import { fetchAdministraciones } from '@/api/catalogos';
import {
  fetchTiposContratacion,
  createTipoContratacion,
  updateTipoContratacion,
  type TipoContratacion,
  type UpdateTipoContratacionDto,
  type CreateTipoContratacionDto,
} from '@/api/tipos-contratacion';

// ── Static fallback ────────────────────────────────────────────────────────────

const FALLBACK: TipoContratacion[] = [
  {
    id: 'tc01', codigo: 'DOM_HAB', nombre: 'Doméstico Habitacional', descripcion: 'Vivienda unifamiliar o multifamiliar',
    requiereMedidor: true, esIndividualizacion: false, requiereInspeccion: true, activo: true,
    claseProceso: 'residencial', esContratoFormal: true, requiereSolicitudPrevia: true,
    diasCaducidadSolicitud: 30, organismoAprobacion: 'Gerencia Técnica',
    diasPlazoAprobacion: 15, periodicidadesPermitidas: 'mensual,bimestral',
    tiposClientePermitidos: 'fisica', _count: { contratos: 120 },
  },
  {
    id: 'tc02', codigo: 'COM_PEQ', nombre: 'Comercial Pequeño', descripcion: 'Comercio local y restaurantes',
    requiereMedidor: true, esIndividualizacion: false, requiereInspeccion: true, activo: true,
    claseProceso: 'comercial', esContratoFormal: true, requiereSolicitudPrevia: true,
    diasCaducidadSolicitud: 20, organismoAprobacion: 'Gerencia Comercial',
    diasPlazoAprobacion: 10, periodicidadesPermitidas: 'mensual',
    tiposClientePermitidos: 'fisica,moral', _count: { contratos: 45 },
  },
  {
    id: 'tc03', codigo: 'IND_MED', nombre: 'Industrial Mediano', descripcion: 'Industria manufacturera mediana',
    requiereMedidor: true, esIndividualizacion: false, requiereInspeccion: true, activo: true,
    claseProceso: 'industrial', esContratoFormal: true, requiereSolicitudPrevia: true,
    diasCaducidadSolicitud: 45, organismoAprobacion: 'Dirección General',
    diasPlazoAprobacion: 30, periodicidadesPermitidas: 'mensual',
    tiposClientePermitidos: 'moral', _count: { contratos: 12 },
  },
  {
    id: 'tc04', codigo: 'GOB_MPAL', nombre: 'Gobierno Municipal', descripcion: 'Dependencias y servicios municipales',
    requiereMedidor: true, esIndividualizacion: false, requiereInspeccion: true, activo: true,
    claseProceso: 'gubernamental', esContratoFormal: true, requiereSolicitudPrevia: false,
    diasCaducidadSolicitud: null, organismoAprobacion: 'Subdirección Comercial',
    diasPlazoAprobacion: 20, periodicidadesPermitidas: 'mensual,trimestral',
    tiposClientePermitidos: 'moral', _count: { contratos: 8 },
  },
];

// ── Form state type ────────────────────────────────────────────────────────────

type FormState = {
  codigo: string; nombre: string; descripcion: string;
  requiereMedidor: boolean; esIndividualizacion: boolean; claseProceso: string;
  esContratoFormal: boolean; requiereSolicitudPrevia: boolean;
  diasCaducidadSolicitud: string; organismoAprobacion: string;
  diasPlazoAprobacion: string; periodicidadesPermitidas: string;
  tiposClientePermitidos: string;
};

const EMPTY_FORM: FormState = {
  codigo: '', nombre: '', descripcion: '',
  requiereMedidor: true, esIndividualizacion: false, claseProceso: '',
  esContratoFormal: true, requiereSolicitudPrevia: false,
  diasCaducidadSolicitud: '', organismoAprobacion: '',
  diasPlazoAprobacion: '', periodicidadesPermitidas: '',
  tiposClientePermitidos: '',
};

function tipoToForm(t: TipoContratacion): FormState {
  return {
    codigo: t.codigo,
    nombre: t.nombre,
    descripcion: t.descripcion ?? '',
    requiereMedidor: t.requiereMedidor,
    esIndividualizacion: t.esIndividualizacion ?? false,
    claseProceso: t.claseProceso ?? '',
    esContratoFormal: t.esContratoFormal,
    requiereSolicitudPrevia: t.requiereSolicitudPrevia,
    diasCaducidadSolicitud: t.diasCaducidadSolicitud?.toString() ?? '',
    organismoAprobacion: t.organismoAprobacion ?? '',
    diasPlazoAprobacion: t.diasPlazoAprobacion?.toString() ?? '',
    periodicidadesPermitidas: t.periodicidadesPermitidas ?? '',
    tiposClientePermitidos: t.tiposClientePermitidos ?? '',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

const TiposContratacion = () => {
  const useApi = hasApi();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; tipo?: TipoContratacion } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [adminFilter, setAdminFilter] = useState<string>('__all__');
  const [medidorFilter, setMedidorFilter] = useState<'all' | 'with' | 'without'>('all');

  const { data: administracionesCatalog = [] } = useQuery({
    queryKey: ['catalogos-operativos', 'administraciones'],
    queryFn: fetchAdministraciones,
    enabled: useApi,
    staleTime: 60 * 60 * 1000,
  });

  const adminNombreById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of administracionesCatalog) m.set(a.id, a.nombre);
    return m;
  }, [administracionesCatalog]);

  const { data: response, isLoading } = useQuery({
    queryKey: ['tipos-contratacion', 'list', adminFilter],
    queryFn: () =>
      fetchTiposContratacion({
        page: 1,
        limit: 500,
        administracionId: adminFilter === '__all__' ? undefined : adminFilter,
      }),
    enabled: useApi,
  });

  const tiposBase = useMemo<TipoContratacion[]>(
    () => (useApi ? (response?.data ?? []) : FALLBACK),
    [useApi, response?.data],
  );

  const tipos = useMemo(() => {
    if (medidorFilter === 'with') return tiposBase.filter((t) => t.requiereMedidor);
    if (medidorFilter === 'without') return tiposBase.filter((t) => !t.requiereMedidor);
    return tiposBase;
  }, [tiposBase, medidorFilter]);

  const createMut = useMutation({
    mutationFn: (dto: CreateTipoContratacionDto) => createTipoContratacion(dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tipos-contratacion'] }); setDialog(null); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateTipoContratacionDto }) => updateTipoContratacion(id, dto),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tipos-contratacion'] }); setDialog(null); },
  });

  const openCreate = () => { setForm(EMPTY_FORM); setDialog({ mode: 'create' }); };
  const openEdit = (t: TipoContratacion) => { setForm(tipoToForm(t)); setDialog({ mode: 'edit', tipo: t }); };

  const handleSave = () => {
    const dto = {
      nombre: form.nombre,
      descripcion: form.descripcion || undefined,
      requiereMedidor: form.requiereMedidor,
      esIndividualizacion: form.esIndividualizacion,
      claseProceso: form.claseProceso || null,
      esContratoFormal: form.esContratoFormal,
      requiereSolicitudPrevia: form.requiereSolicitudPrevia,
      diasCaducidadSolicitud: form.diasCaducidadSolicitud ? parseInt(form.diasCaducidadSolicitud) : null,
      organismoAprobacion: form.organismoAprobacion || null,
      diasPlazoAprobacion: form.diasPlazoAprobacion ? parseInt(form.diasPlazoAprobacion) : null,
      periodicidadesPermitidas: form.periodicidadesPermitidas || null,
      tiposClientePermitidos: form.tiposClientePermitidos || null,
    };

    if (dialog?.mode === 'create') {
      createMut.mutate({ codigo: form.codigo, ...dto });
    } else if (dialog?.tipo) {
      updateMut.mutate({ id: dialog.tipo.id, dto });
    }
  };

  const activos = tiposBase.filter((t) => t.activo).length;
  const conSolicitudPrevia = tiposBase.filter((t) => t.requiereSolicitudPrevia).length;
  const totalContratos = tiposBase.reduce((s, t) => s + (t._count?.contratos ?? 0), 0);

  const set = (k: keyof FormState, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const isSaving = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <PageHeader
        title="Tipos de Contratación"
        subtitle="Catálogo SIGE (importación Excel): tipos por administración territorial; filtre por jurisdicción o por uso de medidor."
        breadcrumbs={[
          { label: 'Configuración', href: '/app/dashboard' },
          { label: 'Tipos de contratación' },
        ]}
        actions={
          <Button onClick={openCreate} className="bg-[#007BFF] hover:bg-blue-600 text-white">
            <Plus className="w-4 h-4 mr-1.5" /> Nuevo tipo
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Tipos registrados" value={tiposBase.length} icon={Settings2} />
        <KpiCard label="Activos" value={activos} accent="success" icon={CheckCircle2} />
        <KpiCard label="Con solicitud previa" value={conSolicitudPrevia} icon={FileText} />
        <KpiCard label="Contratos totales" value={totalContratos} icon={FileText} accent="primary" />
      </div>

      {useApi && (
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div className="space-y-1 min-w-[220px]">
            <Label className="text-xs text-muted-foreground">Administración</Label>
            <SearchableSelect
              value={adminFilter}
              onValueChange={setAdminFilter}
              options={[
                { value: '__all__', label: 'Todas las administraciones' },
                ...administracionesCatalog.map((a) => ({ value: a.id, label: a.nombre })),
              ]}
              placeholder="Todas"
              searchPlaceholder="Buscar administración…"
              className="w-[min(100%,280px)]"
            />
          </div>
          <div className="space-y-1 min-w-[180px]">
            <Label className="text-xs text-muted-foreground">Medidor</Label>
            <Select
              value={medidorFilter}
              onValueChange={(v) => setMedidorFilter(v as 'all' | 'with' | 'without')}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="with">Con medidor</SelectItem>
                <SelectItem value="without">Sin medidor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {(useApi && (tipos.length !== tiposBase.length || medidorFilter !== 'all')) ||
      (!useApi && medidorFilter !== 'all') ? (
        <p className="text-xs text-muted-foreground mb-3">
          Mostrando {tipos.length} de {tiposBase.length} tipos en esta vista.
        </p>
      ) : null}

      <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
        {isLoading && <p className="p-6 text-sm text-muted-foreground text-center">Cargando tipos…</p>}
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40">
              {[
                'Código',
                'Administración',
                'Nombre',
                'Clase proceso',
                'Organismo aprobación',
                'Configuración',
                'Contratos',
                'Estado',
                '',
              ].map((h) => (
                <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tipos.map((t, i) => (
              <tr key={t.id} className={`${i > 0 ? 'border-t border-border/50' : ''} hover:bg-muted/20 transition-colors`}>
                <td className="px-4 py-3.5 font-mono text-xs text-[#007BFF] font-semibold">{t.codigo}</td>
                <td className="px-4 py-3.5 text-sm text-muted-foreground max-w-[220px]">
                  {t.administracionId
                    ? (adminNombreById.get(t.administracionId) ?? t.administracionId)
                    : '—'}
                </td>
                <td className="px-4 py-3.5">
                  <p className="font-medium leading-tight">{t.nombre}</p>
                  {t.descripcion && <p className="text-xs text-muted-foreground mt-0.5">{t.descripcion}</p>}
                </td>
                <td className="px-4 py-3.5">
                  {t.claseProceso
                    ? <Badge variant="secondary" className="text-xs">{t.claseProceso}</Badge>
                    : <span className="text-muted-foreground text-xs">—</span>}
                </td>
                <td className="px-4 py-3.5 text-sm text-muted-foreground">{t.organismoAprobacion ?? '—'}</td>
                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap gap-1">
                    {t.esIndividualizacion && <Badge className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700 border-violet-300">Individualización</Badge>}
                    {t.requiereSolicitudPrevia && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Solicitud previa</Badge>}
                    {t.esContratoFormal && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Formal</Badge>}
                    {t.requiereMedidor && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Medidor</Badge>}
                    {t.diasCaducidadSolicitud && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{t.diasCaducidadSolicitud}d caducidad</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3.5 tabular-nums text-muted-foreground">{t._count?.contratos ?? 0}</td>
                <td className="px-4 py-3.5"><StatusBadge status={t.activo ? 'Activo' : 'Inactivo'} /></td>
                <td className="px-4 py-3.5">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {tipos.length === 0 && !isLoading && (
              <tr>
                <td colSpan={9} className="text-center text-muted-foreground py-12">
                  Sin tipos de contratación en esta vista
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dialog crear / editar */}
      <Dialog open={!!dialog} onOpenChange={() => setDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'create' ? 'Nuevo tipo de contratación' : `Editar — ${dialog?.tipo?.codigo}`}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* Datos base */}
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Datos generales</p>
              <div className="grid grid-cols-2 gap-3">
                {dialog?.mode === 'create' && (
                  <div className="col-span-1 space-y-1">
                    <Label className="text-xs">Código *</Label>
                    <Input placeholder="DOM_HAB" value={form.codigo} onChange={e => set('codigo', e.target.value)} className="font-mono" />
                  </div>
                )}
                <div className={dialog?.mode === 'create' ? 'col-span-1 space-y-1' : 'col-span-2 space-y-1'}>
                  <Label className="text-xs">Nombre *</Label>
                  <Input placeholder="Doméstico Habitacional" value={form.nombre} onChange={e => set('nombre', e.target.value)} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Descripción</Label>
                  <Input placeholder="Descripción breve" value={form.descripcion} onChange={e => set('descripcion', e.target.value)} />
                </div>
              </div>
            </section>

            {/* Configuración del proceso P1/P6 */}
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Configuración del proceso (P1/P6)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Clase de proceso</Label>
                  <Input placeholder="residencial / comercial / industrial…" value={form.claseProceso} onChange={e => set('claseProceso', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Organismo de aprobación</Label>
                  <Input placeholder="Gerencia Técnica" value={form.organismoAprobacion} onChange={e => set('organismoAprobacion', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Días plazo aprobación</Label>
                  <Input type="number" min={1} placeholder="15" value={form.diasPlazoAprobacion} onChange={e => set('diasPlazoAprobacion', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Días caducidad solicitud</Label>
                  <Input type="number" min={1} placeholder="30" value={form.diasCaducidadSolicitud} onChange={e => set('diasCaducidadSolicitud', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Periodicidades permitidas</Label>
                  <Input placeholder="mensual,bimestral,trimestral" value={form.periodicidadesPermitidas} onChange={e => set('periodicidadesPermitidas', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipos de cliente permitidos</Label>
                  <Input placeholder="fisica,moral" value={form.tiposClientePermitidos} onChange={e => set('tiposClientePermitidos', e.target.value)} />
                </div>
              </div>

              {/* Switches */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                {([
                  { key: 'esIndividualizacion', label: 'Individualización' },
                  { key: 'esContratoFormal', label: 'Contrato formal' },
                  { key: 'requiereSolicitudPrevia', label: 'Solicitud previa' },
                  { key: 'requiereMedidor', label: 'Requiere medidor' },
                ] as { key: keyof FormState; label: string }[]).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                    <Label className="text-xs font-medium">{label}</Label>
                    <Switch
                      checked={form[key] as boolean}
                      onCheckedChange={v => set(key, v)}
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button
              className="bg-[#007BFF] hover:bg-blue-600 text-white"
              onClick={handleSave}
              disabled={!form.nombre || (dialog?.mode === 'create' && !form.codigo) || isSaving}
            >
              {isSaving ? 'Guardando…' : dialog?.mode === 'create' ? 'Crear tipo' : 'Guardar cambios'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TiposContratacion;
