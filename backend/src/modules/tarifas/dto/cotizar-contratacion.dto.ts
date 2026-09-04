import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

/**
 * Query de `GET /tarifas/contratacion/cotizar`.
 *
 * `administracionId` y `tipoServicio` son obligatorios: una tarifa de
 * contratación siempre pertenece a una administración y a un concepto
 * (`contratacion_derechos_de_conexion_a_red_de_agua`, …). `claseTarifaId` y
 * `variante` acotan la fila cuando el concepto tiene variantes (clase tarifaria,
 * combinación de materiales calle-banqueta, diámetro / plan de medidor).
 */
export class CotizarContratacionQueryDto {
  @IsString()
  @MinLength(1)
  administracionId!: string;

  @IsString()
  @MinLength(2)
  tipoServicio!: string;

  @IsOptional()
  @IsString()
  claseTarifaId?: string;

  @IsOptional()
  @IsString()
  variante?: string;

  /** Unidades a cotizar (metros de toma/descarga, piezas…). Ausente = 0: sólo la cuota base. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'cantidad debe ser numérico' })
  @Min(0)
  cantidad?: number;
}
