import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Tope de la tabla de precios: 0..200 m³ del Excel tarifario + margen. */
export const MAX_PRECIOS_TABLA = 1001;

/**
 * Alta de una nueva versión de una tarifa (Kardex).
 *
 * Dos modos excluyentes: `porcentaje` (ajuste sobre los valores actuales) o
 * valores directos (`cuotaFija` / `precioUnitario` / `precios`). `ivaPct` puede
 * viajar solo (cambio fiscal) o acompañar a cualquiera de los dos modos.
 *
 * Se usa `@ValidateIf(o => campo !== undefined)` en vez de `@IsOptional()`:
 * `@IsOptional()` también salta la validación cuando el valor es `null`, y un
 * `null` explícito llegaría al servicio como "cambia a nada" (cuotaFija 0,
 * TypeError al mapear precios). Aquí `null` es un 400.
 */
export class ActualizarTarifaDto {
  /** Incremento porcentual (4.5 = +4.5 %; -2 = -2 %). Excluyente con los valores directos. */
  @ValidateIf((o) => o.porcentaje !== undefined)
  @IsNumber()
  @Min(-90)
  @Max(500)
  porcentaje?: number;

  @ValidateIf((o) => o.cuotaFija !== undefined)
  @IsNumber()
  @Min(0)
  cuotaFija?: number;

  @ValidateIf((o) => o.precioUnitario !== undefined)
  @IsNumber()
  @Min(0)
  precioUnitario?: number;

  /** tipoCalculo=tabla: importe acumulado por m³ (índice = m³). */
  @ValidateIf((o) => o.precios !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRECIOS_TABLA)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  precios?: number[];

  @ValidateIf((o) => o.ivaPct !== undefined)
  @IsNumber()
  @Min(0)
  @Max(100)
  ivaPct?: number;

  /** YYYY-MM-DD; default hoy. Debe ser ≥ vigenciaDesde de la versión actual. */
  @ValidateIf((o) => o.vigenciaDesde !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'vigenciaDesde debe tener formato YYYY-MM-DD' })
  vigenciaDesde?: string;

  @IsString()
  @MinLength(3, { message: 'motivo debe tener al menos 3 caracteres' })
  motivo!: string;
}
