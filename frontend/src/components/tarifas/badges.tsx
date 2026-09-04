import { cn } from '@/lib/utils';
import { IVA_LABEL, esContratacion, etiquetaMovimiento, etiquetaSeccion, fmtPct, type EstadoVersion } from './format';

type Tono = 'success' | 'info' | 'warning' | 'danger' | 'muted' | 'violet';

const tonoClases: Record<Tono, { pill: string; dot: string }> = {
  success: { pill: 'bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
  info: { pill: 'bg-blue-50 text-blue-700', dot: 'bg-blue-400' },
  warning: { pill: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  danger: { pill: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  muted: { pill: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  violet: { pill: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
};

/**
 * Pill con dot del design system (§4.2). `StatusBadge` resuelve el color por el texto del
 * estado, así que no sirve para etiquetas nuevas como "Exenta 0%": este componente usa el
 * mismo marcado pero con el tono explícito.
 */
export function Pill({
  tono = 'muted',
  children,
  className,
}: {
  tono?: Tono;
  children: React.ReactNode;
  className?: string;
}) {
  const { pill, dot } = tonoClases[tono];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap',
        pill,
        className,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dot)} />
      {children}
    </span>
  );
}

/**
 * Verde cuando la tarifa está exenta; azul con la tasa cuando está gravada. Los actos **no
 * objeto** también facturan al 0 % pero no son una exención, así que llevan pill neutra.
 */
export function IvaBadge({
  ivaPct,
  ivaNoObjeto,
  className,
}: {
  ivaPct: number;
  ivaNoObjeto?: boolean;
  className?: string;
}) {
  if (ivaNoObjeto) {
    return (
      <Pill tono="muted" className={className}>
        No objeto
      </Pill>
    );
  }
  return (
    <Pill tono={ivaPct === 0 ? 'success' : 'info'} className={className}>
      {IVA_LABEL(ivaPct)}
    </Pill>
  );
}

/** Marca las tarifas de pago único; las periódicas no llevan pill (son el caso por defecto). */
export function SeccionPill({ seccion, className }: { seccion?: string | null; className?: string }) {
  if (!esContratacion(seccion)) return null;
  return (
    <Pill tono="violet" className={className}>
      {etiquetaSeccion(seccion)}
    </Pill>
  );
}

const CALCULO_LABEL: Record<string, string> = {
  tabla: 'Tabla',
  lineal: 'Lineal',
  lineal_excedente: 'Lineal (excedente)',
  escalonado: 'Escalonado',
  fijo: 'Fijo',
  variable: 'Variable',
};

export function TipoCalculoBadge({ tipoCalculo }: { tipoCalculo: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
      {CALCULO_LABEL[tipoCalculo] ?? tipoCalculo}
    </span>
  );
}

const MOVIMIENTO_TONO: Record<string, Tono> = {
  ALTA: 'muted',
  CAMBIO_VALOR: 'info',
  AJUSTE_PORCENTUAL: 'warning',
  AJUSTE_MASIVO: 'warning',
  CAMBIO_FISCAL: 'violet',
  BAJA: 'danger',
};

/** Tipo de movimiento del Kardex; los ajustes muestran el porcentaje aplicado. */
export function TipoMovimientoBadge({
  tipo,
  porcentaje,
}: {
  tipo: string;
  porcentaje?: number | null;
}) {
  const muestraPct =
    porcentaje != null && (tipo === 'AJUSTE_PORCENTUAL' || tipo === 'AJUSTE_MASIVO');
  return (
    <span className="inline-flex items-center gap-1">
      <Pill tono={MOVIMIENTO_TONO[tipo] ?? 'muted'}>{etiquetaMovimiento(tipo)}</Pill>
      {muestraPct && (
        <span className="whitespace-nowrap rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-800">
          {fmtPct(porcentaje)}
        </span>
      )}
    </span>
  );
}

const ESTADO_VERSION_TONO: Record<EstadoVersion, Tono> = {
  Vigente: 'success',
  Programada: 'info',
  Anulada: 'danger',
  'Histórica': 'muted',
};

export function EstadoVersionBadge({ estado }: { estado: EstadoVersion }) {
  return <Pill tono={ESTADO_VERSION_TONO[estado]}>{estado}</Pill>;
}
