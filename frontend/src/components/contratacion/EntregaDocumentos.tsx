import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Paperclip, Eye, Loader2, Clock, Upload } from 'lucide-react';
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

export function nombreDeRequerido(d: DocumentoRequeridoTipoContratacion): string {
  return d.documento?.nombre ?? d.nombreDocumento ?? d.id;
}

interface Props {
  /** Con id los archivos se suben de inmediato; sin id (y con onPendientesChange) quedan en cola. */
  solicitudId?: string;
  /** Documentos configurados para el tipo de contratación (ya filtrados por rama de uso). */
  documentosDelTipo: DocumentoRequeridoTipoContratacion[];
  /** Estado del checklist: ¿este documento está marcado como recibido? */
  esRecibido: (d: DocumentoRequeridoTipoContratacion) => boolean;
  /** Marca/desmarca el documento como recibido. */
  onToggleRecibido: (d: DocumentoRequeridoTipoContratacion, recibido: boolean) => void;
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

const PRESENTACION_LABEL: Record<string, string> = {
  ORIGINAL: 'original',
  COPIA: 'copia',
  ORIGINAL_Y_COPIA: 'original y copia',
};

/**
 * Lista unificada de documentos del tipo de contratación: cada fila lleva su
 * check de "recibido" y su botón para adjuntar archivos (subida inmediata con
 * solicitud guardada; en cola si la solicitud aún no existe). Si el tipo no
 * tiene documentos configurados, se ofrece un combo con búsqueda sobre el
 * catálogo completo.
 */
export default function EntregaDocumentos({
  solicitudId,
  documentosDelTipo,
  esRecibido,
  onToggleRecibido,
  archivosPendientes,
  onPendientesChange,
  mensajeSinSolicitud,
}: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  // destino del próximo archivo: clave del documento al que se adjunta
  const [destino, setDestino] = useState<{ documentoId?: string; nombre: string } | null>(null);
  const [tipoDocSel, setTipoDocSel] = useState('');
  const conId = Boolean(solicitudId);
  const modoCola = !conId && Boolean(onPendientesChange);
  const puedeAdjuntar = conId || modoCola;
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
    enabled: puedeAdjuntar && usarCatalogoCompleto,
    staleTime: 60 * 60 * 1000,
  });

  const archivosPorClave = useMemo(() => {
    type Item =
      | { kind: 'subido'; dto: SolicitudDocumentoDto }
      | { kind: 'pendiente'; idx: number; p: ArchivoPendiente };
    const m = new Map<string, Item[]>();
    const push = (key: string, item: Item) => {
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(item);
    };
    for (const d of entregadosQ.data ?? []) {
      push(d.documentoId ?? d.nombreDocumento ?? 'otros', { kind: 'subido', dto: d });
    }
    pendientes.forEach((p, idx) => push(p.documentoId ?? p.nombre, { kind: 'pendiente', idx, p }));
    return m;
  }, [entregadosQ.data, pendientes]);

  const subirMut = useMutation({
    mutationFn: async ({ files, doc }: { files: File[]; doc: { documentoId?: string; nombre: string } }) => {
      for (const file of files) {
        await uploadSolicitudDocumento(solicitudId!, file, {
          documentoId: doc.documentoId,
          nombreDocumento: doc.documentoId ? undefined : doc.nombre,
        });
      }
      return doc;
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['solicitud-documentos', solicitudId] });
      const fila = documentosDelTipo.find((d) => (d.documentoId ?? nombreDeRequerido(d)) === (doc.documentoId ?? doc.nombre));
      if (fila && !esRecibido(fila)) onToggleRecibido(fila, true);
      toast.success('Documento(s) subido(s)');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Error al subir'),
  });

  const eliminarMut = useMutation({
    mutationFn: (docId: string) => deleteSolicitudDocumento(solicitudId!, docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['solicitud-documentos', solicitudId] }),
    onError: () => toast.error('No se pudo eliminar el archivo'),
  });

  const abrirSelectorPara = (doc: { documentoId?: string; nombre: string }) => {
    setDestino(doc);
    fileRef.current?.click();
  };

  const onArchivosElegidos = (files: File[]) => {
    if (!destino || files.length === 0) return;
    if (conId) {
      subirMut.mutate({ files, doc: destino });
    } else {
      onPendientesChange?.([
        ...pendientes,
        ...files.map((file) => ({ documentoId: destino.documentoId, nombre: destino.nombre, file })),
      ]);
      const fila = documentosDelTipo.find((d) => (d.documentoId ?? nombreDeRequerido(d)) === (destino.documentoId ?? destino.nombre));
      if (fila && !esRecibido(fila)) onToggleRecibido(fila, true);
    }
    if (fileRef.current) fileRef.current.value = '';
    setDestino(null);
  };

  const renderArchivos = (clave: string) => {
    const items = archivosPorClave.get(clave) ?? [];
    if (items.length === 0) return null;
    return (
      <ul className="mt-1.5 space-y-1 pl-7">
        {items.map((it) =>
          it.kind === 'subido' ? (
            <li key={it.dto.id} className="flex items-center gap-2 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{it.dto.archivoNombre}</span>
              <span className="text-muted-foreground">{formatBytes(it.dto.tamanoBytes)}</span>
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Ver"
                onClick={() => void openSolicitudDocumento(solicitudId!, it.dto.id)}>
                <Eye className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="Eliminar"
                disabled={eliminarMut.isPending} onClick={() => eliminarMut.mutate(it.dto.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ) : (
            <li key={`p-${it.idx}`} className="flex items-center gap-2 text-xs">
              <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="min-w-0 flex-1 truncate">{it.p.file.name}</span>
              <span className="text-muted-foreground">{formatBytes(it.p.file.size)} · en cola</span>
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="Quitar de la cola"
                onClick={() => onPendientesChange?.(pendientes.filter((_, i) => i !== it.idx))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ),
        )}
      </ul>
    );
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => onArchivosElegidos(Array.from(e.target.files ?? []))}
      />

      {!puedeAdjuntar && (
        <p className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
          {mensajeSinSolicitud ?? 'Guarde la solicitud para poder adjuntar archivos.'}
        </p>
      )}

      {!usarCatalogoCompleto && (
        <div className="space-y-2 rounded-md border bg-background p-3">
          {documentosDelTipo.map((d) => {
            const nombre = nombreDeRequerido(d);
            const clave = d.documentoId ?? nombre;
            const checked = esRecibido(d);
            const pres = d.documento?.presentacion ? PRESENTACION_LABEL[d.documento.presentacion] : null;
            return (
              <div key={d.id} className="border-b pb-2 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input accent-primary"
                    checked={checked}
                    onChange={(e) => onToggleRecibido(d, e.target.checked)}
                  />
                  <span className={`min-w-0 flex-1 text-sm ${d.obligatorio ? 'font-medium' : ''}`}>
                    {nombre.toUpperCase()}
                    {d.obligatorio && <span className="ml-1 text-destructive">*</span>}
                    {pres && <span className="ml-2 text-xs font-normal text-muted-foreground">({pres})</span>}
                  </span>
                  {puedeAdjuntar && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs"
                      disabled={subirMut.isPending}
                      onClick={() => abrirSelectorPara({ documentoId: d.documentoId ?? undefined, nombre })}
                    >
                      {subirMut.isPending && destino?.nombre === nombre ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Paperclip className="h-3.5 w-3.5" />
                      )}
                      Adjuntar
                    </Button>
                  )}
                </div>
                {renderArchivos(clave)}
              </div>
            );
          })}
        </div>
      )}

      {usarCatalogoCompleto && puedeAdjuntar && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Este tipo de contratación aún no tiene documentos configurados; elija del catálogo completo.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[260px] flex-1">
              <SearchableSelect
                value={tipoDocSel}
                onValueChange={setTipoDocSel}
                options={(catalogoQ.data ?? []).map((d) => ({ value: d.id, label: d.nombre }))}
                placeholder={(catalogoQ.data ?? []).length === 0 ? 'Sin documentos en catálogo' : 'Tipo de documento…'}
                searchPlaceholder="Buscar documento…"
                disabled={(catalogoQ.data ?? []).length === 0}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!tipoDocSel || subirMut.isPending}
              onClick={() => {
                const doc = (catalogoQ.data ?? []).find((d) => d.id === tipoDocSel);
                if (doc) abrirSelectorPara({ documentoId: doc.id, nombre: doc.nombre });
              }}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {conId ? 'Subir archivo(s)' : 'Agregar archivo(s)'}
            </Button>
          </div>
          {[...archivosPorClave.keys()].map((clave) => {
            const nombre =
              (catalogoQ.data ?? []).find((d) => d.id === clave)?.nombre ??
              (archivosPorClave.get(clave)?.[0]?.kind === 'pendiente'
                ? (archivosPorClave.get(clave)![0] as { p: ArchivoPendiente }).p.nombre
                : clave);
            return (
              <div key={clave} className="rounded-md border p-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{nombre}</p>
                {renderArchivos(clave)}
              </div>
            );
          })}
        </div>
      )}

      {modoCola && pendientes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Clock className="mr-1 inline h-3 w-3" />
          {pendientes.length} archivo(s) en cola — se subirán al guardar la solicitud.
        </p>
      )}
    </div>
  );
}
