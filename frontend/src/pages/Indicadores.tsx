import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  BarChart3,
  Users,
  Gauge,
  CreditCard,
  Clock,
  MessageSquareWarning,
  Droplets,
  Globe,
  Wallet,
} from 'lucide-react';
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
              value={d.contratosActivos.toLocaleString('es-MX')}
              sub={`de ${d.padronContratos.toLocaleString('es-MX')} contratos totales`}
              footer="Cobertura del padrón de usuarios (PIGOO: padrón de usuarios)"
            />
            <KpiCard
              label="Micromedición"
              icon={Gauge}
              value={fmtPct(d.micromedicionPct)}
              accent={accentFor(d.micromedicionPct)}
              sub={`${d.contratosConMedidor.toLocaleString('es-MX')} contratos activos con medidor`}
              footer="Contratos activos con medidor entre contratos activos (PIGOO: micromedición)"
            />
            <KpiCard
              label="Eficiencia física"
              icon={Droplets}
              value={fmtPct(d.eficienciaFisicaPct)}
              accent={accentFor(d.eficienciaFisicaPct)}
              sub={
                d.volumenProducidoM3 === null
                  ? 'Requiere capturar volumen producido (macromedición)'
                  : `${d.volumenFacturadoM3.toLocaleString('es-MX')} m³ facturados / ${d.volumenProducidoM3.toLocaleString('es-MX')} m³ producidos`
              }
              footer="Volumen facturado entre volumen producido (PIGOO: eficiencia física)"
            />
            <KpiCard
              label="Eficiencia comercial (IP.14)"
              icon={BarChart3}
              value={fmtPct(d.eficienciaComercialPct)}
              accent={accentFor(d.eficienciaComercialPct)}
              sub={`${fmtMoney(d.importeRecaudado)} recaudado / ${fmtMoney(d.importeFacturado)} facturado`}
              footer="Monto recaudado entre monto facturado timbrado (PIGOO IP.14)"
            />
            <KpiCard
              label="Eficiencia global"
              icon={Globe}
              value={fmtPct(d.eficienciaGlobalPct)}
              accent={accentFor(d.eficienciaGlobalPct)}
              sub="Física × comercial"
              footer="Eficiencia física por eficiencia comercial (PIGOO: eficiencia global)"
            />
            <KpiCard
              label="Eficiencia de cobro (IP.15)"
              icon={CreditCard}
              value={fmtPct(d.eficienciaCobroPct)}
              accent={accentFor(d.eficienciaCobroPct)}
              sub={`${d.recibosPagados.toLocaleString('es-MX')} de ${d.recibosEmitidos.toLocaleString('es-MX')} recibos con pago`}
              footer="Recibos con al menos un pago entre recibos emitidos (PIGOO IP.15)"
            />
            <KpiCard
              label="Pago a tiempo"
              icon={Clock}
              value={fmtPct(d.pagoATiempoPct)}
              accent={accentFor(d.pagoATiempoPct)}
              sub={`${d.pagosATiempo.toLocaleString('es-MX')} de ${d.pagosEvaluados.toLocaleString('es-MX')} pagos evaluados`}
              footer="Pagos realizados en o antes del vencimiento del timbrado (PIGOO: usuarios con pago a tiempo)"
            />
            <KpiCard
              label="Cartera vencida"
              icon={Wallet}
              value={fmtMoney(d.carteraVencida)}
              accent={d.carteraVencida > 0 ? 'warning' : 'success'}
              sub={`${d.usuariosConAdeudo.toLocaleString('es-MX')} usuarios con adeudo (${fmtPct(d.rezagoPctPadron)} del padrón)`}
              footer="Adeudo FIFO de recibos vencidos menos pagos aplicados (PIGOO: rezago)"
            />
            <KpiCard
              label="Reclamaciones / 1,000 tomas"
              icon={MessageSquareWarning}
              value={
                d.reclamacionesPor1000Tomas === null ? 'N/D' : d.reclamacionesPor1000Tomas.toFixed(1)
              }
              sub={`${d.quejasPeriodo.toLocaleString('es-MX')} quejas/aclaraciones en el periodo · ${d.quejasAbiertas.toLocaleString('es-MX')} abiertas`}
              footer="Quejas/aclaraciones por cada 1,000 tomas activas (PIGOO: reclamaciones)"
            />
          </div>

          <div className="rounded-xl border border-border/50 bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
            {d.volumenProducidoM3 === null && (
              <p>
                <span className="font-medium text-foreground">Eficiencia física/global:</span>{' '}
                requieren registrar el volumen producido del periodo (macromedición) vía{' '}
                <code>POST /indicadores/volumen-producido</code>.
              </p>
            )}
            <p>
              Serie histórica y export CSV para reporte PIGOO/CONAGUA disponibles en{' '}
              <code>GET /indicadores/pigoo/serie</code> y <code>GET /indicadores/pigoo/csv</code>.
            </p>
            <p className="pt-1">
              Referencia: PIGOO — Programa de Indicadores de Gestión de Organismos Operadores (IMTA).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
