import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { StepProps } from '../hooks/useWizardState';
import { variableStorageKey } from '../hooks/useWizardState';
import { useTipoContratacionConfig } from '../hooks/useTipoContratacionConfig';

// ── Opciones para códigos reservados ────────────────────────────────────────

const DIAMETROS = ["1/2\"", "3/4\"", "1\"", "1.5\"", "2\"", "3\"", "4\""];

const OPCIONES_RESERVADAS: Record<string, { label: string; value: string }[]> = {
  DIAMETRO_TOMA:      DIAMETROS.map((d) => ({ value: d, label: d })),
  DIAMETRO_DESCARGA:  DIAMETROS.map((d) => ({ value: d, label: d })),
  MATERIAL_CALLE: [
    { value: 'concreto',           label: 'Concreto hidráulico' },
    { value: 'losa',               label: 'Losa' },
    { value: 'adoquin',            label: 'Adoquín' },
    { value: 'concreto_asfaltico', label: 'Concreto asfáltico' },
    { value: 'empedrado',          label: 'Empedrado' },
    { value: 'tierra',             label: 'Terracería / tierra' },
  ],
  MATERIAL_BANQUETA: [
    { value: 'concreto',   label: 'Concreto' },
    { value: 'asfalto',    label: 'Asfalto' },
    { value: 'adoquin',    label: 'Adoquín' },
    { value: 'adocreto',   label: 'Adocreto' },
    { value: 'empedrado',  label: 'Empedrado' },
    { value: 'tierra',     label: 'Terracería / tierra' },
    { value: 'cantera',    label: 'Cantera' },
  ],
  TIPO_MEDIDOR: [
    { value: 'velocidad',   label: 'Velocidad ½"' },
    { value: 'volumetrico', label: 'Volumétrico ½"' },
    { value: 'mayor',       label: 'Mayor que ½" (pago único)' },
  ],
  PLAN_PAGO_MEDIDOR: [
    { value: 'contado', label: 'Contado' },
    { value: '12parc',  label: '12 parcialidades' },
    { value: '24parc',  label: '24 parcialidades' },
  ],
};

