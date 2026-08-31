import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Contrato del settlement write-back (acordado con el equipo SUPRA).
 * Lo consume el conector de ingesta de SUPRA (pushSettlement):
 *
 *   POST /api/integraciones/supra/settlements
 *   { "paymentId": "pay_...", "folio": "supra:pay_...", "paidAt": "ISO-8601",
 *     "totalCentavos": 12345,
 *     "allocations": [{ "reciboId": "<cuid hydra>", "montoCentavos": 12345 }] }
 */
export class SettlementAllocationDto {
  @IsString()
  @IsNotEmpty()
  reciboId!: string;

  @IsInt()
  @Min(1)
  montoCentavos!: number;
}

export class SettlementDto {
  @IsString()
  @IsNotEmpty()
  paymentId!: string;

  @IsString()
  @IsNotEmpty()
  folio!: string;

  @IsISO8601()
  paidAt!: string;

  @IsInt()
  @Min(1)
  totalCentavos!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SettlementAllocationDto)
  allocations!: SettlementAllocationDto[];
}
