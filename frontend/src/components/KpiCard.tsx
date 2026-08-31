import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  /** Optional bottom row: progress bar, badge, or text */
  footer?: React.ReactNode;
  accent?: 'default' | 'primary' | 'danger' | 'warning' | 'success';
  icon?: LucideIcon;
  className?: string;
}

const accentValue: Record<string, string> = {
  default: 'text-foreground',
  primary: 'text-[#007BFF]',
  danger: 'text-destructive',
  warning: 'text-amber-600',
  success: 'text-emerald-600',
};

export function KpiCard({
  label,
  value,
  sub,
  footer,
  accent = 'default',
  icon: Icon,
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-xl border border-slate-200/70 shadow-sm p-5 flex flex-col gap-2',
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>

      <div className="flex items-end justify-between gap-2">
        <p className={cn('text-4xl font-bold font-display leading-none', accentValue[accent])}>
          {value}
        </p>
        {Icon && (
          <div className="p-2 bg-slate-100/80 rounded-lg">
            <Icon className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.6} />
          </div>
        )}
      </div>

      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {footer && <div className="mt-1">{footer}</div>}
    </div>
  );
}
