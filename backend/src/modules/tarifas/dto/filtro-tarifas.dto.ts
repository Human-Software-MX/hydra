import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * Criterio de selección de tarifas vigentes. Se usa tanto en el listado
 * (`GET /tarifas/vigentes`) como en la selección de los lotes masivos
 * (preview y aplicación comparten exactamente este filtro).
 */
export class FiltroTarifasDto {
  @IsOptional()
  @IsString()
  administracionId?: string;

  @IsOptional()
  @IsString()
  categoriaId?: string;

  @IsOptional()
  @IsString()
  claseTarifaId?: string;

  @IsOptional()
  @IsString()
  tipoServicio?: string;

  @IsOptional()
  @IsString()
  concepto?: string;

  /** Texto libre sobre nombre / código / concepto. */
  @IsOptional()
  @IsString()
  buscar?: string;
}

/**
 * Query de `GET /tarifas/vigentes`: el filtro más la fecha de corte. Va en un DTO
 * propio porque el ValidationPipe global rechaza propiedades no declaradas
 * (`forbidNonWhitelisted`).
 */
export class ListarVigentesQueryDto extends FiltroTarifasDto {
  /** YYYY-MM-DD; default hoy. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe tener formato YYYY-MM-DD' })
  fecha?: string;
}
