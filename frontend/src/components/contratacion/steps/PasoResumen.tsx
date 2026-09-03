import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { fetchActividades, fetchCalibres, fetchDistritos } from '@/api/catalogos';
import {
  fetchInegiMunicipiosCatalogo,
  fetchInegiLocalidadesCatalogo,
  fetchInegiColoniasCatalogo,
} from '@/api/domicilios-inegi';
import { formatearCoordenadas } from '@/lib/geo-picker';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMxn, useBillingPreview } from '../hooks/useBillingPreview';
import type { StepProps } from '@/components/contratacion/hooks/useWizardState';
import {
  mergedVariablesCapturadasDisplay,
  variablesStepSatisfied,
} from '@/components/contratacion/hooks/useWizardState';
import { TIPOS_PUNTO_SERVICIO } from '../wizard-catalogos-ui';

function SectionBadge({ ok }: { ok: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        ok
          ? 'border-emerald-600/50 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100'
          : 'border-amber-600/50 bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100'
      }
    >
      {ok ? 'Completo' : 'Pendiente'}
    </Badge>
  );
}

/** Claves que se fusionan en `variablesCapturadas` sin pasar por el catálogo de tipo. */
const VARIABLE_KEY_FALLBACK: Record<string, string> = {
  distritoId: 'Distrito',
  calibreMedidorId: 'Calibre de medidor',
  fechaInstalacionConexion: 'Fecha instalación conexión',
  conexionYaExiste: 'Conexión ya existe',
  posibleCorte: 'Posible corte',
  conceptosLecturaPeriodicaIds: 'Conceptos lectura periódica',
};

function labelVariables(
  config: StepProps['config'],
  key: string,
): string {
  const vars = config?.variables ?? [];
  const found = vars.find(
    (v) =>
      v.id === key ||
      v.tipoVariable?.id === key ||
      v.tipoVariable?.codigo === key,
  );
  if (found?.tipoVariable?.nombre) return found.tipoVariable.nombre;
  if (found?.tipoVariable?.codigo) return found.tipoVariable.codigo;
  return VARIABLE_KEY_FALLBACK[key] ?? key;
}

function formatValor(v: string | number | boolean): string {
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v);
}

function formatVariableDisplayValue(
  key: string,
  val: string | number | boolean,
  opts: {
    distritoNombreById: Map<string, string>;
    calibreLabelById: Map<string, string>;
  },
): string {
  if (typeof val !== 'string') return formatValor(val);
  if (key === 'distritoId') {
    return opts.distritoNombreById.get(val) ?? val;
  }
  if (key === 'calibreMedidorId') {
    return opts.calibreLabelById.get(val) ?? val;
  }
  return formatValor(val);
}

