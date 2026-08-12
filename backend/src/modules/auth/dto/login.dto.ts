import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'operador@cea.gob.mx', description: 'Correo del usuario (interno o portal).' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '••••••••', description: 'Contraseña en texto plano; se compara contra el hash bcrypt.' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
