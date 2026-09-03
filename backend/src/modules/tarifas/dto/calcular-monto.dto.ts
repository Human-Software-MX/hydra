import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';

/**
 * Query de `GET /tarifas/calcular`.
 *
 * `administracionId` / `claseTarifaId` acotan la tarifa igual que lo hace la
 * facturación real: sin ellos el cálculo sumaría todas las tarifas del servicio
 * (con el catálogo periódico, ~170 filas de `agua`).
 */
export class CalcularMontoQueryDto {
  @IsString()
  @MinLength(2)
  tipoServicio!: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'consumoM3 debe ser numérico' })
  @Min(0)
  consumoM3!: number;

  /** YYYY-MM-DD; default hoy. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe tener formato YYYY-MM-DD' })
  fecha?: string;

  @IsOptional()
  @IsString()
  administracionId?: string;

  @IsOptional()
  @IsString()
  claseTarifaId?: string;
}
