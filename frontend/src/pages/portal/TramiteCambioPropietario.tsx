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
  Banknote,
  ShieldCheck,
  Clock,
  UserCheck,
  Building2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type CausaCambio = 'compraventa' | 'herencia' | 'donacion' | 'otro' | '';
type TipoPersona = 'fisica' | 'moral' | '';
type TramitadoPor = 'nuevo_propietario' | 'tercero' | '';

interface FormData {
  // Step 1 – Contrato actual
  numeroContrato: string;
  nombreTitularActual: string;
  direccionPredio: string;
  colonia: string;

  // Step 2 – Causa del cambio
  causaCambio: CausaCambio;
  causaOtroDesc: string;

  // Step 3 – Nuevo propietario
  tipoPersona: TipoPersona;
  // Persona física
  nombreNuevoPropietario: string;
  curpNuevoPropietario: string;
  rfcNuevoPropietario: string;
  telefonoNuevo: string;
  correoNuevo: string;
  direccionParticularNuevo: string;
  // Persona moral
  razonSocial: string;
  rfcEmpresa: string;
  nombreRepLegal: string;
  telefonoRepLegal: string;
  correoRepLegal: string;

  // Step 4 – Quien tramita + Documentos
  tramitadoPor: TramitadoPor;
  nombreTercero: string;
  telefonoTercero: string;
  docIdNuevoPropietario: File | null;
  docPropiedad: File | null;
  docCartaPoder: File | null;
  docActaConstitutiva: File | null;
  docPoderNotarial: File | null;

  // Step 5 – Pago y firma
  aceptaPago: boolean;
  confirmaCoincidencia: boolean;
  firmaDigital: boolean;
}

const INITIAL: FormData = {
  numeroContrato: '',
  nombreTitularActual: '',
  direccionPredio: '',
  colonia: '',
  causaCambio: '',
  causaOtroDesc: '',
  tipoPersona: '',
  nombreNuevoPropietario: '',
  curpNuevoPropietario: '',
  rfcNuevoPropietario: '',
  telefonoNuevo: '',
  correoNuevo: '',
  direccionParticularNuevo: '',
  razonSocial: '',
  rfcEmpresa: '',
  nombreRepLegal: '',
  telefonoRepLegal: '',
  correoRepLegal: '',
  tramitadoPor: '',
  nombreTercero: '',
  telefonoTercero: '',
  docIdNuevoPropietario: null,
  docPropiedad: null,
  docCartaPoder: null,
  docActaConstitutiva: null,
  docPoderNotarial: null,
  aceptaPago: false,
  confirmaCoincidencia: false,
  firmaDigital: false,
};

const TOTAL_STEPS = 5;
const STEP_LABELS = ['Contrato', 'Causa', 'Nuevo dueño', 'Documentos', 'Confirmación'];

