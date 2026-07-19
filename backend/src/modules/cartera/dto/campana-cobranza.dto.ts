import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';

export class CreateCampanaDto {
  @IsString()
  @MinLength(3)
  nombre!: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  administracionId?: string;

  @IsOptional()
  @IsIn(['corriente', 'b1_30', 'b31_60', 'b61_90', 'b90_mas'])
  bucketObjetivo?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaInicio debe ser YYYY-MM-DD' })
  fechaInicio?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaFin debe ser YYYY-MM-DD' })
  fechaFin?: string;

  /** % del universo reservado como grupo control para medir uplift (0-50). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  grupoControlPct?: number;
}

export class EjecutarCampanaDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
