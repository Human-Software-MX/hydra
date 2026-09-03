import { IsIn, IsNumber, IsString, Matches, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { TIPOS_CALCULO } from '../tarifa-valores';

/**
 * `POST /tarifas` — alta de un linaje nuevo (versión 1). Las tarifas del
 * catálogo periódico entran por el seed; este endpoint cubre altas manuales
 * (conceptos fijos, tarifas de una administración concreta).
 */
export class CreateTarifaDto {
  @IsString()
  @MinLength(3)
  codigo!: string;

  @IsString()
  @MinLength(2)
  nombre!: string;

  @IsString()
  @MinLength(2)
  tipoServicio!: string;

  @IsIn([...TIPOS_CALCULO])
  tipoCalculo!: string;

  @ValidateIf((o) => o.rangoMinM3 !== undefined)
  @IsNumber()
  @Min(0)
  rangoMinM3?: number;

  @ValidateIf((o) => o.rangoMaxM3 !== undefined)
  @IsNumber()
  @Min(0)
  rangoMaxM3?: number;

  @ValidateIf((o) => o.precioUnitario !== undefined)
  @IsNumber()
  @Min(0)
  precioUnitario?: number;

  @ValidateIf((o) => o.cuotaFija !== undefined)
  @IsNumber()
  @Min(0)
  cuotaFija?: number;

  @ValidateIf((o) => o.ivaPct !== undefined)
  @IsNumber()
  @Min(0)
  @Max(100)
  ivaPct?: number;

  @Matches(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, { message: 'vigenciaDesde debe ser una fecha ISO' })
  vigenciaDesde!: string;

  @ValidateIf((o) => o.vigenciaHasta !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, { message: 'vigenciaHasta debe ser una fecha ISO' })
  vigenciaHasta?: string;
}
