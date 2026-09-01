import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from '@/components/ui/sonner';
import { useAuth } from '@/context/AuthContext';
import {
  createAgoraTicket,
  getAgoraTickets,
  syncAgoraTicket,
  type AgoraTicketDto,
} from '@/api/agora';

const PRIORIDAD_OPTIONS = [
  { value: 'Baja', label: 'Baja' },
  { value: 'Media', label: 'Media' },
  { value: 'Alta', label: 'Alta' },
  { value: 'Urgente', label: 'Urgente' },
];

/** Estados cerrados/resueltos en gris; el resto activos. */
function estadoVariant(estado: string): 'default' | 'secondary' | 'outline' {
  if (estado === 'Cerrado' || estado === 'Cancelado') return 'secondary';
  if (estado === 'Resuelto') return 'outline';
  return 'default';
}

function prioridadVariant(prioridad: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (prioridad === 'Urgente') return 'destructive';
  if (prioridad === 'Alta') return 'default';
  if (prioridad === 'Baja') return 'outline';
  return 'secondary';
}

export interface AgoraTicketsDialogProps {
  open: boolean;
  contratoId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Tickets de Agora asociados a un contrato: consulta, sincronización puntual
 * con Agora y alta rápida. Cuando el backend no tiene configurada la
 * integración los tickets vuelven marcados como simulados (`_mock`).
 */
export function AgoraTicketsDialog({ open, contratoId, onOpenChange }: AgoraTicketsDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [prioridad, setPrioridad] = useState('Media');
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ['agora-tickets', contratoId],
    queryFn: () => getAgoraTickets({ contratoId: contratoId! }),
    enabled: open && Boolean(contratoId),
  });

  const tickets: AgoraTicketDto[] = ticketsQuery.data ?? [];
  const hayMock = tickets.some((t) => t._mock);

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: ['agora-tickets', contratoId] });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!contratoId) throw new Error('Sin contrato');
      return createAgoraTicket({
        contratoId,
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        prioridad,
        creadoPor: user?.name || user?.email || 'sistema',
      });
    },
    onSuccess: async () => {
      await invalidar();
      setTitulo('');
      setDescripcion('');
      setPrioridad('Media');
      toast.success('Ticket creado');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'No se pudo crear el ticket';
      toast.error('Error al crear el ticket', { description: message });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => {
      setSyncingId(id);
      return syncAgoraTicket(id);
    },
    onSuccess: async (ticket) => {
      await invalidar();
      toast.success(`Ticket sincronizado · ${ticket.estado}`);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'No se pudo sincronizar';
      toast.error('Error al sincronizar con Agora', { description: message });
    },
    onSettled: () => setSyncingId(null),
  });

  const puedeCrear =
    Boolean(contratoId) && titulo.trim().length > 0 && descripcion.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            Tickets Agora
            {hayMock && (
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                modo demo
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Incidencias registradas en Agora para este contrato. "Sincronizar" relee el estado
            desde Agora.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[min(520px,60vh)] px-6">
          <div className="space-y-4 pb-4 pr-3">
            {ticketsQuery.isLoading && (
              <p className="py-6 text-sm text-muted-foreground">Cargando tickets…</p>
            )}
            {ticketsQuery.isError && (
              <div className="space-y-2 py-4">
                <p className="text-sm text-destructive">
                  {ticketsQuery.error instanceof Error
                    ? ticketsQuery.error.message
                    : 'No se pudieron cargar los tickets.'}
                </p>
                <Button size="sm" variant="outline" type="button" onClick={() => ticketsQuery.refetch()}>
                  Reintentar
                </Button>
              </div>
            )}
            {!ticketsQuery.isLoading && !ticketsQuery.isError && tickets.length === 0 && (
              <p className="py-6 text-sm text-muted-foreground">
                Este contrato no tiene tickets en Agora.
              </p>
            )}

            {tickets.map((t) => (
              <div key={t.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{t.titulo}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{t.descripcion}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Sincronizar con Agora"
                    disabled={syncingId === t.id}
                    onClick={() => syncMutation.mutate(t.id)}
                  >
                    <RefreshCw className={`h-4 w-4 ${syncingId === t.id ? 'animate-spin' : ''}`} />
                    <span className="ml-1.5 text-xs">Sincronizar</span>
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={estadoVariant(t.estado)}>{t.estado}</Badge>
                  <Badge variant={prioridadVariant(t.prioridad)}>{t.prioridad}</Badge>
                  {t.agoraRef && (
                    <span className="font-mono text-[11px] text-muted-foreground">{t.agoraRef}</span>
                  )}
                  {t._mock && (
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                      modo demo
                    </Badge>
                  )}
                </div>
              </div>
            ))}

            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Nuevo ticket</p>
              <div className="space-y-2">
                <Label htmlFor="agora-titulo">Título</Label>
                <Input
                  id="agora-titulo"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ej. Fuga en la toma del predio"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agora-desc">Descripción</Label>
                <Textarea
                  id="agora-desc"
                  rows={3}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Detalle del reporte para el agente de Agora"
                />
              </div>
              <div className="space-y-2">
                <Label>Prioridad</Label>
                <SearchableSelect
                  value={prioridad}
                  onValueChange={setPrioridad}
                  placeholder="Seleccionar"
                  searchPlaceholder="Buscar…"
                  options={PRIORIDAD_OPTIONS}
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!puedeCrear || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Creando…' : 'Crear ticket'}
              </Button>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
