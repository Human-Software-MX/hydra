import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, Min, MinLength, ValidateIf } from 'class-validator';

/**
 * Configurador fiscal: categoría de tarifa. Si cambia `ivaPct` se propaga como
 * nueva versión (CAMBIO_FISCAL) a las tarifas vigentes de las clases sin override.
 *
 * `@ValidateIf(campo !== undefined)` en vez de `@IsOptional()`: con `@IsOptional()`
 * un `null` explícito se saltaría los validadores y llegaría al servicio como
 * cambio real (IVA 0 %, nombre null → error de Prisma). Aquí `null` es un 400.
 */
export class UpdateCategoriaTarifaDto {
  @ValidateIf((o) => o.nombre !== undefined)
  @IsString()
  @MinLength(2)
  nombre?: string;

  @ValidateIf((o) => o.descripcion !== undefined)
  @IsString()
  descripcion?: string;

  @ValidateIf((o) => o.ivaPct !== undefined)
  @IsNumber()
  @Min(0)
  @Max(100)
  ivaPct?: number;

  @ValidateIf((o) => o.activo !== undefined)
  @IsBoolean()
  activo?: boolean;

  /** Vigencia de las versiones generadas por el cambio fiscal (YYYY-MM-DD; default hoy). */
  @ValidateIf((o) => o.vigenciaDesde !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'vigenciaDesde debe tener formato YYYY-MM-DD' })
  vigenciaDesde?: string;

  @ValidateIf((o) => o.motivo !== undefined)
  @IsString()
  @MinLength(3, { message: 'motivo debe tener al menos 3 caracteres' })
  motivo?: string;
}

/**
 * Configurador fiscal: clase de tarifa. `ivaPct: null` vuelve a heredar el IVA
 * de la categoría (único campo donde `null` es semántico, por eso conserva
 * `@IsOptional()`); si el IVA efectivo cambia se propaga como CAMBIO_FISCAL.
 */
export class UpdateClaseTarifaDto {
  @ValidateIf((o) => o.nombre !== undefined)
  @IsString()
  @MinLength(2)
  nombre?: string;

  /** null = hereda el IVA de la categoría. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  ivaPct?: number | null;

  @ValidateIf((o) => o.categoriaId !== undefined)
  @IsString()
  @MinLength(1)
  categoriaId?: string;

  @ValidateIf((o) => o.activo !== undefined)
  @IsBoolean()
  activo?: boolean;

  /** Vigencia de las versiones generadas por el cambio fiscal (YYYY-MM-DD; default hoy). */
  @ValidateIf((o) => o.vigenciaDesde !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'vigenciaDesde debe tener formato YYYY-MM-DD' })
  vigenciaDesde?: string;

  @ValidateIf((o) => o.motivo !== undefined)
  @IsString()
  @MinLength(3, { message: 'motivo debe tener al menos 3 caracteres' })
  motivo?: string;
}
