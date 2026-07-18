import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export const ACCIONES_DUNNING = [
  'notificar_aviso',
  'notificar_requerimiento',
  'generar_restriccion',
  'generar_corte',
  'ofrecer_convenio',
  'proponer_incobrable',
] as const;

export const CANALES_DUNNING = ['email', 'whatsapp', 'ambos'] as const;

export class CreateReglaDunningDto {
  @IsString()
  @MinLength(3)
  nombre!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  tipoContratacionId?: string;

  @IsOptional()
  @IsString()
  tipoServicio?: string;

  @IsInt()
  @Min(1)
  diasMoraMin!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minDocsVencidos?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  montoMinimo?: number;

  @IsIn(ACCIONES_DUNNING as unknown as string[])
  accion!: string;

  @IsOptional()
  @IsIn(CANALES_DUNNING as unknown as string[])
  canal?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  reintentoDias?: number;
}

export class UpdateReglaDunningDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  nombre?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  tipoContratacionId?: string;

  @IsOptional()
  @IsString()
  tipoServicio?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  diasMoraMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minDocsVencidos?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  montoMinimo?: number;

  @IsOptional()
  @IsIn(ACCIONES_DUNNING as unknown as string[])
  accion?: string;

  @IsOptional()
  @IsIn(CANALES_DUNNING as unknown as string[])
  canal?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  reintentoDias?: number;
}
