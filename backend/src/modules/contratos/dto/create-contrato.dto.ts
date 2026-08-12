import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  ArrayMaxSize,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PersonaRelacionContratoDto {
  @ApiPropertyOptional({ description: 'Id de Persona existente; si se omite, se crea desde los datos planos.' })
  @IsOptional() @IsString() personaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nombre?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rfc?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() curp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() telefono?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() razonSocial?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() regimenFiscal?: string;
}

export class ConceptoOverrideDto {
  @ApiProperty({ description: 'Id del concepto de cobro a sobrescribir.' })
  @IsString() conceptoCobroId: string;
  @ApiProperty({ description: 'Cantidad (unidades/m3) para recalcular el concepto.' })
  @IsNumber() cantidad: number;
}

export class CreateContratoDto {
  @ApiPropertyOptional() @IsOptional() @IsString() tomaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() puntoServicioId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() domicilioId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tipoContratacionId?: string;
  @ApiProperty({ description: 'Tipo de contrato (catálogo).' })
  @IsString() tipoContrato: string;
  @ApiProperty({ description: 'Tipo de servicio (AGUA, ALCANTARILLADO, etc.).' })
  @IsString() tipoServicio: string;
  @ApiProperty({ description: 'Nombre del titular.' })
  @IsString() nombre: string;
  @ApiProperty({ description: 'RFC del titular.' })
  @IsString() rfc: string;
  @ApiPropertyOptional() @IsOptional() @IsString() direccion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contacto?: string;
  @ApiProperty({ description: 'Estado del contrato.' })
  @IsString() estado: string;
  @ApiProperty({ description: 'Fecha del contrato (ISO 8601).', example: '2026-08-11' })
  @IsString() fecha: string;
  @IsOptional() @IsString() medidorId?: string;
  @IsOptional() @IsString() rutaId?: string;
  @IsOptional() @IsString() zonaId?: string;
  @IsOptional() @IsBoolean() domiciliado?: boolean;
  @IsOptional() @IsString() fechaReconexionPrevista?: string;
  @IsOptional() @IsString() ceaNumContrato?: string;
  // P1 campos adicionales
  @IsOptional() @IsString() fechaBaja?: string;
  @IsOptional() @IsString() actividadId?: string;
  @IsOptional() @IsString() categoriaId?: string;
  @IsOptional() @IsString() referenciaContratoAnterior?: string;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @IsString() tipoEnvioFactura?: string;
  @IsOptional() @IsBoolean() indicadorEmisionRecibo?: boolean;
  @IsOptional() @IsBoolean() indicadorExentarFacturacion?: boolean;
  @IsOptional() @IsBoolean() indicadorContactoCorreo?: boolean;
  @IsOptional() @IsString() cicloFacturacion?: string;
  @IsOptional() @IsNumber() superficiePredio?: number;
  @IsOptional() @IsNumber() superficieConstruida?: number;
  @IsOptional() @IsNumber() mesesAdeudo?: number;
  @IsOptional() @IsNumber() unidadesServidas?: number;
  @IsOptional() @IsNumber() personasHabitanVivienda?: number;

  /** Persona moral / datos fiscales en el contrato */
  @IsOptional() @IsString() razonSocial?: string;
  @IsOptional() @IsString() regimenFiscal?: string;

  /** Si true, al crear se genera orden InstalacionToma y estado Pendiente de toma (prioridad sobre medidor). */
  @IsOptional() @IsBoolean() generarOrdenInstalacionToma?: boolean;
  /** Si true (y no hay orden de toma), orden InstalacionMedidor y estado Pendiente de zona. */
  @IsOptional() @IsBoolean() generarOrdenInstalacionMedidor?: boolean;
  /** Generar factura de contratación con los conceptos del tipo (requiere FEATURE_FACTURACION_CONTRATACION=true). */
  @IsOptional() @IsBoolean() generarFacturaContratacion?: boolean;
  /** Omitir creación de Persona + rol PROPIETARIO (solo datos planos en contrato). */
  @IsOptional() @IsBoolean() omitirRegistroPersonaTitular?: boolean;

  /** Checklist de documentos marcados como recibidos durante la contratación. */
  @ApiPropertyOptional({ type: [String], description: 'Ids/claves de documentos marcados como recibidos.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  documentosRecibidos?: string[];

  /**
   * Plantilla del proceso cuando el checklist se captura en el mismo POST.
   * Requiere al menos un valor en `documentosRecibidos`; si no, 400.
   */
  @IsOptional() @IsString() plantillaContratacionId?: string;

  /** Persona fiscal relacionada (rol FISCAL). */
  @ApiPropertyOptional({ type: () => PersonaRelacionContratoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonaRelacionContratoDto)
  personaFiscal?: PersonaRelacionContratoDto;

  /** Persona de contacto relacionada (rol CONTACTO). */
  @ApiPropertyOptional({ type: () => PersonaRelacionContratoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonaRelacionContratoDto)
  personaContacto?: PersonaRelacionContratoDto;

  /** Variables dinámicas capturadas durante el wizard (superficie, unidades, etc.). */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Variables dinámicas del tipo de contratación (clave → valor).',
  })
  @IsOptional()
  variablesCapturadas?: Record<string, string | number | boolean>;

  /** Override de cantidades por concepto desde el wizard paso 6. */
  @ApiPropertyOptional({ type: () => [ConceptoOverrideDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConceptoOverrideDto)
  conceptosOverride?: ConceptoOverrideDto[];
}
