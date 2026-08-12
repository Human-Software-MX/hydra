import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { PortalContextValue } from '@/components/PortalLayout';
import {
  StepIndicator,
  StepDots,
  Field,
  Label,
  FieldError,
  TextInput,
  TextArea,
  RadioCard,
  CheckCard,
  FileUpload,
  SectionLabel,
} from './tramite-ui';
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  Info,
  Clock,
  Banknote,
  ShieldCheck,
  FileSearch,
  PauseCircle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoInmueble = 'casa' | 'local' | 'obra_negra' | 'predio_baldio' | 'otro' | '';
type SolicitanteTipo = 'titular' | 'representante' | '';

interface FormData {
  // Step 1
  numeroContrato: string;
  numeroMedidor: string;
  nombreTitular: string;
  direccion: string;
  colonia: string;
  // Step 2
  tipoInmueble: TipoInmueble;
  tipoInmuebleOtro: string;
  motivoDescripcion: string;
  // Step 3
  solicitanteTipo: SolicitanteTipo;
  nombreFirmante: string;
  direccionParticular: string;
  telefono: string;
  correoElectronico: string;
  nombreRepresentante: string;
  numeroEscritura: string;
  numeroActaConstitutiva: string;
  // Step 4
  docIdentificacion: File | null;
  docCroquis: File | null;
  docEscritura: File | null;
  docCartaPoder: File | null;
  docIdentTestigos: File | null;
  docActaRFC: File | null;
  // Step 5
  aceptaCuota0m3: boolean;
  aceptaTerminos: boolean;
  firmaDigital: boolean;
}

const INITIAL: FormData = {
  numeroContrato: '',
  numeroMedidor: '',
  nombreTitular: '',
  direccion: '',
  colonia: '',
  tipoInmueble: '',
  tipoInmuebleOtro: '',
  motivoDescripcion: '',
  solicitanteTipo: '',
  nombreFirmante: '',
  direccionParticular: '',
  telefono: '',
  correoElectronico: '',
  nombreRepresentante: '',
  numeroEscritura: '',
  numeroActaConstitutiva: '',
  docIdentificacion: null,
  docCroquis: null,
  docEscritura: null,
  docCartaPoder: null,
  docIdentTestigos: null,
  docActaRFC: null,
  aceptaCuota0m3: false,
  aceptaTerminos: false,
  firmaDigital: false,
};

