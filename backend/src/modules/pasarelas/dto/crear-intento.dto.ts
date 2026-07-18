import { IsIn, IsNotEmpty, IsNumber, IsPositive, IsString } from 'class-validator';
import { MetodoPagoPasarela } from '../pasarela-provider.interface';

const METODOS: MetodoPagoPasarela[] = ['spei', 'oxxo', 'tarjeta'];

/** Alta de intento de pago desde el back-office (caja / atención a clientes). */
export class CrearIntentoDto {
  @IsString()
  @IsNotEmpty()
  contratoId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  monto!: number;

  @IsIn(METODOS, { message: 'metodo debe ser spei, oxxo o tarjeta' })
  metodo!: MetodoPagoPasarela;
}

/** Alta de intento de pago desde el portal del cliente (contrato viene en la URL). */
export class CrearIntentoPortalDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  monto!: number;

  @IsIn(METODOS, { message: 'metodo debe ser spei, oxxo o tarjeta' })
  metodo!: MetodoPagoPasarela;
}
