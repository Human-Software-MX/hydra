import { useState, createContext, useContext, useId, type ReactNode } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { PortalContextValue } from '@/components/PortalLayout';
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Upload,
  AlertCircle,
  Info,
  Clock,
  Banknote,
  ShieldCheck,
  FileSearch,
  Circle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  // Step 1 – Datos del contrato
  numeroContrato: string;
  numeroMedidor: string;
  nombreTitular: string;
  direccion: string;
  colonia: string;

  // Step 2 – Motivo
  tipoMotivo: 'fusion' | 'duplicidad' | 'local' | 'otro' | '';
  descripcionMotivo: string;

  // Step 3 – Solicitante
  solicitanteTipo: 'propietario' | 'representante' | '';
  // Datos de contacto (ambos)
  nombreFirmante: string;
  direccionParticular: string;
  telefono: string;
  correoElectronico: string;
  // Solo representante
  nombreRepresentante: string;
  numeroEscritura: string;
  numeroActaConstitutiva: string;

  // Step 4 – Documentos (filenames for display)
  docEscritura: File | null;
  docIdentificacion: File | null;
  docCroquis: File | null;
  docCartaPoder: File | null;
  docIdentTestigos: File | null;
  docPoderNotarial: File | null;

  // Step 5 – Declaración
  aceptaTerminos: boolean;
  firmaDigital: boolean;
}

const INITIAL_FORM: FormData = {
  numeroContrato: '',
  numeroMedidor: '',
  nombreTitular: '',
  direccion: '',
  colonia: '',
  tipoMotivo: '',
  descripcionMotivo: '',
  solicitanteTipo: '',
  nombreFirmante: '',
  direccionParticular: '',
  telefono: '',
  correoElectronico: '',
  nombreRepresentante: '',
  numeroEscritura: '',
  numeroActaConstitutiva: '',
  docEscritura: null,
  docIdentificacion: null,
  docCroquis: null,
  docCartaPoder: null,
  docIdentTestigos: null,
  docPoderNotarial: null,
  aceptaTerminos: false,
  firmaDigital: false,
};

// ─── Step indicator ────────────────────────────────────────────────────────

