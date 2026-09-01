import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mapEstadoContratoToFlujoRegistro } from '@/lib/contrato-registro-estado';
import { useData } from '@/context/DataContext';
import {
  fetchContratos,
  updateContrato,
  fetchTextoContratoPreview,
  fetchContratoPdfHtml,
  crearFacturaContratacion,
  cancelarContrato,
  hasApi,
} from '@/api/contratos';
import { toast } from '@/components/ui/sonner';
import {
  fetchProcesos,
  crearProceso,
  avanzarEtapa,
  cancelarProceso,
  type ProcesoContratacion,
} from '@/api/procesos-contratacion';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Plus,
  Eye,
  ChevronRight,
  Hash,
  User,
  Droplets,
  FileText,
  SlidersHorizontal,
  Download,
  TrendingUp,
  GitBranch,
  ScrollText,
  Users,
  Search,
  ArrowDown,
  ArrowUp,
  Check,
  Pencil,
  PlayCircle,
  Trash2,
  LifeBuoy,
} from 'lucide-react';
import { fetchAdministraciones } from '@/api/catalogos';
import { fetchTiposContratacion, type TipoContratacion } from '@/api/tipos-contratacion';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useSearchParams } from 'react-router-dom';
import { WizardContratacion } from '@/components/contratacion/WizardContratacion';
import { ContratoEditDialog } from '@/components/contratos/ContratoEditDialog';
import { AgoraTicketsDialog } from '@/components/contratos/AgoraTicketsDialog';

/** Inline editable field for linking/updating the CEA contract number */
function CeaNumInput({ contratoId, initial, onSaved }: { contratoId: string; initial: string; onSaved: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateContrato(contratoId, { ceaNumContrato: value || null });
      onSaved(value);
      setEditing(false);
    } catch {
      // ignore — keep editing open
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="font-mono">{value || '—'}</span>
        <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground">
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ej. 523160"
        className="h-6 text-xs font-mono w-28 py-0 px-1.5"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
      />
      <button onClick={handleSave} disabled={saving} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
        <Check className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function ContratoTextoPreviewPanel({
  contratoId,
  enabled,
}: {
  contratoId: string;
  enabled: boolean;
}) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['contrato-texto-preview', contratoId],
    queryFn: () => fetchTextoContratoPreview(contratoId),
    enabled: enabled && !!contratoId,
  });

  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Activa la API (VITE_API_URL) para generar la vista previa desde la plantilla del proceso o las cláusulas del tipo de contratación.
      </p>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando vista previa…</p>;
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">No se pudo cargar la vista previa.</p>
        <Button size="sm" variant="outline" type="button" onClick={() => refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const fuenteLabels: Record<string, string> = {
    plantilla: 'Plantilla del proceso',
    clausulas: 'Cláusulas del tipo',
    'vacío': 'Sin contenido',
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{fuenteLabels[data!.fuente] ?? data!.fuente}</Badge>
        {isFetching ? <span className="text-xs text-muted-foreground">Actualizando…</span> : null}
        <Button size="sm" variant="ghost" className="h-7 text-xs" type="button" onClick={() => refetch()}>
          Actualizar
        </Button>
      </div>
      <div className="rounded-md border bg-muted/30 p-4 max-h-[min(480px,55vh)] overflow-y-auto">
        {data!.texto.trim() ? (
          <pre className="text-sm whitespace-pre-wrap font-sans text-foreground leading-relaxed">{data!.texto}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            No hay plantilla en el proceso reciente ni cláusulas asociadas al tipo de contratación. Configura el tipo o crea un proceso con plantilla.
          </p>
        )}
      </div>
    </div>
  );
}