const TOTAL_STEPS = 5;

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function InfoSidebar() {
  return (
    <aside className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Información del trámite</h3>

        {[
          { Icon: Clock, title: 'Plazo máximo de respuesta', body: '30 días hábiles' },
          { Icon: Banknote, title: 'Cantidad a pagar', body: 'Gratuito' },
          { Icon: ShieldCheck, title: 'Vigencia del documento', body: 'Temporal' },
        ].map(({ Icon, title, body }, i, arr) => (
          <div key={title} className={`flex items-start gap-3 ${i < arr.length - 1 ? 'pb-4 border-b border-gray-100' : ''}`}>
            <div className="h-9 w-9 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-gray-500" aria-hidden />
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-700">{title}</p>
              <p className="text-sm text-gray-700 mt-0.5">{body}</p>
            </div>
          </div>
        ))}

        <div className="flex items-start gap-3 pt-4 border-t border-gray-100">
          <div className="h-9 w-9 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center shrink-0">
            <FileSearch className="h-4 w-4 text-gray-500" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Inspección</p>
            <p className="text-sm text-gray-600 mt-0.5">
              Se realizará el retiro temporal de la toma para proceder a la baja del contrato de servicios integrales.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-amber-800 mb-2">Criterios de resolución</p>
            <ul className="text-xs text-amber-700 space-y-2 list-disc list-inside">
              <li>Deberás pagar la cuota de <strong>0 m³</strong> mensual para conservar los derechos del contrato.</li>
              <li>Si el predio es baldío, el número oficial debe estar visible para la inspección.</li>
              <li>Al reanudar el servicio, cubrirás los costos de reconexión de toma y medidor.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-blue-800 mb-1">Contacto</p>
            <p className="text-xs text-blue-700">
              <strong>Adriana Fabiola García Olvera</strong><br />
              Gerente de Facturación<br />
              (442) 689 1733
            </p>
            <p className="text-xs text-blue-700 mt-1">
              Seguimiento: Karina Lugo<br />
              (442) 211 0600 Ext. 1212
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TramiteBajaTemporal = () => {
  const { contratos, contratoId } = useOutletContext<PortalContextValue>();
  const navigate = useNavigate();
  const contrato = contratos.find((c) => c.id === contratoId) ?? null;

  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [folio] = useState(() => `BT-${Date.now().toString(36).toUpperCase()}`);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const [form, setForm] = useState<FormData>({
    ...INITIAL,
    numeroContrato: contrato?.id ?? '',
    nombreTitular: contrato?.nombre ?? '',
    direccion: contrato?.direccion ?? '',
  });

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const esTitular = form.solicitanteTipo === 'titular';
  const esRepresentante = form.solicitanteTipo === 'representante';

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = (s: number) => {
    const e: typeof errors = {};
    if (s === 1) {
      if (!form.numeroContrato.trim()) e.numeroContrato = 'Requerido';
      if (!form.nombreTitular.trim()) e.nombreTitular = 'Requerido';
      if (!form.direccion.trim()) e.direccion = 'Requerido';
      if (!form.colonia.trim()) e.colonia = 'Requerido';
    }
    if (s === 2) {
      if (!form.tipoInmueble) e.tipoInmueble = 'Selecciona el tipo de inmueble';
      if (form.tipoInmueble === 'otro' && !form.tipoInmuebleOtro.trim()) e.tipoInmuebleOtro = 'Especifica el tipo de inmueble';
      if (!form.motivoDescripcion.trim()) e.motivoDescripcion = 'Describe el motivo de la baja temporal';
    }
    if (s === 3) {
      if (!form.solicitanteTipo) e.solicitanteTipo = 'Indica quién realiza el trámite';
      if (!form.nombreFirmante.trim()) e.nombreFirmante = 'Requerido';
      if (!form.telefono.trim()) e.telefono = 'Requerido';
      if (!form.correoElectronico.trim()) e.correoElectronico = 'Requerido';
      if (esRepresentante && !form.nombreRepresentante.trim()) e.nombreRepresentante = 'Requerido';
    }
    if (s === 4) {
      if (esTitular) {
        if (!form.docIdentificacion) e.docIdentificacion = 'Requerido';
        if (!form.docCroquis) e.docCroquis = 'Requerido';
      }
      if (esRepresentante) {
        if (!form.docEscritura) e.docEscritura = 'Requerido';
        if (!form.docCartaPoder) e.docCartaPoder = 'Requerido';
        if (!form.docIdentTestigos) e.docIdentTestigos = 'Requerido';
      }
    }
    if (s === 5) {
      if (!form.aceptaCuota0m3) e.aceptaCuota0m3 = 'Debes confirmar tu conformidad con la cuota mensual';
      if (!form.aceptaTerminos) e.aceptaTerminos = 'Debes aceptar los términos';
      if (!form.firmaDigital) e.firmaDigital = 'Debes firmar digitalmente';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => { if (validate(step)) setStep((s) => Math.min(s + 1, TOTAL_STEPS)); };
  const back = () => setStep((s) => Math.max(s - 1, 1));
  const handleSubmit = () => { if (validate(5)) setSubmitted(true); };

  // ── Success screen ──────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <PauseCircle className="h-8 w-8 text-blue-600" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Solicitud enviada exitosamente</h1>
        <p className="text-gray-500 mb-6 max-w-md mx-auto">
          Tu solicitud de baja temporal ha sido recibida. Recibirás respuesta en un plazo máximo de <strong>30 días hábiles</strong>. Recuerda que deberás pagar la cuota de 0 m³ mensual para conservar tus derechos.
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-6 py-4 inline-flex flex-col items-center gap-1 mb-8">
          <p className="text-xs text-gray-400 uppercase tracking-widest">Folio de seguimiento</p>
          <p className="text-2xl font-mono font-bold text-blue-700">{folio}</p>
          <p className="text-xs text-gray-400">Guarda este número para dar seguimiento</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={() => navigate('/portal?tab=tramites-digitales')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors"
          >
            Volver a Trámites
          </button>
          <button
            onClick={() => navigate('/portal?tab=inicio')}
            className="border border-gray-200 text-gray-700 hover:bg-gray-50 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors"
          >
            Ir al Inicio
          </button>
        </div>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400 mb-4">
        <button onClick={() => navigate('/portal?tab=inicio')} className="hover:text-blue-600 transition-colors">Portal</button>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <button onClick={() => navigate('/portal?tab=tramites-digitales')} className="hover:text-blue-600 transition-colors">Trámites Digitales</button>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span className="text-gray-700 font-medium">Baja Temporal</span>
      </nav>

      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-8 w-8 bg-orange-100 rounded-lg flex items-center justify-center">
            <PauseCircle className="h-5 w-5 text-orange-600" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Solicitud de Baja Temporal</h1>
        </div>
        <p className="text-sm text-gray-500 ml-11">
          Suspensión provisional del servicio por no utilizarlo temporalmente · FM-CEA-010
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-8">
        {/* Form card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8">
          <StepIndicator current={step} />

          {/* ── Step 1: Datos del contrato ──────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Datos del Contrato</h2>
                <p className="text-sm text-gray-500">Verifica los datos del contrato que deseas suspender temporalmente.</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field error={errors.numeroContrato}>
                  <Label required>Número de contrato</Label>
                  <TextInput
                    value={form.numeroContrato}
                    readOnly
                    hint="Pre-llenado desde tu sesión activa"
                  />
                </Field>
                <Field>
                  <Label>Número de medidor</Label>
                  <TextInput
                    value={form.numeroMedidor}
                    onChange={(v) => set('numeroMedidor', v)}
                    placeholder="Ej. M-0012345"
                  />
                </Field>
              </div>

              <Field error={errors.nombreTitular}>
                <Label required>Nombre del titular</Label>
                <TextInput
                  value={form.nombreTitular}
                  onChange={(v) => set('nombreTitular', v)}
                  placeholder="Nombre completo del titular"
                />
              </Field>

              <Field error={errors.direccion}>
                <Label required>Dirección del predio</Label>
                <TextInput
                  value={form.direccion}
                  onChange={(v) => set('direccion', v)}
                  placeholder="Calle, número exterior e interior"
                />
              </Field>

              <Field error={errors.colonia}>
                <Label required>Colonia</Label>
                <TextInput
                  value={form.colonia}
                  onChange={(v) => set('colonia', v)}
                  placeholder="Nombre de la colonia"
                />
              </Field>
            </div>
          )}

          {/* ── Step 2: Tipo de inmueble + Motivo ───────────────────────────── */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Tipo de Inmueble y Motivo</h2>
                <p className="text-sm text-gray-500">Indica el tipo de inmueble y por qué no utilizarás el servicio temporalmente.</p>
              </div>

              {/* Tipo de inmueble */}
              <div>
                <Label required>Tipo de inmueble</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
                  {[
                    { value: 'casa', label: '🏠 Casa' },
                    { value: 'local', label: '🏪 Local' },
                    { value: 'obra_negra', label: '🏗️ Obra Negra' },
                    { value: 'predio_baldio', label: '🌿 Predio Baldío' },
                    { value: 'otro', label: '📋 Otro' },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 cursor-pointer transition-all text-sm font-medium ${
                        form.tipoInmueble === opt.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="tipoInmueble"
                        value={opt.value}
                        checked={form.tipoInmueble === opt.value}
                        onChange={() => set('tipoInmueble', opt.value as TipoInmueble)}
                        className="accent-blue-600"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <FieldError msg={errors.tipoInmueble} />
              </div>

              {/* Campo "Otro" */}
              {form.tipoInmueble === 'otro' && (
                <Field error={errors.tipoInmuebleOtro}>
                  <Label required>Especifica el tipo de inmueble</Label>
                  <TextInput
                    value={form.tipoInmuebleOtro}
                    onChange={(v) => set('tipoInmuebleOtro', v)}
                    placeholder="Describe el tipo de inmueble"
                  />
                </Field>
              )}

              {/* Predio baldío warning */}
              {form.tipoInmueble === 'predio_baldio' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                  <p className="text-xs text-amber-800">
                    Para predios baldíos, el <strong>número oficial debe estar visible</strong> en el predio al momento de la visita de inspección.
                  </p>
                </div>
              )}

              {/* Motivo */}
              <Field error={errors.motivoDescripcion}>
                <Label required>Motivo de la baja temporal</Label>
                <p className="text-xs text-gray-400 mb-1.5">Describe por qué no harás uso temporalmente del servicio de agua potable.</p>
                <TextArea
                  value={form.motivoDescripcion}
                  onChange={(v) => set('motivoDescripcion', v)}
                  placeholder="Ej. El inmueble estará sin ocupantes durante los próximos meses por remodelación / viaje prolongado / venta del predio..."
                  rows={5}
                />
              </Field>
            </div>
          )}

          {/* ── Step 3: Solicitante ─────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Datos del Solicitante</h2>
                <p className="text-sm text-gray-500">Indica quién realiza este trámite.</p>
              </div>

              <div>
                <Label required>¿Quién realiza el trámite?</Label>
                <div className="grid sm:grid-cols-2 gap-3 mt-1">
                  <RadioCard
                    name="solicitanteTipo"
                    value="titular"
                    checked={form.solicitanteTipo === 'titular'}
                    onChange={() => set('solicitanteTipo', 'titular')}
                    label="El titular del contrato"
                    desc="Soy el propietario y realizo el trámite personalmente."
                  />
                  <RadioCard
                    name="solicitanteTipo"
                    value="representante"
                    checked={form.solicitanteTipo === 'representante'}
                    onChange={() => set('solicitanteTipo', 'representante')}
                    label="Representante legal / Tercero"
                    desc="Actúo en nombre del titular con carta poder o poder notarial."
                  />
                </div>
                <FieldError msg={errors.solicitanteTipo} />
              </div>

              {/* Datos del representante */}
              {esRepresentante && (
                <div className="border border-blue-100 bg-blue-50/50 rounded-xl p-4 space-y-4">
                  <SectionLabel>Datos del representante legal</SectionLabel>
                  <Field error={errors.nombreRepresentante}>
                    <Label required>Nombre del representante legal</Label>
                    <TextInput
                      value={form.nombreRepresentante}
                      onChange={(v) => set('nombreRepresentante', v)}
                      placeholder="Nombre completo del representante"
                    />
                  </Field>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field>
                      <Label>Escritura número (personalidad)</Label>
                      <TextInput
                        value={form.numeroEscritura}
                        onChange={(v) => set('numeroEscritura', v)}
                        placeholder="Núm. de escritura"
                      />
                    </Field>
                    <Field>
                      <Label>Núm. acta constitutiva (empresa)</Label>
                      <TextInput
                        value={form.numeroActaConstitutiva}
                        onChange={(v) => set('numeroActaConstitutiva', v)}
                        placeholder="Solo si es persona moral"
                      />
                    </Field>
                  </div>
                </div>
              )}

              {/* Datos de contacto */}
              {form.solicitanteTipo && (
                <div className="space-y-4">
                  <SectionLabel>
                    {esRepresentante ? 'Datos de contacto del representante' : 'Tus datos de contacto'}
                  </SectionLabel>
                  <Field error={errors.nombreFirmante}>
                    <Label required>Nombre completo</Label>
                    <TextInput
                      value={form.nombreFirmante}
                      onChange={(v) => set('nombreFirmante', v)}
                      placeholder="Nombre completo"
                    />
                  </Field>
                  <Field>
                    <Label>Dirección particular</Label>
                    <TextInput
                      value={form.direccionParticular}
                      onChange={(v) => set('direccionParticular', v)}
                      placeholder="Calle, número, colonia"
                    />
                  </Field>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field error={errors.telefono}>
                      <Label required>Teléfono (con lada)</Label>
                      <TextInput
                        value={form.telefono}
                        onChange={(v) => set('telefono', v)}
                        placeholder="(442) 000 0000"
                        type="tel"
                      />
                    </Field>
                    <Field error={errors.correoElectronico}>
                      <Label required>Correo electrónico</Label>
                      <TextInput
                        value={form.correoElectronico}
                        onChange={(v) => set('correoElectronico', v)}
                        placeholder="correo@ejemplo.com"
                        type="email"
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Documentos ──────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Documentos Requeridos</h2>
                <p className="text-sm text-gray-500">Adjunta los documentos necesarios. Formatos: PDF, JPG, PNG.</p>
              </div>

              {/* Titular */}
              {esTitular && (
                <div className="space-y-3">
                  <SectionLabel>Documentos para titular del contrato</SectionLabel>

                  <FileUpload
                    label="Identificación oficial"
                    hint="Copia — INE, pasaporte o cédula profesional"
                    required
                    file={form.docIdentificacion}
                    onChange={(f) => set('docIdentificacion', f)}
                  />
                  <FieldError msg={errors.docIdentificacion} />

                  <FileUpload
                    label="Croquis de ubicación del predio"
                    hint="Original — sketch o mapa con referencias de calles"
                    required
                    file={form.docCroquis}
                    onChange={(f) => set('docCroquis', f)}
                  />
                  <FieldError msg={errors.docCroquis} />

                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-xs text-blue-700 font-medium">
                      Debes estar al corriente de tus pagos (sin adeudos) al momento de presentar la solicitud.
                    </p>
                  </div>
                </div>
              )}

              {/* Representante */}
              {esRepresentante && (
                <div className="space-y-3">
                  <SectionLabel>Documentos adicionales — Representante legal</SectionLabel>

                  <FileUpload
                    label="Constancia de propiedad o escritura"
                    hint="Original y copia — escritura o predial del predio"
                    required
                    file={form.docEscritura}
                    onChange={(f) => set('docEscritura', f)}
                  />
                  <FieldError msg={errors.docEscritura} />

                  <FileUpload
                    label="Carta poder simple con firma de 2 testigos"
                    hint="Original — con identificación oficial del dueño y ambos testigos (INE/IFE)"
                    required
                    file={form.docCartaPoder}
                    onChange={(f) => set('docCartaPoder', f)}
                  />
                  <FieldError msg={errors.docCartaPoder} />

                  <FileUpload
                    label="Identificación oficial del dueño del predio y testigos"
                    hint="Copia — INE/IFE de los 3 (dueño + 2 testigos)"
                    required
                    file={form.docIdentTestigos}
                    onChange={(f) => set('docIdentTestigos', f)}
                  />
                  <FieldError msg={errors.docIdentTestigos} />

                  <FileUpload
                    label="Documentos de empresa (si aplica)"
                    hint="Acta constitutiva + RFC + poder del Representante Legal"
                    file={form.docActaRFC}
                    onChange={(f) => set('docActaRFC', f)}
                  />
                </div>
              )}

              <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex items-start gap-2">
                <Info className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-gray-500">
                  Esta solicitud está sujeta a revisión y requiere respuesta por escrito de la institución.
                </p>
              </div>
            </div>
          )}

          {/* ── Step 5: Declaración y firma ─────────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Declaración y Firma Digital</h2>
                <p className="text-sm text-gray-500">Lee con atención antes de firmar.</p>
              </div>

              {/* Resumen */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                <SectionLabel>Resumen de tu solicitud</SectionLabel>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  {[
                    ['Contrato', form.numeroContrato],
                    ['Titular', form.nombreTitular],
                    ['Inmueble', form.tipoInmueble === 'otro' ? form.tipoInmuebleOtro : { casa: 'Casa', local: 'Local', obra_negra: 'Obra Negra', predio_baldio: 'Predio Baldío' }[form.tipoInmueble] ?? '—'],
                    ['Solicitante', form.nombreFirmante],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-gray-400 shrink-0">{k}:</span>
                      <span className="font-medium text-gray-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Legal text */}
              <div className="border border-gray-200 rounded-xl p-5 bg-white max-h-52 overflow-y-auto text-xs text-gray-600 leading-relaxed space-y-3">
                <p>
                  Por medio del presente solicito la <strong>baja temporal</strong> del servicio de agua potable, ya que en este momento no tendrá ningún uso.
                </p>
                <p>
                  En virtud de lo anterior y toda vez que deseo conservar los derechos adquiridos por la contratación de los servicios, solicito desconecten la toma de agua potable y servicios de alcantarillado, hasta en tanto requiera nuevamente de los mismos, estando de acuerdo en cubrir los costos de materiales y mano de obra que se eroguen.
                </p>
                <p>
                  Manifiesto mi conformidad de pagar el importe correspondiente a la <strong>cuota de 0 M3</strong> o su equivalente que se encuentre vigente en las tarifas de la Comisión Estatal de Aguas, por el mantenimiento de la infraestructura hidráulica de acuerdo al uso y zona socioeconómica en que se ubica el predio.
                </p>
                <p>
                  En caso de que se requiera nuevamente el servicio de Agua Potable, lo haré saber con toda oportunidad para que me sea reinstalado, y cubriré los costos que se me indiquen.
                </p>
                <p className="font-medium text-gray-700">
                  Fundamento jurídico: Artículos 3 fracción II, 71 fracción II, 77, 180 y 182 fracción VI, Ley que regula la prestación de los servicios de agua potable, alcantarillado y saneamiento del Estado de Querétaro. Artículos 16 y 17 de la Ley de Procedimientos Administrativos del Estado de Querétaro.
                </p>
              </div>

              {/* Checkboxes */}
              <div className="space-y-3">
                <CheckCard
                  checked={form.aceptaCuota0m3}
                  onChange={(v) => set('aceptaCuota0m3', v)}
                  label="Acepto el pago de la cuota mensual de 0 m³"
                  desc="Entiendo que deberé cubrir mensualmente la cuota mínima de 0 m³ para conservar los derechos de mi contrato durante la baja temporal."
                />
                <FieldError msg={errors.aceptaCuota0m3} />

                <CheckCard
                  checked={form.aceptaTerminos}
                  onChange={(v) => set('aceptaTerminos', v)}
                  label="He leído y acepto los términos de la solicitud"
                  desc="Declaro haber leído y comprendido completamente la declaración de baja temporal del servicio."
                />
                <FieldError msg={errors.aceptaTerminos} />

                <CheckCard
                  checked={form.firmaDigital}
                  onChange={(v) => set('firmaDigital', v)}
                  label="Firmo digitalmente esta solicitud"
                  desc={`Al marcar esta casilla y enviar, ${form.nombreFirmante || 'el solicitante'} acepta que este acto constituye su firma digital en sustitución de la firma autógrafa, con plena validez legal.`}
                />
                <FieldError msg={errors.firmaDigital} />
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-5 border-t border-gray-100">
            <button
              onClick={step === 1 ? () => navigate('/portal?tab=tramites-digitales') : back}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {step === 1 ? 'Cancelar' : 'Anterior'}
            </button>

            <StepDots current={step} total={TOTAL_STEPS} />

            {step < TOTAL_STEPS ? (
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

        <InfoSidebar />
      </div>
    </div>
  );
};

export default TramiteBajaTemporal;
