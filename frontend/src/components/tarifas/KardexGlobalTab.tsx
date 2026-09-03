import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { fetchMovimientosTarifa } from '@/api/tarifas';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TipoMovimientoBadge } from './badges';
import { TIPOS_MOVIMIENTO, etiquetaMovimiento, fmtFechaHora, fmtMXN, fmtPct, valorReferenciaDe } from './format';

const TODOS = '__all__';
const LIMIT = 50;

const COLUMNAS = ['Fecha', 'Tipo', 'Tarifa', 'Clase', 'Administración', '%', 'Valor ref.', 'Usuario', 'Motivo', 'Kardex'];

interface Props {
  useApi: boolean;
  onVerKardex: (tarifaId: string) => void;
}

export function KardexGlobalTab({ useApi, onVerKardex }: Props) {
  const [tipo, setTipo] = useState<string>(TODOS);
  const [page, setPage] = useState(1);

  const params = { tipo: tipo === TODOS ? undefined : tipo, page, limit: LIMIT };
  const { data, isLoading } = useQuery({
    queryKey: ['tarifas-movimientos', params],
    queryFn: () => fetchMovimientosTarifa(params),
    enabled: useApi,
  });

  const movimientos = data?.data ?? [];
  const total = data?.total ?? 0;
  const desde = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const hasta = Math.min(page * LIMIT, total);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect
          value={tipo}
          onValueChange={(v) => {
            setTipo(v);
            setPage(1);
          }}
          placeholder="Tipo de movimiento"
          searchPlaceholder="Buscar movimiento…"
          options={[
            { value: TODOS, label: 'Todos los movimientos' },
            ...TIPOS_MOVIMIENTO.map((t) => ({ value: t, label: etiquetaMovimiento(t) })),
          ]}
          className="h-9 w-[220px] text-sm"
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {total > 0 ? `Mostrando ${desde}–${hasta} de ${total}` : ''}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50 bg-white shadow-sm">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="bg-muted/40">
                {COLUMNAS.map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className={`px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ${
                      h === 'Kardex' ? 'sticky right-0 bg-[#f1f5f9]' : ''
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => {
                const refAnterior = valorReferenciaDe(m.valoresAnteriores);
                const refNuevo = valorReferenciaDe(m.valoresNuevos);
                return (
                  <tr key={m.id} className="border-t border-border/50 transition-colors hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {fmtFechaHora(m.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <TipoMovimientoBadge tipo={m.tipo} />
                    </td>
                    <td className="max-w-[260px] px-4 py-3 font-medium">
                      <span className="line-clamp-2" title={m.tarifaNombre}>
                        {m.tarifaNombre}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{m.claseNombre ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{m.administracionNombre ?? 'Global'}</td>
                    <td className="px-4 py-3 tabular-nums">{m.porcentaje != null ? fmtPct(m.porcentaje) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">
                      {refAnterior != null || refNuevo != null ? (
                        <>
                          <span className="text-muted-foreground">{fmtMXN(refAnterior)}</span>
                          <span className="text-muted-foreground"> → </span>
                          <span className="font-semibold text-[#003366]">{fmtMXN(refNuevo)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{m.usuarioEmail ?? '—'}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-xs text-muted-foreground" title={m.motivo ?? ''}>
                      {m.motivo ?? '—'}
                    </td>
                    <td className="sticky right-0 whitespace-nowrap bg-white px-4 py-3 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.25)]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Ver Kardex de ${m.tarifaNombre}`}
                            onClick={() => onVerKardex(m.tarifaId)}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Ver Kardex de la tarifa</TooltipContent>
                      </Tooltip>
                    </td>
                  </tr>
                );
              })}
              {movimientos.length === 0 && (
                <tr>
                  <td colSpan={COLUMNAS.length} className="py-10 text-center text-sm text-muted-foreground">
                    {isLoading
                      ? 'Cargando movimientos…'
                      : !useApi
                        ? 'Sin conexión al servidor de tarifas'
                        : 'Sin movimientos en el Kardex'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {total > LIMIT && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            Página {page} de {Math.max(1, Math.ceil(total / LIMIT))}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={hasta >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}
