import { Controller, Post, Get, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { LoginThrottle } from './app-throttler.guard';
import { AllowPortal } from './allow-portal.decorator';

type UserPayload = { id: string; email: string; name: string; administracionIds: string[]; zonaIds: string[] };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Único endpoint anónimo de la API interna. Doble límite contra fuerza bruta:
  //   - `login`   → 5/min por (IP + email): frena el ataque a una cuenta sin
  //                 que un atacante pueda bloquear cuentas ajenas ni tumbar a
  //                 toda una oficina que sale por la misma IP NAT.
  //   - `default` → 30/min por IP en este handler: acota el barrido de emails
  //                 desde una sola IP, que la llave anterior no cubre.
  @ApiOperation({
    summary: 'Inicia sesión y devuelve un JWT',
    description: 'Único endpoint anónimo. Doble rate-limit: 5/min por IP+email y 30/min por IP.',
  })
  @Public()
  @LoginThrottle()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // El perfil propio lo consulta tanto el back office como el portal.
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil del usuario autenticado (back office o portal)' })
  @AllowPortal()
  @Get('me')
  async me(@CurrentUser() user: UserPayload) {
    return user;
  }
}
