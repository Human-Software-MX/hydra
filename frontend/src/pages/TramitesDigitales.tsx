import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileText,
  UserPlus,
  UserMinus,
  PowerOff,
  Percent,
  UserCheck,
  Plug,
  PenLine,
  Shield,
} from 'lucide-react';
import {
  getCatalogoTramites,
  labelDocumentoRequeridoCatalogo,
  type CatalogoTramiteDto,
} from '@/api/tramites';

type FieldType = 'text' | 'date' | 'number' | 'select';
interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
}

const TRAMITE_CONTRATOS = [
  { id: 'alta', label: 'Alta', icon: FileText },
  { id: 'cambio-propietario', label: 'Cambio de Propietario', icon: UserPlus },
  { id: 'baja-temporal', label: 'Baja Temporal', icon: PowerOff },
  { id: 'baja-permanente', label: 'Baja Permanente', icon: UserMinus },
  { id: 'descuentos', label: 'Descuentos', icon: Percent },
  { id: 'jubilado-pensionado', label: 'Jubilado/Pensionado', icon: UserCheck },
] as const;

const TRAMITE_SOLICITUDES = [
  { id: 'reconexion', label: 'Reconexión', icon: Plug },
] as const;

const ALL_TRAMITES = [...TRAMITE_CONTRATOS, ...TRAMITE_SOLICITUDES];

const TRAMITE_FIELDS: Record<string, FieldConfig[]> = {
  alta: [
    { name: 'nombre', label: 'Nombre del titular', type: 'text' },
    { name: 'rfc', label: 'RFC', type: 'text' },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'contacto', label: 'Teléfono o contacto', type: 'text' },
    {
      name: 'tipoContrato',
      label: 'Tipo de contrato',
      type: 'select',
      options: [
        { value: 'Agua', label: 'Agua' },
        { value: 'Saneamiento', label: 'Saneamiento' },
        { value: 'Alcantarillado', label: 'Alcantarillado' },
      ],
    },
    {
      name: 'tipoServicio',
      label: 'Tipo de servicio',
      type: 'select',
      options: [
        { value: 'Doméstico', label: 'Doméstico' },
        { value: 'Comercial', label: 'Comercial' },
        { value: 'Industrial', label: 'Industrial' },
      ],
    },
    { name: 'predio', label: 'Predio', type: 'text' },
    { name: 'solicitante', label: 'Solicitante', type: 'text' },
    { name: 'direccionPredio', label: 'Dirección del predio', type: 'text' },
    { name: 'ubicacionToma', label: 'Ubicación de toma', type: 'text' },
    {
      name: 'tipoToma',
      label: 'Tipo de toma',
      type: 'select',
      options: [
        { value: 'Agua', label: 'Agua' },
        { value: 'Saneamiento', label: 'Saneamiento' },
        { value: 'Alcantarillado', label: 'Alcantarillado' },
      ],
    },
  ],
  'cambio-propietario': [
    { name: 'nombre', label: 'Nombre del nuevo titular', type: 'text' },
    { name: 'rfc', label: 'RFC', type: 'text' },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'contacto', label: 'Teléfono o contacto', type: 'text' },
  ],
  'baja-temporal': [
    { name: 'numeroContrato', label: 'Número de contrato', type: 'text' },
    { name: 'fechaReconexionPrevista', label: 'Fecha prevista de reconexión', type: 'date' },
    { name: 'observaciones', label: 'Observaciones', type: 'text' },
  ],
  'baja-permanente': [
    { name: 'numeroContrato', label: 'Número de contrato', type: 'text' },
    { name: 'observaciones', label: 'Observaciones', type: 'text' },
  ],
  descuentos: [
    { name: 'numeroContrato', label: 'Número de contrato', type: 'text' },
    {
      name: 'tipoDescuento',
      label: 'Tipo de descuento',
      type: 'select',
      options: [
        { value: 'Jubilado', label: 'Jubilado' },
        { value: 'Pensionado', label: 'Pensionado' },
        { value: 'Usuario cumplido', label: 'Usuario cumplido' },
        { value: 'Pago anticipado', label: 'Pago anticipado' },
        { value: 'Extraordinario', label: 'Extraordinario' },
      ],
    },
    { name: 'observaciones', label: 'Observaciones', type: 'text' },
  ],
  'jubilado-pensionado': [
    { name: 'numeroContrato', label: 'Número de contrato', type: 'text' },
    { name: 'comprobante', label: 'Comprobante (referencia o folio)', type: 'text' },
    { name: 'observaciones', label: 'Observaciones', type: 'text' },
  ],
  reconexion: [
    { name: 'numeroContrato', label: 'Número de contrato', type: 'text' },
    { name: 'fechaReconexionDeseada', label: 'Fecha deseada de reconexión', type: 'date' },
    { name: 'comprobantePago', label: 'Comprobante de pago (referencia)', type: 'text' },
    { name: 'observaciones', label: 'Observaciones', type: 'text' },
  ],
};

/**
 * Sección pública (sin usuario): los ciudadanos ingresan sus datos
 * y envían solicitudes. No requiere sesión ni selector de contrato interno.
 * Modales de prueba: formularios con inputs vacíos según referencia del sistema.
 */
