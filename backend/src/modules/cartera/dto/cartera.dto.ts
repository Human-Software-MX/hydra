import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class RecalcularCarteraDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  contratoId?: string;
}

export class EvaluarDunningDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class MarcarIncobrableDto {
  @IsString()
  @MinLength(5)
  motivo!: string;

  @IsString()
  @MinLength(3)
  autorizadoPor!: string;
}
