import { IsOptional, IsString, MinLength } from 'class-validator';

export class CancelarLoteDto {
  @IsString()
  @MinLength(5, { message: 'motivo debe tener al menos 5 caracteres' })
  motivo!: string;

  /** Identificador del usuario que cancela; si se omite se toma del token JWT. */
  @IsOptional()
  @IsString()
  canceladoPor?: string;
}
