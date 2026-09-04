import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeDollarSign, AlertTriangle } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  fetchTarifasVigentes,
  fetchCategoriasTarifa,
  cotizarContratacion,
  type CotizacionContratacionDto,
} from '@/api/tarifas';
import { buildTarifaKey } from '@/lib/cotizacion-tarifas';
import type { TipoContratacion } from '@/api/tipos-contratacion';

const fmtMXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** Variante de instalación de medidor según el diámetro capturado. */
function varianteInstalacion(diametro: string): string {
  const d = diametro.replace(/"/g, '').trim();
  if (d === '2') return 'Instalación Med 2 pulg';
  if (d === '3') return 'Instalación Med 3 pulg';
  if (d === '4') return 'Instalación Med 4 pulg';
  return 'Instalación Med 1/2, 3/4 y 1 pulg';
}

interface ConceptoCotizado {
  etiqueta: string;
  detalle?: string;
  cotizacion: CotizacionContratacionDto | null;
  error?: string;
}

interface Props {
  administracionId: string;
  tipo: TipoContratacion | undefined;
  /** variablesCapturadas de la solicitud (DIAMETRO_TOMA, MATERIAL_CALLE, METROS_TOMA, …) */
  variables: Record<string, unknown>;
}

/**
 * Tarifas aplicables al tipo de contratación elegido, resueltas automáticamente:
 * la clase tarifaria viene del tipo (TipoContratacion.claseTarifaId) y los importes
 * de contratación se cotizan en vivo contra el motor versionado
 * (GET /tarifas/contratacion/cotizar) usando las variables capturadas.
 * No hay dropdown de "todas las tarifas": la tarifa se deriva, no se elige —
 * solo aparece un selector (con búsqueda) cuando el tipo no tiene clase asignada.
 */
export default function TarifasAplicables({ administracionId, tipo, variables }: Props) {
  const [clasePreview, setClasePreview] = useState('');
  const claseTarifaId = tipo?.claseTarifaId ?? tipo?.claseTarifa?.id ?? (clasePreview || undefined);
  const sinClase = Boolean(tipo) && !tipo?.claseTarifaId && !tipo?.claseTarifa?.id;

  const v = (k: string): string => String(variables?.[k] ?? '').trim();
  const num = (k: string): number => {
    const n = parseFloat(v(k));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const matCalle = v('MATERIAL_CALLE');
  const matBanqueta = v('MATERIAL_BANQUETA');
  const varianteMateriales = matCalle && matBanqueta ? buildTarifaKey(matCalle, matBanqueta) : null;
  const metrosToma = num('METROS_TOMA');
  const metrosDescarga = num('METROS_DESCARGA');
  const diametroToma = v('DIAMETRO_TOMA');

  // Catálogo de clases: solo para el fallback sin clase asignada
  const categoriasQ = useQuery({
    queryKey: ['tarifas', 'catalogo-categorias'],
    queryFn: fetchCategoriasTarifa,
    enabled: sinClase,
    staleTime: 60 * 60 * 1000,
  });

  // Tarifa periódica de agua vigente para la clase del tipo
  const periodicaQ = useQuery({
    queryKey: ['tarifas-vigentes-agua', administracionId, claseTarifaId],
    queryFn: () =>
      fetchTarifasVigentes({ administracionId, claseTarifaId, tipoServicio: 'agua' }),
    enabled: Boolean(administracionId && claseTarifaId),
    staleTime: 10 * 60 * 1000,
  });

  // Conceptos de contratación cotizados en vivo según variables capturadas
  const conceptosQ = useQuery({
    queryKey: [
      'cotizacion-contratacion',
      administracionId,
      claseTarifaId,
      varianteMateriales,
      metrosToma,
      metrosDescarga,
      diametroToma,
    ],
    enabled: Boolean(administracionId && tipo),
    queryFn: async (): Promise<ConceptoCotizado[]> => {
      const intentos: { etiqueta: string; detalle?: string; params: Parameters<typeof cotizarContratacion>[0] }[] = [];
      if (claseTarifaId) {
        intentos.push({
          etiqueta: 'Derechos de contratación',
          params: { administracionId, tipoServicio: 'contratacion_derechos_de_contratacion', claseTarifaId, cantidad: 0 },
        });
        intentos.push({
          etiqueta: 'Agua (contratación)',
          detalle: 'consumo asignado',
          params: { administracionId, tipoServicio: 'contratacion_agua', claseTarifaId, cantidad: 0 },
        });
      }
      if (varianteMateriales) {
        intentos.push({
          etiqueta: 'Derechos de conexión — agua',
          detalle: `${varianteMateriales} · ${metrosToma || 0} m (6 incluidos en la base)`,
          params: { administracionId, tipoServicio: 'contratacion_derechos_de_conexion_a_red_de_agua', variante: varianteMateriales, cantidad: metrosToma },
        });
        intentos.push({
          etiqueta: 'Derechos de conexión — drenaje',
          detalle: `${varianteMateriales} · ${metrosDescarga || 0} m`,
          params: { administracionId, tipoServicio: 'contratacion_derechos_de_conexion_red_de_drenaje', variante: varianteMateriales, cantidad: metrosDescarga },
        });
      }
      if (diametroToma) {
        intentos.push({
          etiqueta: 'Instalación de medidor',
          detalle: diametroToma,
          params: { administracionId, tipoServicio: 'contratacion_instalacion_de_medidor', variante: varianteInstalacion(diametroToma), cantidad: 0 },
        });
      }
      const resultados = await Promise.allSettled(intentos.map((i) => cotizarContratacion(i.params)));
      return intentos.map((i, idx) => {
        const r = resultados[idx];
        return r.status === 'fulfilled'
          ? { etiqueta: i.etiqueta, detalle: i.detalle, cotizacion: r.value }
          : { etiqueta: i.etiqueta, detalle: i.detalle, cotizacion: null, error: 'sin tarifa en esta administración' };
      });
    },
  });

  if (!tipo) return null;

  const periodica = periodicaQ.data?.[0];
  const conceptos = conceptosQ.data ?? [];
  const totalEstimado = conceptos.reduce((acc, c) => acc + (c.cotizacion?.total ?? 0), 0);
  const clasesOpciones = (categoriasQ.data ?? []).flatMap((cat) =>
    (cat.clases ?? []).map((cl) => ({ value: cl.id, label: `${cl.nombre} (${cat.nombre})` })),
  );

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <BadgeDollarSign className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Tarifas aplicables</p>
        {tipo.claseTarifa && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {tipo.claseTarifa.nombre}
            {tipo.claseTarifa.categoria ? ` · ${tipo.claseTarifa.categoria.nombre}` : ''}
          </span>
        )}
      </div>

      {sinClase && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            Este tipo de contratación no tiene clase tarifaria asignada; elija una para la vista previa.
          </p>
          <SearchableSelect
            value={clasePreview}
            onValueChange={setClasePreview}
            options={clasesOpciones}
            placeholder="Clase tarifaria…"
            searchPlaceholder="Buscar clase…"
            className="max-w-sm"
          />
        </div>
      )}

      {claseTarifaId && (
        <div className="text-sm">
          <span className="text-muted-foreground">Tarifa periódica de agua: </span>
          {periodicaQ.isLoading ? (
            'consultando…'
          ) : periodica ? (
            <span>
              {fmtMXN.format(Number(periodica.valorReferencia ?? 0))}{' '}
              <span className="text-xs text-muted-foreground">
                (ref. 10 m³ · IVA {Number(periodica.ivaPct)}% · vigente desde{' '}
                {String(periodica.vigenciaDesde).slice(0, 10)})
              </span>
            </span>
          ) : (
            <span className="text-amber-600">sin tarifa vigente para esta clase/administración</span>
          )}
        </div>
      )}

      {conceptos.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Conceptos de contratación (afectan la cuantificación)
          </p>
          <ul className="divide-y rounded-md border bg-background">
            {conceptos.map((c) => (
              <li key={c.etiqueta} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  {c.etiqueta}
                  {c.detalle && <span className="ml-1 text-xs text-muted-foreground">({c.detalle})</span>}
                </span>
                {c.cotizacion ? (
                  <span className="tabular-nums">
                    {fmtMXN.format(c.cotizacion.total)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {c.cotizacion.ivaNoObjeto ? 'no objeto de IVA' : `IVA ${c.cotizacion.ivaPct}%`}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{c.error}</span>
                )}
              </li>
            ))}
            <li className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold">
              <span className="flex-1">Total estimado de contratación</span>
              <span className="tabular-nums">{fmtMXN.format(totalEstimado)}</span>
            </li>
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Estimación con tarifas vigentes del motor versionado; la cuantificación formal puede
            agregar o quitar conceptos.
          </p>
        </div>
      )}
    </div>
  );
}
