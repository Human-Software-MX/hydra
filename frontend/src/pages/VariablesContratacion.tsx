import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react';
import { hasApi } from '@/api/client';
import {
  assignVariableTipoContratacion,
  createTipoVariable,
  fetchAdministraciones,
  fetchTiposVariable,
  fetchVariablesTipoContratacion,
  removeVariableTipoContratacion,
  updateTipoVariable,
  type TipoVariable,
  type UpdateTipoVariableDto,
  type VariableTipoContratacionAsignacion,
  type CreateTipoVariableDto,
} from '@/api/catalogos';
import { fetchTiposContratacion, type TipoContratacion } from '@/api/tipos-contratacion';

const TIPOS_DATO = ['TEXTO', 'NUMERO', 'FECHA', 'BOOLEANO', 'LISTA'] as const;

const emptyCreate: CreateTipoVariableDto = {
  codigo: '',
  nombre: '',
  tipoDato: 'TEXTO',
  unidad: '',
};

function valoresPosiblesToText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function parseValoresPosibles(text: string): unknown | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return JSON.parse(t);
}

const VariablesContratacion = () => {
  const useApi = hasApi();
  const queryClient = useQueryClient();

  const [catalogDialog, setCatalogDialog] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; row: TipoVariable }
    | null
  >(null);
  const [formCatalog, setFormCatalog] = useState<CreateTipoVariableDto>(emptyCreate);
  const [valoresJson, setValoresJson] = useState('');

  const [adminFilter, setAdminFilter] = useState<string>('__all__');
  const [tipoSeleccionado, setTipoSeleccionado] = useState<string>('');
  const [addVariableId, setAddVariableId] = useState<string>('');

  const { data: administraciones = [] } = useQuery({
    queryKey: ['catalogos-operativos', 'administraciones'],
    queryFn: fetchAdministraciones,
    enabled: useApi,
    staleTime: 60 * 60 * 1000,
  });

  const { data: tiposVariable = [], isLoading: loadingTiposVar } = useQuery({
    queryKey: ['catalogos-operativos', 'tipos-variable'],
    queryFn: () => fetchTiposVariable(),
    enabled: useApi,
  });

  const { data: tiposContratacionResp, isLoading: loadingTiposTc } = useQuery({
    queryKey: ['tipos-contratacion', 'list', adminFilter, 'variables-page'],
    queryFn: () =>
      fetchTiposContratacion({
        page: 1,
        limit: 500,
        administracionId: adminFilter === '__all__' ? undefined : adminFilter,
      }),
    enabled: useApi,
  });

  const tiposContratacion = useMemo(
    () => tiposContratacionResp?.data ?? [],
    [tiposContratacionResp?.data],
  );

  const { data: asignaciones = [], isLoading: loadingAsig } = useQuery({
    queryKey: ['variables-tipo-contratacion', tipoSeleccionado],
    queryFn: () => fetchVariablesTipoContratacion(tipoSeleccionado),
    enabled: useApi && !!tipoSeleccionado,
  });

  const invalidateConfiguracionTipos = () => {
    queryClient.invalidateQueries({ queryKey: ['tipo-contratacion-config'] });
  };

  const createCatalogMut = useMutation({
    mutationFn: createTipoVariable,
    onSuccess: () => {
      toast.success('Tipo de variable creado');
      queryClient.invalidateQueries({ queryKey: ['catalogos-operativos', 'tipos-variable'] });
      setCatalogDialog(null);
      setFormCatalog(emptyCreate);
      setValoresJson('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateCatalogMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateTipoVariableDto }) =>
      updateTipoVariable(id, dto),
    onSuccess: () => {
      toast.success('Tipo de variable actualizado');
      queryClient.invalidateQueries({ queryKey: ['catalogos-operativos', 'tipos-variable'] });
      queryClient.invalidateQueries({ queryKey: ['variables-tipo-contratacion'] });
      invalidateConfiguracionTipos();
      setCatalogDialog(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignMut = useMutation({
    mutationFn: assignVariableTipoContratacion,
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ['variables-tipo-contratacion', v.tipoContratacionId] });
      invalidateConfiguracionTipos();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: ({
      tipoContratacionId,
      tipoVariableId,
    }: {
      tipoContratacionId: string;
      tipoVariableId: string;
    }) => removeVariableTipoContratacion(tipoContratacionId, tipoVariableId),
    onSuccess: (_, v) => {
      toast.success('Variable desvinculada del tipo');
      queryClient.invalidateQueries({ queryKey: ['variables-tipo-contratacion', v.tipoContratacionId] });
      invalidateConfiguracionTipos();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreateCatalog = () => {
    setFormCatalog(emptyCreate);
    setValoresJson('');
    setCatalogDialog({ mode: 'create' });
  };

  const openEditCatalog = (row: TipoVariable) => {
    setFormCatalog({
      codigo: row.codigo,
      nombre: row.nombre,
      tipoDato: row.tipoDato,
      unidad: row.unidad ?? '',
    });
    setValoresJson(valoresPosiblesToText(row.valoresPosibles));
    setCatalogDialog({ mode: 'edit', row });
  };

  const saveCatalog = () => {
    let valoresParsed: unknown | undefined;
    try {
      valoresParsed = valoresJson.trim() ? parseValoresPosibles(valoresJson) : undefined;
    } catch {
      toast.error('JSON inválido en valores permitidos (lista)');
      return;
    }

    const nombre = formCatalog.nombre.trim();
    if (!nombre) {
      toast.error('El nombre es obligatorio');
      return;
    }

    const baseCommon = {
      nombre,
      tipoDato: formCatalog.tipoDato,
      unidad: formCatalog.unidad?.trim() || null,
      valoresPosibles:
        formCatalog.tipoDato === 'LISTA' ? valoresParsed ?? null : null,
    };

    if (catalogDialog?.mode === 'create') {
      if (!formCatalog.codigo.trim()) {
        toast.error('El código es obligatorio');
        return;
      }
      createCatalogMut.mutate({
        codigo: formCatalog.codigo.trim(),
        nombre: baseCommon.nombre,
        tipoDato: baseCommon.tipoDato,
        unidad: baseCommon.unidad,
        ...(formCatalog.tipoDato === 'LISTA' ? { valoresPosibles: valoresParsed } : {}),
      });
    } else if (catalogDialog?.mode === 'edit') {
      updateCatalogMut.mutate({
        id: catalogDialog.row.id,
        dto: {
          nombre: baseCommon.nombre,
          tipoDato: baseCommon.tipoDato,
          unidad: baseCommon.unidad,
          valoresPosibles: baseCommon.valoresPosibles,
        },
      });
    }
  };

  const tiposDisponiblesParaAgregar = useMemo(() => {
    const used = new Set(asignaciones.map((a) => a.tipoVariable.id));
    return tiposVariable.filter((t) => t.activo && !used.has(t.id));
  }, [asignaciones, tiposVariable]);

  const handleAddAsignacion = () => {
    if (!tipoSeleccionado || !addVariableId) return;
    const maxOrden = asignaciones.reduce((m, a) => Math.max(m, a.orden), -1);
    assignMut.mutate({
      tipoContratacionId: tipoSeleccionado,
      tipoVariableId: addVariableId,
      orden: maxOrden + 1,
      obligatorio: false,
    });
    setAddVariableId('');
    toast.success('Variable asignada al tipo');
  };

  const patchAsignacion = (
    row: VariableTipoContratacionAsignacion,
    patch: { obligatorio?: boolean; orden?: number; valorDefecto?: string | null },
  ) => {
    const orden = patch.orden ?? row.orden;
    const obligatorio = patch.obligatorio ?? row.obligatorio;
    let valorDefecto: string | undefined;
    if (patch.valorDefecto !== undefined) {
      valorDefecto = patch.valorDefecto === null || patch.valorDefecto === '' ? undefined : patch.valorDefecto;
    } else {
      valorDefecto = row.valorDefecto ?? undefined;
    }
    assignMut.mutate({
      tipoContratacionId: tipoSeleccionado,
      tipoVariableId: row.tipoVariable.id,
      obligatorio,
      orden,
      valorDefecto,
    });
  };

  const tipoSel: TipoContratacion | undefined = tiposContratacion.find((t) => t.id === tipoSeleccionado);

  const savingCatalog = createCatalogMut.isPending || updateCatalogMut.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Variables de contratación"
        subtitle="Catálogo maestro de tipos de variable y vínculo por tipo de contratación (paso Variables del registro de contrato)."
        breadcrumbs={[
          { label: 'Configuración', href: '/app/dashboard' },
          { label: 'Variables de contratación' },
        ]}
      />

      <Tabs defaultValue="catalogo" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-2">
          <TabsTrigger value="catalogo">Catálogo (tipos de variable)</TabsTrigger>
          <TabsTrigger value="asignacion">Por tipo de contratación</TabsTrigger>
        </TabsList>

        <TabsContent value="catalogo" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button type="button" onClick={openCreateCatalog} disabled={!useApi}>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo tipo de variable
            </Button>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo dato</TableHead>
                  <TableHead>Unidad</TableHead>
                  <TableHead>Activo</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingTiposVar ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Cargando…
                    </TableCell>
                  </TableRow>
                ) : tiposVariable.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Sin registros. Cree tipos de variable para poder asignarlos a cada tipo de contratación.
                    </TableCell>
                  </TableRow>
                ) : (
                  tiposVariable.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-sm">{row.codigo}</TableCell>
                      <TableCell>{row.nombre}</TableCell>
                      <TableCell>{row.tipoDato}</TableCell>
                      <TableCell>{row.unidad ?? '—'}</TableCell>
                      <TableCell>{row.activo ? 'Sí' : 'No'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => openEditCatalog(row)}>
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Editar</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="asignacion" className="mt-4 space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end">
            <div className="space-y-2 min-w-[220px]">
              <Label>Administración</Label>
              <SearchableSelect
                value={adminFilter}
                onValueChange={setAdminFilter}
                options={[
                  { value: '__all__', label: 'Todas las administraciones' },
                  ...administraciones.map((a) => ({ value: a.id, label: a.nombre })),
                ]}
                placeholder="Todas"
                searchPlaceholder="Buscar administración…"
              />
            </div>
            <div className="space-y-2 min-w-[280px] flex-1">
              <Label>Tipo de contratación</Label>
              <SearchableSelect
                value={tipoSeleccionado || '__none__'}
                onValueChange={(v) => setTipoSeleccionado(v === '__none__' ? '' : v)}
                options={[
                  { value: '__none__', label: '— Seleccione —' },
                  ...(loadingTiposTc
                    ? []
                    : tiposContratacion.map((t) => ({ value: t.id, label: `${t.codigo} — ${t.nombre}` }))),
                ]}
                placeholder="Seleccione un tipo"
                searchPlaceholder="Buscar tipo…"
              />
            </div>
          </div>

          {tipoSeleccionado && tipoSel && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Link2 className="h-4 w-4 shrink-0" />
              Las variables capturadas en el paso <strong>Variables</strong> del wizard provienen de esta
              configuración para <strong>{tipoSel.nombre}</strong>.
            </p>
          )}

          {tipoSeleccionado ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="space-y-2 flex-1 min-w-[240px]">
                  <Label>Añadir variable del catálogo</Label>
                  <SearchableSelect
                    value={addVariableId || '__pick__'}
                    onValueChange={(v) => setAddVariableId(v === '__pick__' ? '' : v)}
                    options={[
                      { value: '__pick__', label: '— Elegir —' },
                      ...tiposDisponiblesParaAgregar.map((t) => ({
                        value: t.id,
                        label: `${t.codigo} — ${t.nombre} (${t.tipoDato})`,
                      })),
                    ]}
                    placeholder="Elija una variable a vincular"
                    searchPlaceholder="Buscar variable…"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleAddAsignacion}
                  disabled={!addVariableId || assignMut.isPending}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Vincular
                </Button>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variable</TableHead>
                      <TableHead className="w-[90px]">Orden</TableHead>
                      <TableHead className="w-[120px]">Obligatorio</TableHead>
                      <TableHead>Valor por defecto</TableHead>
                      <TableHead className="w-[70px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingAsig ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground">
                          Cargando asignaciones…
                        </TableCell>
                      </TableRow>
                    ) : asignaciones.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground">
                          Este tipo no tiene variables adicionales. El paso Variables del contrato mostrará el mensaje
                          de “sin variables” hasta que vincule al menos una.
                        </TableCell>
                      </TableRow>
                    ) : (
                      asignaciones.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <div className="font-medium">{a.tipoVariable.nombre}</div>
                            <div className="text-xs text-muted-foreground font-mono">{a.tipoVariable.codigo}</div>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="h-8 w-16"
                              defaultValue={a.orden}
                              key={`${a.id}-orden-${a.orden}`}
                              onBlur={(e) => {
                                const n = parseInt(e.target.value, 10);
                                if (!Number.isFinite(n)) return;
                                if (n !== a.orden) patchAsignacion(a, { orden: n });
                              }}
                              aria-label={`Orden para ${a.tipoVariable.codigo}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={a.obligatorio}
                                id={`ob-${a.id}`}
                                onCheckedChange={(c) =>
                                  patchAsignacion(a, { obligatorio: c === true })
                                }
                              />
                              <Label htmlFor={`ob-${a.id}`} className="text-sm font-normal cursor-pointer">
                                Requerido
                              </Label>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              defaultValue={a.valorDefecto ?? ''}
                              key={`${a.id}-vd-${a.valorDefecto ?? ''}`}
                              placeholder="Opcional"
                              className="h-8 max-w-[220px]"
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                const next = v === '' ? null : v;
                                const prev = a.valorDefecto ?? null;
                                if (next !== prev) patchAsignacion(a, { valorDefecto: next });
                              }}
                              aria-label={`Valor por defecto ${a.tipoVariable.codigo}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              disabled={removeMut.isPending}
                              onClick={() =>
                                removeMut.mutate({
                                  tipoContratacionId: tipoSeleccionado,
                                  tipoVariableId: a.tipoVariable.id,
                                })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Seleccione un tipo de contratación para ver y editar las variables vinculadas.
            </p>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!catalogDialog} onOpenChange={(o) => !o && setCatalogDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {catalogDialog?.mode === 'create' ? 'Nuevo tipo de variable' : 'Editar tipo de variable'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="tv-codigo">Código</Label>
              <Input
                id="tv-codigo"
                value={formCatalog.codigo}
                onChange={(e) => setFormCatalog((f) => ({ ...f, codigo: e.target.value }))}
                disabled={catalogDialog?.mode === 'edit'}
                className="font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tv-nombre">Nombre</Label>
              <Input
                id="tv-nombre"
                value={formCatalog.nombre}
                onChange={(e) => setFormCatalog((f) => ({ ...f, nombre: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Tipo de dato</Label>
              <Select
                value={formCatalog.tipoDato}
                onValueChange={(v) => setFormCatalog((f) => ({ ...f, tipoDato: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_DATO.map((td) => (
                    <SelectItem key={td} value={td}>
                      {td}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tv-unidad">Unidad (opcional)</Label>
              <Input
                id="tv-unidad"
                value={formCatalog.unidad ?? ''}
                onChange={(e) => setFormCatalog((f) => ({ ...f, unidad: e.target.value }))}
              />
            </div>
            {formCatalog.tipoDato === 'LISTA' && (
              <div className="grid gap-2">
                <Label htmlFor="tv-valores-json">Valores permitidos (JSON, para LISTA)</Label>
                <textarea
                  id="tv-valores-json"
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                  value={valoresJson}
                  onChange={(e) => setValoresJson(e.target.value)}
                  placeholder='Ej. ["Opción A","Opción B"]'
                />
              </div>
            )}
            {catalogDialog?.mode === 'edit' ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="tv-activo"
                  checked={catalogDialog.row.activo}
                  onCheckedChange={(c) =>
                    updateCatalogMut.mutate({
                      id: catalogDialog.row.id,
                      dto: { activo: c },
                    })
                  }
                />
                <Label htmlFor="tv-activo">Activo</Label>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCatalogDialog(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={saveCatalog} disabled={savingCatalog}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VariablesContratacion;
