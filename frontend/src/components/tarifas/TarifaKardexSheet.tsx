import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import {
  fetchKardexTarifa,
  type TarifaMovimientoDto,
  type TarifaVigenteDto,
  type ValoresTarifa,
} from '@/api/tarifas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { EstadoVersionBadge, IvaBadge, TipoCalculoBadge, TipoMovimientoBadge } from './badges';
import { estadoVersion, fmtFecha, fmtFechaHora, fmtMXN, fmtPrecio } from './format';

interface CambioFila {
  label: string;
  anterior: string;
  nuevo: string;
}

/** Importe a 10 m³ del snapshot (o el último tramo si la tabla es más corta). */
function valorReferenciaTabla(v: ValoresTarifa | null | undefined): number | null {
  if (!v?.precios?.length) return null;
  return v.precios[Math.min(10, v.precios.length - 1)] ?? null;
}

/** Filas "anterior → nuevo" de un movimiento; solo las que realmente cambiaron. */
function cambiosDeMovimiento(m: TarifaMovimientoDto): CambioFila[] {
  const antes: ValoresTarifa | null = m.valoresAnteriores;
  const ahora = m.valoresNuevos;
  const filas: CambioFila[] = [];
  const agrega = (
    label: string,
    a: number | null | undefined,
    b: number | null | undefined,
    formato: (n: number | null | undefined) => string = fmtPrecio,
  ) => {
    if (a == null && b == null) return;
    if (a != null && b != null && Number(a) === Number(b)) return;
    filas.push({ label, anterior: formato(a), nuevo: formato(b) });
  };
  agrega('Precio base', antes?.cuotaFija, ahora.cuotaFija);
  agrega('Precio m³', antes?.precioUnitario, ahora.precioUnitario);
  agrega('Ref. 10 m³', valorReferenciaTabla(antes), valorReferenciaTabla(ahora), (n) => fmtMXN(n));
  if (antes && antes.ivaPct !== ahora.ivaPct) {
    filas.push({ label: 'IVA', anterior: `${antes.ivaPct}%`, nuevo: `${ahora.ivaPct}%` });
  }
  return filas;
}

interface Props {
  tarifaId: string | null;
  /** Fila de origen: alimenta el encabezado mientras carga el Kardex. */
  tarifaResumen?: TarifaVigenteDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abre el lote de actualización masiva que originó un movimiento. */
  onVerLote?: (actualizacionId: string) => void;
}

export function TarifaKardexSheet({ tarifaId, tarifaResumen, open, onOpenChange, onVerLote }: Props) {
  const { data: kardex, isLoading, error } = useQuery({
    queryKey: ['tarifas-kardex', tarifaId],
    queryFn: () => fetchKardexTarifa(tarifaId!),
    enabled: open && Boolean(tarifaId),
  });

  const cabecera: TarifaVigenteDto | null =
    kardex?.tarifaVigente ?? kardex?.versiones[0] ?? tarifaResumen ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pr-8">
          <SheetTitle>{cabecera?.nombre ?? 'Kardex de tarifa'}</SheetTitle>
          <SheetDescription>
            Histórico de versiones y movimientos del linaje {kardex?.codigo ?? cabecera?.codigo ?? ''}
          </SheetDescription>
        </SheetHeader>

        {cabecera && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{cabecera.claseNombre ?? '—'}</span>
            {cabecera.categoriaNombre && (
              <Badge variant="secondary" className="text-[10px] font-semibold">
                {cabecera.categoriaNombre}
              </Badge>
            )}
            <span>·</span>
            <span>{cabecera.administracionNombre ?? 'Global'}</span>
            <span>·</span>
            <span>
              {cabecera.tipoServicio}
              {cabecera.concepto ? ` · ${cabecera.concepto}` : ''}
            </span>
            <IvaBadge ivaPct={cabecera.ivaPct} />
            <TipoCalculoBadge tipoCalculo={cabecera.tipoCalculo} />
            <span>Vigente desde {fmtFecha(cabecera.vigenciaDesde)}</span>
          </div>
        )}

        {isLoading && <p className="mt-6 text-sm text-muted-foreground">Cargando Kardex…</p>}
        {error && (
          <p className="mt-6 text-sm text-destructive">No se pudo cargar el Kardex: {(error as Error).message}</p>
        )}

        {kardex && (
          <div className="mt-6 space-y-8">
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Versiones
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40">
                      {['v', 'Vigencia', 'Estado', 'Precio base', 'Precio m³', 'IVA'].map((h) => (
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
                    {kardex.versiones.map((v) => {
                      const estado = estadoVersion(v.vigenciaDesde, v.vigenciaHasta);
                      return (
                        <tr key={v.id} className="border-t">
                          <td className="px-3 py-2 tabular-nums">{v.version}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            {estado === 'Anulada'
                              ? `${fmtFecha(v.vigenciaDesde)} (anulada el mismo día)`
                              : `${fmtFecha(v.vigenciaDesde)} – ${
                                  v.vigenciaHasta ? fmtFecha(v.vigenciaHasta) : 'sin cierre'
                                }`}
                          </td>
                          <td className="px-3 py-2">
                            <EstadoVersionBadge estado={estado} />
                          </td>
                          <td className="px-3 py-2 tabular-nums">{fmtPrecio(v.cuotaFija)}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtPrecio(v.precioUnitario)}</td>
                          <td className="px-3 py-2 tabular-nums">{v.ivaPct}%</td>
                        </tr>
                      );
                    })}
                    {kardex.versiones.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                          Sin versiones registradas
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Movimientos
              </p>
              {kardex.movimientos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin movimientos registrados</p>
              ) : (
                <ol className="relative space-y-5 border-l border-border/70 pl-5">
                  {kardex.movimientos.map((m) => {
                    const cambios = cambiosDeMovimiento(m);
                    return (
                      <li key={m.id} className="relative">
                        <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-300" />
                        <div className="flex flex-wrap items-center gap-2">
                          <TipoMovimientoBadge tipo={m.tipo} porcentaje={m.porcentaje} />
                          <span className="text-xs text-muted-foreground">
                            v{m.version} · vigencia {fmtFecha(m.vigenciaDesde)}
                          </span>
                          {m.actualizacionId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-1.5 text-[11px] text-[#007BFF] hover:bg-[#007BFF]/10"
                              onClick={() => onVerLote?.(m.actualizacionId!)}
                              disabled={!onVerLote}
                            >
                              <Layers className="h-3 w-3" />
                              Lote {m.actualizacionId.slice(0, 8)}
                            </Button>
                          )}
                        </div>

                        {cambios.length > 0 && (
                          <div className="mt-1.5 space-y-0.5">
                            {cambios.map((c) => (
                              <p key={c.label} className="text-xs">
                                <span className="text-muted-foreground">{c.label}: </span>
                                <span className="tabular-nums text-muted-foreground">{c.anterior}</span>
                                <span className="text-muted-foreground"> → </span>
                                <span className="font-semibold tabular-nums text-[#003366]">{c.nuevo}</span>
                              </p>
                            ))}
                          </div>
                        )}

                        {m.motivo && <p className="mt-1.5 text-xs text-foreground">{m.motivo}</p>}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {fmtFechaHora(m.createdAt)}
                          {m.usuarioEmail ? ` · ${m.usuarioEmail}` : ''}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
