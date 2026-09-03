import { IsBoolean, IsString, Matches, MinLength, ValidateIf } from 'class-validator';

/**
 * `PATCH /tarifas/:id` — SÓLO metadatos.
 *
 * Los valores económicos y el IVA se cambian por `POST /tarifas/:id/actualizar`,
 * que crea una versión nueva y su movimiento en el Kardex: editarlos en sitio
 * reescribiría la historia de lo que se facturó en periodos ya cerrados.
 */
export class UpdateTarifaMetadatosDto {
  @ValidateIf((o) => o.nombre !== undefined)
  @IsString()
  @MinLength(2)
  nombre?: string;

  @ValidateIf((o) => o.activo !== undefined)
  @IsBoolean()
  activo?: boolean;

  /** Cierre manual de la vigencia (ISO: YYYY-MM-DD o fecha-hora completa). */
  @ValidateIf((o) => o.vigenciaHasta !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, { message: 'vigenciaHasta debe ser una fecha ISO' })
  vigenciaHasta?: string;
}
