import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Upload, Eye, Loader2, Clock } from 'lucide-react';
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

/** Archivo elegido antes de que la solicitud exista; se sube al guardar. */
export interface ArchivoPendiente {
  /** documentoId del catálogo, o undefined si es nombre libre */
  documentoId?: string;
  nombre: string;
  file: File;
}

/** Sube los archivos en cola contra una solicitud recién creada. */
export async function subirArchivosPendientes(
  solicitudId: string,
  pendientes: ArchivoPendiente[],
): Promise<{ subidos: number; fallidos: number }> {
  let subidos = 0;
  let fallidos = 0;
  for (const p of pendientes) {
    try {
      await uploadSolicitudDocumento(solicitudId, p.file, {
        documentoId: p.documentoId,
        nombreDocumento: p.documentoId ? undefined : p.nombre,
      });
      subidos++;
    } catch {
      fallidos++;
    }
  }
  return { subidos, fallidos };
}

interface Props {
  /** Con id los archivos se suben de inmediato; sin id (y con onPendientesChange) quedan en cola. */
  solicitudId?: string;
  /** Documentos configurados para el tipo de contratación (ya filtrados por rama de uso). */
  documentosDelTipo: DocumentoRequeridoTipoContratacion[];
  /** Marca el tipo de documento como recibido en el checklist del formulario. */
  onDocumentoEntregado?: (nombre: string) => void;
  /** Cola de archivos para solicitudes aún no guardadas (estado del padre). */
  archivosPendientes?: ArchivoPendiente[];
  onPendientesChange?: (pendientes: ArchivoPendiente[]) => void;
  /** Mensaje cuando no hay id ni modo cola (p. ej. wizard sin solicitud vinculada). */
  mensajeSinSolicitud?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Entrega de documentos: se elige el tipo de documento (según el tipo de
 * contratación) y se suben uno o varios archivos bajo ese tipo. Si la solicitud
 * aún no existe, los archivos quedan en cola y se suben al guardar.
 */
export default function EntregaDocumentos({
  solicitudId,
  documentosDelTipo,
  onDocumentoEntregado,
  archivosPendientes,
  onPendientesChange,
  mensajeSinSolicitud,
}: Props) {
  const qc = useQueryClient();
  const [tipoDocSel, setTipoDocSel] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const conId = Boolean(solicitudId);
  const modoCola = !conId && Boolean(onPendientesChange);
  const habilitado = conId || modoCola;
  const pendientes = archivosPendientes ?? [];

  const entregadosQ = useQuery({
    queryKey: ['solicitud-documentos', solicitudId],
    queryFn: () => fetchSolicitudDocumentos(solicitudId!),
    enabled: conId,
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

  const resolverSeleccion = () => {
    const opcion = opciones.find((o) => o.value === tipoDocSel);
    const esLibre = tipoDocSel.startsWith('libre:');
    return { documentoId: esLibre ? undefined : tipoDocSel, nombre: opcion?.nombre ?? tipoDocSel };
  };

  const subirMut = useMutation({
    mutationFn: async (files: File[]) => {
      const { documentoId, nombre } = resolverSeleccion();
      for (const file of files) {
        await uploadSolicitudDocumento(solicitudId!, file, {
          documentoId,
          nombreDocumento: documentoId ? undefined : nombre,
        });
      }
      return nombre;
    },
    onSuccess: (nombre) => {
      qc.invalidateQueries({ queryKey: ['solicitud-documentos', solicitudId] });
      if (nombre && onDocumentoEntregado) onDocumentoEntregado(nombre);
      toast.success('Documento(s) subido(s)');
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Error al subir'),
  });

  const encolar = (files: File[]) => {
    const { documentoId, nombre } = resolverSeleccion();
    onPendientesChange?.([
      ...pendientes,
      ...files.map((file) => ({ documentoId, nombre, file })),
    ]);
    if (onDocumentoEntregado) onDocumentoEntregado(nombre);
    if (fileRef.current) fileRef.current.value = '';
  };

  const eliminarMut = useMutation({
    mutationFn: (docId: string) => deleteSolicitudDocumento(solicitudId!, docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['solicitud-documentos', solicitudId] }),
    onError: () => toast.error('No se pudo eliminar el archivo'),
  });

  // Agrupar (subidos + en cola) por tipo de documento
  const grupos = useMemo(() => {
    type Item =
      | { kind: 'subido'; dto: SolicitudDocumentoDto }
      | { kind: 'pendiente'; idx: number; p: ArchivoPendiente };
    const m = new Map<string, { nombre: string; items: Item[] }>();
    const push = (key: string, nombre: string, item: Item) => {
      if (!m.has(key)) m.set(key, { nombre, items: [] });
      m.get(key)!.items.push(item);
    };
    for (const d of entregadosQ.data ?? []) {
      push(d.documentoId ?? d.nombreDocumento ?? 'otros', d.documento?.nombre ?? d.nombreDocumento ?? 'Sin clasificar', { kind: 'subido', dto: d });
    }
    pendientes.forEach((p, idx) => {
      push(p.documentoId ?? p.nombre, p.nombre, { kind: 'pendiente', idx, p });
    });
    return [...m.values()];
  }, [entregadosQ.data, pendientes]);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Archivos entregados:</p>

      {!habilitado && (
        <p className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
          {mensajeSinSolicitud ?? 'Guarde la solicitud para poder adjuntar archivos.'}
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
                placeholder={opciones.length === 0 ? 'Sin documentos en catálogo' : 'Tipo de documento…'}
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
                if (files.length === 0) return;
                if (conId) subirMut.mutate(files);
                else encolar(files);
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
              {conId ? 'Subir archivo(s)' : 'Agregar archivo(s)'}
            </Button>
          </div>

          {modoCola && pendientes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <Clock className="mr-1 inline h-3 w-3" />
              {pendientes.length} archivo(s) en cola — se subirán al guardar la solicitud.
            </p>
          )}

          {usarCatalogoCompleto && opciones.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Este tipo de contratación aún no tiene documentos configurados; se muestra el catálogo completo.
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
                    {g.items.map((it) =>
                      it.kind === 'subido' ? (
                        <li key={it.dto.id} className="flex items-center gap-2 text-sm">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{it.dto.archivoNombre}</span>
                          <span className="text-xs text-muted-foreground">{formatBytes(it.dto.tamanoBytes)}</span>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Ver"
                            onClick={() => void openSolicitudDocumento(solicitudId!, it.dto.id)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Eliminar"
                            disabled={eliminarMut.isPending} onClick={() => eliminarMut.mutate(it.dto.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ) : (
                        <li key={`p-${it.idx}`} className="flex items-center gap-2 text-sm">
                          <Clock className="h-4 w-4 shrink-0 text-amber-500" />
                          <span className="min-w-0 flex-1 truncate">{it.p.file.name}</span>
                          <span className="text-xs text-muted-foreground">{formatBytes(it.p.file.size)} · en cola</span>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Quitar de la cola"
                            onClick={() => onPendientesChange?.(pendientes.filter((_, i) => i !== it.idx))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ),
                    )}
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
