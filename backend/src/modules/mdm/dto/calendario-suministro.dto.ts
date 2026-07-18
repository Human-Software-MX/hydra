import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `horario` es un Json con bloques por día:
 *   { lun: [["06:00","12:00"]], mar: [["06:00","09:00"],["18:00","21:00"]], ... }
 * La validación estructural fina (días válidos, pares HH:MM, traslapes) vive en
 * TandeoService.validarHorario — aquí solo se exige que sea objeto.
 */
export class CrearCalendarioSuministroDto {
  @IsString()
  @MinLength(1)
  sectorId!: string;

  @IsString()
  @MinLength(1)
  nombre!: string;

  @IsObject()
  horario!: Record<string, unknown>;

  @Matches(FECHA_REGEX, { message: 'vigenteDesde debe ser YYYY-MM-DD' })
  vigenteDesde!: string;

  @IsOptional()
  @Matches(FECHA_REGEX, { message: 'vigenteHasta debe ser YYYY-MM-DD' })
  vigenteHasta?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  notas?: string;
}

export class ActualizarCalendarioSuministroDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nombre?: string;

  @IsOptional()
  @IsObject()
  horario?: Record<string, unknown>;

  @IsOptional()
  @Matches(FECHA_REGEX, { message: 'vigenteDesde debe ser YYYY-MM-DD' })
  vigenteDesde?: string;

  @IsOptional()
  @Matches(FECHA_REGEX, { message: 'vigenteHasta debe ser YYYY-MM-DD' })
  vigenteHasta?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  notas?: string;
}