const IVA = 0.16;
const COSTO_BASE = 175;
const COSTO_TOTAL = COSTO_BASE * (1 + IVA);

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function InfoSidebar() {
  return (
    <aside className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Información del trámite</h3>

        <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
          <div className="h-9 w-9 bg-green-50 border border-green-200 rounded-lg flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4 text-green-600" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Plazo de respuesta</p>
            <p className="text-sm font-bold text-green-700">Inmediato</p>
          </div>
        </div>

        <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
          <div className="h-9 w-9 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-center shrink-0">
            <Banknote className="h-4 w-4 text-amber-600" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Costo del trámite</p>
            <p className="text-base font-bold text-gray-900">${COSTO_BASE}.00 <span className="text-xs font-normal text-gray-500">+ IVA</span></p>
            <p className="text-xs text-gray-500 mt-0.5">Total: <strong>${COSTO_TOTAL.toFixed(2)} MXN</strong></p>
            <p className="text-xs text-gray-400 mt-0.5">Pago en cajas CEA al presentar solicitud</p>
          </div>
        </div>

        <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
          <div className="h-9 w-9 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center shrink-0">
            <ShieldCheck className="h-4 w-4 text-gray-500" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Vigencia del documento</p>
            <p className="text-sm text-gray-700">Permanente</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="h-9 w-9 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center shrink-0">
            <UserCheck className="h-4 w-4 text-gray-500" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Inspección</p>
            <p className="text-sm text-gray-600">No requiere inspección.</p>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-amber-800 mb-1.5">Criterio de resolución</p>
            <p className="text-xs text-amber-700">
              Deberán <strong>coincidir el domicilio</strong>, la constancia de propiedad y el recibo de agua para que el trámite proceda.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-blue-800 mb-1">Contacto</p>
            <p className="text-xs text-blue-700">
              <strong>Mario Pérez Zamorano</strong><br />
              Gerente de Contratación y Padrón<br />
              442 211 0600 Ext. 1267<br />
              mperezz@ceaqueretaro.gob.mx
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TramiteCambioPropietario = () => {
  const { contratos, contratoId } = useOutletContext<PortalContextValue>();
  const navigate = useNavigate();
  const contrato = contratos.find((c) => c.id === contratoId) ?? null;

  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [folio] = useState(() => `CP-${Date.now().toString(36).toUpperCase()}`);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const [form, setForm] = useState<FormData>({
    ...INITIAL,
    numeroContrato: contrato?.id ?? '',
    nombreTitularActual: contrato?.nombre ?? '',
    direccionPredio: contrato?.direccion ?? '',
  });

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const esMoral = form.tipoPersona === 'moral';
  const esTercero = form.tramitadoPor === 'tercero';

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = (s: number) => {
    const e: typeof errors = {};
    if (s === 1) {
      if (!form.numeroContrato.trim()) e.numeroContrato = 'Requerido';
      if (!form.nombreTitularActual.trim()) e.nombreTitularActual = 'Requerido';
      if (!form.direccionPredio.trim()) e.direccionPredio = 'Requerido';
    }
    if (s === 2) {
      if (!form.causaCambio) e.causaCambio = 'Selecciona la causa del cambio';
      if (form.causaCambio === 'otro' && !form.causaOtroDesc.trim()) e.causaOtroDesc = 'Describe la causa';
    }
    if (s === 3) {
      if (!form.tipoPersona) e.tipoPersona = 'Indica el tipo de persona';
      if (!esMoral) {
        if (!form.nombreNuevoPropietario.trim()) e.nombreNuevoPropietario = 'Requerido';
        if (!form.telefonoNuevo.trim()) e.telefonoNuevo = 'Requerido';
        if (!form.correoNuevo.trim()) e.correoNuevo = 'Requerido';
      } else {
        if (!form.razonSocial.trim()) e.razonSocial = 'Requerido';
        if (!form.rfcEmpresa.trim()) e.rfcEmpresa = 'Requerido';
        if (!form.nombreRepLegal.trim()) e.nombreRepLegal = 'Requerido';
        if (!form.telefonoRepLegal.trim()) e.telefonoRepLegal = 'Requerido';
      }
    }
    if (s === 4) {
      if (!form.tramitadoPor) e.tramitadoPor = 'Indica quién realizará el trámite';
      if (!form.docIdNuevoPropietario) e.docIdNuevoPropietario = 'Requerido';
      if (!form.docPropiedad) e.docPropiedad = 'Requerido';
      if (esTercero && !form.docCartaPoder) e.docCartaPoder = 'Requerido para trámite por tercero';
      if (esMoral && !form.docActaConstitutiva) e.docActaConstitutiva = 'Requerido para persona moral';
      if (esMoral && !form.docPoderNotarial) e.docPoderNotarial = 'Requerido para persona moral';
    }
    if (s === 5) {
      if (!form.aceptaPago) e.aceptaPago = 'Debes confirmar el pago';
      if (!form.confirmaCoincidencia) e.confirmaCoincidencia = 'Debes confirmar la coincidencia de datos';
      if (!form.firmaDigital) e.firmaDigital = 'Debes firmar digitalmente';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => { if (validate(step)) setStep((s) => Math.min(s + 1, TOTAL_STEPS)); };
  const back = () => setStep((s) => Math.max(s - 1, 1));
  const handleSubmit = () => { if (validate(5)) setSubmitted(true); };

  // ── Success ─────────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <UserCheck className="h-8 w-8 text-green-600" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Solicitud enviada</h1>
        <p className="text-gray-500 mb-2 max-w-md mx-auto">
          Tu solicitud de cambio de propietario ha sido registrada. Al ser un trámite de <strong>resolución inmediata</strong>, acude a las oficinas CEA con tu documentación y comprobante de pago.
        </p>

        {/* Payment reminder */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-6 text-left max-w-md mx-auto">
          <div className="flex items-start gap-3">
            <Banknote className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="text-sm font-bold text-amber-800">Recuerda realizar el pago</p>
              <p className="text-sm text-amber-700 mt-0.5">
                <strong>${COSTO_TOTAL.toFixed(2)} MXN</strong> (${COSTO_BASE}.00 + IVA) en cajas de la CEA al presentar tu solicitud.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl px-6 py-4 inline-flex flex-col items-center gap-1 mb-8">
          <p className="text-xs text-gray-400 uppercase tracking-widest">Folio de seguimiento</p>
          <p className="text-2xl font-mono font-bold text-blue-700">{folio}</p>
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
        <span className="text-gray-700 font-medium">Cambio de Propietario</span>
      </nav>

      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-8 w-8 bg-blue-100 rounded-lg flex items-center justify-center">
            <UserCheck className="h-5 w-5 text-blue-600" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Cambio de Propietario</h1>
        </div>
        <p className="text-sm text-gray-500 ml-11">
          Actualización del titular del contrato de servicios integrales de agua · Resolución inmediata
        </p>
      </div>

      {/* Cost banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center gap-3 mb-6">
        <Banknote className="h-5 w-5 text-amber-600 shrink-0" aria-hidden />
        <p className="text-sm text-amber-800">
          Este trámite tiene un costo de <strong>${COSTO_BASE}.00 + IVA (${COSTO_TOTAL.toFixed(2)} MXN)</strong>. El pago se realiza en cajas de la CEA al presentar la documentación.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-8">
        <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8">
          <StepIndicator current={step} labels={STEP_LABELS} />

          {/* ── Step 1: Contrato actual ─────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Datos del Contrato Actual</h2>
                <p className="text-sm text-gray-500">Información del contrato que cambiará de titular.</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field error={errors.numeroContrato}>
                  <Label required>Número de contrato</Label>
                  <TextInput value={form.numeroContrato} readOnly hint="Pre-llenado desde tu sesión" />
                </Field>
                <Field error={errors.nombreTitularActual}>
                  <Label required>Nombre del titular actual</Label>
                  <TextInput value={form.nombreTitularActual} onChange={(v) => set('nombreTitularActual', v)} placeholder="Titular registrado en el contrato" />
                </Field>
              </div>

              <Field error={errors.direccionPredio}>
                <Label required>Dirección del predio</Label>
                <TextInput value={form.direccionPredio} onChange={(v) => set('direccionPredio', v)} placeholder="Calle, número exterior e interior" />
              </Field>

              <Field>
                <Label>Colonia</Label>
                <TextInput value={form.colonia} onChange={(v) => set('colonia', v)} placeholder="Nombre de la colonia" />
              </Field>

              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-blue-700">
                  El domicilio del contrato deberá coincidir con la constancia de propiedad y el recibo de agua del nuevo propietario para que el trámite proceda.
                </p>
              </div>
            </div>
          )}

          {/* ── Step 2: Causa del cambio ────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Causa del Cambio</h2>
                <p className="text-sm text-gray-500">¿Por qué se realiza el cambio de propietario?</p>
              </div>

              <div>
                <Label required>Motivo del cambio</Label>
                <div className="space-y-2 mt-1">
                  {[
                    { value: 'compraventa', label: 'Compra-Venta', desc: 'El predio fue vendido a un nuevo propietario mediante contrato o escritura.' },
                    { value: 'herencia', label: 'Herencia', desc: 'El predio fue heredado al nuevo propietario por fallecimiento del titular anterior.' },
                    { value: 'donacion', label: 'Donación', desc: 'El predio fue donado al nuevo propietario mediante acto notarial.' },
                    { value: 'otro', label: 'Otro motivo', desc: 'Otro acto jurídico que transfiere la propiedad o posesión del predio.' },
                  ].map((opt) => (
                    <RadioCard
                      key={opt.value}
                      name="causaCambio"
                      value={opt.value}
                      checked={form.causaCambio === opt.value}
                      onChange={() => set('causaCambio', opt.value as CausaCambio)}
                      label={opt.label}
                      desc={opt.desc}
                    />
                  ))}
                </div>
                <FieldError msg={errors.causaCambio} />
              </div>

              {form.causaCambio === 'otro' && (
                <Field error={errors.causaOtroDesc}>
                  <Label required>Describe el motivo</Label>
                  <TextArea
                    value={form.causaOtroDesc}
                    onChange={(v) => set('causaOtroDesc', v)}
                    placeholder="Describe el acto jurídico que origina el cambio de propietario..."
                    rows={3}
                  />
                </Field>
              )}
            </div>
          )}

          {/* ── Step 3: Nuevo propietario ───────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Datos del Nuevo Propietario</h2>
                <p className="text-sm text-gray-500">Información de quien tomará la titularidad del contrato.</p>
              </div>

              <div>
                <Label required>Tipo de persona</Label>
                <div className="grid sm:grid-cols-2 gap-3 mt-1">
                  <RadioCard
                    name="tipoPersona"
                    value="fisica"
                    checked={form.tipoPersona === 'fisica'}
                    onChange={() => set('tipoPersona', 'fisica')}
                    label="Persona Física"
                    desc="Individuo — ciudadano o extranjero con CURP/RFC."
                  />
                  <RadioCard
                    name="tipoPersona"
                    value="moral"
                    checked={form.tipoPersona === 'moral'}
                    onChange={() => set('tipoPersona', 'moral')}
                    label="Persona Moral"
                    desc="Empresa, asociación u organización con acta constitutiva."
                  />
                </div>
                <FieldError msg={errors.tipoPersona} />
              </div>

              {/* Persona física */}
              {form.tipoPersona === 'fisica' && (
                <div className="space-y-4">
                  <SectionLabel>Datos del nuevo propietario (persona física)</SectionLabel>

                  <Field error={errors.nombreNuevoPropietario}>
                    <Label required>Nombre completo</Label>
                    <TextInput value={form.nombreNuevoPropietario} onChange={(v) => set('nombreNuevoPropietario', v)} placeholder="Nombre(s) y apellidos" />
                  </Field>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field>
                      <Label>CURP</Label>
                      <TextInput value={form.curpNuevoPropietario} onChange={(v) => set('curpNuevoPropietario', v.toUpperCase())} placeholder="XXXX000000XXXXXXXX" />
                    </Field>
                    <Field>
                      <Label>RFC</Label>
                      <TextInput value={form.rfcNuevoPropietario} onChange={(v) => set('rfcNuevoPropietario', v.toUpperCase())} placeholder="XXXX000000XXX" />
                    </Field>
                  </div>

                  <Field>
                    <Label>Dirección particular</Label>
                    <TextInput value={form.direccionParticularNuevo} onChange={(v) => set('direccionParticularNuevo', v)} placeholder="Calle, número, colonia, ciudad" />
                  </Field>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field error={errors.telefonoNuevo}>
                      <Label required>Teléfono</Label>
                      <TextInput value={form.telefonoNuevo} onChange={(v) => set('telefonoNuevo', v)} placeholder="(442) 000 0000" type="tel" />
                    </Field>
                    <Field error={errors.correoNuevo}>
                      <Label required>Correo electrónico</Label>
                      <TextInput value={form.correoNuevo} onChange={(v) => set('correoNuevo', v)} placeholder="correo@ejemplo.com" type="email" />
                    </Field>
                  </div>
                </div>
              )}

              {/* Persona moral */}
              {esMoral && (
                <div className="space-y-4">
                  <SectionLabel>Datos de la empresa (persona moral)</SectionLabel>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field error={errors.razonSocial}>
                      <Label required>Razón social</Label>
                      <TextInput value={form.razonSocial} onChange={(v) => set('razonSocial', v)} placeholder="Nombre legal de la empresa" />
                    </Field>
                    <Field error={errors.rfcEmpresa}>
                      <Label required>RFC de la empresa</Label>
                      <TextInput value={form.rfcEmpresa} onChange={(v) => set('rfcEmpresa', v.toUpperCase())} placeholder="XXXX000000XXX" />
                    </Field>
                  </div>

                  <div className="border border-gray-100 rounded-xl p-4 space-y-4 bg-gray-50">
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Representante Legal</p>
                    <Field error={errors.nombreRepLegal}>
                      <Label required>Nombre del representante legal</Label>
                      <TextInput value={form.nombreRepLegal} onChange={(v) => set('nombreRepLegal', v)} placeholder="Nombre completo del representante" />
                    </Field>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field error={errors.telefonoRepLegal}>
                        <Label required>Teléfono</Label>
                        <TextInput value={form.telefonoRepLegal} onChange={(v) => set('telefonoRepLegal', v)} placeholder="(442) 000 0000" type="tel" />
                      </Field>
                      <Field>
                        <Label>Correo electrónico</Label>
                        <TextInput value={form.correoRepLegal} onChange={(v) => set('correoRepLegal', v)} placeholder="correo@empresa.com" type="email" />
                      </Field>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Quién tramita + Documentos ─────────────────────────── */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Documentos Requeridos</h2>
                <p className="text-sm text-gray-500">Adjunta los documentos necesarios. Formatos: PDF, JPG, PNG.</p>
              </div>

              {/* Quién tramita */}
              <div>
                <Label required>¿Quién presentará el trámite en las oficinas?</Label>
                <div className="grid sm:grid-cols-2 gap-3 mt-1">
                  <RadioCard
                    name="tramitadoPor"
                    value="nuevo_propietario"
                    checked={form.tramitadoPor === 'nuevo_propietario'}
                    onChange={() => set('tramitadoPor', 'nuevo_propietario')}
                    label="El nuevo propietario"
                    desc="Acude personalmente a tramitarlo."
                  />
                  <RadioCard
                    name="tramitadoPor"
                    value="tercero"
                    checked={form.tramitadoPor === 'tercero'}
                    onChange={() => set('tramitadoPor', 'tercero')}
                    label="Un tercero / Representante"
                    desc="Otra persona lo tramita mediante carta poder simple."
                  />
                </div>
                <FieldError msg={errors.tramitadoPor} />
              </div>

              {esTercero && (
                <div className="grid sm:grid-cols-2 gap-4 border border-blue-100 bg-blue-50/50 rounded-xl p-4">
                  <Field>
                    <Label>Nombre del tercero</Label>
                    <TextInput value={form.nombreTercero} onChange={(v) => set('nombreTercero', v)} placeholder="Nombre completo" />
                  </Field>
                  <Field>
                    <Label>Teléfono del tercero</Label>
                    <TextInput value={form.telefonoTercero} onChange={(v) => set('telefonoTercero', v)} placeholder="(442) 000 0000" type="tel" />
                  </Field>
                </div>
              )}

              {/* Documentos obligatorios */}
              <div className="space-y-3">
                <SectionLabel>Documentos requeridos</SectionLabel>

                <FileUpload
                  label="Identificación oficial del nuevo propietario"
                  hint={esMoral ? 'Copia — INE/IFE o pasaporte del representante legal' : 'Copia — INE, pasaporte o cédula profesional (persona física)'}
                  required
                  file={form.docIdNuevoPropietario}
                  onChange={(f) => set('docIdNuevoPropietario', f)}
                />
                <FieldError msg={errors.docIdNuevoPropietario} />

                <FileUpload
                  label="Documento que acredite propiedad o posesión del predio"
                  hint="Copia — escritura, contrato de compra-venta, sucesión testamentaria, etc."
                  required
                  file={form.docPropiedad}
                  onChange={(f) => set('docPropiedad', f)}
                />
                <FieldError msg={errors.docPropiedad} />
              </div>

              {/* Tercero */}
              {esTercero && (
                <div className="space-y-3">
                  <SectionLabel>Documento adicional — Trámite por tercero</SectionLabel>
                  <FileUpload
                    label="Carta Poder Simple"
                    hint="Original — firmada por el nuevo propietario, autorizando al tercero"
                    required
                    file={form.docCartaPoder}
                    onChange={(f) => set('docCartaPoder', f)}
                  />
                  <FieldError msg={errors.docCartaPoder} />
                </div>
              )}

              {/* Persona moral */}
              {esMoral && (
                <div className="space-y-3">
                  <SectionLabel>Documentos adicionales — Persona Moral</SectionLabel>

                  <FileUpload
                    label="Acta Constitutiva"
                    hint="Copia — acta notarial de constitución de la empresa"
                    required
                    file={form.docActaConstitutiva}
                    onChange={(f) => set('docActaConstitutiva', f)}
                  />
                  <FieldError msg={errors.docActaConstitutiva} />

                  <FileUpload
                    label="Poder Notarial del Representante Legal"
                    hint="Copia — poder que acredita la facultad de representación"
                    required
                    file={form.docPoderNotarial}
                    onChange={(f) => set('docPoderNotarial', f)}
                  />
                  <FieldError msg={errors.docPoderNotarial} />
                </div>
              )}
            </div>
          )}

          {/* ── Step 5: Confirmación y firma ────────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 mb-0.5">Confirmación y Firma Digital</h2>
                <p className="text-sm text-gray-500">Revisa el resumen y confirma antes de enviar.</p>
              </div>

              {/* Resumen */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                <SectionLabel>Resumen de la solicitud</SectionLabel>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {[
                    ['Contrato', form.numeroContrato],
                    ['Titular actual', form.nombreTitularActual],
                    ['Causa', { compraventa: 'Compra-Venta', herencia: 'Herencia', donacion: 'Donación', otro: form.causaOtroDesc }[form.causaCambio] ?? '—'],
                    ['Nuevo propietario', esMoral ? form.razonSocial : form.nombreNuevoPropietario],
                    ['Tipo', form.tipoPersona === 'fisica' ? 'Persona Física' : 'Persona Moral'],
                    ['Trámite por', form.tramitadoPor === 'tercero' ? `Tercero: ${form.nombreTercero}` : 'El nuevo propietario'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-gray-400 shrink-0">{k}:</span>
                      <span className="font-medium text-gray-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pago */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <Banknote className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                  <div>
                    <p className="text-sm font-bold text-amber-800">Pago requerido al presentar la solicitud</p>
                    <p className="text-sm text-amber-700 mt-0.5">
                      Deberás pagar <strong>${COSTO_TOTAL.toFixed(2)} MXN</strong> (${COSTO_BASE}.00 + IVA 16%) en las cajas de la Comisión Estatal de Aguas al entregar tu documentación. El trámite se resuelve de forma <strong>inmediata</strong>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Checkboxes */}
              <div className="space-y-3">
                <CheckCard
                  checked={form.aceptaPago}
                  onChange={(v) => set('aceptaPago', v)}
                  label={`Acepto pagar $${COSTO_TOTAL.toFixed(2)} MXN en cajas CEA`}
                  desc="Entiendo que el pago se realiza presencialmente al entregar la documentación y que el trámite se resuelve de forma inmediata."
                />
                <FieldError msg={errors.aceptaPago} />

                <CheckCard
                  checked={form.confirmaCoincidencia}
                  onChange={(v) => set('confirmaCoincidencia', v)}
                  label="Confirmo coincidencia de domicilio, propiedad y recibo"
                  desc="Declaro que el domicilio del contrato, la constancia de propiedad y el recibo de agua coinciden, conforme al criterio de resolución del trámite."
                />
                <FieldError msg={errors.confirmaCoincidencia} />

                <CheckCard
                  checked={form.firmaDigital}
                  onChange={(v) => set('firmaDigital', v)}
                  label="Firmo digitalmente esta solicitud"
                  desc={`Al marcar esta casilla y enviar, ${esMoral ? form.nombreRepLegal || 'el representante legal' : form.nombreNuevoPropietario || 'el nuevo propietario'} acepta que este acto constituye su firma digital con plena validez legal.`}
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
              <button onClick={next} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors">
                Siguiente <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            ) : (
              <button onClick={handleSubmit} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors">
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

export default TramiteCambioPropietario;
