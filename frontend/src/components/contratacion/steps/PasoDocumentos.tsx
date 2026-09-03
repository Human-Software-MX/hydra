import { Label } from '@/components/ui/label';
import type { StepProps } from '../hooks/useWizardState';
import EntregaDocumentos, { nombreDeRequerido } from '../EntregaDocumentos';

export default function PasoDocumentos({ data, updateData, config }: StepProps) {
  const entregados = data.documentosRecibidos;

  const agregarRecibido = (nombre: string) => {
    if (entregados.includes(nombre)) return;
    updateData({ documentosRecibidos: [...entregados, nombre] });
  };

  const quitarRecibido = (nombre: string) => {
    updateData({ documentosRecibidos: entregados.filter((n) => n !== nombre) });
  };

  return (
    <section aria-labelledby="paso-documentos" className="space-y-4">
      <div>
        <h2 id="paso-documentos" className="text-base font-semibold">
          Documentos
        </h2>
        <p className="text-sm text-muted-foreground">
          Marque los documentos entregados por el cliente y adjunte los archivos correspondientes en
          cada uno.
        </p>
      </div>

      <EntregaDocumentos
        solicitudId={data.solicitudId}
        documentosDelTipo={config?.documentos ?? []}
        esRecibido={(d) => entregados.includes(nombreDeRequerido(d))}
        onToggleRecibido={(d, recibido) =>
          recibido ? agregarRecibido(nombreDeRequerido(d)) : quitarRecibido(nombreDeRequerido(d))
        }
        mensajeSinSolicitud="Este contrato no tiene una solicitud vinculada; los archivos se adjuntan desde la solicitud de servicio."
      />

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Label className="sr-only" htmlFor="doc-count-resumen">
          Resumen
        </Label>
        <span id="doc-count-resumen" role="status">
          {entregados.length} documento(s) marcados como recibidos.
        </span>
      </div>
    </section>
  );
}