function parseListaOpciones(valoresPosibles: unknown): string[] {
  if (valoresPosibles == null) return [];
  if (Array.isArray(valoresPosibles)) {
    return valoresPosibles.map((v) => String(v));
  }
  if (typeof valoresPosibles === 'string') {
    try {
      const p = JSON.parse(valoresPosibles) as unknown;
      return Array.isArray(p) ? p.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normTipoDato(raw: string | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

export default function PasoVariables({ data, updateData, config }: StepProps) {
  const tipoId = data.tipoContratacionId?.trim() || undefined;
  const q = useTipoContratacionConfig(tipoId);
  const effectiveConfig = config ?? q.data ?? undefined;

  const rows = useMemo(
    () => [...(effectiveConfig?.variables ?? [])].sort((a, b) => a.orden - b.orden),
    [effectiveConfig?.variables],
  );

  const vc = data.variablesCapturadas ?? {};

  const setVar = (key: string, value: string | number | boolean | undefined) => {
    const next = { ...vc };
    if (value === undefined || value === '') {
      delete next[key];
    } else {
      next[key] = value;
    }
    updateData({ variablesCapturadas: next });
  };

  if (!data.tipoContratacionId?.trim()) {
    return (
      <section aria-labelledby="paso-variables" className="space-y-3">
        <h2 id="paso-variables" className="text-base font-semibold">
          Variables
        </h2>
        <p className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          Seleccione primero el tipo de contratación en el paso de configuración.
        </p>
      </section>
    );
  }

  if (q.isError) {
    return (
      <section aria-labelledby="paso-variables" className="space-y-3">
        <h2 id="paso-variables" className="text-base font-semibold">
          Variables
        </h2>
        <p className="text-sm text-destructive">
          No se pudo cargar la configuración del tipo de contratación. Vuelva al paso anterior o reintente.
        </p>
      </section>
    );
  }

  if (q.isPending && !effectiveConfig) {
    return (
      <section aria-labelledby="paso-variables" className="space-y-3">
        <h2 id="paso-variables" className="text-base font-semibold">
          Variables
        </h2>
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          Cargando variables del tipo…
        </div>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section aria-labelledby="paso-variables" className="space-y-3">
        <h2 id="paso-variables" className="text-base font-semibold">
          Variables
        </h2>
        <p className="text-sm text-muted-foreground">
          Este tipo de contratación no define variables adicionales. Puede continuar.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="paso-variables" className="space-y-4">
      <div>
        <h2 id="paso-variables" className="text-base font-semibold">
          Variables del tipo
        </h2>
        <p className="text-sm text-muted-foreground">
          Valores usados en facturación y en el texto del contrato (<span className="font-mono">{'{{codigo}}'}</span>).
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {rows.map((row) => {
          const tv = row.tipoVariable;
          const key = variableStorageKey(row);
          const tipo = normTipoDato(tv.tipoDato);
          const label = (
            <>
              {tv.nombre}
              {row.obligatorio ? <span className="text-destructive"> *</span> : null}
              {tv.unidad?.trim() ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">({tv.unidad.trim()})</span>
              ) : null}
            </>
          );
          const def = row.valorDefecto?.trim();
          const rawVal = vc[key];
          const lista = tipo === 'LISTA' ? parseListaOpciones(tv.valoresPosibles) : [];

          // ── Códigos reservados → UI especializada ─────────────────────
          const opcionesReservadas = OPCIONES_RESERVADAS[tv.codigo?.toUpperCase?.() ?? ''];
          if (opcionesReservadas) {
            const valStr = rawVal != null && String(rawVal).length > 0 ? String(rawVal) : def ?? '';
            const selectValue = valStr.length > 0 ? valStr : '__none__';
            return (
              <div key={row.id} className="space-y-2">
                <Label htmlFor={`var-${key}`}>{label}</Label>
                <SearchableSelect
                  value={selectValue}
                  onValueChange={(v) => setVar(key, v === '__none__' ? undefined : v)}
                  placeholder="Seleccione…"
                  options={[
                    ...(!row.obligatorio ? [{ value: '__none__', label: '(vacío)' }] : []),
                    ...opcionesReservadas,
                  ]}
                />
              </div>
            );
          }

          // METROS_TOMA / METROS_DESCARGA / UNIDADES_SERVIDAS → número con placeholder útil
          const esMetros = ['METROS_TOMA', 'METROS_DESCARGA'].includes(tv.codigo?.toUpperCase?.() ?? '');
          if (esMetros && tipo !== 'NUMERO') {
            // Forzar comportamiento numérico aunque esté configurado como TEXTO
            const numStr = rawVal !== undefined ? String(rawVal) : def ?? '';
            return (
              <div key={row.id} className="space-y-2">
                <Label htmlFor={`var-${key}`}>{label}</Label>
                <Input
                  id={`var-${key}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.1}
                  value={numStr}
                  placeholder="metros lineales"
                  onChange={(e) => {
                    const t = e.target.value.trim();
                    setVar(key, t === '' ? undefined : Number(t));
                  }}
                />
              </div>
            );
          }

          if (tipo === 'BOOLEANO') {
            const checked =
              typeof rawVal === 'boolean'
                ? rawVal
                : rawVal === 'true' || rawVal === '1' || def === 'true' || def === '1';
            return (
              <div key={row.id} className="flex flex-col gap-2 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`var-${key}`}
                    checked={checked}
                    onCheckedChange={(v) => setVar(key, v === true)}
                  />
                  <Label htmlFor={`var-${key}`} className="font-normal cursor-pointer">
                    {label}
                  </Label>
                </div>
              </div>
            );
          }

          if (tipo === 'LISTA' && lista.length > 0) {
            const valStr = rawVal != null && String(rawVal).length > 0 ? String(rawVal) : def ?? '';
            const selectValue = valStr.length > 0 ? valStr : '__none__';
            return (
              <div key={row.id} className="space-y-2">
                <Label htmlFor={`var-${key}`}>{label}</Label>
                <SearchableSelect
                  value={selectValue}
                  onValueChange={(v) => setVar(key, v === '__none__' ? undefined : v)}
                  placeholder="Seleccione…"
                  options={[
                    ...(!row.obligatorio ? [{ value: '__none__', label: '(vacío)' }] : []),
                    ...lista.map((opt) => ({ value: opt, label: opt })),
                  ]}
                />
              </div>
            );
          }

          if (tipo === 'NUMERO') {
            const numStr =
              rawVal !== undefined && rawVal !== null && rawVal !== ''
                ? String(rawVal)
                : def ?? '';
            return (
              <div key={row.id} className="space-y-2">
                <Label htmlFor={`var-${key}`}>{label}</Label>
                <Input
                  id={`var-${key}`}
                  type="number"
                  inputMode="decimal"
                  value={numStr}
                  onChange={(e) => {
                    const t = e.target.value.trim();
                    if (t === '') {
                      setVar(key, undefined);
                      return;
                    }
                    const n = Number(t);
                    setVar(key, Number.isFinite(n) ? n : t);
                  }}
                />
              </div>
            );
          }

          if (tipo === 'FECHA') {
            const dateStr =
              typeof rawVal === 'string' && rawVal
                ? rawVal.slice(0, 10)
                : def?.slice(0, 10) ?? '';
            return (
              <div key={row.id} className="space-y-2">
                <Label htmlFor={`var-${key}`}>{label}</Label>
                <Input
                  id={`var-${key}`}
                  type="date"
                  value={dateStr}
                  onChange={(e) => setVar(key, e.target.value.trim() || undefined)}
                />
              </div>
            );
          }

          const textVal = rawVal != null ? String(rawVal) : def ?? '';
          return (
            <div key={row.id} className="space-y-2 sm:col-span-2">
              <Label htmlFor={`var-${key}`}>{label}</Label>
              <Input
                id={`var-${key}`}
                value={textVal}
                onChange={(e) => setVar(key, e.target.value.trim() || undefined)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
