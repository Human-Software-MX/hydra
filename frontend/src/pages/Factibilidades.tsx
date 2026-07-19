import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, TrendingUp, AlertTriangle, MoreVertical } from 'lucide-react';
import { fetchProcesos, avanzarEtapa, type ProcesoContratacion } from '@/api/procesos-contratacion';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Maps backend etapa → factibilidad display status
const ETAPA_TO_ESTADO: Record<string, string> = {
  solicitud: 'Pre-factibilidad',
  factibilidad: 'En comité',
  contrato: 'Aprobada',
  instalacion_toma: 'Aprobada',
  instalacion_medidor: 'Aprobada',
  alta: 'Aprobada',
  cancelado: 'Rechazada',
};

function etapaToEstado(p: ProcesoContratacion): string {
  if (p.estado === 'cancelado') return 'Rechazada';
  return ETAPA_TO_ESTADO[p.etapaActual] ?? p.etapaActual;
}

// Only show procesos that are relevant to factibilidad flow (not yet past contrato stage or cancelled)
function isRelevante(p: ProcesoContratacion): boolean {
  return ['solicitud', 'factibilidad', 'contrato', 'cancelado'].includes(
    p.estado === 'cancelado' ? 'cancelado' : p.etapaActual,
  );
}

function AvatarInitials({ name }: { name: string }) {
  const parts = name.trim().split(' ');
  const initials = parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const colors = [
    'bg-violet-500', 'bg-blue-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-indigo-500',
  ];
  const idx = name.charCodeAt(0) % colors.length;
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-bold shrink-0 ${colors[idx]}`}>
      {initials}
    </span>
  );
}

const Factibilidades = () => {
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState<string | null>(null);

  const { data: procesos = [], isLoading, isError } = useQuery({
    queryKey: ['procesos-factibilidades'],
    queryFn: () => fetchProcesos({ limit: 200 }),
  });

  const avanzarMut = useMutation({
    mutationFn: (id: string) => avanzarEtapa(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procesos-factibilidades'] });
      setDetail(null);
    },
  });

  const relevantes = procesos.filter(isRelevante);

  const total = relevantes.length;
  const enRevision = relevantes.filter((p) => p.etapaActual === 'factibilidad').length;
  const aprobadas = relevantes.filter((p) =>
    ['contrato', 'instalacion_toma', 'instalacion_medidor', 'alta'].includes(p.etapaActual) && p.estado !== 'cancelado'
  ).length;
  const urgentes = relevantes.filter((p) => p.etapaActual === 'solicitud' && p.estado !== 'cancelado').length;
  const pctEfectividad = total > 0 ? Math.round((aprobadas / total) * 100) : 0;

  const selected = procesos.find((p) => p.id === detail);
  const selectedEstado = selected ? etapaToEstado(selected) : '';

  return (
    <div>
      <PageHeader
        title="Factibilidades"
        subtitle="Gestión y seguimiento de solicitudes de infraestructura hidráulica."
        breadcrumbs={[{ label: 'Infraestructura', href: '#' }, { label: 'Factibilidades' }]}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total solicitudes"
          value={total.toLocaleString()}
          sub={
            <span className="flex items-center gap-1 text-emerald-600">
              <TrendingUp className="w-3 h-3" /> Procesos activos
            </span>
          }
        />
        <KpiCard
          label="En revisión"
          value={enRevision}
          footer={
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-[#007BFF] rounded-full"
                style={{ width: `${Math.min(100, (enRevision / Math.max(total, 1)) * 100 * 3)}%` }}
              />
            </div>
          }
        />
        <KpiCard
          label="Aprobadas"
          value={aprobadas.toLocaleString()}
          sub={
            <span className="flex items-center gap-1 text-emerald-600">
              ✓ {pctEfectividad}% de efectividad
            </span>
          }
        />
        <KpiCard
          label="Pre-factibilidad"
          value={urgentes}
          accent={urgentes > 0 ? 'danger' : 'default'}
          sub={
            urgentes > 0 ? (
              <span className="flex items-center gap-1 text-red-600">
                <AlertTriangle className="w-3 h-3" /> Pendientes de enviar
              </span>
            ) : (
              'Sin pendientes'
            )
          }
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border/50 overflow-hidden shadow-sm">
        {isLoading && (
          <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Cargando procesos…</p>
          </div>
        )}
        {isError && (
          <div className="text-center text-sm text-destructive py-12">
            Error al cargar los procesos de contratación.
          </div>
        )}
        {!isLoading && !isError && (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40">
                {['Expediente', 'Contrato / Solicitante', 'Dirección', 'Estado', 'Fecha', 'Acciones'].map((h) => (
                  <th
                    key={h}
                    className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {relevantes.map((p) => {
                const estadoDisplay = etapaToEstado(p);
                const nombre = p.contrato?.nombre ?? p.contratoId ?? p.id;
                const rfc = p.contrato?.rfc ?? '';
                const direccion = p.contrato?.direccion ?? '—';
                const fecha = p.contrato?.fecha
                  ? new Date(p.contrato.fecha).toLocaleDateString('es-MX')
                  : new Date(p.createdAt).toLocaleDateString('es-MX');

                return (
                  <tr key={p.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => setDetail(p.id)}
                        className="font-mono text-xs font-medium text-[#007BFF] hover:underline"
                      >
                        {p.id.slice(0, 8).toUpperCase()}
                      </button>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <AvatarInitials name={nombre} />
                        <div>
                          <p className="font-medium text-foreground">{nombre}</p>
                          {rfc && <p className="text-xs text-muted-foreground">{rfc}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground text-xs">{direccion}</td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={estadoDisplay} />
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">{fecha}</td>
                    <td className="px-4 py-3.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetail(p.id)}>
                            Ver detalle
                          </DropdownMenuItem>
                          {p.etapaActual === 'solicitud' && p.estado !== 'cancelado' && (
                            <DropdownMenuItem onClick={() => avanzarMut.mutate(p.id)}>
                              Enviar a comité
                            </DropdownMenuItem>
                          )}
                          {p.etapaActual === 'factibilidad' && p.estado !== 'cancelado' && (
                            <DropdownMenuItem onClick={() => avanzarMut.mutate(p.id)}>
                              Aprobar → Contrato
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {relevantes.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted-foreground py-12">
                    No hay solicitudes de factibilidad registradas
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proceso {selected?.id.slice(0, 8).toUpperCase()}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Contrato</p>
                  <p className="font-medium">{selected.contrato?.nombre ?? selected.contratoId}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">RFC</p>
                  <p className="font-medium">{selected.contrato?.rfc ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Dirección</p>
                  <p>{selected.contrato?.direccion ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Etapa actual</p>
                  <p className="font-mono text-xs">{selected.etapaActual}</p>
                </div>
              </div>
              <StatusBadge status={selectedEstado} />
              {avanzarMut.isError && (
                <p className="text-sm text-destructive">
                  {(avanzarMut.error as Error)?.message ?? 'Error al avanzar etapa'}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                {selected.etapaActual === 'solicitud' && selected.estado !== 'cancelado' && (
                  <Button
                    size="sm"
                    className="bg-[#007BFF] hover:bg-blue-600 text-white"
                    disabled={avanzarMut.isPending}
                    onClick={() => avanzarMut.mutate(selected.id)}
                  >
                    {avanzarMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                    Enviar a comité
                  </Button>
                )}
                {selected.etapaActual === 'factibilidad' && selected.estado !== 'cancelado' && (
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={avanzarMut.isPending}
                    onClick={() => avanzarMut.mutate(selected.id)}
                  >
                    {avanzarMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                    Aprobar → Contrato
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Factibilidades;
