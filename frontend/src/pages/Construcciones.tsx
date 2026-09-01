import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wrench, CheckCircle2 } from 'lucide-react';
import { fetchOrdenes, updateOrdenEstado, type OrdenDto } from '@/api/ordenes';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/KpiCard';

const TIPO_LABEL: Record<string, string> = {
  InstalacionToma: 'Instalación de Toma',
  InstalacionMedidor: 'Instalación de Medidor',
};

const ESTADO_SIGUIENTE: Record<string, string> = {
  Pendiente: 'En proceso',
  'En proceso': 'Completado',
};

const BTN_LABEL: Record<string, string> = {
  Pendiente: 'Iniciar',
  'En proceso': 'Completar',
};

function OrdenesTable({
  ordenes,
  isLoading,
  onActualizar,
  actualizandoId,
}: {
  ordenes: OrdenDto[];
  isLoading: boolean;
  onActualizar: (id: string, estado: string) => void;
  actualizandoId: string | null;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-sm">Cargando órdenes…</p>
      </div>
    );
  }
  if (ordenes.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        No hay órdenes de instalación activas.
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-muted/40">
          {['Tipo', 'Contrato', 'Prioridad', 'Estado', 'Fecha', 'Acciones'].map((h) => (
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
        {ordenes.map((o) => {
          const nextEstado = ESTADO_SIGUIENTE[o.estado];
          const btnLabel = BTN_LABEL[o.estado];
          return (
            <tr key={o.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3.5">
                <span className="font-medium">{TIPO_LABEL[o.tipo] ?? o.tipo}</span>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">{o.id.slice(0, 8).toUpperCase()}</p>
              </td>
              <td className="px-4 py-3.5">
                <p className="font-medium">{o.contrato?.nombre ?? o.contratoId}</p>
                {o.contrato?.direccion && (
                  <p className="text-xs text-muted-foreground">{o.contrato.direccion}</p>
                )}
              </td>
              <td className="px-4 py-3.5 text-muted-foreground">{o.prioridad}</td>
              <td className="px-4 py-3.5">
                <StatusBadge status={o.estado} />
              </td>
              <td className="px-4 py-3.5 text-muted-foreground">
                {new Date(o.createdAt).toLocaleDateString('es-MX')}
              </td>
              <td className="px-4 py-3.5">
                {nextEstado && btnLabel && (
                  <Button
                    size="sm"
                    variant={nextEstado === 'Completado' ? 'default' : 'outline'}
                    className={nextEstado === 'Completado' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
                    disabled={actualizandoId === o.id}
                    onClick={() => onActualizar(o.id, nextEstado)}
                  >
                    {actualizandoId === o.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : nextEstado === 'Completado' ? (
                      <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />{btnLabel}</>
                    ) : (
                      <><Wrench className="h-3.5 w-3.5 mr-1.5" />{btnLabel}</>
                    )}
                  </Button>
                )}
                {o.estado === 'Completado' && (
                  <span className="text-xs text-emerald-600 font-medium">Completado</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const Construcciones = () => {
  const queryClient = useQueryClient();

  const { data: tomasRes, isLoading: loadingTomas } = useQuery({
    queryKey: ['ordenes', 'InstalacionToma'],
    queryFn: () => fetchOrdenes({ tipo: 'InstalacionToma', limit: 100 }),
  });

  const { data: medidoresRes, isLoading: loadingMedidores } = useQuery({
    queryKey: ['ordenes', 'InstalacionMedidor'],
    queryFn: () => fetchOrdenes({ tipo: 'InstalacionMedidor', limit: 100 }),
  });

  const actualizarMut = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: string }) =>
      updateOrdenEstado(id, estado),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ordenes'] });
    },
  });

  const tomas: OrdenDto[] = tomasRes?.data ?? [];
  const medidores: OrdenDto[] = medidoresRes?.data ?? [];
  const todasOrdenes = [...tomas, ...medidores];

  const pendientes = todasOrdenes.filter((o) => o.estado === 'Pendiente').length;
  const enProceso = todasOrdenes.filter((o) => o.estado === 'En proceso').length;
  const completadas = todasOrdenes.filter((o) => o.estado === 'Completado').length;

  const actualizandoId = actualizarMut.isPending
    ? (actualizarMut.variables as { id: string }).id
    : null;

  const handleActualizar = (id: string, estado: string) => {
    actualizarMut.mutate({ id, estado });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="page-title">Construcción</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Órdenes de instalación de toma y medidor generadas automáticamente.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total órdenes" value={todasOrdenes.length} />
        <KpiCard
          label="Pendientes"
          value={pendientes}
          accent={pendientes > 0 ? 'warning' : 'default'}
        />
        <KpiCard label="En proceso" value={enProceso} />
        <KpiCard
          label="Completados"
          value={completadas}
          sub={
            todasOrdenes.length > 0 ? (
              <span className="text-emerald-600">
                {Math.round((completadas / todasOrdenes.length) * 100)}% completadas
              </span>
            ) : undefined
          }
        />
      </div>

      {/* Tomas */}
      <div className="bg-white rounded-xl border border-border/50 overflow-hidden shadow-sm mb-6">
        <div className="px-4 py-3 border-b border-border/50 bg-muted/20">
          <h2 className="text-sm font-semibold">Instalación de Toma</h2>
          <p className="text-xs text-muted-foreground">
            {tomas.length} orden{tomas.length !== 1 ? 'es' : ''}
          </p>
        </div>
        <OrdenesTable
          ordenes={tomas}
          isLoading={loadingTomas}
          onActualizar={handleActualizar}
          actualizandoId={actualizandoId}
        />
      </div>

      {/* Medidores */}
      <div className="bg-white rounded-xl border border-border/50 overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-border/50 bg-muted/20">
          <h2 className="text-sm font-semibold">Instalación de Medidor</h2>
          <p className="text-xs text-muted-foreground">
            {medidores.length} orden{medidores.length !== 1 ? 'es' : ''}
          </p>
        </div>
        <OrdenesTable
          ordenes={medidores}
          isLoading={loadingMedidores}
          onActualizar={handleActualizar}
          actualizandoId={actualizandoId}
        />
      </div>

      {actualizarMut.isError && (
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          {(actualizarMut.error as Error)?.message ?? 'Error al actualizar la orden'}
        </div>
      )}
    </div>
  );
};

export default Construcciones;
