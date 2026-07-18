import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Una lectura de intervalo enviada por un colector AMI/AMR o captura manual. */
export class LecturaIntervaloItemDto {
  /** Id interno del medidor (preferente si el colector lo conoce). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  medidorId?: string;

  /** Serie del medidor — alternativa cuando el colector no conoce el id. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  medidorSerie?: string;

  @IsISO8601({}, { message: 'timestamp debe ser fecha ISO-8601' })
  timestamp!: string;

  /** Lectura acumulada del totalizador en m³. */
  @IsNumber()
  @Min(0)
  m3Acumulado!: number;

  /** Caudal instantáneo en litros/hora (si el medidor lo reporta). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  caudalLh?: number;

  @IsOptional()
  @IsIn(['ami', 'amr', 'manual'])
  origen?: string;

  /** Alarmas nativas del dispositivo: { fuga, tamper, flujoInverso, consumoCero } */
  @IsOptional()
  @IsObject()
  alarmas?: Record<string, unknown>;
}

export class IngestarLecturasDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000, { message: 'Máximo 10,000 lecturas por request' })
  @ValidateNested({ each: true })
  @Type(() => LecturaIntervaloItemDto)
  lecturas!: LecturaIntervaloItemDto[];
}
