import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, BarChart3, Users, Gauge, CreditCard, Clock, MessageSquareWarning } from 'lucide-react';
import { fetchIndicadoresPigoo, hasApi } from '@/api/indicadores';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const useApi = hasApi();

const fmtPct = (v: number | null) => (v === null ? 'N/D' : `${v.toFixed(1)}%`);
const fmtMoney = (v: number) =>
  v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

const accentFor = (pct: number | null): 'success' | 'warning' | 'danger' | 'default' => {
  if (pct === null) return 'default';
  if (pct >= 80) return 'success';
  if (pct >= 60) return 'warning';
  return 'danger';
};

export default function Indicadores() {
  const [periodo, setPeriodo] = useState('');

  const q = useQuery({
    queryKey: ['indicadores-pigoo', periodo],
    queryFn: () => fetchIndicadoresPigoo(periodo || undefined),
    enabled: useApi,
  });

  const d = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indicadores PIGOO"
        subtitle="Indicadores de gestión de organismos operadores (PIGOO/IMTA) calculados con datos comerciales de Hydra"
      />

      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="periodo">Periodo (opcional)</Label>
          <Input
            id="periodo"
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="w-44"
          />
        </div>
        <p className="text-xs text-muted-foreground pb-2">
          Sin periodo se calcula el acumulado histórico.
        </p>
      </div>

      {!useApi && (
        <p className="text-sm text-muted-foreground">Backend no disponible — sin datos.</p>
      )}

      {q.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando indicadores…
        </div>
      )}

      {q.isError && (
        <p className="text-sm text-destructive">Error al calcular indicadores. Verifique su sesión.</p>
      )}

      {d && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Padrón de usuarios"
              icon={Users}
              value={d.padron.contratosActivos.toLocaleString('es-MX')}
              sub={`de ${d.padron.contratosTotales.toLocaleString('es-MX')} contratos totales`}
              footer={d.padron.definicion}
            />
            <KpiCard
              label="Micromedición"
              icon={Gauge}
              value={fmtPct(d.micromedicion.pct)}
              accent={accentFor(d.micromedicion.pct)}
              sub={`${d.micromedicion.medidoresActivos.toLocaleString('es-MX')} medidores activos`}
              footer={d.micromedicion.definicion}
            />
            <KpiCard
              label="Eficiencia comercial (IP.14)"
              icon={BarChart3}
              value={fmtPct(d.eficienciaComercial.pct)}
              accent={accentFor(d.eficienciaComercial.pct)}
              sub={`${fmtMoney(d.eficienciaComercial.cobrado)} cobrado / ${fmtMoney(d.eficienciaComercial.facturado)} facturado`}
              footer={d.eficienciaComercial.definicion}
            />
            <KpiCard
              label="Eficiencia de cobro (IP.15)"
              icon={CreditCard}
              value={fmtPct(d.eficienciaCobro.pct)}
              accent={accentFor(d.eficienciaCobro.pct)}
              sub={`${d.eficienciaCobro.recibosPagados.toLocaleString('es-MX')} de ${d.eficienciaCobro.recibosEmitidos.toLocaleString('es-MX')} recibos con pago`}
              footer={d.eficienciaCobro.definicion}
            />
            <KpiCard
              label="Pago a tiempo"
              icon={Clock}
              value={fmtPct(d.pagoATiempo.pct)}
              accent={accentFor(d.pagoATiempo.pct)}
              sub={`${d.pagoATiempo.pagosATiempo.toLocaleString('es-MX')} de ${d.pagoATiempo.pagosEvaluados.toLocaleString('es-MX')} pagos evaluados`}
              footer={d.pagoATiempo.definicion}
            />
            <KpiCard
              label="Reclamaciones / 1,000 tomas"
              icon={MessageSquareWarning}
              value={d.reclamaciones.por1000Tomas === null ? 'N/D' : d.reclamaciones.por1000Tomas.toFixed(1)}
              sub={`${d.reclamaciones.quejasPeriodo.toLocaleString('es-MX')} quejas/aclaraciones en el periodo`}
              footer={d.reclamaciones.definicion}
            />
          </div>

          <div className="rounded-xl border border-border/50 bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">Indicadores no disponibles</p>
            {Object.entries(d.noDisponibles).map(([k, v]) => (
              <p key={k}>
                <span className="font-medium">{k}:</span> {v}
              </p>
            ))}
            <p className="pt-1">
              Referencia: PIGOO — Programa de Indicadores de Gestión de Organismos Operadores (IMTA).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
