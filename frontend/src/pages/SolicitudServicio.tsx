import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSolicitud, fetchSolicitud, updateSolicitud } from '@/api/solicitudes';
import type { CatalogoEstadoINEGI, CatalogoMunicipioINEGIRow, PaginatedInegi } from '@/api/domicilios-inegi';
import { fetchInegiEstados, fetchInegiMunicipiosCatalogo, fetchInegiLocalidadesCatalogo, fetchInegiColoniasCatalogo } from '@/api/domicilios-inegi';
import { ArrowLeft, Check, FileText, MapPin, User, HelpCircle, Settings, Receipt, ClipboardCheck, Wand2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/ui/sonner';
import DomicilioPickerForm from '@/components/contratacion/DomicilioPickerForm';
import EntregaDocumentos, { subirArchivosPendientes, type ArchivoPendiente } from '@/components/contratacion/EntregaDocumentos';
import { fetchAdministraciones, fetchDistritos, fetchActividades, type DistritoCatalogo, type CatalogoActividad } from '@/api/catalogos';
import { fetchTiposContratacion, fetchTipoContratacionConfiguracion, type TipoContratacion } from '@/api/tipos-contratacion';
import { hasApi } from '@/api/contratos';
import { cn } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { DomicilioFormValue, SolicitudEstado, SolicitudRecord, SolicitudState } from '@/types/solicitudes';
import { SOLICITUD_STATE_EMPTY } from '@/types/solicitudes';
import { deriveName, derivePredioResumen, useSolicitudesStore } from '@/hooks/useSolicitudesStore';
import { formatearCoordenadas } from '@/lib/geo-picker';
import {
  usoCfdiMatchesRegimenSeleccionado,
  REGIMEN_FISCAL_OFFLINE,
  USO_CFDI_OFFLINE,
} from '@/lib/sat-catalog-fallback';

// ── Catalogues (offline fallback; API vía fetchCatalogoSat en StepFiscal) ────

const REGIMENES_FISCALES = REGIMEN_FISCAL_OFFLINE;
const USOS_CFDI = USO_CFDI_OFFLINE;

// ── Mock data for demos ───────────────────────────────────────────────────────

// Data split per wizard step so prellenar can fill them one by one
const MOCK_STEP_DATA: Partial<SolicitudState>[] = [
  // 0 – Predio  (estadoINEGIId/municipioINEGIId hold claveINEGI codes; resolveDir() swaps them for real UUIDs at runtime)
  {
    claveCatastral: '22001-045-012',
    folioExpediente: '',
    predioDir: {
      estadoINEGIId: '22',      // claveINEGI → resolved to UUID by handlePrellenar
      municipioINEGIId: '014',  // claveINEGI of municipio within state
      localidadINEGIId: '',
      coloniaINEGIId: '',
      codigoPostal: '76030',
      calle: 'Av. Constituyentes',
      numExterior: '425',
      numInterior: 'Depto. 3',
      referencia: 'Entre Av. 5 de Febrero y calle Hidalgo',
    },
    predioManzana: '12',
    predioLote: '04',
    superficieTotal: '180',
    superficieConstruida: '120',
  },
  // 1 – Propietario
  {
    propTipoPersona: 'fisica',
    propPaterno: 'García',
    propMaterno: 'Ramírez',
    propNombre: 'María Elena',
    propRazonSocial: '',
    propRfc: 'GARM850312AB3',
    propCorreo: 'mgarcia@correo.com',
    propTelefono: '4421234567',
    propDir: {
      estadoINEGIId: '22',
      municipioINEGIId: '014',
      localidadINEGIId: '',
      coloniaINEGIId: '',
      codigoPostal: '76030',
      calle: 'Calle Independencia',
      numExterior: '88',
      numInterior: 'Int. 3',
      referencia: '',
    },
    propManzana: '',
    propLote: '',
  },
  // 2 – Fiscal (mismosDatosProp='si' → copiar de propietario al seleccionar)
  {
    requiereFactura: 'si',
    mismosDatosProp: 'si',
    fiscalRegimenFiscal: '616',
    fiscalUsoCfdi: 'G03',
  },
  // 3 – Solicitud
  {
    usoDomestico: 'si',
    hayTuberias: 'si',
    hayInfraCEA: 'si',
    esCondominio: 'no',
    condoViviendas: '',
    condoUbicacionTomas: '',
    condoTieneMedidorMacro: '',
    condoNumMedidor: '',
    condoAreasComunes: '',
    condoNumAreas: '',
    condoAgrupacion: '',
    condoNombreAgrupacion: '',
    personasVivienda: '4',
    tieneCertConexion: 'si',
  },
  // 4 – Contratación (adminId/tipoContratacionId resolved at runtime; distritoId/actividadId pick first available)
  {
    adminId: '1',
    distritoId: '__first__',
    actividadId: '__first__',
    contratoPadre: '',
  },
];

const MOCK_DATA: SolicitudState = {
  claveCatastral: '22001-045-012',
  folioExpediente: '',
  predioDir: {
    estadoINEGIId: '22',        // Querétaro
    municipioINEGIId: '22014',  // Querétaro (municipio)
    localidadINEGIId: '',
    coloniaINEGIId: '',
    codigoPostal: '76030',
    calle: 'Av. Constituyentes',
    numExterior: '425',
    numInterior: 'Depto. 3',
    referencia: 'Entre Av. 5 de Febrero y calle Hidalgo',
  },
  predioManzana: '12',
  predioLote: '04',
  superficieTotal: '180',
  superficieConstruida: '120',
  propTipoPersona: 'fisica',
  propPaterno: 'García',
  propMaterno: 'Ramírez',
  propNombre: 'María Elena',
  propRazonSocial: '',
  propRfc: 'GARM850312AB3',
  propCorreo: 'mgarcia@correo.com',
  propTelefono: '4421234567',
  propDir: {
    estadoINEGIId: '22',
    municipioINEGIId: '22014',
    localidadINEGIId: '',
    coloniaINEGIId: '',
    codigoPostal: '76030',
    calle: 'Calle Independencia',
    numExterior: '88',
    numInterior: 'Int. 3',
    referencia: '',
  },
  propManzana: '',
  propLote: '',
  usoDomestico: 'si',
  hayTuberias: 'si',
  hayInfraCEA: 'si',
  esCondominio: 'no',
  condoViviendas: '',
  condoUbicacionTomas: '',
  condoTieneMedidorMacro: '',
  condoNumMedidor: '',
  condoAreasComunes: '',
  condoNumAreas: '',
  condoAgrupacion: '',
  condoNombreAgrupacion: '',
  personasVivienda: '4',
  tieneCertConexion: 'si',
  noDomHayInfra: '',
  noDomRestComensales: '',
  noDomRestMesas: '',
  noDomRestSanitarios: '',
  noDomLavNumLavadoras: '',
  noDomLavCapKg: '',
  noDomLavKgDia: '',
  noDomAutoAutosDia: '',
  noDomTortKgDia: '',
  noDomOficM2Oficinas: '',
  noDomOficM2Estac: '',
  noDomOtroGiro: '',
  noDomReqDomUnidades: '',
  noDomReqDomGiro: '',
  noDomReqComUnidades: '',
  noDomReqComGiro: '',
  noDomReqIndUnidades: '',
  noDomReqIndGiro: '',
  noDomReqOtroUnidades: '',
  noDomReqOtroGiro: '',
  noDomReqTotalUnidades: '',
  adminId: '',
  tipoContratacionId: '',
  tipoContratacionCodigo: '',
  distritoId: '',
  grupoActividadId: '',
  actividadId: '',
  variablesCapturadas: {},
  variablesTexto: '',
  documentosRecibidos: [],
  documentosTexto: '',
  contratoPadre: '',
  requiereFactura: 'si',
  mismosDatosProp: 'si',
  fiscalTipoPersona: 'fisica',
  fiscalRazonSocial: '',
  fiscalRfc: 'GARM850312AB3',
  fiscalCorreo: 'mgarcia@correo.com',
  fiscalDir: {
    estadoINEGIId: '22',
    municipioINEGIId: '22014',
    localidadINEGIId: '',
    coloniaINEGIId: '',
    codigoPostal: '76030',
    calle: 'Calle Independencia',
    numExterior: '88',
    numInterior: 'Int. 3',
    referencia: '',
  },
  fiscalRegimenFiscal: '616',
  fiscalUsoCfdi: 'G03',
};

// ── Wizard steps definition ───────────────────────────────────────────────────

const STEPS = [
  { key: 'predio',        label: 'Predio',        icon: MapPin },
  { key: 'propietario',   label: 'Propietario',   icon: User },
  { key: 'fiscal',        label: 'Fiscal',        icon: Receipt },
  { key: 'solicitud',     label: 'Solicitud',     icon: HelpCircle },
  { key: 'contratacion',  label: 'Contratación',  icon: Settings },
  { key: 'resumen',       label: 'Resumen',       icon: ClipboardCheck },
] as const;

type StepKey = typeof STEPS[number]['key'];

// ── Per-step validation ───────────────────────────────────────────────────────

function validDir(d: {
  estadoINEGIId: string;
  municipioINEGIId: string;
  localidadINEGIId: string;
  coloniaINEGIId: string;
  calle: string;
  numExterior: string;
}) {
  return !!(
    d.estadoINEGIId &&
    d.municipioINEGIId &&
    d.localidadINEGIId &&
    d.coloniaINEGIId &&
    d.calle.trim() &&
    d.numExterior.trim()
  );
}

/** Validación condominio — preguntas c y d marcadas obligatorias en UI */
function validCondominioCd(form: SolicitudState): boolean {
  if (!form.condoAreasComunes || !form.condoAgrupacion) return false;
  if (form.condoAreasComunes === 'si') {
    const n = Number(form.condoNumAreas);
    if (!form.condoNumAreas.trim() || !Number.isFinite(n) || n < 1) return false;
  }
  if (form.condoAgrupacion === 'si' && !form.condoNombreAgrupacion.trim()) return false;
  return true;
}

function canAdvance(step: number, form: SolicitudState, esAdminQueretaro?: boolean): boolean {
  switch (step) {
    case 0: // Predio
      return validDir(form.predioDir);

    case 1: { // Propietario
      if (!form.propTipoPersona) return false;
      if (form.propTipoPersona === 'moral' && !form.propRazonSocial.trim()) return false;
      if (form.propTipoPersona === 'fisica' && (!form.propPaterno.trim() || !form.propNombre.trim())) return false;
      if (!form.propCorreo.trim() || !form.propTelefono.trim()) return false;
      return validDir(form.propDir);
    }

    case 2: { // Fiscal
      if (!form.requiereFactura) return false;
      if (form.requiereFactura === 'no') return true;
      // requiere factura = si
      if (!form.mismosDatosProp) return false;
      if (!form.fiscalTipoPersona) return false;
      if (form.fiscalTipoPersona === 'moral' && !form.fiscalRazonSocial.trim()) return false;
      if (!form.fiscalRfc.trim() || !form.fiscalCorreo.trim()) return false;
      if (!validDir(form.fiscalDir)) return false;
      if (!form.fiscalRegimenFiscal || !form.fiscalUsoCfdi) return false;
      return true;
    }

    case 3: { // Solicitud
      if (!form.usoDomestico || !form.hayTuberias) return false;
      if (form.usoDomestico === 'no') return !!form.noDomHayInfra;
      if (form.usoDomestico === 'si' && form.esCondominio === 'si' && !validCondominioCd(form)) return false;
      return true;
    }

    case 4: // Contratación
      return !!(form.adminId && form.tipoContratacionId && form.actividadId &&
        (!esAdminQueretaro || form.distritoId));

    case 5: // Resumen
      return true;

    default:
      return true;
  }
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function YesNo({
  id,
  value,
  onChange,
}: {
  id: string;
  value: 'si' | 'no' | '';
  onChange: (v: 'si' | 'no') => void;
}) {
  return (
    <RadioGroup id={id} value={value} onValueChange={(v) => onChange(v as 'si' | 'no')} className="flex flex-row gap-0">
      {(['si', 'no'] as const).map((opt) => (
        <Label
          key={opt}
          htmlFor={`${id}-${opt}`}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 border px-3.5 py-1.5 text-sm font-medium transition-colors select-none',
            opt === 'si' ? 'rounded-l-md border-r-0' : 'rounded-r-md',
            value === opt
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-foreground border-input hover:bg-accent',
          )}
        >
          <RadioGroupItem id={`${id}-${opt}`} value={opt} className="sr-only" />
          {opt === 'si' ? 'Sí' : 'No'}
        </Label>
      ))}
    </RadioGroup>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">
        {label}{required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function PillToggle({
  options,
  value,
  onChange,
  idPrefix,
  disabled = false,
}: {
  options: { value: string; label: string; sub?: string }[];
  value: string;
  onChange: (v: string) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  return (
    <RadioGroup value={value} onValueChange={onChange} disabled={disabled} className="flex flex-wrap gap-2">
      {options.map((opt, i) => (
        <Label
          key={opt.value}
          htmlFor={`${idPrefix}-${i}`}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-sm font-medium transition-colors select-none',
            disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
            value === opt.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-accent',
          )}
        >
          <RadioGroupItem id={`${idPrefix}-${i}`} value={opt.value} className="sr-only" />
          {opt.label}
          {opt.sub && <span className="ml-1 text-xs font-normal opacity-70">{opt.sub}</span>}
        </Label>
      ))}
    </RadioGroup>
  );
}

// ── Step views ────────────────────────────────────────────────────────────────

function StepPredio({ form, set }: { form: SolicitudState; set: (p: Partial<SolicitudState>) => void }) {
  const today = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Clave catastral del predio">
          <Input className="h-9" placeholder="Ej. 22001-001-001" value={form.claveCatastral} onChange={(e) => set({ claveCatastral: e.target.value })} />
        </Field>
        <Field label="Fecha de solicitud">
          <Input className="h-9 bg-muted/40" value={today} readOnly />
        </Field>
        <Field label="Folio de expediente (factibilidades)">
          <Input className="h-9" placeholder="Folio expediente" value={form.folioExpediente} onChange={(e) => set({ folioExpediente: e.target.value })} />
        </Field>
      </div>

      <Separator />

      {/* Domicilio */}
      <div>
        <p className="mb-3 text-sm font-medium">
          Domicilio del predio <span className="text-destructive">*</span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">Este dato persiste a través de todo el flujo y se usará para crear el punto de servicio.</span>
        </p>
        <DomicilioPickerForm value={form.predioDir} onChange={(v) => set({ predioDir: v })} conMapa />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Manzana">
          <Input className="h-9" placeholder="MZ" value={form.predioManzana} onChange={(e) => set({ predioManzana: e.target.value })} />
        </Field>
        <Field label="Lote">
          <Input className="h-9" placeholder="LT" value={form.predioLote} onChange={(e) => set({ predioLote: e.target.value })} />
        </Field>
        <Field label="Superficie total (m²)">
          <Input className="h-9" type="number" min="0" placeholder="0.00" value={form.superficieTotal} onChange={(e) => set({ superficieTotal: e.target.value })} />
        </Field>
        <Field label="Superficie construida (m²)">
          <Input className="h-9" type="number" min="0" placeholder="0.00" value={form.superficieConstruida} onChange={(e) => set({ superficieConstruida: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

function StepPropietario({ form, set }: { form: SolicitudState; set: (p: Partial<SolicitudState>) => void }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Tipo de persona <span className="text-destructive">*</span></Label>
        <PillToggle
          idPrefix="prop-tipo"
          options={[{ value: 'fisica', label: 'Física' }, { value: 'moral', label: 'Moral' }]}
          value={form.propTipoPersona}
          onChange={(v) => set({ propTipoPersona: v as 'fisica' | 'moral', propPaterno: '', propMaterno: '', propNombre: '', propRazonSocial: '' })}
        />
      </div>

      {form.propTipoPersona === 'moral' && (
        <Field label="Razón social" required>
          <Input className="h-9" value={form.propRazonSocial} onChange={(e) => set({ propRazonSocial: e.target.value })} />
        </Field>
      )}
      {form.propTipoPersona === 'fisica' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Apellido paterno" required>
            <Input className="h-9" value={form.propPaterno} onChange={(e) => set({ propPaterno: e.target.value })} />
          </Field>
          <Field label="Apellido materno">
            <Input className="h-9" value={form.propMaterno} onChange={(e) => set({ propMaterno: e.target.value })} />
          </Field>
          <Field label="Nombre(s)" required>
            <Input className="h-9" value={form.propNombre} onChange={(e) => set({ propNombre: e.target.value })} />
          </Field>
        </div>
      )}

      {form.propTipoPersona && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="RFC">
              <Input className="h-9 font-mono text-xs" placeholder="XXXX000000XX0" value={form.propRfc} onChange={(e) => set({ propRfc: e.target.value.toUpperCase() })} maxLength={13} />
            </Field>
            <Field label="Correo electrónico" required>
              <Input className="h-9" type="email" value={form.propCorreo} onChange={(e) => set({ propCorreo: e.target.value })} />
            </Field>
            <Field label="Teléfono" required>
              <Input className="h-9" type="tel" value={form.propTelefono} onChange={(e) => set({ propTelefono: e.target.value })} />
            </Field>
          </div>

          <Separator />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Domicilio del propietario</p>
          <DomicilioPickerForm value={form.propDir} onChange={(v) => set({ propDir: v })} />
          <div className="grid grid-cols-4 gap-4">
            <Field label="Manzana">
              <Input className="h-9" value={form.propManzana} onChange={(e) => set({ propManzana: e.target.value })} />
            </Field>
            <Field label="Lote">
              <Input className="h-9" value={form.propLote} onChange={(e) => set({ propLote: e.target.value })} />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function StepSolicitud({ form, set }: { form: SolicitudState; set: (p: Partial<SolicitudState>) => void }) {
  const resetCondo = {
    condoViviendas: '', condoUbicacionTomas: '' as const, condoTieneMedidorMacro: '' as const,
    condoNumMedidor: '', condoAreasComunes: '' as const, condoNumAreas: '',
    condoAgrupacion: '' as const, condoNombreAgrupacion: '', personasVivienda: '',
  };
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium">1. ¿Uso que desea contratar? <span className="text-destructive">*</span></p>
        <PillToggle
          idPrefix="uso"
          options={[
            { value: 'si', label: 'Doméstico' },
            { value: 'no', label: 'No Doméstico', sub: '(comercial, industrial, otros)' },
          ]}
          value={form.usoDomestico}
          onChange={(v) =>
            set({
              usoDomestico: v as 'si' | 'no',
              hayInfraCEA: '',
              esCondominio: '',
              // La rama de uso decide administraciones y tipos: al cambiarla se
              // invalida lo elegido en el paso Contratación.
              adminId: '',
              tipoContratacionId: '',
              tipoContratacionCodigo: '',
              ...resetCondo,
            })
          }
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          2. ¿En el predio hay instalaciones de tuberías para conectar toma(s) y colocar medidor(es)? <span className="text-destructive">*</span>
        </p>
        <YesNo id="hay-tuberias" value={form.hayTuberias} onChange={(v) => set({ hayTuberias: v })} />
      </div>

      {form.usoDomestico === 'si' && (
        <div className="space-y-5 rounded-lg border bg-muted/20 p-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Uso doméstico</p>

          <div className="space-y-2">
            <p className="text-sm font-medium">1. ¿En la colonia o desarrollo existe infraestructura de agua operada por la CEA?</p>
            <YesNo id="hay-infra-cea" value={form.hayInfraCEA} onChange={(v) => set({ hayInfraCEA: v })} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">2. La colonia o desarrollo ¿es un condominio?</p>
            <YesNo id="es-condominio" value={form.esCondominio} onChange={(v) => set({ esCondominio: v, ...resetCondo })} />

            {form.esCondominio === 'si' && (
              <div className="ml-4 mt-3 space-y-4 border-l border-muted-foreground/20 pl-4">
                <div className="space-y-1.5">
                  <Label className="text-sm">a. ¿Cuántas viviendas / unidades privativas se desea contratar? <span className="text-xs text-muted-foreground">(Trámite individualización)</span></Label>
                  <Input className="h-9 max-w-xs" type="number" min="1" placeholder="Núm. unidades" value={form.condoViviendas} onChange={(e) => set({ condoViviendas: e.target.value })} />
                </div>

                <div className="space-y-2">
                  <p className="text-sm">a.1 ¿Dónde se encuentran ubicadas las tomas?</p>
                  <PillToggle
                    idPrefix="tomas"
                    options={[{ value: 'banqueta', label: 'En la banqueta' }, { value: 'cuadro', label: 'Hay cuadro para instalar medidor' }]}
                    value={form.condoUbicacionTomas}
                    onChange={(v) => set({ condoUbicacionTomas: v as 'banqueta' | 'cuadro' })}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm">b. ¿El condominio cuenta actualmente con medidor (macro)?</p>
                  <YesNo id="condo-medidor" value={form.condoTieneMedidorMacro} onChange={(v) => set({ condoTieneMedidorMacro: v, condoNumMedidor: '' })} />
                  {form.condoTieneMedidorMacro === 'si' && (
                    <Input className="mt-1.5 h-9 max-w-xs" placeholder="Número de medidor" value={form.condoNumMedidor} onChange={(e) => set({ condoNumMedidor: e.target.value })} />
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm">
                    c. ¿Se pretende contratar servicio para áreas comunes?{' '}
                    <span className="text-xs text-muted-foreground">(Excepto áreas verdes)</span>{' '}
                    <span className="text-destructive">*</span>
                  </p>
                  <YesNo id="condo-areas" value={form.condoAreasComunes} onChange={(v) => set({ condoAreasComunes: v, condoNumAreas: '' })} />
                  {form.condoAreasComunes === 'si' && (
                    <div className="mt-1.5 space-y-1.5">
                      <Label className="text-sm font-normal leading-snug">
                        ¿Cuántas áreas? <span className="text-destructive">*</span>
                      </Label>
                      <Input className="h-9 max-w-xs" type="number" min="1" placeholder="Ej. 2" value={form.condoNumAreas} onChange={(e) => set({ condoNumAreas: e.target.value })} />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm">d. ¿Existe una agrupación formal de colonos o condominios? <span className="text-destructive">*</span></p>
                  <YesNo id="condo-agrupacion" value={form.condoAgrupacion} onChange={(v) => set({ condoAgrupacion: v, condoNombreAgrupacion: '' })} />
                  {form.condoAgrupacion === 'si' && (
                    <div className="mt-1.5 space-y-1.5">
                      <Label className="text-sm font-normal leading-snug">
                        Nombre de la agrupación <span className="text-destructive">*</span>
                      </Label>
                      <Input className="h-9 max-w-sm" placeholder="Nombre de la agrupación" value={form.condoNombreAgrupacion} onChange={(e) => set({ condoNombreAgrupacion: e.target.value })} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {form.esCondominio === 'no' && (
              <div className="ml-4 mt-3 space-y-1.5 border-l border-muted-foreground/20 pl-4">
                <Label className="text-sm">a. ¿Cuántas personas habitarán la vivienda?</Label>
                <Input className="h-9 max-w-xs" type="number" min="1" placeholder="Núm. personas" value={form.personasVivienda} onChange={(e) => set({ personasVivienda: e.target.value })} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">
              3. ¿Cuenta con certificado de conexión?{' '}
              <span className="font-normal text-muted-foreground text-xs">(Documento que avala infraestructura entregada a la CEA y/o municipio)</span>
            </p>
            <YesNo id="cert-conexion" value={form.tieneCertConexion} onChange={(v) => set({ tieneCertConexion: v })} />
          </div>
        </div>
      )}

      {form.usoDomestico === 'no' && (
        <div className="space-y-5 rounded-lg border bg-muted/20 p-4">
          <p className="text-lg font-bold text-primary uppercase tracking-wide">Uso No Doméstico</p>
          <p className="text-sm text-muted-foreground">Llenar todos los campos que correspondan.</p>
          <p className="text-xs text-muted-foreground">(Usos mixtos pueden ser: doméstico+comercio, industria+comercio u otros similares de modo que se llenen los campos específicos).</p>

          <div className="space-y-2">
            <p className="text-sm font-medium">¿Cuenta con infraestructura para toma/s y otros servicios de agua? <span className="text-destructive">*</span></p>
            <YesNo
              id="no-dom-hay-infra"
              value={form.noDomHayInfra}
              onChange={(v) => set({ noDomHayInfra: v })}
            />
          </div>

          {/* CON infraestructura → giros específicos */}
          {form.noDomHayInfra === 'si' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Seleccione el giro específico y llene los campos</p>

              {/* Restaurante */}
              <div className="grid grid-cols-[120px_1fr_1fr_1fr] items-center gap-3">
                <span className="text-sm font-semibold">RESTAURANTE</span>
                <Field label="Núm. comensales por día">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomRestComensales} onChange={(e) => set({ noDomRestComensales: e.target.value })} />
                </Field>
                <Field label="Núm. de mesas">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomRestMesas} onChange={(e) => set({ noDomRestMesas: e.target.value })} />
                </Field>
                <Field label="Núm. de sanitarios">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomRestSanitarios} onChange={(e) => set({ noDomRestSanitarios: e.target.value })} />
                </Field>
              </div>

              {/* Lavandería */}
              <div className="grid grid-cols-[120px_1fr_1fr_1fr] items-center gap-3">
                <span className="text-sm font-semibold">LAVANDERÍA</span>
                <Field label="Núm. de lavadoras">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomLavNumLavadoras} onChange={(e) => set({ noDomLavNumLavadoras: e.target.value })} />
                </Field>
                <Field label="Capacidad Kg por lavadora">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomLavCapKg} onChange={(e) => set({ noDomLavCapKg: e.target.value })} />
                </Field>
                <Field label="Kg de ropa promedio por día">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomLavKgDia} onChange={(e) => set({ noDomLavKgDia: e.target.value })} />
                </Field>
              </div>

              {/* Autolavado */}
              <div className="grid grid-cols-[120px_1fr_3fr] items-center gap-3">
                <span className="text-sm font-semibold">AUTOLAVADO</span>
                <Field label="Núm. automóviles lavados por día">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomAutoAutosDia} onChange={(e) => set({ noDomAutoAutosDia: e.target.value })} />
                </Field>
              </div>

              {/* Tortillería */}
              <div className="grid grid-cols-[120px_1fr_3fr] items-center gap-3">
                <span className="text-sm font-semibold">TORTILLERÍA</span>
                <Field label="Núm. kg procesados por día">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomTortKgDia} onChange={(e) => set({ noDomTortKgDia: e.target.value })} />
                </Field>
              </div>

              {/* Oficinas */}
              <div className="grid grid-cols-[120px_1fr_1fr_2fr] items-center gap-3">
                <span className="text-sm font-semibold">OFICINAS</span>
                <Field label="M² de oficina/s">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomOficM2Oficinas} onChange={(e) => set({ noDomOficM2Oficinas: e.target.value })} />
                </Field>
                <Field label="M² de estacionamiento">
                  <Input className="h-9" type="number" min="0" placeholder="0" value={form.noDomOficM2Estac} onChange={(e) => set({ noDomOficM2Estac: e.target.value })} />
                </Field>
              </div>

              {/* Otro giro */}
              <div className="grid grid-cols-[120px_1fr] items-center gap-3">
                <span className="text-sm font-semibold">OTRO GIRO</span>
                <Field label="Especificar">
                  <Input className="h-9" placeholder="Descripción del giro" value={form.noDomOtroGiro} onChange={(e) => set({ noDomOtroGiro: e.target.value })} />
                </Field>
              </div>
            </div>
          )}

          {/* SIN infraestructura → requerimiento de agua */}
          {form.noDomHayInfra === 'no' && (
            <div className="space-y-4">
              <p className="text-base font-bold text-primary uppercase tracking-wide">Requerimiento de Agua</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 text-left font-semibold w-40">USO</th>
                      <th className="py-2 text-left font-semibold">UNIDADES (Especificar núm. de tomas)</th>
                      <th className="py-2 text-left font-semibold">GIRO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {([
                      { label: 'DOMÉSTICO',  uKey: 'noDomReqDomUnidades', gKey: 'noDomReqDomGiro' },
                      { label: 'COMERCIAL',  uKey: 'noDomReqComUnidades', gKey: 'noDomReqComGiro' },
                      { label: 'INDUSTRIAL', uKey: 'noDomReqIndUnidades', gKey: 'noDomReqIndGiro' },
                      { label: 'OTRO (Especificar)', uKey: 'noDomReqOtroUnidades', gKey: 'noDomReqOtroGiro' },
                    ] as { label: string; uKey: keyof SolicitudState; gKey: keyof SolicitudState }[]).map((row) => (
                      <tr key={row.label}>
                        <td className="py-2 font-semibold pr-4">{row.label}</td>
                        <td className="py-2 pr-4">
                          <Input className="h-8 max-w-[120px]" type="number" min="0" placeholder="0"
                            value={form[row.uKey] as string}
                            onChange={(e) => set({ [row.uKey]: e.target.value } as Partial<SolicitudState>)} />
                        </td>
                        <td className="py-2">
                          <Input className="h-8" placeholder="—"
                            value={form[row.gKey] as string}
                            onChange={(e) => set({ [row.gKey]: e.target.value } as Partial<SolicitudState>)} />
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-bold">
                      <td className="py-2 pr-4">TOTAL DE UNIDADES A SERVIR</td>
                      <td className="py-2">
                        <Input className="h-8 max-w-[120px]" type="number" min="0" placeholder="0"
                          value={form.noDomReqTotalUnidades}
                          onChange={(e) => set({ noDomReqTotalUnidades: e.target.value })} />
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Opciones para variables reservadas (igual que PasoVariables) ─────────────
const DIAMETROS_SOL = ["1/2\"", "3/4\"", "1\"", "1.5\"", "2\"", "3\"", "4\""];
const OPCIONES_RESERVADAS_SOL: Record<string, { label: string; value: string }[]> = {
  DIAMETRO_TOMA:     DIAMETROS_SOL.map((d) => ({ value: d, label: d })),
  DIAMETRO_DESCARGA: DIAMETROS_SOL.map((d) => ({ value: d, label: d })),
  MATERIAL_CALLE: [
    { value: 'concreto',           label: 'Concreto hidráulico' },
    { value: 'losa',               label: 'Losa' },
    { value: 'adoquin',            label: 'Adoquín' },
    { value: 'concreto_asfaltico', label: 'Concreto asfáltico' },
    { value: 'empedrado',          label: 'Empedrado' },
    { value: 'tierra',             label: 'Terracería / tierra' },
  ],
  MATERIAL_BANQUETA: [
    { value: 'concreto',  label: 'Concreto' },
    { value: 'asfalto',   label: 'Asfalto' },
    { value: 'adoquin',   label: 'Adoquín' },
    { value: 'adocreto',  label: 'Adocreto' },
    { value: 'empedrado', label: 'Empedrado' },
    { value: 'tierra',    label: 'Terracería / tierra' },
    { value: 'cantera',   label: 'Cantera' },
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

function StepContratacion({
  form,
  set,
  solicitudId,
  archivosPendientes,
  onPendientesChange,
}: {
  form: SolicitudState;
  set: (p: Partial<SolicitudState>) => void;
  solicitudId?: string;
  archivosPendientes?: ArchivoPendiente[];
  onPendientesChange?: (p: ArchivoPendiente[]) => void;
}) {
  const useApi = hasApi();
  // Rama del árbol de uso elegida en el paso Solicitud: de ella dependen las
  // administraciones y los tipos de contratación que se ofrecen.
  const ramaUso: 'domestico' | 'no_domestico' | undefined =
    form.usoDomestico === 'si' ? 'domestico' : form.usoDomestico === 'no' ? 'no_domestico' : undefined;
  const { data: administraciones = [], isLoading: adminsLoading, isError: adminsError } = useQuery({
    queryKey: ['catalogos-operativos', 'administraciones', ramaUso ?? 'todas'],
    queryFn: () => fetchAdministraciones(ramaUso ? { uso: ramaUso } : undefined),
    enabled: useApi,
    staleTime: 60 * 60 * 1000,
  });

  const { data: tiposRes, isLoading: tiposLoading, isError: tiposError } = useQuery({
    queryKey: ['tipos-contratacion', form.adminId, ramaUso ?? 'todas', 'solicitud-servicio'],
    queryFn: () =>
      fetchTiposContratacion({
        administracionId: form.adminId,
        activo: true,
        page: 1,
        limit: 200,
        uso: ramaUso,
      }),
    enabled: useApi && !!form.adminId,
  });

  const { data: distritos = [], isLoading: distritosLoading } = useQuery({
    queryKey: ['catalogos', 'distritos'],
    queryFn: fetchDistritos,
    enabled: useApi,
    staleTime: 60 * 60 * 1000,
  });

  const esAdminQueretaro = form.adminId
    ? /quer[eé]taro/i.test(administraciones.find((a) => a.id === form.adminId)?.nombre ?? '')
    : false;

  const { data: actividades = [], isLoading: actividadesLoading } = useQuery({
    queryKey: ['catalogos', 'actividades'],
    queryFn: fetchActividades,
    enabled: useApi,
    staleTime: 60 * 60 * 1000,
  });

  const actividadesFiltradas: CatalogoActividad[] = actividades;

  const tiposList: TipoContratacion[] = tiposRes?.data ?? [];
  const selectedTipo = tiposList.find((t) => t.id === form.tipoContratacionId);

  const { data: tipoConfig, isLoading: configLoading } = useQuery({
    queryKey: ['tipo-contratacion-config', form.tipoContratacionId],
    queryFn: () => fetchTipoContratacionConfiguracion(form.tipoContratacionId),
    enabled: useApi && !!form.tipoContratacionId,
    staleTime: 10 * 60 * 1000,
  });

  const variables = tipoConfig?.variables ?? [];
  // Un documento con aplicaUso solo se exige en la rama de uso elegida (ramaUso, arriba).
  const documentos = (tipoConfig?.documentos ?? []).filter(
    (d) => !d.aplicaUso || !ramaUso || d.aplicaUso === ramaUso,
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Administración" required>
          <SearchableSelect
            value={form.adminId}
            onValueChange={(v) => set({ adminId: v, tipoContratacionId: '', tipoContratacionCodigo: '' })}
            disabled={!useApi || adminsLoading || administraciones.length === 0}
            placeholder={
              !useApi ? 'Catálogo no disponible' : adminsLoading ? 'Cargando…' : adminsError ? 'Error al cargar' : 'Seleccione administración…'
            }
            searchPlaceholder="Buscar administración…"
            options={administraciones.map((a) => ({ value: a.id, label: a.nombre }))}
          />
        </Field>

        <Field label="Tipo de contratación" required>
          <SearchableSelect
            value={form.tipoContratacionId}
            onValueChange={(v) => {
              const tipo = tiposList.find((t) => t.id === v);
              set({
                tipoContratacionId: v,
                tipoContratacionCodigo: tipo?.codigo ?? '',
                contratoPadre: tipo?.esIndividualizacion ? form.contratoPadre : '',
              });
            }}
            disabled={!form.adminId || tiposLoading || tiposList.length === 0}
            placeholder={
              !form.adminId ? 'Primero seleccione administración' : tiposLoading ? 'Cargando tipos…' : tiposError ? 'Error al cargar tipos' : tiposList.length === 0 ? 'Sin tipos disponibles' : 'Seleccione tipo…'
            }
            searchPlaceholder="Buscar tipo de contratación…"
            options={tiposList.map((t) => ({
              value: t.id,
              label: `${t.descripcion?.trim() || t.nombre} (${t.codigo})`,
            }))}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Distrito" required={esAdminQueretaro}>
          <SearchableSelect
            value={form.distritoId}
            onValueChange={(v) => set({ distritoId: v })}
            disabled={!useApi || distritosLoading || distritos.length === 0}
            placeholder={distritosLoading ? 'Cargando…' : 'Seleccione distrito…'}
            searchPlaceholder="Buscar distrito…"
            options={[
              ...(!esAdminQueretaro ? [{ value: '', label: '— Sin distrito —' }] : []),
              ...distritos.map((d: DistritoCatalogo) => ({ value: d.id, label: d.nombre })),
            ]}
          />
        </Field>

        <Field label="Actividad" required>
          <SearchableSelect
            value={form.actividadId}
            onValueChange={(v) => set({ actividadId: v })}
            disabled={!useApi || actividadesLoading || actividadesFiltradas.length === 0}
            placeholder={actividadesLoading ? 'Cargando…' : 'Seleccione actividad…'}
            searchPlaceholder="Buscar por código o descripción…"
            options={actividadesFiltradas.map((a: CatalogoActividad) => ({
              value: a.id,
              label: `${a.codigo} – ${a.descripcion}`,
            }))}
          />
        </Field>
      </div>

      {selectedTipo?.esIndividualizacion && (
        <Field label="Contrato padre">
          <Input className="h-9" placeholder="Folio o número de contrato padre" value={form.contratoPadre} onChange={(e) => set({ contratoPadre: e.target.value })} />
        </Field>
      )}

      {/* Variables de Contratación */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Variables de Contratación:</p>
        <div className="rounded-md border bg-background p-4">
          {configLoading ? (
            <p className="text-xs text-muted-foreground">Cargando variables…</p>
          ) : variables.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {variables
                .slice()
                .sort((a, b) => a.orden - b.orden)
                .map((v) => {
                  const tv = v.tipoVariable;
                  const codigo = (tv.codigo ?? '').toUpperCase();
                  const tipo = (tv.tipoDato ?? '').trim().toUpperCase();
                  const rawVal = form.variablesCapturadas[tv.codigo];
                  const def = v.valorDefecto?.trim();

                  const setVar = (val: string | number | undefined) => {
                    const next = { ...form.variablesCapturadas };
                    if (val === undefined || val === '') {
                      delete next[tv.codigo];
                    } else {
                      next[tv.codigo] = val;
                    }
                    set({ variablesCapturadas: next });
                  };

                  const labelNode = (
                    <>
                      {tv.nombre}
                      {v.obligatorio && <span className="text-destructive"> *</span>}
                      {tv.unidad?.trim() ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">({tv.unidad.trim()})</span>
                      ) : null}
                    </>
                  );

                  // Códigos reservados → select especializado
                  const opcionesRes = OPCIONES_RESERVADAS_SOL[codigo];
                  if (opcionesRes) {
                    const valStr = rawVal != null && String(rawVal).length > 0 ? String(rawVal) : def ?? '';
                    return (
                      <div key={v.id} className="space-y-2">
                        <Label htmlFor={`var-sol-${tv.codigo}`}>{labelNode}</Label>
                        <SearchableSelect
                          className="h-9"
                          value={valStr || '__none__'}
                          onValueChange={(s) => setVar(s === '__none__' ? undefined : s)}
                          placeholder="Seleccione…"
                          options={[
                            ...(!v.obligatorio ? [{ value: '__none__', label: '(vacío)' }] : []),
                            ...opcionesRes,
                          ]}
                        />
                      </div>
                    );
                  }

                  // Metros lineales / numérico
                  if (['METROS_TOMA', 'METROS_DESCARGA', 'UNIDADES_SERVIDAS'].includes(codigo) || tipo === 'NUMERO') {
                    const numStr = rawVal !== undefined ? String(rawVal) : def ?? '';
                    return (
                      <div key={v.id} className="space-y-2">
                        <Label htmlFor={`var-sol-${tv.codigo}`}>{labelNode}</Label>
                        <Input
                          id={`var-sol-${tv.codigo}`}
                          className="h-9"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={['UNIDADES_SERVIDAS'].includes(codigo) ? 1 : 0.1}
                          value={numStr}
                          placeholder={['METROS_TOMA', 'METROS_DESCARGA'].includes(codigo) ? 'metros lineales' : ''}
                          onChange={(e) => {
                            const t = e.target.value.trim();
                            setVar(t === '' ? undefined : Number(t));
                          }}
                        />
                      </div>
                    );
                  }

                  // Texto genérico
                  return (
                    <div key={v.id} className="space-y-2 sm:col-span-2">
                      <Label htmlFor={`var-sol-${tv.codigo}`}>{labelNode}</Label>
                      <Input
                        id={`var-sol-${tv.codigo}`}
                        className="h-9"
                        placeholder={def ?? ''}
                        value={rawVal != null ? String(rawVal) : ''}
                        onChange={(e) => setVar(e.target.value.trim() || undefined)}
                      />
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {form.tipoContratacionId
                ? 'Este tipo de contratación no define variables adicionales.'
                : 'Seleccione primero el tipo de contratación.'}
            </p>
          )}
        </div>
      </div>

      {/* Documentos Presentados */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Documentos Presentados:</p>
        {configLoading ? (
          <p className="text-xs text-muted-foreground">Cargando documentos…</p>
        ) : (
          <EntregaDocumentos
            solicitudId={solicitudId}
            documentosDelTipo={documentos}
            esRecibido={(d) => form.documentosRecibidos.includes(d.id)}
            onToggleRecibido={(d, recibido) =>
              set({
                documentosRecibidos: recibido
                  ? [...form.documentosRecibidos, d.id]
                  : form.documentosRecibidos.filter((x) => x !== d.id),
              })
            }
            archivosPendientes={archivosPendientes}
            onPendientesChange={onPendientesChange}
          />
        )}
      </div>
    </div>
  );
}

function StepFiscal({
  form,
  set,
}: {
  form: SolicitudState;
  set: (p: Partial<SolicitudState>) => void;
}) {
  const locked = form.mismosDatosProp === 'si';
  const useApi = hasApi();

  const { data: regimenSat = [] } = useQuery({
    queryKey: ['catalogos', 'sat', 'REGIMEN_FISCAL'],
    queryFn: () => fetchCatalogoSat('REGIMEN_FISCAL'),
    enabled: useApi,
  });
  const { data: usoSat = [] } = useQuery({
    queryKey: ['catalogos', 'sat', 'USO_CFDI'],
    queryFn: () => fetchCatalogoSat('USO_CFDI'),
    enabled: useApi,
  });

  const esFisica = form.fiscalTipoPersona === 'fisica';
  const regimenSel = (form.fiscalRegimenFiscal ?? '').trim();

  const regimenOpciones = useMemo(() => {
    if (regimenSat.length > 0) {
      return regimenSat
        .filter((r) => (esFisica ? r.aplicaFisica : r.aplicaMoral))
        .map((r) => ({ clave: r.clave, texto: r.descripcion }));
    }
    return REGIMENES_FISCALES.filter((r) => (esFisica ? r.aplicaFisica : r.aplicaMoral)).map((r) => ({
      clave: r.id,
      texto: r.nombre,
    }));
  }, [regimenSat, esFisica]);

  const usoOpciones = useMemo(() => {
    const sinRegimen = regimenSel === '';
    if (sinRegimen) {
      return [];
    }
    if (usoSat.length > 0) {
      const rows = usoSat.filter((u) => {
        if (esFisica ? !u.aplicaFisica : !u.aplicaMoral) return false;
        return usoCfdiMatchesRegimenSeleccionado(u.regimenesReceptorPermitidos, regimenSel);
      });
      return rows.map((u) => ({ clave: u.clave, texto: u.descripcion }));
    }
    const rows = USOS_CFDI.filter((u) => {
      if (esFisica ? !u.aplicaFisica : !u.aplicaMoral) return false;
      return usoCfdiMatchesRegimenSeleccionado(u.regimenesReceptorPermitidos, regimenSel);
    });
    return rows.map((u) => ({ clave: u.id, texto: u.nombre }));
  }, [usoSat, esFisica, regimenSel]);

  useEffect(() => {
    if (!form.fiscalUsoCfdi) return;
    const ok = usoOpciones.some((u) => u.clave === form.fiscalUsoCfdi);
    if (!ok) set({ fiscalUsoCfdi: '' });
  }, [usoOpciones, form.fiscalUsoCfdi, set]);

  function handleMismosDatos(v: 'si' | 'no') {
    if (v === 'si') {
      set({
        mismosDatosProp: 'si',
        fiscalTipoPersona: form.propTipoPersona,
        fiscalRazonSocial: form.propRazonSocial,
        fiscalRfc: form.propRfc,
        fiscalCorreo: form.propCorreo,
        fiscalDir: { ...form.propDir },
      });
    } else {
      set({ mismosDatosProp: 'no' });
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">¿Requiere facturar? <span className="text-destructive">*</span></p>
        <YesNo
          id="requiere-factura"
          value={form.requiereFactura}
          onChange={(v) => set({
            requiereFactura: v,
            mismosDatosProp: '',
            // When no invoice required, use SAT "Público en general" generic data
            ...(v === 'no' ? {
              fiscalRfc: 'XAXX010101000',
              fiscalRazonSocial: 'Público en general',
              fiscalTipoPersona: 'moral' as const,
              fiscalRegimenFiscal: '616',
              fiscalUsoCfdi: 'S01',
            } : {}),
          })}
        />
      </div>

      {form.requiereFactura === 'si' && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              ¿La factura y dirección fiscal serán los mismos que los del propietario?{' '}
              <span className="text-xs font-normal text-muted-foreground">(Sección B)</span>
            </p>
            <YesNo id="mismos-datos-prop" value={form.mismosDatosProp} onChange={handleMismosDatos} />
          </div>

          {(form.mismosDatosProp === 'si' || form.mismosDatosProp === 'no') && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Tipo de persona <span className="text-destructive">*</span>
                  {locked && <span className="ml-2 text-xs font-normal text-muted-foreground">(del propietario)</span>}
                </Label>
                <PillToggle
                  idPrefix="fiscal-tipo"
                  options={[{ value: 'fisica', label: 'Física' }, { value: 'moral', label: 'Moral' }]}
                  value={form.fiscalTipoPersona}
                  onChange={
                    locked
                      ? () => {}
                      : (v) =>
                          set({
                            fiscalTipoPersona: v as 'fisica' | 'moral',
                            fiscalRegimenFiscal: '',
                            fiscalUsoCfdi: '',
                          })
                  }
                  disabled={locked}
                />
              </div>

              {form.fiscalTipoPersona === 'moral' && (
                <Field label="Razón social" required>
                  <Input className="h-9" value={form.fiscalRazonSocial} readOnly={locked} disabled={locked} onChange={(e) => set({ fiscalRazonSocial: e.target.value })} />
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="RFC para facturación" required>
                  <Input className="h-9 font-mono text-xs" placeholder="XXXX000000XX0" value={form.fiscalRfc} readOnly={locked} disabled={locked} onChange={(e) => set({ fiscalRfc: e.target.value.toUpperCase() })} maxLength={13} />
                </Field>
                <Field label="Correo electrónico" required>
                  <Input className="h-9" type="email" value={form.fiscalCorreo} readOnly={locked} disabled={locked} onChange={(e) => set({ fiscalCorreo: e.target.value })} />
                </Field>
              </div>

              <Separator />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Domicilio fiscal
                {locked && <span className="ml-2 font-normal normal-case text-muted-foreground/70">(precargado del propietario)</span>}
              </p>
              <DomicilioPickerForm value={form.fiscalDir} onChange={locked ? () => {} : (v) => set({ fiscalDir: v })} disabled={locked} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Régimen fiscal" required>
                  <SearchableSelect
                    className="h-9"
                    value={form.fiscalRegimenFiscal}
                    onValueChange={(v) => set({ fiscalRegimenFiscal: v, fiscalUsoCfdi: '' })}
                    placeholder="Seleccione régimen…"
                    options={regimenOpciones.map((r) => ({
                      value: r.clave,
                      label: `${r.clave} — ${r.texto}`,
                    }))}
                  />
                </Field>
                <Field label="Uso del CFDI" required>
                  <SearchableSelect
                    className="h-9"
                    value={form.fiscalUsoCfdi}
                    onValueChange={(v) => set({ fiscalUsoCfdi: v })}
                    disabled={!regimenSel}
                    placeholder={regimenSel ? 'Seleccione uso…' : 'Primero elija régimen fiscal…'}
                    options={usoOpciones.map((u) => ({
                      value: u.clave,
                      label: `${u.clave} — ${u.texto}`,
                    }))}
                  />
                </Field>
              </div>
            </div>
          )}
        </>
      )}

      {form.requiereFactura === 'no' && (
        <div className="space-y-3 rounded-md border bg-muted/20 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Datos fiscales genéricos (SAT — Público en general)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">RFC</p>
              <p className="text-sm font-mono font-medium">XAXX010101000</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Razón social</p>
              <p className="text-sm font-medium">Público en general</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Régimen fiscal</p>
              <p className="text-sm font-medium">616 — Sin obligaciones fiscales</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Uso del CFDI</p>
              <p className="text-sm font-medium">S01 — Sin efectos fiscales</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResumenRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function StepResumen({ form }: { form: SolicitudState }) {
  const useApi = hasApi();
  const today = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });

  const { data: administraciones = [] } = useQuery({
    queryKey: ['catalogos-operativos', 'administraciones'],
    queryFn: fetchAdministraciones,
    enabled: useApi,
    staleTime: 60 * 60 * 1000,
  });

  const { data: tiposRes } = useQuery({
    queryKey: ['tipos-contratacion', form.adminId, 'solicitud-servicio'],
    queryFn: () =>
      fetchTiposContratacion({
        administracionId: form.adminId,
        activo: true,
        page: 1,
        limit: 200,
      }),
    enabled: useApi && !!form.adminId,
  });

  const tiposList: TipoContratacion[] = tiposRes?.data ?? [];
  const selectedTipo = tiposList.find((t) => t.id === form.tipoContratacionId);
  const adminNombre = form.adminId ? administraciones.find((a) => a.id === form.adminId)?.nombre : undefined;
  const nombre = form.propTipoPersona === 'moral'
    ? form.propRazonSocial
    : [form.propPaterno, form.propMaterno, form.propNombre].filter(Boolean).join(' ');

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
          <ClipboardCheck className="h-6 w-6" />
        </div>
        <div>
          <p className="font-semibold">Revise los datos antes de guardar</p>
          <p className="text-sm text-muted-foreground">Al guardar, la solicitud quedará registrada y podrá editarse después.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Predio</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 pb-4">
            <ResumenRow label="Fecha de solicitud" value={today} />
            <ResumenRow label="Clave catastral" value={form.claveCatastral || '—'} />
            <ResumenRow label="Calle" value={form.predioDir.calle || '—'} />
            <ResumenRow label="Núm. exterior" value={form.predioDir.numExterior} />
            <ResumenRow label="Código postal" value={form.predioDir.codigoPostal} />
            <ResumenRow label="Ubicación GPS" value={formatearCoordenadas(form.predioDir.gpsLat, form.predioDir.gpsLng) || 'Sin ubicar en mapa'} />
            {form.predioManzana && <ResumenRow label="Manzana" value={form.predioManzana} />}
            {form.predioLote && <ResumenRow label="Lote" value={form.predioLote} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Propietario</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 pb-4">
            <ResumenRow label="Tipo de persona" value={form.propTipoPersona === 'fisica' ? 'Persona física' : form.propTipoPersona === 'moral' ? 'Persona moral' : '—'} />
            <ResumenRow label="Nombre / Razón social" value={nombre || '—'} />
            <ResumenRow label="RFC" value={form.propRfc} />
            <ResumenRow label="Teléfono" value={form.propTelefono} />
            <ResumenRow label="Correo" value={form.propCorreo} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tipo de solicitud</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 pb-4">
            <ResumenRow label="Uso" value={form.usoDomestico === 'si' ? 'Doméstico' : form.usoDomestico === 'no' ? 'No doméstico' : '—'} />
            <ResumenRow label="Hay tuberías" value={form.hayTuberias === 'si' ? 'Sí' : form.hayTuberias === 'no' ? 'No' : '—'} />
            {form.usoDomestico === 'si' && (
              <>
                <ResumenRow label="Infraestructura CEA" value={form.hayInfraCEA === 'si' ? 'Sí' : form.hayInfraCEA === 'no' ? 'No' : '—'} />
                <ResumenRow label="Es condominio" value={form.esCondominio === 'si' ? 'Sí' : form.esCondominio === 'no' ? 'No' : '—'} />
                {form.esCondominio === 'si' && (
                  <>
                    {form.condoViviendas && <ResumenRow label="Viviendas / unidades privativas" value={form.condoViviendas} />}
                    {form.condoUbicacionTomas && <ResumenRow label="Ubicación de tomas" value={form.condoUbicacionTomas === 'banqueta' ? 'En la banqueta' : 'Hay cuadro para instalar medidor'} />}
                    {form.condoTieneMedidorMacro && <ResumenRow label="Medidor macro" value={form.condoTieneMedidorMacro === 'si' ? 'Sí' : 'No'} />}
                    {form.condoTieneMedidorMacro === 'si' && form.condoNumMedidor && <ResumenRow label="No. medidor macro" value={form.condoNumMedidor} />}
                    {form.condoAreasComunes && <ResumenRow label="Áreas comunes" value={form.condoAreasComunes === 'si' ? 'Sí' : 'No'} />}
                    {form.condoAreasComunes === 'si' && form.condoNumAreas && <ResumenRow label="Cantidad de áreas" value={form.condoNumAreas} />}
                    {form.condoAgrupacion && <ResumenRow label="Agrupación formal" value={form.condoAgrupacion === 'si' ? 'Sí' : 'No'} />}
                    {form.condoAgrupacion === 'si' && form.condoNombreAgrupacion && <ResumenRow label="Nombre de agrupación" value={form.condoNombreAgrupacion} />}
                  </>
                )}
                {form.esCondominio === 'no' && form.personasVivienda && (
                  <ResumenRow label="Personas en vivienda" value={form.personasVivienda} />
                )}
                <ResumenRow label="Cert. de conexión" value={form.tieneCertConexion === 'si' ? 'Sí' : form.tieneCertConexion === 'no' ? 'No' : '—'} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Contratación</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 pb-4">
            <ResumenRow label="Administración" value={adminNombre || form.adminId || '—'} />
            <ResumenRow
              label="Tipo de contratación"
              value={
                selectedTipo
                  ? `${selectedTipo.descripcion?.trim() || selectedTipo.nombre} (${selectedTipo.codigo})`
                  : form.tipoContratacionId || '—'
              }
            />
            {form.contratoPadre && <ResumenRow label="Contrato padre" value={form.contratoPadre} />}
            <ResumenRow label="Requiere factura" value={form.requiereFactura === 'si' ? 'Sí' : form.requiereFactura === 'no' ? 'No' : '—'} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function SolicitudServicio() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const store = useSolicitudesStore();

  const isEditMode = !!id;
  const localRecord = isEditMode && id ? store.getById(id) : undefined;
  const { data: apiSolicitud } = useQuery({
    queryKey: ['solicitud', id],
    queryFn: () => fetchSolicitud(id!),
    enabled: isEditMode && !!id && !localRecord,
    staleTime: 30_000,
  });

  const [form, setForm] = useState<SolicitudState>(localRecord?.formData ?? SOLICITUD_STATE_EMPTY);
  const [currentStep, setCurrentStep] = useState(0);
  // Archivos elegidos antes de guardar la solicitud; se suben al crearla.
  const [archivosPendientes, setArchivosPendientes] = useState<ArchivoPendiente[]>([]);

  useEffect(() => {
    if (!localRecord && apiSolicitud?.formData) {
      setForm(apiSolicitud.formData as SolicitudState);
    }
  }, [localRecord, apiSolicitud?.id, apiSolicitud?.formData]);

  const existingRecord: SolicitudRecord | undefined =
    localRecord ??
    (apiSolicitud
      ? {
          id: apiSolicitud.id,
          folio: apiSolicitud.folio,
          fechaSolicitud: apiSolicitud.fechaSolicitud,
          propNombreCompleto: apiSolicitud.propNombreCompleto,
          propTelefono: apiSolicitud.propTelefono ?? '—',
          predioResumen: apiSolicitud.predioResumen,
          adminId: apiSolicitud.adminId ?? '',
          tipoContratacionId:
            apiSolicitud.tipoContratacionId ??
            (typeof apiSolicitud.formData?.tipoContratacionId === 'string'
              ? apiSolicitud.formData.tipoContratacionId
              : '') ??
            '',
          usoDomestico: apiSolicitud.formData.usoDomestico,
          estado: apiSolicitud.estado as SolicitudEstado,
          formData: apiSolicitud.formData as SolicitudState,
          createdAt: apiSolicitud.createdAt,
        }
      : undefined);

  const createMutation = useMutation({
    mutationFn: (dto: Parameters<typeof createSolicitud>[0]) => createSolicitud(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['solicitudes'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ sid, dto }: { sid: string; dto: Parameters<typeof updateSolicitud>[1] }) =>
      updateSolicitud(sid, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['solicitudes'] });
      void queryClient.invalidateQueries({ queryKey: ['solicitud', id] });
    },
  });

  function set(patch: Partial<SolicitudState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  const { data: adminsForValidation = [] } = useQuery({
    queryKey: ['catalogos-operativos', 'administraciones'],
    queryFn: fetchAdministraciones,
    staleTime: 60 * 60 * 1000,
  });
  const esAdminQueretaro = form.adminId
    ? /quer[eé]taro/i.test(adminsForValidation.find((a) => a.id === form.adminId)?.nombre ?? '')
    : false;

  const isLastStep = currentStep === STEPS.length - 1;
  const canNext = canAdvance(currentStep, form, esAdminQueretaro);

  async function resolveDir(dir: DomicilioFormValue | undefined): Promise<DomicilioFormValue | undefined> {
    if (!dir) return dir;

    // Resolve estado — fetch if not cached yet
    const estados = await queryClient.fetchQuery({
      queryKey: ['inegi-estados'],
      queryFn: fetchInegiEstados,
      staleTime: 10 * 60 * 1000,
    });
    const estado = (estados ?? []).find((e) => e.claveINEGI === dir.estadoINEGIId || e.id === dir.estadoINEGIId);
    const estadoId = estado?.id ?? '';

    if (!estadoId) return { ...dir, estadoINEGIId: '', municipioINEGIId: '', localidadINEGIId: '', coloniaINEGIId: '' };

    // Resolve municipio (fetch if not in cache)
    const mpioRes = await queryClient.fetchQuery({
      queryKey: ['inegi-municipios', estadoId],
      queryFn: () => fetchInegiMunicipiosCatalogo({ estadoId, limit: 200 }),
      staleTime: 10 * 60 * 1000,
    });
    const municipios = mpioRes?.data ?? [];
    // Match by claveINEGI (with/without leading zeros), full combined code, or UUID
    const rawMpio = dir.municipioINEGIId ?? '';
    const mpio =
      municipios.find((m) => m.id === rawMpio) ??
      municipios.find((m) => m.claveINEGI === rawMpio) ??
      municipios.find((m) => m.claveINEGI === rawMpio.slice(-3)) ??
      municipios.find((m) => m.claveINEGI === rawMpio.replace(/^0+/, '')) ??
      municipios[0]; // fallback: first municipio in state (demo only)
    const municipioId = mpio?.id ?? '';

    if (!municipioId) return { ...dir, estadoINEGIId: estadoId, municipioINEGIId: '', localidadINEGIId: '', coloniaINEGIId: '' };

    // Resolve localidad — use provided id or pick first available
    let localidadId = dir.localidadINEGIId;
    if (!localidadId) {
      const locRes = await queryClient.fetchQuery({
        queryKey: ['inegi-localidades', municipioId],
        queryFn: () => fetchInegiLocalidadesCatalogo({ municipioId, limit: 500 }),
        staleTime: 10 * 60 * 1000,
      });
      localidadId = locRes?.data?.[0]?.id ?? '';
    }

    // Resolve colonia — filter by localidad (Aquasis: colonias belong to localidad, not municipio)
    let coloniaId = dir.coloniaINEGIId;
    if (!coloniaId && localidadId) {
      const colRes = await queryClient.fetchQuery({
        queryKey: ['inegi-colonias', localidadId],
        queryFn: () => fetchInegiColoniasCatalogo({ localidadId, limit: 500 }),
        staleTime: 10 * 60 * 1000,
      });
      const colonias = colRes?.data ?? [];
      coloniaId = colonias[0]?.id ?? '';
    }

    return { ...dir, estadoINEGIId: estadoId, municipioINEGIId: municipioId, localidadINEGIId: localidadId, coloniaINEGIId: coloniaId };
  }

  async function handlePrellenar() {
    if (!hasApi()) {
      setForm({ ...MOCK_DATA });
      setCurrentStep(0);
      toast.success('Datos de demo cargados', {
        description: 'Defina administración y tipo desde el catálogo en el paso de contratación.',
      });
      return;
    }

    const stepData = MOCK_STEP_DATA[currentStep];
    if (!stepData) {
      toast.info('No hay datos de demo para este paso');
      return;
    }

    try {
      let patch: Partial<SolicitudState> = { ...stepData };

      if (currentStep === 4) {
        const administraciones = await queryClient.fetchQuery({
          queryKey: ['catalogos-operativos', 'administraciones'],
          queryFn: fetchAdministraciones,
        });
        if (!administraciones.length) {
          toast.error('No hay administraciones en el catálogo');
          return;
        }
        // Find first admin that actually has tipos de contratación
        let chosenAdmin = null;
        let chosenTipo = null;
        for (const admin of administraciones) {
          const { data: tipos } = await fetchTiposContratacion({
            administracionId: admin.id,
            activo: true,
            page: 1,
            limit: 10,
          });
          const tipo = tipos.find((t) => t.activo) ?? tipos[0];
          if (tipo) {
            chosenAdmin = admin;
            chosenTipo = tipo;
            break;
          }
        }
        if (!chosenAdmin || !chosenTipo) {
          toast.error('No se encontraron tipos de contratación en ninguna administración');
          return;
        }
        // Resolve distrito — pick first available
        const distritos = await queryClient.fetchQuery({
          queryKey: ['catalogos', 'distritos'],
          queryFn: fetchDistritos,
          staleTime: 60 * 60 * 1000,
        });
        const distritoId = distritos?.[0]?.id ?? '';

        // Resolve actividad — pick first available
        const actividades = await queryClient.fetchQuery({
          queryKey: ['catalogos', 'actividades'],
          queryFn: fetchActividades,
          staleTime: 60 * 60 * 1000,
        });
        const actividadId = (actividades ?? [])[0]?.id ?? '';

        patch = {
          ...patch,
          adminId: chosenAdmin.id,
          tipoContratacionId: chosenTipo.id,
          tipoContratacionCodigo: chosenTipo.codigo,
          distritoId,
          actividadId,
        };
      }

      if (currentStep === 0 && patch.predioDir) {
        patch = { ...patch, predioDir: await resolveDir(patch.predioDir) };
      }
      if (currentStep === 1 && patch.propDir) {
        patch = { ...patch, propDir: await resolveDir(patch.propDir) };
      }
      if (currentStep === 2) {
        if (patch.mismosDatosProp === 'si') {
          // Copy propietario data into fiscal fields (mirrors handleMismosDatos)
          const resolvedPropDir = await resolveDir({ ...form.propDir });
          patch = {
            ...patch,
            fiscalTipoPersona: form.propTipoPersona,
            fiscalRazonSocial: form.propRazonSocial,
            fiscalRfc: form.propRfc,
            fiscalCorreo: form.propCorreo,
            fiscalDir: resolvedPropDir ?? { ...form.propDir },
          };
        } else if (patch.fiscalDir) {
          patch = { ...patch, fiscalDir: await resolveDir(patch.fiscalDir) };
        }
      }

      setForm((prev) => ({ ...prev, ...patch }));
      toast.success('Datos de demo del paso actual');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error al cargar catálogos';
      toast.error('No se pudo prellenar', { description: message });
    }
  }

  async function handleNext() {
    if (!canNext) return;
    if (isLastStep) {
      await handleGuardar();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }

  async function handleGuardar() {
    const propNombreCompleto = deriveName(form);
    const predioResumen = derivePredioResumen(form);

    if (isEditMode && id) {
      try {
        await updateMutation.mutateAsync({
          sid: id,
          dto: {
            propNombreCompleto,
            propRfc: form.propRfc || undefined,
            propCorreo: form.propCorreo || undefined,
            propTelefono: form.propTelefono || undefined,
            predioResumen,
            claveCatastral: form.claveCatastral || undefined,
            adminId: form.adminId || undefined,
            tipoContratacionId: form.tipoContratacionId || undefined,
            formData: form,
          },
        });
      } catch {
        store.updateFormData(id, form);
      }
      toast.success('Solicitud actualizada');
    } else {
      try {
        const dto = await createMutation.mutateAsync({
          propTipoPersona: form.propTipoPersona === 'moral' ? 'moral' : 'fisica',
          propNombreCompleto,
          propRfc: form.propRfc || undefined,
          propCorreo: form.propCorreo || undefined,
          propTelefono: form.propTelefono || undefined,
          predioResumen,
          claveCatastral: form.claveCatastral || undefined,
          adminId: form.adminId || undefined,
          tipoContratacionId: form.tipoContratacionId || undefined,
          formData: form,
        });
        toast.success(`Solicitud ${dto.folio} guardada`);
        if (archivosPendientes.length > 0) {
          const r = await subirArchivosPendientes(dto.id, archivosPendientes);
          setArchivosPendientes([]);
          if (r.fallidos > 0) {
            toast.error(`${r.fallidos} archivo(s) no se pudieron subir; súbelos desde la solicitud`);
          } else if (r.subidos > 0) {
            toast.success(`${r.subidos} archivo(s) adjuntados`);
          }
        }
      } catch {
        const record = store.create(form);
        toast.success(`Solicitud ${record.folio} guardada`);
        navigate('/app/solicitudes');
        return;
      }
    }
    navigate('/app/solicitudes');
  }

  const stepContent: Record<StepKey, React.ReactNode> = {
    predio: <StepPredio form={form} set={set} />,
    propietario: <StepPropietario form={form} set={set} />,
    solicitud: <StepSolicitud form={form} set={set} />,
    contratacion: (
      <StepContratacion
        form={form}
        set={set}
        solicitudId={id}
        archivosPendientes={archivosPendientes}
        onPendientesChange={setArchivosPendientes}
      />
    ),
    fiscal: <StepFiscal form={form} set={set} />,
    resumen: <StepResumen form={form} />,
  };

  const currentStepKey = STEPS[currentStep].key;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/app/solicitudes')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">
              {isEditMode && existingRecord
                ? `Editar solicitud — ${existingRecord.folio}`
                : 'CEA-FUS01 — Nueva Solicitud de Servicios'}
            </h1>
            <p className="inline-flex items-center gap-1 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-2 py-0.5">
              <span className="text-sm font-bold leading-none">*</span> Los campos marcados son obligatorios
            </p>
          </div>
        </div>
        {!isEditMode && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 border-dashed text-muted-foreground hover:text-foreground"
            onClick={handlePrellenar}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Prellenar demo
          </Button>
        )}
      </div>

      {/* ── Step progress ─────────────────────────────────────────────── */}
      <nav aria-label="Pasos de la solicitud" className="w-full overflow-x-auto pb-1">
        <ol className="flex min-w-[560px] items-center sm:min-w-0">
          {STEPS.map((step, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            const segDone = i < currentStep;
            const Icon = step.icon;
            return (
              <React.Fragment key={step.key}>
                <li className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    disabled={!done && !active}
                    onClick={() => { if (done) setCurrentStep(i); }}
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      done && 'border-emerald-600 bg-emerald-600 text-white cursor-pointer',
                      active && !done && 'border-primary bg-primary text-primary-foreground',
                      !active && !done && 'border-muted-foreground/30 bg-muted text-muted-foreground',
                    )}
                    aria-current={active ? 'step' : undefined}
                  >
                    {done ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
                  </button>
                  <span className={cn(
                    'hidden max-w-[5rem] truncate text-center text-[10px] leading-tight sm:block',
                    active ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}>
                    {step.label}
                  </span>
                </li>
                {i < STEPS.length - 1 && (
                  <div className={cn('mx-1 h-0.5 min-w-[12px] flex-1 transition-colors', segDone ? 'bg-emerald-600' : 'bg-border')} aria-hidden />
                )}
              </React.Fragment>
            );
          })}
        </ol>
      </nav>

      {/* ── Step content ──────────────────────────────────────────────── */}
      <div className="min-h-[260px] rounded-lg border bg-card p-5 shadow-sm">
        {stepContent[currentStepKey]}
      </div>

      {/* ── Navigation ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button type="button" variant="ghost" onClick={() => navigate('/app/solicitudes')}>
          Cancelar
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setCurrentStep((s) => Math.max(s - 1, 0))}
            disabled={currentStep === 0}
          >
            Anterior
          </Button>
          <Button
            type="button"
            onClick={handleNext}
            disabled={!canNext}
            className={isLastStep ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-[#007BFF] hover:bg-blue-600 text-white'}
          >
            {isLastStep ? (isEditMode ? 'Guardar cambios' : 'Guardar solicitud') : 'Siguiente'}
          </Button>
        </div>
      </div>
    </div>
  );
}
