import { IsOptional, IsString, Matches } from 'class-validator';

export class FacturarPeriodoDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodo debe tener formato YYYY-MM' })
  periodo!: string;

  @IsOptional()
  @IsString()
  rutaId?: string;

  @IsOptional()
  @IsString()
  zonaId?: string;

  @IsOptional()
  @IsString()
  contratoId?: string;
}
