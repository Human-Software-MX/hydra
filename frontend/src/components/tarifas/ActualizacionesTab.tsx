import { Fragment, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import {
  aplicarActualizacion,
  fetchActualizacionDetalle,
  fetchActualizaciones,
  type CategoriaTarifaDto,
  type FiltroTarifas,
} from '@/api/tarifas';
import type { AdministracionCatalogo } from '@/api/catalogos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import { useToast } from '@/components/ui/use-toast';
import { TipoMovimientoBadge } from './badges';
import { fmtFecha, fmtMXN, fmtPct, fmtPrecio, valorReferenciaDe } from './format';

const COLUMNAS = ['', 'Aplicación', 'Descripción', '%', 'Alcance', 'Tarifas', 'Estado', 'Aplicado por', ''];

interface Props {
  useApi: boolean;
  administraciones: AdministracionCatalogo[];
  categorias: CategoriaTarifaDto[];
  /** Lote expandido; controlado por la página para poder abrirlo desde el Kardex. */
  expandidoId: string | null;
  onToggleExpandido: (id: string) => void;
}

export function ActualizacionesTab({
  useApi,
  administraciones,
  categorias,
  expandidoId,
  onToggleExpandido,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: actualizaciones = [], isLoading } = useQuery({
    queryKey: ['tarifas-actualizaciones'],
    queryFn: () => fetchActualizaciones(),
    enabled: useApi,
  });

  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of administraciones) m.set(a.id, a.nombre);
    for (const c of categorias) {
      m.set(c.id, c.nombre);
      for (const cl of c.clases) m.set(cl.id, cl.nombre);
    }
    return m;
  }, [administraciones, categorias]);

  /** Chips legibles del filtro del lote: los ids se resuelven contra los catálogos cargados. */
  const chipsFiltro = (filtro: FiltroTarifas | null) => {
    if (!filtro) return [] as string[];
    const chips: string[] = [];
    if (filtro.administracionId) chips.push(nombrePorId.get(filtro.administracionId) ?? filtro.administracionId);
    if (filtro.categoriaId) chips.push(nombrePorId.get(filtro.categoriaId) ?? filtro.categoriaId);
    if (filtro.claseTarifaId) chips.push(nombrePorId.get(filtro.claseTarifaId) ?? filtro.claseTarifaId);
    if (filtro.tipoServicio) chips.push(filtro.tipoServicio);
    if (filtro.concepto) chips.push(filtro.concepto);
    if (filtro.buscar) chips.push(`"${filtro.buscar}"`);
    return chips;
  };

  const aplicarMut = useMutation({
    mutationFn: aplicarActualizacion,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tarifas-vigentes'] });
      qc.invalidateQueries({ queryKey: ['tarifas-actualizaciones'] });
      qc.invalidateQueries({ queryKey: ['tarifas-movimientos'] });
      toast({ title: 'Actualización aplicada', description: 'Las tarifas quedaron actualizadas.' });
    },
    onError: (err: Error) =>
      toast({ title: 'No se pudo aplicar la actualización', description: err.message, variant: 'destructive' }),
  });

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40">
              {COLUMNAS.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {actualizaciones.map((a) => {
              const abierto = expandidoId === a.id;
              const chips = chipsFiltro(a.filtro);
              return (
                <Fragment key={a.id}>
                  <tr className="border-t border-border/50 transition-colors hover:bg-muted/30">
                    <td className="px-2 py-3.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`${abierto ? 'Ocultar' : 'Ver'} movimientos del lote`}
                        onClick={() => onToggleExpandido(a.id)}
                      >
                        {abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-muted-foreground">
                      {fmtFecha(a.fechaAplicacion)}
                    </td>
                    <td className="px-4 py-3.5 font-medium">{a.descripcion}</td>
                    <td className="px-4 py-3.5 tabular-nums">{a.porcentaje != null ? fmtPct(a.porcentaje) : '—'}</td>
                    <td className="px-4 py-3.5">
                      {chips.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Todas las tarifas</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {chips.map((c) => (
                            <Badge key={c} variant="secondary" className="text-[10px] font-semibold">
                              {c}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums">{a.totalTarifas ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <StatusBadge
                        status={a.estado === 'aplicada' ? 'Aprobada' : a.estado === 'pendiente' ? 'Pendiente' : a.estado}
                      />
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">{a.aplicadoPor ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      {a.estado === 'pendiente' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-[#007BFF] text-xs text-[#007BFF] hover:bg-[#007BFF]/10"
                          disabled={aplicarMut.isPending}
                          onClick={() => aplicarMut.mutate(a.id)}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" /> Aplicar
                        </Button>
                      )}
                    </td>
                  </tr>
                  {abierto && (
                    <tr className="bg-muted/20">
                      <td colSpan={COLUMNAS.length} className="px-4 py-3">
                        <DetalleLote id={a.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {actualizaciones.length === 0 && (
              <tr>
                <td colSpan={COLUMNAS.length} className="py-10 text-center text-sm text-muted-foreground">
                  {isLoading
                    ? 'Cargando actualizaciones…'
                    : !useApi
                      ? 'Sin conexión al servidor de tarifas'
                      : 'Sin actualizaciones registradas'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetalleLote({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tarifas-actualizacion', id],
    queryFn: () => fetchActualizacionDetalle(id),
  });

  if (isLoading) return <p className="text-xs text-muted-foreground">Cargando movimientos del lote…</p>;
  if (error) {
    return <p className="text-xs text-destructive">No se pudo cargar el lote: {(error as Error).message}</p>;
  }
  const movimientos = data?.movimientos ?? [];
  if (movimientos.length === 0) {
    return <p className="text-xs text-muted-foreground">Este lote no tiene movimientos registrados.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Movimientos del lote ({movimientos.length})
      </p>
      <div className="overflow-hidden rounded-lg border bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40">
              {['Tarifa', 'Clase', 'Administración', 'Tipo', 'Precio base', 'Precio m³', 'Valor ref.'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="px-3 py-2 font-medium">{m.tarifaNombre}</td>
                <td className="px-3 py-2 text-muted-foreground">{m.claseNombre ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{m.administracionNombre ?? 'Global'}</td>
                <td className="px-3 py-2">
                  <TipoMovimientoBadge tipo={m.tipo} porcentaje={m.porcentaje} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  <span className="text-muted-foreground">{fmtPrecio(m.valoresAnteriores?.cuotaFija)}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="font-semibold text-[#003366]">{fmtPrecio(m.valoresNuevos.cuotaFija)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  <span className="text-muted-foreground">{fmtPrecio(m.valoresAnteriores?.precioUnitario)}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="font-semibold text-[#003366]">{fmtPrecio(m.valoresNuevos.precioUnitario)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  <span className="text-muted-foreground">{fmtMXN(valorReferenciaDe(m.valoresAnteriores))}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="font-semibold text-[#003366]">{fmtMXN(valorReferenciaDe(m.valoresNuevos))}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
