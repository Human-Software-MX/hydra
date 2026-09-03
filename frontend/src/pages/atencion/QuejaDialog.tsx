import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { createQueja } from '@/api/atencion';

interface QuejaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contratoId: string;
  usuarioActual?: string;
  onCreated?: () => void;
}

const CATEGORIAS = ['Facturación', 'Servicio', 'Medidor', 'Lectura', 'Corte/Reconexión', 'Cobro', 'Otro'] as const;
const PRIORIDADES = ['Baja', 'Media', 'Alta', 'Urgente'] as const;
const CANALES = ['Ventanilla', 'Teléfono', 'Portal web', 'Correo', 'Redes sociales'] as const;
const AREAS = ['Atención a clientes', 'Operación', 'Facturación', 'Jurídico', 'Cartera'] as const;

const DEFAULT_FORM = {
  tipo: 'Queja' as 'Queja' | 'Aclaración',
  categoria: '' as string,
  prioridad: 'Media' as string,
  canal: 'Ventanilla' as string,
  areaAsignada: 'Atención a clientes' as string,
  descripcion: '',
  enlaceExterno: '',
};

export default function QuejaDialog({ open, onOpenChange, contratoId, usuarioActual, onCreated }: QuejaDialogProps) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof DEFAULT_FORM, string>>>({});
  const [saving, setSaving] = useState(false);

  function validate() {
    const e: typeof errors = {};
    if (!form.descripcion.trim()) e.descripcion = 'La descripción es requerida';
    if (!form.categoria) e.categoria = 'Selecciona una categoría';
    if (form.enlaceExterno && !isValidUrl(form.enlaceExterno)) e.enlaceExterno = 'URL no válida';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function isValidUrl(s: string) {
    try { new URL(s); return true; } catch { return false; }
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    try {
      await createQueja({
        contratoId,
        tipo: form.tipo,
        descripcion: form.descripcion.trim(),
        prioridad: form.prioridad,
        canal: form.canal,
        areaAsignada: form.areaAsignada,
        atendidoPor: usuarioActual,
        categoria: form.categoria,
        enlaceExterno: form.enlaceExterno.trim() || undefined,
      });
      setForm(DEFAULT_FORM);
      setErrors({});
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setForm(DEFAULT_FORM);
    setErrors({});
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Nueva queja / aclaración</DialogTitle>
          <DialogDescription>
            Registra la queja o aclaración del cliente. Selecciona la categoría y canal de atención.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo <span className="text-red-500">*</span></Label>
              <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as typeof f.tipo }))}>
                <SelectTrigger id="tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Queja">Queja</SelectItem>
                  <SelectItem value="Aclaración">Aclaración</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="categoria">Categoría <span className="text-red-500">*</span></Label>
              <SearchableSelect
                options={CATEGORIAS.map((c) => ({ value: c, label: c }))}
                value={form.categoria}
                onValueChange={(v) => { setForm((f) => ({ ...f, categoria: v })); setErrors((e) => ({ ...e, categoria: undefined })); }}
                placeholder="Seleccionar..."
                searchPlaceholder="Buscar categoría…"
                className={errors.categoria ? 'border-red-500' : ''}
              />
              {errors.categoria && <p className="text-xs text-red-500">{errors.categoria}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Select value={form.prioridad} onValueChange={(v) => setForm((f) => ({ ...f, prioridad: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORIDADES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Canal</Label>
              <Select value={form.canal} onValueChange={(v) => setForm((f) => ({ ...f, canal: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CANALES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Área asignada</Label>
            <Select value={form.areaAsignada} onValueChange={(v) => setForm((f) => ({ ...f, areaAsignada: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="descripcion">Descripción <span className="text-red-500">*</span></Label>
            <Textarea
              id="descripcion"
              value={form.descripcion}
              onChange={(e) => { setForm((f) => ({ ...f, descripcion: e.target.value })); setErrors((e2) => ({ ...e2, descripcion: undefined })); }}
              placeholder="Describe el motivo de la queja o aclaración..."
              rows={3}
              className={errors.descripcion ? 'border-red-500' : ''}
            />
            {errors.descripcion && <p className="text-xs text-red-500">{errors.descripcion}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="enlace">
              Enlace a sistema externo
              <span className="ml-1.5 text-xs text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Input
              id="enlace"
              value={form.enlaceExterno}
              onChange={(e) => { setForm((f) => ({ ...f, enlaceExterno: e.target.value })); setErrors((e2) => ({ ...e2, enlaceExterno: undefined })); }}
              placeholder="https://sistema-reclamos.ejemplo.com/ticket/123"
              className={errors.enlaceExterno ? 'border-red-500' : ''}
            />
            {errors.enlaceExterno && <p className="text-xs text-red-500">{errors.enlaceExterno}</p>}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Guardando...' : 'Registrar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
