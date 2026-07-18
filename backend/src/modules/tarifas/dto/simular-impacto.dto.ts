import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

/** Línea de tarifa propuesta que reemplaza a las vigentes de un tipoServicio. */
export class TarifaNuevaSimulacionDto {
  @IsIn(['escalonado', 'variable', 'fijo'])
  tipoCalculo!: 'escalonado' | 'variable' | 'fijo';

  @IsOptional()
  @IsNumber()
  @Min(0)
  rangoMinM3?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rangoMaxM3?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  precioUnitario?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cuotaFija?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  ivaPct?: number;
}

/** Cambio propuesto sobre un tipo de servicio: factor de ajuste O tarifas de reemplazo. */
export class CambioTarifaSimulacionDto {
  @IsString()
  tipoServicio!: string;

  /** Multiplica precioUnitario y cuotaFija de las tarifas vigentes (p. ej. 1.08 = +8%). */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  factorAjuste?: number;

  /** Reemplaza por completo las tarifas vigentes del servicio. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TarifaNuevaSimulacionDto)
  tarifasNuevas?: TarifaNuevaSimulacionDto[];
}

export class SimularImpactoDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodoBase debe tener formato YYYY-MM' })
  periodoBase!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CambioTarifaSimulacionDto)
  cambios!: CambioTarifaSimulacionDto[];

  @IsOptional()
  @IsString()
  administracionId?: string;
}
