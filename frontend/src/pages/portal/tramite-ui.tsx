/**
 * Shared UI primitives for all portal tramite wizard forms.
 * Import from here to keep tramite pages DRY.
 */
import { createContext, useContext, useId, type ReactNode } from 'react';
import { CheckCircle2, Upload } from 'lucide-react';

// ─── Step indicator ────────────────────────────────────────────────────────

export const STEP_LABELS = ['Contrato', 'Motivo', 'Solicitante', 'Documentos', 'Firma'];

export function StepIndicator({ current, labels = STEP_LABELS }: { current: number; labels?: string[] }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {labels.map((label, i) => {
        const num = i + 1;
        return (
          <div key={num} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  num < current
                    ? 'bg-blue-600 text-white'
                    : num === current
                    ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {num < current ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : num}
              </div>
              <span
                className={`text-xs font-medium hidden sm:block ${
                  num === current ? 'text-blue-600' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 mb-4 sm:mb-5 transition-all ${
                  num < current ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step dots (progress bar) ──────────────────────────────────────────────

export function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <div
          key={n}
          className={`h-1.5 rounded-full transition-all ${
            n === current ? 'w-6 bg-blue-600' : n < current ? 'w-2 bg-blue-300' : 'w-2 bg-gray-200'
          }`}
        />
      ))}
    </div>
  );
}

// ─── Form primitives ───────────────────────────────────────────────────────

/**
 * Accesibilidad de los formularios de trámite.
 *
 * `Field` genera un id estable (`useId`) y lo comparte por contexto con el
 * `Label` (→ `htmlFor`) y el control (`TextInput`/`TextArea` → `id`), de modo
 * que el lector de pantalla anuncia la etiqueta al enfocar el campo sin tener
 * que pasar ids a mano en cada sitio. Si hay error, `Field` lo pinta con un id
 * propio y el control lo referencia vía `aria-describedby` + `aria-invalid`.
 *
 * Sólo debe envolver campos con UN control etiquetable. Para grupos (radios,
 * checkboxes) sigue usándose `<Label>` suelto — cada opción ya lleva su propio
 * `<label>` que envuelve al input.
 */
interface FieldContextValue {
  inputId: string;
  errorId?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function Field({
  children,
  error,
  className,
}: {
  children: ReactNode;
  error?: string;
  className?: string;
}) {
  const inputId = useId();
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <FieldContext.Provider value={{ inputId, errorId, invalid: Boolean(error) }}>
      <div className={className}>
        {children}
        {error && (
          <p id={errorId} className="text-xs text-red-500 mt-1">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export function Label({
  children,
  required,
  htmlFor,
}: {
  children: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  const ctx = useContext(FieldContext);
  return (
    <label htmlFor={htmlFor ?? ctx?.inputId} className="block text-sm font-medium text-gray-700 mb-1">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

/** Standalone error line for fields not wrapped in `<Field>` (e.g. radio groups). */
export function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-red-500 mt-1">{msg}</p>;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  readOnly,
  type = 'text',
  hint,
  id,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  type?: string;
  hint?: string;
  id?: string;
}) {
  const ctx = useContext(FieldContext);
  const inputId = id ?? ctx?.inputId;
  const hintId = hint && inputId ? `${inputId}-hint` : undefined;
  const describedBy = [ctx?.errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <>
      <input
        id={inputId}
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        aria-invalid={ctx?.invalid || undefined}
        aria-describedby={describedBy}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
          readOnly
            ? 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
            : 'bg-white border-gray-200 text-gray-900'
        }`}
      />
      {hint && (
        <p id={hintId} className="text-xs text-gray-400 mt-1">
          {hint}
        </p>
      )}
    </>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  id?: string;
}) {
  const ctx = useContext(FieldContext);
  const inputId = id ?? ctx?.inputId;
  return (
    <textarea
      id={inputId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      aria-invalid={ctx?.invalid || undefined}
      aria-describedby={ctx?.errorId}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors resize-none"
    />
  );
}

export function RadioCard({
  name,
  value,
  checked,
  onChange,
  label,
  desc,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  desc?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 border rounded-xl p-4 cursor-pointer transition-all ${
        checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 accent-blue-600 shrink-0"
      />
      <div>
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
      </div>
    </label>
  );
}

export function CheckCard({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 border rounded-xl p-4 cursor-pointer transition-all ${
        checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-blue-600 h-4 w-4 shrink-0"
      />
      <div>
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
      </div>
    </label>
  );
}

export function FileUpload({
  label,
  hint,
  required,
  file,
  onChange,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <div className="border border-dashed border-gray-300 rounded-xl p-4 hover:border-blue-400 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </p>
          {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
          {file && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-2.5 py-1 rounded-full w-fit">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              {file.name}
            </div>
          )}
        </div>
        <label className="shrink-0 cursor-pointer flex items-center gap-1.5 text-xs font-semibold text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors">
          <Upload className="h-3.5 w-3.5" aria-hidden />
          {file ? 'Cambiar' : 'Subir'}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
    </div>
  );
}

// ─── Section separator ─────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">{children}</p>
  );
}