// Map from tramite id to backend 'tipo' key for catalog lookup
const TRAMITE_ID_TO_TIPO: Record<string, string> = {
  alta: 'Alta',
  'cambio-propietario': 'CambioPropietario',
  'baja-temporal': 'BajaTemporal',
  'baja-permanente': 'BajaDefinitiva',
  descuentos: 'Descuento',
  'jubilado-pensionado': 'Descuento',
  reconexion: 'Reconexion',
};

const FIRMA_ICON: Record<string, React.ElementType> = {
  Digital: PenLine,
  Fisica: PenLine,
  NoRequerida: Shield,
};

const TramitesDigitales = () => {
  const [tramiteModal, setTramiteModal] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [catalogoMap, setCatalogoMap] = useState<Record<string, CatalogoTramiteDto>>({});

  useEffect(() => {
    getCatalogoTramites()
      .then((items) => {
        const map: Record<string, CatalogoTramiteDto> = {};
        for (const item of items) map[item.tipo] = item;
        setCatalogoMap(map);
      })
      .catch(() => {/* catalog unavailable — continue with defaults */});
  }, []);

  const openModal = (id: string) => {
    setTramiteModal(id);
    setFormValues({});
  };

  const closeModal = () => {
    setTramiteModal(null);
    setFormValues({});
  };

  const currentTramite = tramiteModal ? ALL_TRAMITES.find((t) => t.id === tramiteModal) : null;
  const fields = tramiteModal ? TRAMITE_FIELDS[tramiteModal] ?? [] : [];
  const catalogoTipo = tramiteModal ? TRAMITE_ID_TO_TIPO[tramiteModal] : null;
  const catalogoEntry = catalogoTipo ? catalogoMap[catalogoTipo] ?? null : null;

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="page-title">
          Trámites Digitales
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sección abierta para solicitudes de ciudadanos. Seleccione el trámite
          que desea realizar e ingrese sus datos para enviar su solicitud. No
          requiere inicio de sesión.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section
          className="rounded-lg border bg-card p-4"
          aria-labelledby="section-contratos"
        >
          <h2 id="section-contratos" className="text-base font-semibold mb-4">
            Contratos
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {TRAMITE_CONTRATOS.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant="outline"
                className="h-auto justify-start gap-2 py-3"
                onClick={() => openModal(id)}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </section>

        <section
          className="rounded-lg border bg-card p-4"
          aria-labelledby="section-solicitudes"
        >
          <h2 id="section-solicitudes" className="text-base font-semibold mb-4">
            Solicitudes
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {TRAMITE_SOLICITUDES.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant="outline"
                className="h-auto justify-start gap-2 py-3"
                onClick={() => openModal(id)}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </section>
      </div>

      <Dialog open={tramiteModal !== null} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{currentTramite?.label ?? 'Trámite'}</DialogTitle>
            <DialogDescription>
              Formulario de prueba. Complete los datos de referencia del trámite.
            </DialogDescription>
          </DialogHeader>
          {/* Document requirements from catalog */}
          {catalogoEntry && (
            <div className="rounded-lg bg-muted/40 border p-3 space-y-2 text-sm">
              {catalogoEntry.documentosRequeridos.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Documentos requeridos
                  </p>
                  <ul className="space-y-0.5">
                    {catalogoEntry.documentosRequeridos.map((doc, i) => {
                      const label = labelDocumentoRequeridoCatalogo(doc);
                      const key =
                        typeof doc === 'string' ? doc : `${doc.nombre}-${i}`;
                      const obligatorio = typeof doc === 'object' && doc !== null && doc.requerido;
                      return (
                        <li key={key} className="flex items-center gap-1.5 text-xs text-foreground">
                          <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span>
                            {label}
                            {obligatorio ? (
                              <span className="text-destructive" aria-label="obligatorio">
                                {' '}
                                *
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {catalogoEntry.tipoFirma && catalogoEntry.tipoFirma !== 'NoRequerida' && (() => {
                const FirmaIcon = FIRMA_ICON[catalogoEntry.tipoFirma] ?? PenLine;
                return (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-t pt-2">
                    <FirmaIcon className="h-3.5 w-3.5 shrink-0" />
                    <span>Firma requerida: <strong>{catalogoEntry.tipoFirma}</strong></span>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="grid gap-4 py-4">
            {fields.map((field) => (
              <div key={field.name}>
                <Label htmlFor={`tramite-${field.name}`}>{field.label}</Label>
                {field.type === 'select' && field.options ? (
                  <Select
                    value={formValues[field.name] ?? ''}
                    onValueChange={(v) =>
                      setFormValues((prev) => ({ ...prev, [field.name]: v }))
                    }
                  >
                    <SelectTrigger id={`tramite-${field.name}`} className="mt-1.5">
                      <SelectValue placeholder="Seleccione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`tramite-${field.name}`}
                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    value={formValues[field.name] ?? ''}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                    className="mt-1.5"
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              Cerrar
            </Button>
            <Button onClick={closeModal}>Enviar solicitud (prueba)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TramitesDigitales;
