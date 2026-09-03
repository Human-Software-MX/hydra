import { useMemo } from 'react';
import { History, Percent, Search } from 'lucide-react';
import type { CategoriaTarifaDto, FiltroTarifas, ServicioTarifaDto, TarifaVigenteDto } from '@/api/tarifas';
import type { AdministracionCatalogo } from '@/api/catalogos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IvaBadge, TipoCalculoBadge } from './badges';
import { fmtFecha, fmtMXN, fmtPrecio } from './format';

const TODAS = '__all__';

const COLUMNAS = [
  'Clase',
  'Servicio / concepto',
  'Administración',
  'Cálculo',
  'Precio base',
  'Precio m³',
  'Ref. 10 m³',
  'IVA',
  'Vigente desde',
  'v',
  'Acciones',
];

/** Codifica el par (tipoServicio, concepto) en un único valor de select. */
const servicioKey = (tipoServicio: string, concepto: string | null | undefined) =>
  `${tipoServicio}|${concepto ?? ''}`;

interface Props {
  tarifas: TarifaVigenteDto[];
  isLoading: boolean;
  useApi: boolean;
  filtro: FiltroTarifas;
  onFiltroChange: (filtro: FiltroTarifas) => void;
  onLimpiarFiltros: () => void;
  administraciones: AdministracionCatalogo[];
  categorias: CategoriaTarifaDto[];
  servicios: ServicioTarifaDto[];
  onActualizar: (tarifa: TarifaVigenteDto) => void;
  onKardex: (tarifa: TarifaVigenteDto) => void;
}

