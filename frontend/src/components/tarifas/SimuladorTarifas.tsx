import { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import {
  calcularMonto,
  type CategoriaTarifaDto,
  type ServicioTarifaDto,
} from '@/api/tarifas';
import type { AdministracionCatalogo } from '@/api/catalogos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useToast } from '@/components/ui/use-toast';
import { fmtMXN } from './format';

interface DetalleSimulacion {
  rango: string;
  m3: number;
  importe: number;
}

interface Resultado {
  subtotal: number;
  iva: number;
  total: number;
  detalle: DetalleSimulacion[];
}

interface Props {
  useApi: boolean;
  administraciones: AdministracionCatalogo[];
  categorias: CategoriaTarifaDto[];
  servicios: ServicioTarifaDto[];
}

/**
 * Simulador de cálculo por consumo. La administración y la clase son obligatorias: sin ellas
 * el backend agrega todas las administraciones y clases del servicio y el importe no
 * corresponde a ningún contrato real.
 */
export function SimuladorTarifas({ useApi, administraciones, categorias, servicios }: Props) {
  const { toast } = useToast();
  const [administracionId, setAdministracionId] = useState('');
  const [claseTarifaId, setClaseTarifaId] = useState('');
  const [tipoServicio, setTipoServicio] = useState('');
  const [consumoM3, setConsumoM3] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);

  const clases = useMemo(
    () =>
      categorias.flatMap((c) =>
        c.clases.map((cl) => ({ value: cl.id, label: `${cl.nombre} · ${c.nombre}` })),
      ),
    [categorias],
  );

  /** `/tarifas/servicios` devuelve un renglón por (tipoServicio, concepto); aquí basta el servicio. */
  const tiposServicio = useMemo(() => {
    const vistos = new Map<string, number>();
    for (const s of servicios) vistos.set(s.tipoServicio, (vistos.get(s.tipoServicio) ?? 0) + s.total);
    return [...vistos.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'es-MX'))
      .map(([key, total]) => ({ value: key, label: `${key} (${total})` }));
  }, [servicios]);

  const consumo = Number(consumoM3);
  const consumoValido = consumoM3.trim() !== '' && Number.isFinite(consumo) && consumo >= 0;
  const listo = useApi && Boolean(administracionId && claseTarifaId && tipoServicio) && consumoValido;

  const limpiarResultado = () => setResultado(null);

  const handleSimular = async () => {
    if (!listo || cargando) return;
    setCargando(true);
    try {
      const res = await calcularMonto(tipoServicio, consumo, { administracionId, claseTarifaId });
      setResultado({
        subtotal: res.subtotal,
        iva: res.iva,
        total: res.total,
        detalle: (res.desglose ?? []).map((d) => ({ rango: d.rango, m3: d.m3, importe: d.subtotal })),
      });
    } catch (err) {
      setResultado(null);
      toast({
        title: 'No se pudo calcular el monto',
        description:
          (err as Error).message ||
          `No hay tarifas vigentes para el servicio "${tipoServicio}" en la administración y clase elegidas.`,
        variant: 'destructive',
      });
    } finally {
      setCargando(false);
    }
  };

  const claseSeleccionada = clases.find((c) => c.value === claseTarifaId)?.label;
  const adminSeleccionada = administraciones.find((a) => a.id === administracionId)?.nombre;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-border/50 bg-white p-6 shadow-sm">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Calcular monto por consumo
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
            <Label>Clase de tarifa</Label>
            <SearchableSelect
              placeholder="Seleccione clase"
              searchPlaceholder="Buscar clase…"
              value={claseTarifaId}
              onValueChange={(v) => {
                setClaseTarifaId(v);
                limpiarResultado();
              }}
              options={clases}
            />
          </div>
          <div>
            <Label>Servicio</Label>
            <SearchableSelect
              placeholder="Seleccione servicio"
              searchPlaceholder="Buscar servicio…"
              value={tipoServicio}
              onValueChange={(v) => {
                setTipoServicio(v);
                limpiarResultado();
              }}
              options={tiposServicio}
            />
          </div>
          <div>
            <Label htmlFor="sim-m3">Consumo (m³)</Label>
            <Input
              id="sim-m3"
              type="number"
              min={0}
              step={1}
              inputMode="decimal"
              placeholder="Ej. 22"
              value={consumoM3}
              onChange={(e) => {
                setConsumoM3(e.target.value);
                limpiarResultado();
              }}
            />
          </div>
          <Button
            onClick={handleSimular}
            disabled={!listo || cargando}
            className="w-full bg-[#007BFF] text-white hover:bg-blue-600"
          >
            <Calculator className="mr-1.5 h-4 w-4" />
            {cargando ? 'Calculando…' : 'Calcular monto'}
          </Button>
          {!listo && !cargando && (
            <p className="text-xs text-muted-foreground">
              Elige administración, clase, servicio y consumo para calcular el importe con la tarifa que
              factura el motor.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border border-border/50 bg-white p-6 shadow-sm">
        {resultado ? (
          <div className="w-full text-center">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Monto calculado
            </p>
            <p className="mb-1 font-display text-5xl font-bold text-[#003366]">{fmtMXN(resultado.total)}</p>
            <p className="mb-1 text-sm text-muted-foreground">
              {consumoM3} m³ · {tipoServicio}
            </p>
            <p className="mb-4 text-xs text-muted-foreground">
              {adminSeleccionada ?? '—'} · {claseSeleccionada ?? '—'}
            </p>
            <div className="mx-auto mb-2 flex max-w-xs items-center justify-between text-xs text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmtMXN(resultado.subtotal)}</span>
            </div>
            <div className="mx-auto flex max-w-xs items-center justify-between text-xs text-muted-foreground">
              <span>IVA</span>
              <span className="tabular-nums">{fmtMXN(resultado.iva)}</span>
            </div>
            {resultado.detalle.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-lg border text-left">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40">
                      <th scope="col" className="px-3 py-2 text-left text-muted-foreground">
                        Rango
                      </th>
                      <th scope="col" className="px-3 py-2 text-right text-muted-foreground">
                        m³
                      </th>
                      <th scope="col" className="px-3 py-2 text-right text-muted-foreground">
                        Importe
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.detalle.map((d, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{d.rango}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.m3}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtMXN(d.importe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <Calculator className="mx-auto mb-3 h-12 w-12 opacity-20" />
            <p className="text-sm">
              El importe se calcula con la tarifa vigente de la administración y clase seleccionadas
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