export default function PasoResumen({ data, config }: StepProps) {
  const mergedVc = useMemo(() => mergedVariablesCapturadasDisplay(data), [data]);

  const actividadesQ = useQuery({
    queryKey: ['catalogos', 'actividades', 'wizard-resumen'],
    queryFn: fetchActividades,
    enabled: Boolean(data.actividadId?.trim()) && !data.actividadNombre?.trim(),
  });
  const vc = mergedVc;
  const distritosQ = useQuery({
    queryKey: ['catalogos', 'distritos', 'wizard-resumen'],
    queryFn: fetchDistritos,
    enabled: typeof vc.distritoId === 'string' && vc.distritoId.length > 0,
  });
  const calibresQ = useQuery({
    queryKey: ['catalogos', 'calibres', 'wizard-resumen'],
    queryFn: fetchCalibres,
    enabled: typeof vc.calibreMedidorId === 'string' && vc.calibreMedidorId.length > 0,
  });

  // ── Domicilio del predio — resolución de nombres desde IDs ───────────────
  const predioDir = data.solicitudFormSnapshot?.predioDir;
  const mpioId = predioDir?.municipioINEGIId;
  const locId = predioDir?.localidadINEGIId;
  const colId = predioDir?.coloniaINEGIId;
  const estadoId = predioDir?.estadoINEGIId;

  const mpioQ = useQuery({
    queryKey: ['inegi-municipios', estadoId],
    queryFn: () => fetchInegiMunicipiosCatalogo({ estadoId: estadoId!, limit: 200 }),
    enabled: Boolean(estadoId) && Boolean(mpioId),
    staleTime: 10 * 60 * 1000,
  });
  const locQ = useQuery({
    queryKey: ['inegi-localidades', mpioId],
    queryFn: () => fetchInegiLocalidadesCatalogo({ municipioId: mpioId!, limit: 500 }),
    enabled: Boolean(mpioId) && Boolean(locId),
    staleTime: 10 * 60 * 1000,
  });
  const colQ = useQuery({
    queryKey: ['inegi-colonias', locId],
    queryFn: () => fetchInegiColoniasCatalogo({ localidadId: locId!, limit: 500 }),
    enabled: Boolean(locId) && Boolean(colId),
    staleTime: 10 * 60 * 1000,
  });

  const mpioNombre = useMemo(
    () => (mpioQ.data?.data ?? []).find((m) => m.id === mpioId)?.nombre ?? '',
    [mpioQ.data, mpioId],
  );
  const locNombre = useMemo(
    () => (locQ.data?.data ?? []).find((l) => l.id === locId)?.nombre ?? '',
    [locQ.data, locId],
  );
  const colNombre = useMemo(
    () => (colQ.data?.data ?? []).find((c) => c.id === colId)?.nombre ?? '',
    [colQ.data, colId],
  );

  const predioGeoLinea = useMemo(() => {
    const parts = [
      colNombre ? `Col. ${colNombre}` : '',
      locNombre,
      mpioNombre,
    ].filter(Boolean);
    return parts.join(', ');
  }, [colNombre, locNombre, mpioNombre]);

  const distritoNombreById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of distritosQ.data ?? []) {
      m.set(d.id, d.nombre);
    }
    return m;
  }, [distritosQ.data]);

  const calibreLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calibresQ.data ?? []) {
      m.set(c.id, c.descripcion?.trim() || c.codigo || c.id);
    }
    return m;
  }, [calibresQ.data]);

  const actividadDisplay = useMemo(() => {
    const manual = data.actividadNombre?.trim();
    if (manual) return manual;
    const id = data.actividadId?.trim();
    if (!id) return '—';
    const row = (actividadesQ.data ?? []).find((a) => a.id === id);
    if (row) return row.descripcion?.trim() || row.codigo || id;
    return actividadesQ.isLoading ? '…' : id;
  }, [data.actividadId, data.actividadNombre, actividadesQ.data, actividadesQ.isLoading]);

  const tipoContratacionIdPreview = data.tipoContratacionId?.trim() || undefined;
  const { preview, isLoading: billingLoading } = useBillingPreview({
    tipoContratacionId: tipoContratacionIdPreview,
    variables: mergedVc,
    conceptosOverride: data.conceptosOverride,
  });

  const psOk = !!(data.puntoServicioCodigo?.trim() || data.puntoServicioId);
  const prop = data.propietario;
  const fiscal = data.personaFiscal;
  const contacto = data.personaContacto;
  const personasOk = [prop, fiscal, contacto].some(
    (p) => p && (p.nombre?.trim() || p.rfc?.trim() || p.personaId),
  );
  const configOk = !!(data.actividadId && data.tipoContratacionId);
  const varsOk = variablesStepSatisfied(data, config);
  const docsOk = data.documentosRecibidos.length > 0;
  const cotizacionTotal = (data.cotizacionPrevia ?? []).reduce((s, c) => s + c.subtotal, 0);
  const effectiveTotal = preview && preview.total > 0 ? preview.total : cotizacionTotal;
  const billingOk =
    !!data.tipoContratacionId && !billingLoading && (preview != null || cotizacionTotal > 0);

  const ordenesDesc: string[] = [];
  if (data.generarOrdenInstalacionToma) ordenesDesc.push('Instalación de toma');
  if (data.generarOrdenInstalacionMedidor) ordenesDesc.push('Instalación de medidor');
  const ordenesOk = ordenesDesc.length > 0;

  const tipoNombre =
    config?.id === data.tipoContratacionId && config?.nombre
      ? config.nombre
      : data.tipoContratacionDescripcion?.trim() || data.tipoContratacionId?.trim() || '—';

  const tipoPsLabel =
    TIPOS_PUNTO_SERVICIO.find((t) => t.id === data.tipoPuntoServicio)?.descripcion ??
    data.tipoPuntoServicio;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/20 px-4 py-6 text-center sm:flex-row sm:text-left">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
          <CheckCircle2 className="h-8 w-8" aria-hidden />
        </div>
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Revise los datos del contrato antes de confirmar
          </h2>
          <p className="text-sm text-muted-foreground">
            Use el botón <span className="font-medium text-foreground">Crear Contrato</span> al final del
            asistente para registrar el contrato con todos los datos capturados.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg">Punto de servicio</CardTitle>
          <SectionBadge ok={psOk} />
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Código</dt>
              <dd className="font-medium">{data.puntoServicioCodigo?.trim() || '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Domicilio del predio</dt>
              <dd className="font-medium break-words">
                {data.predioDomicilioResumen?.trim() ||
                  data.puntoServicioDireccion?.trim() ||
                  '—'}
                {predioGeoLinea && (
                  <span className="block text-sm text-muted-foreground font-normal">
                    {predioGeoLinea}
                  </span>
                )}
                {formatearCoordenadas(predioDir?.gpsLat, predioDir?.gpsLng) && (
                  <span className="block text-sm text-muted-foreground font-normal">
                    GPS: {formatearCoordenadas(predioDir?.gpsLat, predioDir?.gpsLng)}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg">Personas</CardTitle>
          <SectionBadge ok={personasOk} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Propietario
            </h4>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Nombre completo</dt>
                <dd>{[prop?.paterno, prop?.materno, prop?.nombre].filter(Boolean).join(' ') || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">RFC</dt>
                <dd className="font-mono text-xs">{prop?.rfc?.trim() || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tipo de persona</dt>
                <dd className="capitalize">{prop?.tipoPersona || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Correo</dt>
                <dd>{prop?.email?.trim() || '—'}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Fiscal
            </h4>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Nombre / razón social</dt>
                <dd>{[fiscal?.paterno, fiscal?.materno, fiscal?.nombre].filter(Boolean).join(' ') || fiscal?.razonSocial?.trim() || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">RFC</dt>
                <dd className="font-mono text-xs">{fiscal?.rfc?.trim() || '—'}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Contacto
            </h4>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Nombre</dt>
                <dd>{contacto?.nombre?.trim() || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">RFC</dt>
                <dd className="font-mono text-xs">{contacto?.rfc?.trim() || '—'}</dd>
              </div>
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg">Configuración</CardTitle>
          <SectionBadge ok={configOk} />
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Actividad</dt>
              <dd className="font-medium">{actividadDisplay}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tipo de contratación</dt>
              <dd>{tipoNombre}</dd>
            </div>
            {data.tipoPuntoServicio ? (
              <div>
                <dt className="text-muted-foreground">Tipo de punto de servicio</dt>
                <dd>{tipoPsLabel}</dd>
              </div>
            ) : null}
            {data.referenciaContratoAnterior ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Referencia contrato anterior</dt>
                <dd>{data.referenciaContratoAnterior}</dd>
              </div>
            ) : null}
            {data.superficiePredio != null ? (
              <div>
                <dt className="text-muted-foreground">Superficie predio (m²)</dt>
                <dd>{data.superficiePredio}</dd>
              </div>
            ) : null}
            {data.superficieConstruida != null ? (
              <div>
                <dt className="text-muted-foreground">Superficie construida (m²)</dt>
                <dd>{data.superficieConstruida}</dd>
              </div>
            ) : null}
            {data.unidadesServidas != null ? (
              <div>
                <dt className="text-muted-foreground">Unidades servidas</dt>
                <dd>{data.unidadesServidas}</dd>
              </div>
            ) : null}
            {data.personasHabitanVivienda != null ? (
              <div>
                <dt className="text-muted-foreground">Personas en la vivienda</dt>
                <dd>{data.personasHabitanVivienda}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg">Variables</CardTitle>
          <SectionBadge ok={varsOk} />
        </CardHeader>
        <CardContent>
          {Object.keys(mergedVc).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin variables capturadas.</p>
          ) : (
            <dl className="grid gap-3 text-sm">
              {Object.entries(mergedVc).map(([key, val]) => (
                <div key={key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                  <dt className="min-w-[160px] text-muted-foreground">{labelVariables(config, key)}</dt>
                  <dd className="font-medium break-all">
                    {formatVariableDisplayValue(key, val, { distritoNombreById, calibreLabelById })}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg">Documentos</CardTitle>
          <SectionBadge ok={docsOk} />
        </CardHeader>
        <CardContent>
          {data.documentosRecibidos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ningún documento registrado.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-sm">
              {data.documentosRecibidos.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg">Facturación</CardTitle>
          <SectionBadge ok={billingOk} />
        </CardHeader>
        <CardContent>
          {!data.tipoContratacionId ? (
            <p className="text-sm text-muted-foreground">Sin tipo de contratación — no hay total.</p>
          ) : billingLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Calculando total…
            </div>
          ) : effectiveTotal > 0 ? (
            <div className="space-y-0.5">
              <p className="text-lg font-semibold tabular-nums">{formatMxn(effectiveTotal)}</p>
              {cotizacionTotal > 0 && (!preview || preview.total === 0) ? (
                <p className="text-xs text-muted-foreground">Total de la cotización aprobada</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No fue posible obtener el total.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg">Órdenes</CardTitle>
          <SectionBadge ok={ordenesOk} />
        </CardHeader>
        <CardContent>
          {ordenesDesc.length === 0 ? (
            <p className="text-sm text-muted-foreground">No se crearán órdenes de instalación.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-sm">
              {ordenesDesc.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