const STEPS = [
  { number: 1, label: 'Contrato' },
  { number: 2, label: 'Motivo' },
  { number: 3, label: 'Solicitante' },
  { number: 4, label: 'Documentos' },
  { number: 5, label: 'Firma' },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, i) => (
        <div key={step.number} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                step.number < current
                  ? 'bg-blue-600 text-white'
                  : step.number === current
                  ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {step.number < current ? (
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              ) : (
                step.number
              )}
            </div>
            <span
              className={`text-xs font-medium hidden sm:block ${
                step.number === current ? 'text-blue-600' : 'text-gray-400'
              }`}
            >
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-2 mb-4 sm:mb-5 transition-all ${
                step.number < current ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Input helpers ─────────────────────────────────────────────────────────

// Accesibilidad: `Field` genera un id (useId) y lo comparte por contexto con
// `Label` (htmlFor) y el control (id), de modo que el lector de pantalla anuncia
// la etiqueta al enfocar. Con error, lo referencia vía aria-describedby/invalid.
interface FieldContextValue {
  inputId: string;
  errorId?: string;
  invalid: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

function Field({
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

function Label({
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

function Input({
  value,
  onChange,
  placeholder,
  readOnly,
  type = 'text',
  id,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  type?: string;
  id?: string;
}) {
  const ctx = useContext(FieldContext);
  const inputId = id ?? ctx?.inputId;
  return (
    <input
      id={inputId}
      type={type}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      aria-invalid={ctx?.invalid || undefined}
      aria-describedby={ctx?.errorId}
      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
        readOnly
          ? 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
          : 'bg-white border-gray-200 text-gray-900'
      }`}
    />
  );
}

function Textarea({
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

function FileUpload({
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

// ─── Info Sidebar ──────────────────────────────────────────────────────────

function InfoSidebar() {
  return (
    <aside className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Información del trámite</h3>

        <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
          <div className="h-9 w-9 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4 text-gray-500" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Plazo máximo de respuesta</p>
            <p className="text-sm text-gray-700 mt-0.5">30 días hábiles</p>
          </div>
        </div>

        <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
          <div className="h-9 w-9 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center shrink-0">
            <Banknote className="h-4 w-4 text-gray-500" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Cantidad a pagar</p>
            <p className="text-sm text-gray-700 mt-0.5">Gratuito</p>
          </div>
        </div>

        <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
          <div className="h-9 w-9 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center shrink-0">
            <ShieldCheck className="h-4 w-4 text-gray-500" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Vigencia del documento</p>
            <p className="text-sm text-gray-700 mt-0.5">Permanente</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="h-9 w-9 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center shrink-0">
            <FileSearch className="h-4 w-4 text-gray-500" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Inspección</p>
            <p className="text-sm text-gray-600 mt-0.5">
              Se realizará el retiro de la toma de agua potable para proceder a la baja definitiva.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-amber-800 mb-1">Criterios de resolución</p>
            <ul className="text-xs text-amber-700 space-y-1.5 list-disc list-inside">
              <li>Estar al corriente en los pagos del servicio.</li>
              <li>La baja definitiva implica la pérdida de todos los derechos adquiridos, incluidos los de infraestructura.</li>
              <li>De requerir el servicio nuevamente, deberá cubrir derechos de infraestructura y contratación a la tarifa vigente.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-blue-800 mb-1">¿Dudas?</p>
            <p className="text-xs text-blue-700">
              Comunícate al <strong>(442) 211 0600 Ext. 1212</strong> con Karina Lugo.
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

const TramiteBajaDefinitiva = () => {
  const { contratos, contratoId } = useOutletContext<PortalContextValue>();
  const navigate = useNavigate();
  const contrato = contratos.find((c) => c.id === contratoId) ?? null;

  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [folio] = useState(() => `BJ-${Date.now().toString(36).toUpperCase()}`);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const [form, setForm] = useState<FormData>({
    ...INITIAL_FORM,
    numeroContrato: contrato?.id ?? '',
    nombreTitular: contrato?.nombre ?? '',
    direccion: contrato?.direccion ?? '',
  });

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const validate = (s: number): boolean => {
    const newErrors: typeof errors = {};

    if (s === 1) {
      if (!form.numeroContrato.trim()) newErrors.numeroContrato = 'Requerido';
      if (!form.nombreTitular.trim()) newErrors.nombreTitular = 'Requerido';
      if (!form.direccion.trim()) newErrors.direccion = 'Requerido';
      if (!form.colonia.trim()) newErrors.colonia = 'Requerido';
    }
    if (s === 2) {
      if (!form.tipoMotivo) newErrors.tipoMotivo = 'Selecciona un motivo';
      if (!form.descripcionMotivo.trim()) newErrors.descripcionMotivo = 'Describe el motivo';
    }
    if (s === 3) {
      if (!form.solicitanteTipo) newErrors.solicitanteTipo = 'Indica quién realiza el trámite';
      if (!form.nombreFirmante.trim()) newErrors.nombreFirmante = 'Requerido';
      if (!form.telefono.trim()) newErrors.telefono = 'Requerido';
      if (!form.correoElectronico.trim()) newErrors.correoElectronico = 'Requerido';
      if (form.solicitanteTipo === 'representante' && !form.nombreRepresentante.trim())
        newErrors.nombreRepresentante = 'Requerido';
    }
    if (s === 4) {
      if (!form.docEscritura) newErrors.docEscritura = 'Requerido';
      if (!form.docIdentificacion) newErrors.docIdentificacion = 'Requerido';
      if (!form.docCroquis) newErrors.docCroquis = 'Requerido';
      if (form.solicitanteTipo === 'representante' && !form.docCartaPoder)
        newErrors.docCartaPoder = 'Requerido';
    }
    if (s === 5) {
      if (!form.aceptaTerminos) newErrors.aceptaTerminos = 'Debes aceptar los términos';
      if (!form.firmaDigital) newErrors.firmaDigital = 'Debes firmar digitalmente';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const next = () => {
    if (validate(step)) setStep((s) => Math.min(s + 1, 5));
  };
  const back = () => setStep((s) => Math.max(s - 1, 1));

  const handleSubmit = () => {
    if (!validate(5)) return;
    // TODO: POST to /portal/tramites/baja-definitiva
    setSubmitted(true);
  };

  // ── Success screen ─────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 className="h-8 w-8 text-green-600" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Solicitud enviada exitosamente</h1>
        <p className="text-gray-500 mb-6">
          Tu solicitud de baja definitiva ha sido recibida. En un plazo máximo de 30 días hábiles recibirás respuesta.
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-6 py-4 inline-flex flex-col items-center gap-1 mb-8">
          <p className="text-xs text-gray-400 uppercase tracking-widest">Folio de seguimiento</p>
          <p className="text-2xl font-mono font-bold text-blue-700">{folio}</p>
          <p className="text-xs text-gray-400">Guarda este número para dar seguimiento a tu trámite</p>
        </div>
        <div>
          <button
            onClick={() => navigate('/portal?tab=tramites-digitales')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors"
          >
            Volver a Trámites
          </button>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────
  const esRepresentante = form.solicitanteTipo === 'representante';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400 mb-4">
        <button onClick={() => navigate('/portal?tab=inicio')} className="hover:text-blue-600 transition-colors">Portal</button>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <button onClick={() => navigate('/portal?tab=tramites-digitales')} className="hover:text-blue-600 transition-colors">Trámites Digitales</button>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span className="text-gray-700 font-medium">Baja Definitiva</span>
      </nav>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-8 w-8 bg-red-100 rounded-lg flex items-center justify-center">
            <Circle className="h-4 w-4 text-red-600 fill-red-600" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Solicitud de Baja Definitiva</h1>
        </div>
        <p className="text-sm text-gray-500 ml-11">
          Cancelación definitiva del contrato de suministro y retiro de medidor · FM-CEA-009
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-8">
        {/* Main card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8">
          <StepIndicator current={step} />

          {/* ── Step 1: Datos del contrato ──────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Datos del Contrato</h2>
                <p className="text-sm text-gray-500">Verifica los datos del contrato que deseas dar de baja.</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field>
                  <Label required>Número de contrato</Label>
                  <Input value={form.numeroContrato} readOnly placeholder="CT001" />
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" aria-hidden /> Pre-llenado desde tu sesión
                  </p>
                </Field>
                <Field>
                  <Label>Número de medidor</Label>
                  <Input
                    value={form.numeroMedidor}
                    onChange={(v) => set('numeroMedidor', v)}
                    placeholder="Ej. M-0012345"
                  />
                </Field>
              </div>

              <Field error={errors.nombreTitular}>
                <Label required>Nombre del titular</Label>
                <Input
                  value={form.nombreTitular}
                  onChange={(v) => set('nombreTitular', v)}
                  placeholder="Nombre completo del titular del contrato"
                />
              </Field>

              <Field error={errors.direccion}>
                <Label required>Dirección del predio</Label>
                <Input
                  value={form.direccion}
                  onChange={(v) => set('direccion', v)}
                  placeholder="Calle, número exterior e interior"
                />
              </Field>

              <Field error={errors.colonia}>
                <Label required>Colonia</Label>
                <Input
                  value={form.colonia}
                  onChange={(v) => set('colonia', v)}
                  placeholder="Nombre de la colonia"
                />
              </Field>
            </div>
          )}

          {/* ── Step 2: Motivo ─────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Motivo de la Baja</h2>
                <p className="text-sm text-gray-500">
                  La baja definitiva solo procede en los casos señalados a continuación.
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-amber-800">
                  Solo procede cuando sea <strong>fusión de predios</strong>, <strong>duplicidad de contrato</strong> o en caso de <strong>local(es) que dejen de funcionar</strong> y se integren a casa habitación.
                </p>
              </div>

              <div>
                <Label required>Tipo de motivo</Label>
                <div className="space-y-2 mt-1">
                  {[
                    { value: 'fusion', label: 'Fusión de predios', desc: 'El predio se une con otro y se integran los servicios.' },
                    { value: 'duplicidad', label: 'Duplicidad de contrato', desc: 'Existe más de un contrato para el mismo predio o toma.' },
                    { value: 'local', label: 'Local que se integra a casa habitación', desc: 'El local comercial o industrial deja de funcionar y pasa a ser uso habitacional.' },
                    { value: 'otro', label: 'Otro motivo', desc: 'Describe el motivo en el campo de abajo.' },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-3 border rounded-xl p-4 cursor-pointer transition-all ${
                        form.tipoMotivo === opt.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="tipoMotivo"
                        value={opt.value}
                        checked={form.tipoMotivo === opt.value}
                        onChange={() => set('tipoMotivo', opt.value as FormData['tipoMotivo'])}
                        className="mt-0.5 accent-blue-600"
                      />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
                {errors.tipoMotivo && <p className="text-xs text-red-500 mt-1">{errors.tipoMotivo}</p>}
              </div>

              <Field error={errors.descripcionMotivo}>
                <Label required>Descripción detallada del motivo</Label>
                <Textarea
                  value={form.descripcionMotivo}
                  onChange={(v) => set('descripcionMotivo', v)}
                  placeholder="Describe con detalle la causa por la que solicitas la baja definitiva del servicio..."
                  rows={5}
                />
              </Field>
            </div>
          )}

          {/* ── Step 3: Solicitante ────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Datos del Solicitante</h2>
                <p className="text-sm text-gray-500">Indica quién realiza este trámite y sus datos de contacto.</p>
              </div>

              <div>
                <Label required>¿Quién realiza el trámite?</Label>
                <div className="grid sm:grid-cols-2 gap-3 mt-1">
                  {[
                    { value: 'propietario', label: 'El propietario del predio', desc: 'Soy el titular del contrato y realizo el trámite personalmente.' },
                    { value: 'representante', label: 'Representante legal / Tercero', desc: 'Actúo en nombre del propietario con poder notarial o carta poder.' },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-3 border rounded-xl p-4 cursor-pointer transition-all ${
                        form.solicitanteTipo === opt.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="solicitanteTipo"
                        value={opt.value}
                        checked={form.solicitanteTipo === opt.value}
                        onChange={() => set('solicitanteTipo', opt.value as FormData['solicitanteTipo'])}
                        className="mt-0.5 accent-blue-600 shrink-0"
                      />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
                {errors.solicitanteTipo && <p className="text-xs text-red-500 mt-1">{errors.solicitanteTipo}</p>}
              </div>

              {/* Datos del representante (si aplica) */}
              {esRepresentante && (
                <div className="border border-blue-100 bg-blue-50/50 rounded-xl p-4 space-y-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Datos del Representante Legal</p>
                  <Field error={errors.nombreRepresentante}>
                    <Label required>Nombre del representante legal</Label>
                    <Input
                      value={form.nombreRepresentante}
                      onChange={(v) => set('nombreRepresentante', v)}
                      placeholder="Nombre completo del representante"
                    />
                  </Field>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field>
                      <Label>Escritura número (personalidad)</Label>
                      <Input
                        value={form.numeroEscritura}
                        onChange={(v) => set('numeroEscritura', v)}
                        placeholder="Núm. de escritura"
                      />
                    </Field>
                    <Field>
                      <Label>Núm. acta constitutiva (empresa)</Label>
                      <Input
                        value={form.numeroActaConstitutiva}
                        onChange={(v) => set('numeroActaConstitutiva', v)}
                        placeholder="Solo si es persona moral"
                      />
                    </Field>
                  </div>
                </div>
              )}

              {/* Datos de contacto */}
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  {esRepresentante ? 'Datos de contacto del representante' : 'Tus datos de contacto'}
                </p>
                <Field error={errors.nombreFirmante}>
                  <Label required>Nombre completo</Label>
                  <Input
                    value={form.nombreFirmante}
                    onChange={(v) => set('nombreFirmante', v)}
                    placeholder="Nombre completo"
                  />
                </Field>
                <Field>
                  <Label>Dirección particular</Label>
                  <Input
                    value={form.direccionParticular}
                    onChange={(v) => set('direccionParticular', v)}
                    placeholder="Calle, número, colonia"
                  />
                </Field>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field error={errors.telefono}>
                    <Label required>Teléfono (con lada)</Label>
                    <Input
                      value={form.telefono}
                      onChange={(v) => set('telefono', v)}
                      placeholder="(442) 000 0000"
                      type="tel"
                    />
                  </Field>
                  <Field error={errors.correoElectronico}>
                    <Label required>Correo electrónico</Label>
                    <Input
                      value={form.correoElectronico}
                      onChange={(v) => set('correoElectronico', v)}
                      placeholder="correo@ejemplo.com"
                      type="email"
                    />
                  </Field>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Documentos ─────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Documentos Requeridos</h2>
                <p className="text-sm text-gray-500">
                  Adjunta los documentos necesarios para ingresar el trámite. Formatos aceptados: PDF, JPG, PNG.
                </p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
                  Todos los solicitantes
                </p>
                <div className="space-y-3">
                  <FileUpload
                    label="Constancia de propiedad o escritura"
                    hint="Original y copia — escritura o predial del predio"
                    required
                    file={form.docEscritura}
                    onChange={(f) => set('docEscritura', f)}
                  />
                  {errors.docEscritura && <p className="text-xs text-red-500 -mt-1">{errors.docEscritura}</p>}

                  <FileUpload
                    label="Identificación oficial del propietario"
                    hint="Copia — INE, pasaporte o cédula profesional"
                    required
                    file={form.docIdentificacion}
                    onChange={(f) => set('docIdentificacion', f)}
                  />
                  {errors.docIdentificacion && <p className="text-xs text-red-500 -mt-1">{errors.docIdentificacion}</p>}

                  <FileUpload
                    label="Croquis de ubicación del predio"
                    hint="Original — sketch o mapa con referencias de calles"
                    required
                    file={form.docCroquis}
                    onChange={(f) => set('docCroquis', f)}
                  />
                  {errors.docCroquis && <p className="text-xs text-red-500 -mt-1">{errors.docCroquis}</p>}
                </div>
              </div>

              {esRepresentante && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
                    Documentos adicionales — Representante legal
                  </p>
                  <div className="space-y-3">
                    <FileUpload
                      label="Carta poder simple"
                      hint="Original — con identificación de 2 testigos (IFE/INE de ambos)"
                      required
                      file={form.docCartaPoder}
                      onChange={(f) => set('docCartaPoder', f)}
                    />
                    {errors.docCartaPoder && <p className="text-xs text-red-500 -mt-1">{errors.docCartaPoder}</p>}

                    <FileUpload
                      label="Identificación oficial del representante"
                      hint="Copia — INE, pasaporte o cédula profesional"
                      file={form.docIdentTestigos}
                      onChange={(f) => set('docIdentTestigos', f)}
                    />

                    <FileUpload
                      label="Poder notarial (persona moral / empresa)"
                      hint="Original y copia — junto con acta constitutiva y RFC"
                      file={form.docPoderNotarial}
                      onChange={(f) => set('docPoderNotarial', f)}
                    />
                  </div>
                </div>
              )}

              <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex items-start gap-2">
                <Info className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-gray-500">
                  Esta solicitud está sujeta a revisión y requiere respuesta por escrito por parte de la institución.
                </p>
              </div>
            </div>
          )}

          {/* ── Step 5: Declaración y firma ────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Declaración y Firma Digital</h2>
                <p className="text-sm text-gray-500">Lee con atención la siguiente declaración antes de firmar.</p>
              </div>

              {/* Resumen */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Resumen de tu solicitud</p>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <div className="flex gap-2"><span className="text-gray-400 shrink-0">Contrato:</span><span className="font-medium text-gray-900">{form.numeroContrato}</span></div>
                  <div className="flex gap-2"><span className="text-gray-400 shrink-0">Titular:</span><span className="font-medium text-gray-900">{form.nombreTitular}</span></div>
                  <div className="flex gap-2"><span className="text-gray-400 shrink-0">Motivo:</span><span className="font-medium text-gray-900 capitalize">{form.tipoMotivo.replace('fusion', 'Fusión de predios').replace('duplicidad', 'Duplicidad de contrato').replace('local', 'Local → casa habitación').replace('otro', 'Otro')}</span></div>
                  <div className="flex gap-2"><span className="text-gray-400 shrink-0">Solicitante:</span><span className="font-medium text-gray-900">{form.nombreFirmante}</span></div>
                </div>
              </div>

              {/* Legal text */}
              <div className="border border-gray-200 rounded-xl p-5 bg-white max-h-56 overflow-y-auto text-xs text-gray-600 leading-relaxed space-y-3">
                <p>
                  Por lo anterior manifiesto y hago constar mi expresa y libre voluntad para solicitar la <strong>baja y cancelación definitiva</strong> de la toma de agua potable y conexión al alcantarillado sanitario.
                </p>
                <p>
                  Es de mi pleno conocimiento y absoluta conformidad que con la autorización de la baja definitiva del contrato se perderán los derechos adquiridos por la contratación de los servicios, incluyendo los derechos de infraestructura.
                </p>
                <p>
                  Por lo que de requerir los servicios nuevamente estoy de acuerdo en cubrir los requisitos que corresponda y realizar el pago de los importes por los conceptos de derechos de infraestructura y contratación a la tarifa vigente, sin reservarme acción o derecho alguno que reclamar ante instancia judicial o administrativa.
                </p>
                <p>
                  Manifiesto mi conformidad para que se practiquen las diligencias de inspección en el inmueble de referencia, para verificar que no se hace uso del servicio que presta esta institución, al amparo del contrato sujeto a la baja definitiva.
                </p>
                <p className="font-medium text-gray-700">
                  Fundamento jurídico: Artículos 3 fracción II, 76 fracción I, 77, 180 y 182 de la Ley que regula la prestación de los servicios de agua potable, alcantarillado y saneamiento del Estado de Querétaro. Artículos 16 y 17 de la Ley de Procedimientos Administrativos del Estado de Querétaro.
                </p>
              </div>

              {/* Checkboxes */}
              <div className="space-y-3">
                <label className={`flex items-start gap-3 border rounded-xl p-4 cursor-pointer transition-all ${form.aceptaTerminos ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                  <input
                    type="checkbox"
                    checked={form.aceptaTerminos}
                    onChange={(e) => set('aceptaTerminos', e.target.checked)}
                    className="mt-0.5 accent-blue-600 h-4 w-4 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">He leído y acepto los términos de la solicitud</p>
                    <p className="text-xs text-gray-500 mt-0.5">Declaro haber leído y comprendido completamente el texto de la solicitud de baja definitiva.</p>
                  </div>
                </label>
                {errors.aceptaTerminos && <p className="text-xs text-red-500">{errors.aceptaTerminos}</p>}

                <label className={`flex items-start gap-3 border rounded-xl p-4 cursor-pointer transition-all ${form.firmaDigital ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                  <input
                    type="checkbox"
                    checked={form.firmaDigital}
                    onChange={(e) => set('firmaDigital', e.target.checked)}
                    className="mt-0.5 accent-blue-600 h-4 w-4 shrink-0"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Firmo digitalmente esta solicitud</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Al marcar esta casilla y enviar el formulario, <strong>{form.nombreFirmante || 'el solicitante'}</strong> acepta que este acto constituye su firma digital en sustitución de la firma autógrafa, con plena validez legal conforme a la normativa aplicable.
                    </p>
                  </div>
                </label>
                {errors.firmaDigital && <p className="text-xs text-red-500">{errors.firmaDigital}</p>}
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-5 border-t border-gray-100">
            <button
              onClick={step === 1 ? () => navigate('/portal?tab=tramites-digitales') : back}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors px-3 py-2 rounded-lg hover:bg-gray-100"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {step === 1 ? 'Cancelar' : 'Anterior'}
            </button>

            <div className="flex items-center gap-1">
              {STEPS.map((s) => (
                <div
                  key={s.number}
                  className={`h-1.5 rounded-full transition-all ${
                    s.number === step ? 'w-6 bg-blue-600' : s.number < step ? 'w-2 bg-blue-300' : 'w-2 bg-gray-200'
                  }`}
                />
              ))}
            </div>

            {step < 5 ? (
              <button
                onClick={next}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                Siguiente
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Enviar Solicitud
              </button>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <InfoSidebar />
      </div>
    </div>
  );
};

export default TramiteBajaDefinitiva;
