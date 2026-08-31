import { IsIn, IsNumber, IsPositive } from 'class-validator';

/** Métodos de pago en línea del portal (los ejecuta SUPRA, no Hydra). */
export type MetodoPagoPortal = 'spei' | 'oxxo' | 'tarjeta';

const METODOS: MetodoPagoPortal[] = ['spei', 'oxxo', 'tarjeta'];

/** Alta de intento de pago desde el portal del cliente (contrato en la URL). */
export class CrearIntentoPortalDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  monto!: number;

  @IsIn(METODOS, { message: 'metodo debe ser spei, oxxo o tarjeta' })
  metodo!: MetodoPagoPortal;
}
