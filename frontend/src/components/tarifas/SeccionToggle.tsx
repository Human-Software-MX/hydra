import type { SeccionTarifa } from '@/api/tarifas';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { SECCIONES, etiquetaSeccion } from './format';

const TODAS = '__all__';

interface Props {
  /** `undefined` = todas las secciones (el backend no recibe el parámetro). */
  value: SeccionTarifa | undefined;
  onChange: (seccion: SeccionTarifa | undefined) => void;
  /** Añade la opción "Todas"; el simulador siempre trabaja sobre una sección concreta. */
  conTodas?: boolean;
  ariaLabel?: string;
  className?: string;
}

/**
 * Control segmentado de sección (periódicas / contratación). Se usa como filtro principal
 * del catálogo porque las dos secciones no comparten columnas ni unidades.
 */
export function SeccionToggle({
  value,
  onChange,
  conTodas = false,
  ariaLabel = 'Sección del catálogo',
  className,
}: Props) {
  const opciones: Array<{ value: string; label: string }> = [
    ...SECCIONES.map((s) => ({ value: s as string, label: etiquetaSeccion(s) })),
    ...(conTodas ? [{ value: TODAS, label: 'Todas' }] : []),
  ];

  return (
    <ToggleGroup
      type="single"
      aria-label={ariaLabel}
      value={value ?? TODAS}
      onValueChange={(v) => {
        // Radix emite '' al volver a pulsar el ítem activo: se ignora para que siempre haya sección.
        if (!v) return;
        onChange(v === TODAS ? undefined : (v as SeccionTarifa));
      }}
      className={cn('inline-flex justify-start gap-0.5 rounded-md border border-input bg-white p-0.5', className)}
    >
      {opciones.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          size="sm"
          className="h-7 px-3 text-xs font-medium data-[state=on]:bg-[#007BFF]/10 data-[state=on]:text-[#003366]"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
