import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Switch } from '@/components/ui/switch';
import { fetchCalibres } from '@/api/catalogos';
import type { StepProps } from '@/components/contratacion/hooks/useWizardState';

export default function PasoOrdenes({ data, updateData }: StepProps) {
  const toma = data.generarOrdenInstalacionToma;
  const medidor = data.generarOrdenInstalacionMedidor;

  const calibresQ = useQuery({
    queryKey: ['catalogos', 'calibres', 'wizard-ordenes'],
    queryFn: fetchCalibres,
  });

  let mensajeFlujo: string;
  if (toma) {
    mensajeFlujo =
      'Se creará una orden de instalación de conexión (toma). Al completarla, podrá generarse la orden de medidor según el flujo operativo.';
  } else if (medidor) {
    mensajeFlujo = 'Se creará directamente la orden de instalación de medidor.';
  } else {
    mensajeFlujo = 'No se generarán órdenes de trabajo en esta alta.';
  }

  let estadoInicial: string;
  if (toma) {
    estadoInicial = 'Estado inicial previsto: Pendiente de toma (instalación de conexión)';
  } else if (medidor) {
    estadoInicial = 'Estado inicial previsto: Pendiente de zona (instalación de medidor)';
  } else {
    estadoInicial = 'El estado inicial lo define el backend si no se generan órdenes.';
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="orden-conexion" className="text-base">
              Generar orden de instalación de conexión
            </Label>
            <p className="text-sm text-muted-foreground">
              Equivale a la orden de instalación de toma en el sistema actual.
            </p>
          </div>
          <Switch
            id="orden-conexion"
            checked={toma}
            onCheckedChange={(checked) =>
              updateData({
                generarOrdenInstalacionToma: checked,
                generarOrdenInstalacionMedidor: checked ? false : medidor,
              })
            }
            aria-label="Generar orden de instalación de conexión"
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label
              htmlFor="orden-medidor"
              className={`text-base ${toma ? 'text-muted-foreground' : ''}`}
            >
              Generar orden de instalación de medidor
            </Label>
            <p className="text-sm text-muted-foreground">
              {toma
                ? 'Podrá generarse en campo al completar la conexión, según proceso.'
                : 'Programa la instalación o colocación del medidor.'}
            </p>
          </div>
          <Switch
            id="orden-medidor"
            checked={medidor}
            disabled={toma}
            onCheckedChange={(checked) =>
              updateData({
                generarOrdenInstalacionMedidor: checked,
                generarOrdenInstalacionToma: checked ? false : toma,
              })
            }
            aria-label="Generar orden de instalación de medidor"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-lg border p-4">
          <Checkbox
            id="posible-corte"
            checked={!!data.posibleCorte}
            onCheckedChange={(v) => updateData({ posibleCorte: v === true })}
            aria-labelledby="posible-corte-label"
          />
          <div className="space-y-1">
            <Label id="posible-corte-label" htmlFor="posible-corte" className="text-sm font-medium cursor-pointer">
              Posible corte
            </Label>
            <p className="text-xs text-muted-foreground">Se guarda en variables capturadas.</p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border p-4">
          <Label htmlFor="calibre-medidor">Diámetro / calibre de conexión (catálogo)</Label>
          {calibresQ.isLoading ? (
            <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando calibres…
            </div>
          ) : calibresQ.isError ? (
            <p className="text-sm text-destructive">No se pudieron cargar los calibres.</p>
          ) : (
            <SearchableSelect
              value={data.calibreMedidorId ?? ''}
              onValueChange={(v) => updateData({ calibreMedidorId: v || undefined })}
              options={(calibresQ.data ?? [])
                .filter((c) => c.activo)
                .map((c) => ({ value: c.id, label: `${c.descripcion} ${c.codigo}` }))}
              placeholder="Seleccione calibre…"
              searchPlaceholder="Buscar calibre…"
            />
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="conexion-existe"
            checked={!!data.conexionYaExiste}
            onCheckedChange={(v) => updateData({ conexionYaExiste: v === true })}
            aria-labelledby="conexion-existe-label"
          />
          <div className="space-y-1">
            <Label id="conexion-existe-label" htmlFor="conexion-existe" className="text-sm font-medium cursor-pointer">
              La conexión ya existe en campo
            </Label>
            <p className="text-xs text-muted-foreground">
              Si aplica, puede capturar la fecha de instalación de la conexión. Si proviene de una orden existente,
              sincronice el dato desde operaciones; aquí es captura manual.
            </p>
          </div>
        </div>
        {data.conexionYaExiste ? (
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="fecha-instalacion-conexion">Fecha de instalación de la conexión</Label>
            <Input
              id="fecha-instalacion-conexion"
              type="date"
              value={data.fechaInstalacionConexion ?? ''}
              onChange={(e) => updateData({ fechaInstalacionConexion: e.target.value || undefined })}
            />
          </div>
        ) : null}
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm leading-relaxed text-muted-foreground">{mensajeFlujo}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm font-medium text-foreground">{estadoInicial}</p>
        </CardContent>
      </Card>
    </div>
  );
}
