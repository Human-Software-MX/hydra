import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { Public } from './modules/auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Sonda de vida para el HEALTHCHECK del contenedor y el balanceador:
  // anónima a propósito y exenta del rate limit (se consulta cada 30 s).
  @Public()
  @SkipThrottle()
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }
}
