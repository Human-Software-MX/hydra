import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, Max, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { FiltroTarifasDto } from './filtro-tarifas.dto';

/** Previsualización de un ajuste porcentual masivo (no escribe nada). */
export class PreviewMasivaDto {
  /** Ausente o vacío = todas las tarifas vigentes (el servicio lo trata como `{}`). */
  @IsOptional()
  @ValidateNested()
  @Type(() => FiltroTarifasDto)
  filtro?: FiltroTarifasDto;

  /** Incremento porcentual (4.5 = +4.5 %). Debe ser distinto de 0 y estar en [-90, 500]. */
  @IsNumber()
  @Min(-90)
  @Max(500)
  porcentaje!: number;

  /** YYYY-MM-DD; default hoy. */
  @ValidateIf((o) => o.vigenciaDesde !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'vigenciaDesde debe tener formato YYYY-MM-DD' })
  vigenciaDesde?: string;
}

/** Aplicación del ajuste porcentual masivo: crea el lote y una versión por tarifa. */
export class AplicarMasivaDto extends PreviewMasivaDto {
  @IsString()
  @MinLength(3, { message: 'motivo debe tener al menos 3 caracteres' })
  motivo!: string;

  @ValidateIf((o) => o.fuenteOficial !== undefined)
  @IsString()
  fuenteOficial?: string;
}