export function TarifasVigentesTable({
  tarifas,
  isLoading,
  useApi,
  filtro,
  onFiltroChange,
  onLimpiarFiltros,
  administraciones,
  categorias,
  servicios,
  onActualizar,
  onKardex,
}: Props) {
  const clases = useMemo(() => {
    const todas = categorias.flatMap((c) => c.clases);
    return filtro.categoriaId ? todas.filter((cl) => cl.categoriaId === filtro.categoriaId) : todas;
  }, [categorias, filtro.categoriaId]);

  /** El texto se filtra en cliente sobre el resultado del servidor: misma selección, sin refetch por tecla. */
  const filas = useMemo(() => {
    const q = (filtro.buscar ?? '').trim().toLowerCase();
    const visibles = q
      ? tarifas.filter((t) =>
          [t.nombre, t.codigo, t.claseNombre, t.categoriaNombre, t.administracionNombre, t.tipoServicio, t.concepto]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : tarifas;
    return [...visibles].sort((a, b) => {
      const clase = (a.claseNombre ?? '').localeCompare(b.claseNombre ?? '', 'es-MX');
      if (clase !== 0) return clase;
      return (a.administracionNombre ?? '').localeCompare(b.administracionNombre ?? '', 'es-MX');
    });
  }, [tarifas, filtro.buscar]);

  const hayFiltros =
    Boolean(filtro.administracionId) ||
    Boolean(filtro.categoriaId) ||
    Boolean(filtro.claseTarifaId) ||
    Boolean(filtro.tipoServicio) ||
    (filtro.buscar ?? '').trim() !== '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtro.buscar ?? ''}
            onChange={(e) => onFiltroChange({ ...filtro, buscar: e.target.value })}
            placeholder="Buscar por clase, servicio o código…"
            className="h-9 pl-8 text-sm"
            aria-label="Buscar tarifas"
          />
        </div>

        <SearchableSelect
          className="w-[200px]"
          placeholder="Administración"
          searchPlaceholder="Buscar administración…"
          value={filtro.administracionId ?? TODAS}
          onValueChange={(v) =>
            onFiltroChange({ ...filtro, administracionId: v === TODAS ? undefined : v })
          }
          options={[
            { value: TODAS, label: 'Todas las administraciones' },
            ...administraciones.map((a) => ({ value: a.id, label: a.nombre })),
          ]}
        />

        <SearchableSelect
          className="w-[180px]"
          placeholder="Categoría"
          searchPlaceholder="Buscar categoría…"
          value={filtro.categoriaId ?? TODAS}
          onValueChange={(v) =>
            onFiltroChange({
              ...filtro,
              categoriaId: v === TODAS ? undefined : v,
              // la clase seleccionada puede no pertenecer a la nueva categoría
              claseTarifaId: undefined,
            })
          }
          options={[
            { value: TODAS, label: 'Todas las categorías' },
            ...categorias.map((c) => ({ value: c.id, label: c.nombre })),
          ]}
        />

        <SearchableSelect
          className="w-[200px]"
          placeholder="Clase"
          searchPlaceholder="Buscar clase…"
          value={filtro.claseTarifaId ?? TODAS}
          onValueChange={(v) => onFiltroChange({ ...filtro, claseTarifaId: v === TODAS ? undefined : v })}
          options={[
            { value: TODAS, label: 'Todas las clases' },
            ...clases.map((cl) => ({ value: cl.id, label: cl.nombre })),
          ]}
        />

        <SearchableSelect
          className="w-[220px]"
          placeholder="Servicio / concepto"
          searchPlaceholder="Buscar servicio…"
          value={filtro.tipoServicio ? servicioKey(filtro.tipoServicio, filtro.concepto) : TODAS}
          onValueChange={(v) => {
            if (v === TODAS) {
              onFiltroChange({ ...filtro, tipoServicio: undefined, concepto: undefined });
              return;
            }
            const [tipoServicio, concepto] = v.split('|');
            onFiltroChange({ ...filtro, tipoServicio, concepto: concepto || undefined });
          }}
          options={[
            { value: TODAS, label: 'Todos los servicios' },
            ...servicios.map((s) => ({
              value: servicioKey(s.tipoServicio, s.concepto),
              label: s.concepto ? `${s.tipoServicio} · ${s.concepto}` : s.tipoServicio,
            })),
          ]}
        />

        {hayFiltros && (
          <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground" onClick={onLimpiarFiltros}>
            Limpiar filtros
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50 bg-white shadow-sm">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead>
              <tr className="bg-muted/40">
                {COLUMNAS.map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((t) => (
                <tr key={t.id} className="border-t border-border/50 transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3.5">
                    <p className="font-medium leading-tight">{t.claseNombre ?? t.nombre}</p>
                    {t.categoriaNombre && (
                      <Badge variant="secondary" className="mt-1 text-[10px] font-semibold">
                        {t.categoriaNombre}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="leading-tight">{t.tipoServicio}</p>
                    {t.concepto && <p className="text-xs text-muted-foreground">{t.concepto}</p>}
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">{t.administracionNombre ?? 'Global'}</td>
                  <td className="px-4 py-3.5">
                    <TipoCalculoBadge tipoCalculo={t.tipoCalculo} />
                  </td>
                  <td className="px-4 py-3.5 tabular-nums">{fmtPrecio(t.cuotaFija)}</td>
                  <td className="px-4 py-3.5 tabular-nums">{fmtPrecio(t.precioUnitario)}</td>
                  <td className="px-4 py-3.5 tabular-nums">
                    {t.tipoCalculo === 'tabla' ? fmtMXN(t.valorReferencia) : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <IvaBadge ivaPct={t.ivaPct} />
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">{fmtFecha(t.vigenciaDesde)}</td>
                  <td className="px-4 py-3.5 tabular-nums text-muted-foreground">{t.version}</td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-[#007BFF] hover:bg-[#007BFF]/10"
                            aria-label={`Actualizar tarifa ${t.claseNombre ?? t.nombre}`}
                            onClick={() => onActualizar(t)}
                          >
                            <Percent className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Actualizar tarifa</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Ver Kardex de ${t.claseNombre ?? t.nombre}`}
                            onClick={() => onKardex(t)}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Ver Kardex</TooltipContent>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={COLUMNAS.length} className="py-10 text-center text-sm text-muted-foreground">
                    {isLoading
                      ? 'Cargando tarifas…'
                      : !useApi
                        ? 'Sin conexión al servidor de tarifas'
                        : hayFiltros
                          ? 'Sin tarifas para los filtros aplicados'
                          : 'No hay tarifas vigentes registradas'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filas.length > 0 && (
          <div className="border-t border-border/50 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
            {filas.length === tarifas.length
              ? `${filas.length} tarifa${filas.length === 1 ? '' : 's'} vigente${filas.length === 1 ? '' : 's'}`
              : `Mostrando ${filas.length} de ${tarifas.length} tarifas vigentes`}
          </div>
        )}
      </div>
    </div>
  );
}