const Contratos = () => {
  const useApi = hasApi();
  const queryClient = useQueryClient();
  const { contratos: contextContratos, allowedZonaIds, timbrados, recibos, preFacturas, pagos } = useData();

  const [showWizard, setShowWizard] = useState(false);
  const [confirmCloseWizard, setConfirmCloseWizard] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  /** Edición vía PATCH (distinto del modal de solo lectura / ficha). */
  const [editContratoId, setEditContratoId] = useState<string | null>(null);
  const [agoraContratoId, setAgoraContratoId] = useState<string | null>(null);
  const [resumingContratoId, setResumingContratoId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openingPdfId, setOpeningPdfId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const cancelarMutation = useMutation({
    mutationFn: (id: string) => cancelarContrato(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contratos'] });
      toast.success('Contrato cancelado');
      setDeletingId(null);
    },
    onError: () => {
      toast.error('No se pudo cancelar el contrato');
      setDeletingId(null);
    },
  });

  const { data: apiContratos = [], isLoading } = useQuery({
    queryKey: ['contratos'],
    queryFn: fetchContratos,
    enabled: useApi,
  });

  const snapshotTextoMut = useMutation({
    mutationFn: async (contratoId: string) => {
      const prev = await fetchTextoContratoPreview(contratoId);
      await updateContrato(contratoId, { textoContratoSnapshot: prev.texto });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['contratos'] });
      toast.success('Texto contractual guardado', {
        description: 'Se actualizó el HTML almacenado para impresión y consulta.',
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'No se pudo guardar el texto.';
      toast.error('Error al guardar', { description: message });
    },
  });

  const contratos = useApi
    ? (Array.isArray(apiContratos) ? apiContratos : [])
    : contextContratos;
  const contratosVisibles = useMemo(() => {
    if (!allowedZonaIds?.length) return contratos;
    return contratos.filter((c: { zonaId?: string | null; estado?: string }) => {
      const z = c.zonaId;
      if (z && allowedZonaIds.includes(z)) return true;
      // Altas recientes sin zona operativa aún deben verse en mesa (p. ej. antes de asignar ruta/zona).
      if (!z && c.estado === 'Pendiente de alta') return true;
      return false;
    });
  }, [contratos, allowedZonaIds]);

  const { data: administracionesCatalog = [] } = useQuery({
    queryKey: ['catalogos-operativos', 'administraciones'],
    queryFn: fetchAdministraciones,
    enabled: useApi,
    staleTime: 60 * 60 * 1000,
  });

  const { data: tiposContratacionCatalog = [] } = useQuery({
    queryKey: ['tipos-contratacion', 'catalog-lookup'],
    enabled: useApi,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const pageSize = 100;
      let page = 1;
      const acc: TipoContratacion[] = [];
      for (;;) {
        const { data, total } = await fetchTiposContratacion({ page, limit: pageSize });
        acc.push(...data);
        if (acc.length >= total || data.length === 0) break;
        page += 1;
      }
      return acc;
    },
  });

  const adminNombreById = useMemo(() => {
    const m = new Map<string, string>();
    administracionesCatalog.forEach((a) => m.set(a.id, a.nombre));
    return m;
  }, [administracionesCatalog]);

  const tipoById = useMemo(() => {
    const m = new Map<string, TipoContratacion>();
    tiposContratacionCatalog.forEach((t) => m.set(t.id, t));
    return m;
  }, [tiposContratacionCatalog]);

  const getTipoContratacionDesc = (id: string | null | undefined) => {
    if (!id) return '—';
    const t = tipoById.get(id);
    if (t) return (t.descripcion?.trim() || t.nombre) + (t.codigo ? ` (${t.codigo})` : '');
    return id;
  };

  const getAdminNombreForTipo = (tipoId: string | null | undefined) => {
    if (!tipoId) return '—';
    const t = tipoById.get(tipoId);
    const aid = t?.administracionId;
    if (!aid) return '—';
    return adminNombreById.get(aid) ?? aid;
  };

  const filteredContratos = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? contratosVisibles.filter(
          (c: { id: string; nombre: string }) =>
            c.id.toLowerCase().includes(q) || c.nombre.toLowerCase().includes(q),
        )
      : contratosVisibles;
    return [...base].sort((a: { createdAt?: string; fecha: string }, b: { createdAt?: string; fecha: string }) => {
      const ta = a.createdAt ?? a.fecha ?? '';
      const tb = b.createdAt ?? b.fecha ?? '';
      return sortOrder === 'desc' ? tb.localeCompare(ta) : ta.localeCompare(tb);
    });
  }, [contratosVisibles, search, sortOrder]);

  useEffect(() => {
    if (searchParams.get('new') === '1' || searchParams.get('procesoId')) setShowWizard(true);
    const detailId = searchParams.get('detail');
    if (detailId) {
      setDetail(detailId);
      const next = new URLSearchParams(searchParams);
      next.delete('detail');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams]);

  const resumeContratacionWizard = useCallback(
    async (contrato: { id: string; tipoContratacionId?: string | null }): Promise<boolean> => {
      if (!useApi) {
        toast.error('Sin conexión a API', {
          description: 'No se puede reanudar el registro sin servicios activos.',
        });
        return false;
      }
      setResumingContratoId(contrato.id);
      try {
        const list = await fetchProcesos({ contratoId: contrato.id, limit: 50 });
        let procesoId =
          list.find((p) => p.estado !== 'completado' && p.estado !== 'cancelado')?.id ?? null;
        if (!procesoId) {
          const nuevo = await crearProceso({
            contratoId: contrato.id,
            tipoContratacionId: contrato.tipoContratacionId ?? undefined,
          });
          procesoId = nuevo.id;
        }
        const next = new URLSearchParams(searchParams);
        const solicitudIdParam = searchParams.get('solicitudId');
        next.delete('iniciarAlta');
        next.delete('contratoId');
        if (solicitudIdParam) next.set('solicitudId', solicitudIdParam);
        next.set('new', '1');
        next.set('procesoId', procesoId);
        setSearchParams(next, { replace: true });
        setShowWizard(true);
        setDetail(null);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'No se pudo abrir el asistente.';
        toast.error('No se pudo reanudar el registro', { description: message });
        return false;
      } finally {
        setResumingContratoId(null);
      }
    },
    [useApi, searchParams, setSearchParams],
  );

  /** Tras aceptar cotización (Solicitudes) llegamos con ?iniciarAlta=1&contratoId= — abrir wizard cuando el contrato ya está en lista. */
  const wizardBootstrapLockRef = useRef<string | null>(null);
  useEffect(() => {
    if (!useApi) return;
    if (searchParams.get('iniciarAlta') !== '1') {
      wizardBootstrapLockRef.current = null;
      return;
    }
    const cid = searchParams.get('contratoId')?.trim() ?? '';
    if (!cid) {
      wizardBootstrapLockRef.current = null;
      return;
    }
    const c = contratosVisibles.find((x: { id: string }) => x.id === cid);
    if (!c) return;
    if (wizardBootstrapLockRef.current === cid) return;
    wizardBootstrapLockRef.current = cid;
    void (async () => {
      try {
        const ok = await resumeContratacionWizard(c);
        if (!ok) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete('iniciarAlta');
              next.delete('contratoId');
              return next;
            },
            { replace: true },
          );
        }
      } finally {
        wizardBootstrapLockRef.current = null;
      }
    })();
  }, [useApi, searchParams, contratosVisibles, resumeContratacionWizard, setSearchParams]);

  const selected = contratosVisibles.find(c => c.id === detail);

  const facturasDesglose = useMemo(() => {
    if (!selected) return { pagadas: [], porCobrar: [], vencidas: [] };
    const facturasContrato = timbrados
      .filter(t => t.contratoId === selected.id)
      .map(t => {
        const recibo = recibos.find(r => r.timbradoId === t.id);
        const pf = preFacturas.find(p => p.id === t.preFacturaId);
        const total = recibo ? recibo.saldoVigente + recibo.saldoVencido : (pf?.total ?? 0);
        const fechaVenc = recibo?.fechaVencimiento ?? '';
        return { timbrado: t, recibo, preFactura: pf, total, fechaVencimiento: fechaVenc };
      })
      .sort((a, b) => (a.preFactura?.periodo ?? '').localeCompare(b.preFactura?.periodo ?? ''));
    const totalPagos = pagos.filter(p => p.contratoId === selected.id).reduce((s, p) => s + p.monto, 0);
    let runningPagos = totalPagos;
    const hoy = new Date().toISOString().split('T')[0];
    const pagadas: typeof facturasContrato = [];
    const porCobrar: typeof facturasContrato = [];
    const vencidas: typeof facturasContrato = [];
    facturasContrato.forEach(f => {
      if (runningPagos >= f.total) {
        pagadas.push(f);
        runningPagos -= f.total;
      } else if (f.fechaVencimiento && f.fechaVencimiento < hoy) {
        vencidas.push(f);
      } else {
        porCobrar.push(f);
      }
    });
    return { pagadas, porCobrar, vencidas };
  }, [selected, timbrados, recibos, preFacturas, pagos]);

  const activos = contratosVisibles.filter((c: { estado: string }) => c.estado === 'Activo').length;
  const pendientesAlta = contratosVisibles.filter((c: { estado: string }) => c.estado === 'Pendiente de alta').length;
  const pendientesCampo = contratosVisibles.filter(
    (c: { estado: string }) => c.estado === 'Pendiente de toma' || c.estado === 'Pendiente de zona',
  ).length;
  const suspendidos = contratosVisibles.filter((c: { estado: string }) => c.estado === 'Suspendido').length;

  return (
    <div>
      <PageHeader
        title="Contratos"
        subtitle="Gestión centralizada de contratos de servicio hidráulico."
        breadcrumbs={[{ label: 'Servicios', href: '#' }, { label: 'Contratos' }]}
        actions={
          <Button
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('procesoId');
              next.set('new', '1');
              setSearchParams(next, { replace: true });
              setShowWizard(true);
            }}
            className="bg-[#007BFF] hover:bg-blue-600 text-white"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Nuevo registro de contrato
          </Button>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard
          label="Total contratos"
          value={contratosVisibles.length.toLocaleString()}
          sub={<span className="flex items-center gap-1 text-emerald-600"><TrendingUp className="w-3 h-3" /> En el sistema</span>}
        />
        <KpiCard label="Activos" value={activos} accent="success"
          footer={<div className="w-full h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, (activos / Math.max(contratosVisibles.length, 1)) * 100)}%` }} /></div>}
        />
        <KpiCard label="Pendientes de alta" value={pendientesAlta} accent={pendientesAlta > 0 ? 'warning' : 'default'} />
        <KpiCard label="Pendientes en campo" value={pendientesCampo} accent={pendientesCampo > 0 ? 'warning' : 'default'} />
        <KpiCard label="Suspendidos" value={suspendidos} accent={suspendidos > 0 ? 'danger' : 'default'} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Buscar por ID o titular…"
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
          title={sortOrder === 'desc' ? 'Mostrando más recientes primero' : 'Mostrando más antiguos primero'}
        >
          {sortOrder === 'desc'
            ? <><ArrowDown className="w-3.5 h-3.5 mr-1.5" /> Más recientes</>
            : <><ArrowUp className="w-3.5 h-3.5 mr-1.5" /> Más antiguos</>}
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground"><Download className="w-3.5 h-3.5 mr-1.5" /> Exportar CSV</Button>
        <span className="ml-auto text-xs text-muted-foreground font-medium uppercase tracking-wide">
          {filteredContratos.length} contratos
        </span>
      </div>

      <div className="bg-white rounded-xl border border-border/50 overflow-hidden shadow-sm">
        {isLoading && useApi && (
          <div className="p-6 text-center text-muted-foreground text-sm">Cargando contratos…</div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40">
              {['ID contrato', 'Creación / modificación', 'Cliente / titular', 'Estado (flujo)', ''].map((h) => (
                <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredContratos.map(
              (c: {
                id: string;
                numeroContrato?: number | null;
                nombre: string;
                estado: string;
                createdAt?: string;
                updatedAt?: string;
                fecha: string;
                tipoContratacionId?: string | null;
              }) => {
              const flujo = mapEstadoContratoToFlujoRegistro(c.estado);
              const fmtDateTime = (iso: string) =>
                new Date(iso).toLocaleString('es-MX', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit', hour12: true,
                });
              const creado = c.createdAt ? fmtDateTime(c.createdAt) : c.fecha;
              const modificado = c.updatedAt && c.updatedAt !== c.createdAt
                ? fmtDateTime(c.updatedAt)
                : null;
              return (
                <tr key={c.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3.5 font-medium text-[#007BFF]">
                    {c.numeroContrato ?? <span className="font-mono text-xs">{c.id.slice(0, 8)}…</span>}
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground tabular-nums">
                    <span className="block text-xs">{creado}</span>
                    {modificado && (
                      <span className="block text-[11px] text-muted-foreground/60 mt-0.5">
                        Mod. {modificado}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 font-medium">{c.nombre}</td>
                  <td className="px-4 py-3.5">
                    <span className="text-sm" title={c.estado}>
                      {flujo.label}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(c.id)} title="Ver ficha">
                        <Eye className="h-4 w-4" />
                      </Button>
                      {c.estado === 'Pendiente de alta' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={resumingContratoId === c.id || !useApi}
                          onClick={() => resumeContratacionWizard({ id: c.id, tipoContratacionId: c.tipoContratacionId })}
                          title="Continuar registro de contrato"
                        >
                          <PlayCircle className={`h-4 w-4 ${resumingContratoId === c.id ? 'opacity-50' : 'text-[#007BFF]'}`} />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!useApi || resumingContratoId === c.id}
                        onClick={() => {
                          if (c.estado === 'Pendiente de alta') {
                            void resumeContratacionWizard({ id: c.id, tipoContratacionId: c.tipoContratacionId });
                            return;
                          }
                          setEditContratoId(c.id);
                        }}
                        title={
                          !useApi
                            ? 'Requiere API (VITE_API_URL)'
                            : c.estado === 'Pendiente de alta'
                              ? 'Continuar registro (asistente)'
                              : 'Editar contrato'
                        }
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAgoraContratoId(c.id)}
                        title="Tickets Agora"
                      >
                        <LifeBuoy className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeletingId(c.id)} title="Cancelar contrato">
                        <Trash2 className="h-4 w-4 text-destructive/70 hover:text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            },
            )}
            {filteredContratos.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted-foreground py-12">
                  {search ? 'Sin resultados para esta búsqueda' : 'No hay contratos'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmación de cancelación de contrato */}
      <AlertDialog open={!!deletingId} onOpenChange={(o) => { if (!o) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              El contrato cambiará de estado a "Cancelado". Esta acción puede deshacerse editando el estado desde el detalle del contrato.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, conservar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingId && cancelarMutation.mutate(deletingId)}
            >
              Sí, cancelar contrato
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Wizard de contratación (7 pasos) */}
      <Dialog
        open={showWizard}
        onOpenChange={(v) => { if (!v) setConfirmCloseWizard(true); }}
      >
        <DialogContent
          className="max-w-3xl max-h-[90vh] overflow-y-auto"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Registro de contrato</DialogTitle>
          </DialogHeader>
          <WizardContratacion
            key={searchParams.get('procesoId') ?? 'nuevo'}
            procesoPrecargaId={searchParams.get('procesoId')}
            solicitudIdPrecarga={searchParams.get('solicitudId') ?? undefined}
            onComplete={() => {
              setShowWizard(false);
              const next = new URLSearchParams(searchParams);
              next.delete('new');
              next.delete('procesoId');
              setSearchParams(next, { replace: true });
            }}
            onCancel={() => setConfirmCloseWizard(true)}
          />
        </DialogContent>
      </Dialog>

      {/* Confirmación al cerrar el wizard */}
      <AlertDialog open={confirmCloseWizard} onOpenChange={setConfirmCloseWizard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar el alta de contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Se perderá todo el avance del formulario. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar capturando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmCloseWizard(false);
                setShowWizard(false);
                const next = new URLSearchParams(searchParams);
                next.delete('new');
                next.delete('procesoId');
                setSearchParams(next, { replace: true });
              }}
            >
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ContratoEditDialog
        open={!!editContratoId}
        contratoId={editContratoId}
        onOpenChange={(o) => {
          if (!o) setEditContratoId(null);
        }}
      />

      <AgoraTicketsDialog
        open={!!agoraContratoId}
        contratoId={agoraContratoId}
        onOpenChange={(o) => {
          if (!o) setAgoraContratoId(null);
        }}
      />

      {/* Detail (solo lectura + campos puntuales como CEA en línea) */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-6xl w-[95vw] h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>
              {selected ? `Contrato ${selected.numeroContrato ?? selected.id}` : 'Detalle de contrato'}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? 'Ficha del contrato con pestañas de información y procesos.'
                : 'No hay contrato seleccionado o no está disponible en la lista actual.'}
            </DialogDescription>
          </DialogHeader>
          {!selected && (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No se encontró el contrato en la lista visible. Cierra el panel e inténtalo de nuevo.
            </div>
          )}
          {selected && (() => {
            // Mock data para validación con cliente (campos aún no en BD)
            const mock = {
              tipoCliente: 'Particular',
              consumoPromedio: 8,
              email1: 'titular@ejemplo.com',
              email2: '',
              telFijo: '',
              movil: selected.contacto || '',
              jubilado: false,
              juridica: false,
              administracion: 'CEA Querétaro',
              envioFactura: 'Correo electrónico',
              observaciones: [
                { fecha: selected.fecha, observacion: 'Alta de contrato', usuario: 'SISTEMA' },
              ],
            };

            const todasFacturas = [
              ...facturasDesglose.vencidas,
              ...facturasDesglose.porCobrar,
              ...facturasDesglose.pagadas,
            ];
            const saldoTotal = todasFacturas.reduce((s, f) => {
              const esPagada = facturasDesglose.pagadas.includes(f);
              return s + (esPagada ? 0 : f.total);
            }, 0);

            const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
              <div className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-sm">
                <span className="text-muted-foreground shrink-0">{label}</span>
                <span className="font-medium text-right">{value}</span>
              </div>
            );

            return (
              <div className="flex h-full overflow-hidden">

                {/* ── Sidebar izquierdo ── */}
                <aside className="w-56 shrink-0 border-r flex flex-col overflow-y-auto bg-muted/10">

                  {/* Identidad */}
                  <div className="p-5 border-b space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xl font-bold tracking-tight leading-none">{selected.numeroContrato ?? selected.id.slice(0, 8)}</span>
                      <StatusBadge status={selected.estado} />
                    </div>
                    <p className="font-semibold text-sm leading-snug">{selected.nombre}</p>
                    {selected.rfc && (
                      <p className="text-xs text-muted-foreground font-mono">{selected.rfc}</p>
                    )}
                    {selected.contacto && (
                      <p className="text-xs text-muted-foreground">{selected.contacto}</p>
                    )}
                  </div>

                  {/* Clasificación y fechas */}
                  <div className="p-4 border-b space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-xs">{selected.tipoContrato}</Badge>
                      <Badge variant="secondary" className="text-xs">{selected.tipoServicio}</Badge>
                    </div>
                    <dl className="space-y-1.5 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Alta</dt>
                        <dd className="font-medium tabular-nums">{selected.fecha}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Zona</dt>
                        <dd className="font-medium">{selected.zonaId || '—'}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Toma</dt>
                        <dd className="font-mono font-medium">{selected.tomaId || '—'}</dd>
                      </div>
                    </dl>
                  </div>

                  {/* Estado de cuenta */}
                  <div className="p-4 space-y-1 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Estado de cuenta</p>
                    <dl className="space-y-2 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Total pendiente</dt>
                        <dd className={`font-medium tabular-nums ${saldoTotal > 0 ? 'text-red-400' : 'text-emerald-500'}`}>${saldoTotal.toFixed(2)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Vencidas</dt>
                        <dd className={`font-medium tabular-nums ${facturasDesglose.vencidas.length > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{facturasDesglose.vencidas.length}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Por cobrar</dt>
                        <dd className="font-medium tabular-nums text-amber-400">{facturasDesglose.porCobrar.length}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Pagadas</dt>
                        <dd className="font-medium tabular-nums text-emerald-500">{facturasDesglose.pagadas.length}</dd>
                      </div>
                    </dl>
                  </div>
                </aside>

                {/* ── Panel derecho con tabs ── */}
                <Tabs defaultValue="general" className="flex flex-col flex-1 min-w-0 overflow-hidden">

                  {/* Tab bar estilo underline */}
                  <div className="shrink-0 border-b px-4 pt-1">
                    <TabsList className="h-auto bg-transparent p-0 gap-0 border-0 flex">
                      {([
                        { value: 'general',     icon: Hash,        label: 'General' },
                        { value: 'titular',     icon: Users,       label: 'Personas' },
                        { value: 'servicio',    icon: Droplets,    label: 'Servicio' },
                        { value: 'texto-contrato', icon: ScrollText, label: 'Texto contrato' },
                        { value: 'facturacion', icon: FileText,    label: 'Facturación' },
                        { value: 'historico',   icon: ChevronRight,label: 'Histórico' },
                        { value: 'procesos',    icon: GitBranch,   label: 'Procesos' },
                      ] as const).map(({ value, icon: Icon, label }) => (
                        <TabsTrigger
                          key={value}
                          value={value}
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm gap-1.5 -mb-px font-normal data-[state=active]:font-medium"
                        >
                          <Icon className="h-3.5 w-3.5" />{label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </div>

                  {/* Contenido scrollable */}
                  <div className="flex-1 overflow-y-auto p-6">

                    {/* ── General ── */}
                    <TabsContent value="general" className="mt-0 space-y-5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h2 className="text-sm font-semibold">Información del contrato</h2>
                        <div className="flex items-center gap-2">
                          {selected.estado === 'Pendiente de alta' && (
                            <Button
                              size="sm"
                              className="gap-1.5 text-xs bg-[#007BFF] hover:bg-blue-600 text-white"
                              disabled={resumingContratoId === selected.id}
                              onClick={() =>
                                resumeContratacionWizard({
                                  id: selected.id,
                                  tipoContratacionId: selected.tipoContratacionId,
                                })
                              }
                            >
                              <PlayCircle className="h-3.5 w-3.5" />
                              Continuar contratación
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs"
                            disabled={resumingContratoId === selected.id || !useApi}
                            onClick={() => {
                              if (selected.estado === 'Pendiente de alta') {
                                void resumeContratacionWizard({
                                  id: selected.id,
                                  tipoContratacionId: selected.tipoContratacionId,
                                });
                                return;
                              }
                              setDetail(null);
                              setEditContratoId(selected.id);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" /> Editar
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-5">
                        <section className="space-y-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-0.5">Contrato</h3>
                          <div className="rounded-lg border divide-y">
                            <Row label="Estado" value={<StatusBadge status={selected.estado} />} />
                            <Row label="Fecha de alta" value={selected.fecha} />
                            <Row label="Tipo de contratación" value={getTipoContratacionDesc(selected.tipoContratacionId)} />
                            <Row label="Tipo de servicio" value={selected.tipoServicio || '—'} />
                            <Row label="Domiciliado" value={selected.domiciliado ? 'Sí' : 'No'} />
                            {selected.fechaReconexionPrevista && (
                              <Row label="Reconexión prevista" value={selected.fechaReconexionPrevista} />
                            )}
                            <Row
                              label="N° Contrato CEA"
                              value={
                                <CeaNumInput
                                  contratoId={selected.id}
                                  initial={selected.ceaNumContrato ?? ''}
                                  onSaved={(v) => { (selected as any).ceaNumContrato = v; }}
                                />
                              }
                            />
                          </div>
                        </section>
                        <section className="space-y-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-0.5">Configuración</h3>
                          <div className="rounded-lg border divide-y">
                            {selected.direccion && (
                              <div className="px-4 py-3 bg-blue-50/50 dark:bg-blue-950/20">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Dirección del predio</p>
                                <p className="text-sm font-medium">{selected.direccion}</p>
                              </div>
                            )}
                            <Row label="Administración" value={getAdminNombreForTipo(selected.tipoContratacionId)} />
                            <Row label="Zona" value={selected.zonaId || '—'} />
                            <Row label="Punto de servicio" value={<span className="font-mono text-xs">{selected.puntoServicioId || '—'}</span>} />
                            <Row label="Ruta" value={selected.rutaId || '—'} />
                            <Row label="Toma" value={<span className="font-mono text-xs">{selected.tomaId || '—'}</span>} />
                            <Row label="Medidor" value={<span className="font-mono text-xs">{selected.medidorId || '—'}</span>} />
                          </div>
                        </section>
                      </div>
                    </TabsContent>

                    {/* ── Personas ── */}
                    <TabsContent value="titular" className="mt-0 space-y-5">
                      {/* Titular / Propietario */}
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-0.5">Titular / Propietario</h3>
                        <div className="grid grid-cols-2 gap-5">
                          <div className="rounded-lg border divide-y">
                            <Row label="Nombre completo" value={selected.nombre || '—'} />
                            <Row label="RFC" value={<span className="font-mono">{selected.rfc || '—'}</span>} />
                            <Row label="Tipo de persona" value={mock.juridica ? 'Moral' : 'Física'} />
                            <Row label="Razón social" value={selected.razonSocial || '—'} />
                            <Row label="Régimen fiscal" value={selected.regimenFiscal || '—'} />
                          </div>
                          <div className="rounded-lg border divide-y">
                            <Row label="Teléfono" value={mock.movil || '—'} />
                            <Row label="Correo electrónico" value={mock.email1 || '—'} />
                            <Row label="Dirección" value={selected.direccion || '—'} />
                          </div>
                        </div>
                      </div>
                      {/* Persona Fiscal */}
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-0.5">Persona Fiscal</h3>
                        <div className="grid grid-cols-2 gap-5">
                          <div className="rounded-lg border divide-y">
                            <Row label="Nombre / Razón social" value={selected.razonSocial || selected.nombre || '—'} />
                            <Row label="RFC" value={<span className="font-mono">{selected.rfc || '—'}</span>} />
                            <Row label="Régimen fiscal" value={selected.regimenFiscal || '—'} />
                          </div>
                          <div className="rounded-lg border divide-y">
                            <Row label="Correo electrónico" value={mock.email1 || '—'} />
                            <Row label="Uso CFDI" value="—" />
                          </div>
                        </div>
                      </div>
                      {/* Contacto */}
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-0.5">Contacto</h3>
                        <div className="rounded-lg border divide-y max-w-sm">
                          <Row label="Nombre" value={mock.movil ? '—' : '—'} />
                          <Row label="Teléfono" value={mock.movil || '—'} />
                          <Row label="Correo" value={mock.email2 || '—'} />
                        </div>
                      </div>
                    </TabsContent>

                    {/* ── Servicio ── */}
                    <TabsContent value="servicio" className="mt-0 space-y-5">
                      <div className="grid grid-cols-2 gap-5">
                        <section className="space-y-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-0.5">Punto de servicio</h3>
                          <div className="rounded-lg border divide-y">
                            <Row label="Toma" value={<span className="font-mono">{selected.tomaId || '—'}</span>} />
                            <Row
                              label="Punto de servicio (id)"
                              value={<span className="font-mono text-xs">{selected.puntoServicioId || '—'}</span>}
                            />
                            <Row
                              label="Tipo contratación (id)"
                              value={<span className="font-mono text-xs">{selected.tipoContratacionId || '—'}</span>}
                            />
                            <Row label="Dirección" value={selected.direccion || '—'} />
                            <Row label="Zona" value={selected.zonaId || '—'} />
                            <Row label="Ruta" value={selected.rutaId || 'Sin asignar'} />
                          </div>
                        </section>
                        <section className="space-y-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-0.5">Medidor</h3>
                          <div className="rounded-lg border divide-y">
                            <Row label="ID Medidor" value={<span className="font-mono">{selected.medidorId || 'Sin asignar'}</span>} />
                            <Row label="Serie" value="—" />
                            <Row label="Estado" value="—" />
                            <Row label="Lectura inicial" value="—" />
                          </div>
                        </section>
                      </div>
                    </TabsContent>

                    {/* ── Vista previa texto contractual ── */}
                    <TabsContent value="texto-contrato" className="mt-0 space-y-3">
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Vista previa (plantilla o cláusulas)
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!useApi || snapshotTextoMut.isPending}
                              onClick={() => snapshotTextoMut.mutate(selected.id)}
                            >
                              {snapshotTextoMut.isPending ? 'Guardando…' : 'Generar y guardar en contrato'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={openingPdfId === selected.id}
                              onClick={async () => {
                                setOpeningPdfId(selected.id);
                                try {
                                  const html = await fetchContratoPdfHtml(selected.id);
                                  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                                  const blobUrl = URL.createObjectURL(blob);
                                  const w = window.open(blobUrl, '_blank');
                                  if (!w) {
                                    toast.error('Permite ventanas emergentes para imprimir o guardar PDF.');
                                  }
                                  setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
                                } catch (err: unknown) {
                                  toast.error(
                                    err instanceof Error ? err.message : 'No se pudo abrir la vista de impresión.',
                                  );
                                } finally {
                                  setOpeningPdfId(null);
                                }
                              }}
                            >
                              <Download className="h-3.5 w-3.5 mr-1" />{' '}
                              {openingPdfId === selected.id ? 'Abriendo…' : 'Imprimir / PDF'}
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          Texto generado con variables del contrato (nombre, RFC, dirección, etc.). No sustituye al PDF firmado.
                        </p>
                        <ContratoTextoPreviewPanel contratoId={selected.id} enabled={useApi} />
                      </div>
                    </TabsContent>

                    {/* ── Facturación ── */}
                    <TabsContent value="facturacion" className="mt-0">
                      {import.meta.env.VITE_FEATURE_FACTURACION_CONTRATACION === 'true' && (
                        <div className="flex justify-end mb-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              try {
                                const res = await crearFacturaContratacion(selected.id);
                                toast.success(`Factura de contratación generada: $${res.total.toFixed(2)}`);
                                queryClient.invalidateQueries({ queryKey: ['contratos'] });
                              } catch (err: any) {
                                toast.error(err?.message ?? 'Error al generar factura de contratación');
                              }
                            }}
                          >
                            <FileText className="h-3.5 w-3.5 mr-1" /> Facturar contratación
                          </Button>
                        </div>
                      )}
                      {todasFacturas.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-12">Sin facturas para este contrato.</p>
                      ) : (
                        <div className="table-container">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-muted/50 border-b">
                                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Periodo</th>
                                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Periodicidad</th>
                                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">F. Factura</th>
                                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Estado</th>
                                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Importe</th>
                                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Recargo</th>
                                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Motivo</th>
                                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Nº Factura</th>
                              </tr>
                            </thead>
                            <tbody>
                              {todasFacturas.map(f => {
                                const esPagada = facturasDesglose.pagadas.includes(f);
                                const esVencida = facturasDesglose.vencidas.includes(f);
                                const estadoLabel = esPagada ? 'COBRADA' : esVencida ? 'VENCIDA' : 'PENDIENTE';
                                const impagada = !esPagada && esVencida;
                                return (
                                  <tr key={f.timbrado.id} className="border-t hover:bg-muted/30 transition-colors">
                                    <td className="px-3 py-2 font-medium">{f.preFactura?.periodo ?? '—'}</td>
                                    <td className="px-3 py-2 text-muted-foreground">MENSUAL</td>
                                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                                      {f.timbrado.fecha ?? f.fechaVencimiento ?? '—'}
                                    </td>
                                    <td className="px-3 py-2 font-medium">
                                      <span className={impagada ? 'text-red-400/90 dark:text-red-400/80' : 'text-muted-foreground'}>
                                        {estadoLabel}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums font-medium">${f.total.toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">$0.00</td>
                                    <td className="px-3 py-2 text-muted-foreground">Periódica</td>
                                    <td className="px-3 py-2 font-mono text-muted-foreground">{f.timbrado.uuid || f.timbrado.id}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </TabsContent>

                    {/* ── Histórico ── */}
                    <TabsContent value="historico" className="mt-0">
                      <table className="w-full text-sm border rounded-lg overflow-hidden">
                        <thead>
                          <tr className="bg-muted/50 text-left text-xs">
                            <th className="px-4 py-3 font-medium text-muted-foreground">Fecha</th>
                            <th className="px-4 py-3 font-medium text-muted-foreground">Observación</th>
                            <th className="px-4 py-3 font-medium text-muted-foreground">Usuario</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mock.observaciones.map((o, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-4 py-3 tabular-nums whitespace-nowrap text-muted-foreground">{o.fecha}</td>
                              <td className="px-4 py-3">{o.observacion}</td>
                              <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{o.usuario}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TabsContent>

                    {/* ── Procesos de contratación ── */}
                    <TabsContent value="procesos" className="mt-0">
                      <ProcesosTab contratoId={selected.id} useApi={useApi} />
                    </TabsContent>

                  </div>
                </Tabs>

              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ── ProcesosTab ─────────────────────────────────────────────────────────────

/** Etapas visibles en el flujo simplificado (solicitud y factibilidad se omiten) */
const ETAPAS = [
  'contrato',
  'instalacion_toma',
  'instalacion_medidor',
  'alta',
];

/** Map etapas previas al índice 0 para que el stepper las trate como paso anterior al Contrato */
function resolveEtapaIdx(etapaActual: string): number {
  if (etapaActual === 'solicitud' || etapaActual === 'factibilidad') return -1;
  return ETAPAS.indexOf(etapaActual);
}

function etapaLabel(e: string) {
  const labels: Record<string, string> = {
    contrato: 'Contrato',
    instalacion_toma: 'Instalación\ntoma',
    instalacion_medidor: 'Instalación\nmedidor',
    alta: 'Alta',
  };
  return labels[e] ?? e;
}

function ProcesosTab({ contratoId, useApi }: { contratoId: string; useApi: boolean }) {
  const queryClient = useQueryClient();
  const [cancelMotivo, setCancelMotivo] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);

  const { data: procesos = [], isLoading, isError, error } = useQuery({
    queryKey: ['procesos', contratoId],
    queryFn: () => fetchProcesos({ contratoId }),
    enabled: useApi,
    retry: 1,
  });

  const crearMut = useMutation({
    mutationFn: () => crearProceso({ contratoId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['procesos', contratoId] }),
  });

  const avanzarMut = useMutation({
    mutationFn: (id: string) => avanzarEtapa(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['procesos', contratoId] }),
  });

  const cancelarMut = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => cancelarProceso(id, motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procesos', contratoId] });
      setCancelId(null);
      setCancelMotivo('');
    },
  });

  const MOCK_PROCESO: ProcesoContratacion = {
    id: 'proc-mock-1',
    contratoId,
    tipoContratacionId: null,
    etapaActual: 'contrato',
    estado: 'en_curso',
    creadoPor: 'SISTEMA',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    historial: [
      { id: 'h1', procesoId: 'proc-mock-1', etapa: 'contrato', estado: 'en_curso', nota: 'Contrato generado', fechaInicio: new Date().toISOString(), fechaFin: null },
    ],
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground text-center py-8">Cargando procesos…</p>;
  }

  if (isError) {
    return (
      <div className="text-center py-14 space-y-2">
        <p className="text-sm font-medium text-destructive">Error al cargar procesos</p>
        <p className="text-xs text-muted-foreground">{(error as Error)?.message ?? 'Error desconocido'}</p>
      </div>
    );
  }

  const displayProcesos = procesos.length > 0 ? procesos : [MOCK_PROCESO];

  return (
    <div className="space-y-5">

      {displayProcesos.map((proceso) => {
        const etapaIdx = resolveEtapaIdx(proceso.etapaActual);
        const historialVisible = (proceso.historial ?? []).filter((h) => ETAPAS.includes(h.etapa));
        const isCancelado = proceso.estado === 'cancelado';
        const isCompletado = proceso.estado === 'completado';

        return (
          <div key={proceso.id} className="rounded-xl border border-border/50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-muted/20 border-b">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{proceso.id.slice(0, 8)}…</span>
                <StatusBadge status={
                  isCancelado ? 'Cancelado' :
                  isCompletado ? 'Activo' :
                  'Pendiente de alta'
                } />
              </div>
              <div className="flex items-center gap-2">
                {!isCancelado && !isCompletado && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => avanzarMut.mutate(proceso.id)}
                      disabled={avanzarMut.isPending || etapaIdx >= ETAPAS.length - 1}
                    >
                      Avanzar etapa
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setCancelId(proceso.id)}
                    >
                      Cancelar
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Stepper */}
            <div className="px-5 py-4">
              <div className="flex items-center gap-0">
                {ETAPAS.map((etapa, i) => {
                  const done = i < etapaIdx;
                  const active = i === etapaIdx && !isCancelado;
                  return (
                    <React.Fragment key={etapa}>
                      <div className="flex flex-col items-center gap-1 min-w-0">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                          isCancelado && i <= etapaIdx ? 'border-red-300 bg-red-50 text-red-400' :
                          done ? 'border-emerald-500 bg-emerald-500 text-white' :
                          active ? 'border-[#007BFF] bg-[#007BFF] text-white' :
                          'border-border bg-muted text-muted-foreground'
                        }`}>
                          {done ? '✓' : i + 1}
                        </div>
                        <span className={`text-[10px] text-center leading-tight max-w-[60px] ${active ? 'font-semibold text-[#007BFF]' : done ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                          {etapaLabel(etapa)}
                        </span>
                      </div>
                      {i < ETAPAS.length - 1 && (
                        <div className={`flex-1 h-0.5 mx-1 mb-4 rounded-full ${done ? 'bg-emerald-400' : 'bg-border'}`} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Historial */}
            {historialVisible.length > 0 && (
              <div className="border-t px-5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Historial de etapas</p>
                <div className="space-y-1.5">
                  {historialVisible.map((h) => (
                    <div key={h.id} className="flex items-start gap-2.5 text-xs">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${h.estado === 'completada' ? 'bg-emerald-500' : h.estado === 'en_curso' ? 'bg-blue-500' : 'bg-muted-foreground'}`} />
                      <div className="flex-1">
                        <span className="font-medium">{etapaLabel(h.etapa)}</span>
                        {h.nota && <span className="text-muted-foreground ml-1.5">— {h.nota}</span>}
                      </div>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {new Date(h.fechaInicio).toLocaleDateString('es-MX')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Cancel dialog */}
      {cancelId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200/70 shadow-lg shadow-slate-900/10 p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold">Cancelar proceso</h3>
            <Input
              placeholder="Motivo de cancelación"
              value={cancelMotivo}
              onChange={(e) => setCancelMotivo(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setCancelId(null); setCancelMotivo(''); }}>Cancelar</Button>
              <Button
                variant="destructive"
                disabled={!cancelMotivo.trim() || cancelarMut.isPending}
                onClick={() => cancelarMut.mutate({ id: cancelId, motivo: cancelMotivo })}
              >
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Contratos;
