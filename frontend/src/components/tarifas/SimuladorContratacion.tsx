import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator } from 'lucide-react';
import {
  cotizarContratacion,
  fetchTarifasVigentes,
  type CotizacionContratacionDto,
  type ServicioTarifaDto,
} from '@/api/tarifas';
import type { AdministracionCatalogo } from '@/api/catalogos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/use-toast';
import { esContratacion, etiquetaTipoServicio, fmtCantidad, fmtMXN, fmtPrecio, paramNumero } from './format';

/** Clase y variante viajan juntas en el valor del select: cualquiera de las dos puede faltar. */
const claseKey = (claseTarifaId: string | null, variante: string | null) =>
  `${claseTarifaId ?? ''}|${variante ?? ''}`;

interface Props {
  useApi: boolean;
  administraciones: AdministracionCatalogo[];
  servicios: ServicioTarifaDto[];
}

/**
 * Cotizador de conceptos de contratación (pago único). El importe lo calcula el backend
 * (`/tarifas/contratacion/cotizar`) para que el simulador y el alta de contrato coincidan.
 */
export function SimuladorContratacion({ useApi, administraciones, servicios }: Props) {
  const { toast } = useToast();
  const [administracionId, setAdministracionId] = useState('');
  const [tipoServicio, setTipoServicio] = useState('');
  const [clase, setClase] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [resultado, setResultado] = useState<CotizacionContratacionDto | null>(null);
  const [cargando, setCargando] = useState(false);

  const limpiarResultado = () => setResultado(null);

  /** Un renglón por concepto de contratación, con su nombre legible. */
  const conceptos = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const s of servicios) {
      if (!esContratacion(s.seccion) || vistos.has(s.tipoServicio)) continue;
      vistos.set(s.tipoServicio, s.concepto ?? etiquetaTipoServicio(s.tipoServicio));
    }
    return [...vistos.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es-MX'));
  }, [servicios]);

  /** Las variantes del concepto salen de sus tarifas vigentes en esa administración. */
  const { data: vigentes = [], isLoading: cargandoVigentes } = useQuery({
    queryKey: ['tarifas-vigentes', 'contratacion', administracionId, tipoServicio],
    queryFn: () => fetchTarifasVigentes({ seccion: 'CONTRATACION', administracionId, tipoServicio }),
    enabled: useApi && Boolean(administracionId && tipoServicio),
  });

  const opcionesClase = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const t of vigentes) {
      const key = claseKey(t.claseTarifaId, t.variante);
      if (!vistos.has(key)) vistos.set(key, t.claseNombre ?? t.variante ?? 'General');
    }
    return [...vistos.entries()].map(([value, label]) => ({ value, label }));
  }, [vigentes]);

  /** Con una sola variante no hay nada que elegir; si cambia el concepto la selección caduca. */
  useEffect(() => {
    setClase((actual) => {
      if (opcionesClase.length === 1) return opcionesClase[0].value;
      return opcionesClase.some((o) => o.value === actual) ? actual : '';
    });
  }, [opcionesClase]);

  const cantidadNum = Number(cantidad);
  const cantidadValida = cantidad.trim() !== '' && Number.isFinite(cantidadNum) && cantidadNum > 0;
  const listo =
    useApi && Boolean(administracionId && tipoServicio) && cantidadValida &&
    (opcionesClase.length === 0 || Boolean(clase));

  const cotizar = async () => {
    if (!listo || cargando) return;
    const [claseTarifaId, variante] = clase.split('|');
    setCargando(true);
    try {
      const res = await cotizarContratacion({
        administracionId,
        tipoServicio,
        cantidad: cantidadNum,
        claseTarifaId: claseTarifaId || undefined,
        variante: variante || undefined,
      });
      setResultado(res);
    } catch (err) {
      setResultado(null);
      toast({
        title: 'No se pudo cotizar el concepto',
        description:
          (err as Error).message ||
          'No hay una tarifa de contratación vigente para el concepto y la administración elegidos.',
        variant: 'destructive',
      });
    } finally {
      setCargando(false);
    }
  };

  const conceptoLabel = conceptos.find((c) => c.value === tipoServicio)?.label;
  const adminLabel = administraciones.find((a) => a.id === administracionId)?.nombre;
  const cantidadIncluida = paramNumero(resultado?.tarifa.parametros, 'cantidadIncluida');

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-border/50 bg-white p-6 shadow-sm">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Cotizar concepto de contratación
        </p>
        <div className="space-y-3">
          <div>
            <Label>Administración</Label>
            <SearchableSelect
              placeholder="Seleccione administración"
              searchPlaceholder="Buscar administración…"
              value={administracionId}
              onValueChange={(v) => {
                setAdministracionId(v);
                limpiarResultado();
              }}
              options={administraciones.map((a) => ({ value: a.id, label: a.nombre }))}
            />
          </div>
          <div>
            <Label>Concepto</Label>
            <SearchableSelect
              placeholder="Seleccione concepto"
              searchPlaceholder="Buscar concepto…"
              value={tipoServicio}
              onValueChange={(v) => {
                setTipoServicio(v);
                setClase('');
                limpiarResultado();
              }}
              options={conceptos}
            />
          </div>
          <div>
            <Label>Clase / variante</Label>
            <SearchableSelect
              placeholder={
                !administracionId || !tipoServicio
                  ? 'Elige administración y concepto'
                  : cargandoVigentes
                    ? 'Cargando variantes…'
                    : opcionesClase.length === 0
                      ? 'Sin tarifas vigentes'
                      : 'Seleccione variante'
              }
              searchPlaceholder="Buscar variante…"
              disabled={opcionesClase.length === 0}
              value={clase}
              onValueChange={(v) => {
                setClase(v);
                limpiarResultado();
              }}
              options={opcionesClase}
            />
          </div>
          <div>
            <Label htmlFor="sim-cantidad">Cantidad (m, unidades)</Label>
            <Input
              id="sim-cantidad"
              type="number"
              min={0}
              step={0.01}
              inputMode="decimal"
              placeholder="Ej. 8"
              value={cantidad}
              onChange={(e) => {
                setCantidad(e.target.value);
                limpiarResultado();
              }}
            />
          </div>
          <Button
            onClick={cotizar}
            disabled={!listo || cargando}
            className="w-full bg-[#007BFF] text-white hover:bg-blue-600"
          >
            <Calculator className="mr-1.5 h-4 w-4" />
            {cargando ? 'Calculando…' : 'Calcular'}
          </Button>
          {!listo && !cargando && (
            <p className="text-xs text-muted-foreground">
              Elige administración, concepto, variante y cantidad para cotizar con la tarifa vigente.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border border-border/50 bg-white p-6 shadow-sm">
        {resultado ? (
          <div className="w-full text-center">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Importe cotizado
            </p>
            <p className="mb-1 font-display text-5xl font-bold text-[#003366]">{fmtMXN(resultado.total)}</p>
            <p className="mb-1 text-sm text-muted-foreground">
              {fmtCantidad(resultado.cantidad)} · {conceptoLabel ?? resultado.tarifa.concepto ?? tipoServicio}
            </p>
            <p className="mb-4 text-xs text-muted-foreground">
              {adminLabel ?? resultado.tarifa.administracionNombre ?? 'Global'}
              {resultado.tarifa.variante ? ` · ${resultado.tarifa.variante}` : ''}
            </p>
            <div className="mx-auto mb-2 flex max-w-xs items-center justify-between text-xs text-muted-foreground">
              <span>Importe</span>
              <span className="tabular-nums">{fmtMXN(resultado.importe)}</span>
            </div>
            <div className="mx-auto flex max-w-xs items-center justify-between text-xs text-muted-foreground">
              <span>IVA{resultado.ivaNoObjeto ? '' : ` (${resultado.ivaPct} %)`}</span>
              <span className="tabular-nums">
                {resultado.ivaNoObjeto ? 'No objeto' : fmtMXN(resultado.iva)}
              </span>
            </div>
            <div className="mt-4 space-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{resultado.tarifa.nombre}</p>
              <p>Precio base: {fmtPrecio(resultado.tarifa.cuotaFija)}</p>
              <p>Precio proporcional: {fmtPrecio(resultado.tarifa.precioUnitario)}</p>
              {cantidadIncluida != null && <p>Cantidad incluida en la base: {fmtCantidad(cantidadIncluida)}</p>}
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <Calculator className="mx-auto mb-3 h-12 w-12 opacity-20" />
            <p className="text-sm">
              El importe se cotiza con la tarifa de contratación vigente de la administración y variante
              seleccionadas
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
