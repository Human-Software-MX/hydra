import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Upload, Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from '@/components/ui/sonner';
import {
  fetchSolicitudDocumentos,
  uploadSolicitudDocumento,
  deleteSolicitudDocumento,
  openSolicitudDocumento,
  type SolicitudDocumentoDto,
} from '@/api/solicitudes';
import { fetchCatalogoDocumentos } from '@/api/tipos-contratacion';
import type { DocumentoRequeridoTipoContratacion } from '@/api/tipos-contratacion';

interface Props {
  /** Sin id (solicitud aún no guardada) el control se muestra deshabilitado. */
  solicitudId?: string;
  /** Documentos configurados para el tipo de contratación (ya filtrados por rama de uso). */
  documentosDelTipo: DocumentoRequeridoTipoContratacion[];
  /** Marca el tipo de documento como recibido en el checklist de la solicitud. */
  onDocumentoEntregado?: (nombre: string) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Entrega de documentos de la solicitud: se elige el tipo de documento (según el
 * tipo de contratación) y se suben uno o varios archivos bajo ese tipo.
 */
export default function EntregaDocumentos({ solicitudId, documentosDelTipo, onDocumentoEntregado }: Props) {
  const qc = useQueryClient();
  const [tipoDocSel, setTipoDocSel] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const habilitado = Boolean(solicitudId);

  const entregadosQ = useQuery({
    queryKey: ['solicitud-documentos', solicitudId],
    queryFn: () => fetchSolicitudDocumentos(solicitudId!),
    enabled: habilitado,
  });

  // El mapeo tipo→documento lo cura CEA; mientras un tipo no tenga documentos
  // configurados, se ofrece el catálogo completo para no bloquear la ventanilla.
  const usarCatalogoCompleto = documentosDelTipo.length === 0;
  const catalogoQ = useQuery({
    queryKey: ['catalogo-documentos', 'activos'],
    queryFn: () => fetchCatalogoDocumentos({ activo: true }),
    enabled: habilitado && usarCatalogoCompleto,
    staleTime: 60 * 60 * 1000,
  });

  const opciones = useMemo(() => {
    if (!usarCatalogoCompleto) {
      return documentosDelTipo.map((d) => ({
        value: d.documentoId ?? `libre:${d.id}`,
        label: (d.documento?.nombre ?? d.nombreDocumento ?? d.id) + (d.obligatorio ? ' *' : ''),
        nombre: d.documento?.nombre ?? d.nombreDocumento ?? d.id,
      }));
    }
    return (catalogoQ.data ?? []).map((d) => ({ value: d.id, label: d.nombre, nombre: d.nombre }));
  }, [usarCatalogoCompleto, documentosDelTipo, catalogoQ.data]);

  const subirMut = useMutation({
    mutationFn: async (files: File[]) => {
      const opcion = opciones.find((o) => o.value === tipoDocSel);
      const esLibre = tipoDocSel.startsWith('libre:');
      for (const file of files) {
        await uploadSolicitudDocumento(solicitudId!, file, {
          documentoId: esLibre ? undefined : tipoDocSel,
          nombreDocumento: esLibre ? opcion?.nombre : undefined,
        });
      }
      return opcion?.nombre;
    },
    onSuccess: (nombre) => {
      qc.invalidateQueries({ queryKey: ['solicitud-documentos', solicitudId] });
      if (nombre && onDocumentoEntregado) onDocumentoEntregado(nombre);
      toast.success('Documento(s) subido(s)');
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Error al subir'),
  });

  const eliminarMut = useMutation({
    mutationFn: (docId: string) => deleteSolicitudDocumento(solicitudId!, docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['solicitud-documentos', solicitudId] }),
    onError: () => toast.error('No se pudo eliminar el archivo'),
  });

  // Agrupar entregados por tipo de documento
  const grupos = useMemo(() => {
    const m = new Map<string, { nombre: string; items: SolicitudDocumentoDto[] }>();
    for (const d of entregadosQ.data ?? []) {
      const key = d.documentoId ?? d.nombreDocumento ?? 'otros';
      const nombre = d.documento?.nombre ?? d.nombreDocumento ?? 'Sin clasificar';
      if (!m.has(key)) m.set(key, { nombre, items: [] });
      m.get(key)!.items.push(d);
    }
    return [...m.values()];
  }, [entregadosQ.data]);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Archivos entregados:</p>

      {!habilitado && (
        <p className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
          Guarde la solicitud para poder adjuntar archivos.
        </p>
      )}

      {habilitado && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[260px] flex-1">
              <SearchableSelect
                value={tipoDocSel}
                onValueChange={setTipoDocSel}
                options={opciones.map(({ value, label }) => ({ value, label }))}
                placeholder={
                  opciones.length === 0 ? 'Sin documentos en catálogo' : 'Tipo de documento…'
                }
                searchPlaceholder="Buscar documento…"
                disabled={opciones.length === 0}
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) subirMut.mutate(files);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!tipoDocSel || subirMut.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {subirMut.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              Subir archivo(s)
            </Button>
          </div>

          {usarCatalogoCompleto && opciones.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Este tipo de contratación aún no tiene documentos configurados; se muestra el
              catálogo completo.
            </p>
          )}

          {grupos.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              {grupos.map((g) => (
                <div key={g.nombre}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.nombre} ({g.items.length})
                  </p>
                  <ul className="mt-1 space-y-1">
                    {g.items.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{d.archivoNombre}</span>
                        <span className="text-xs text-muted-foreground">{formatBytes(d.tamanoBytes)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Ver"
                          onClick={() => void openSolicitudDocumento(solicitudId!, d.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title="Eliminar"
                          disabled={eliminarMut.isPending}
                          onClick={() => eliminarMut.mutate(d.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
