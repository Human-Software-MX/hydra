import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class CrearSuscripcionDto {
  @IsString()
  @MinLength(3)
  nombre!: string;

  @IsUrl({ require_tld: false })
  url!: string;

  @IsArray()
  @IsString({ each: true })
  eventos!: string[];
}

class ActualizarSuscripcionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  nombre?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventos?: string[];

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

@Controller('webhooks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('suscripciones')
  @Roles('SUPER_ADMIN', 'ADMIN')
  listar() {
    return this.webhooks.listarSuscripciones();
  }

  @Post('suscripciones')
  @Roles('SUPER_ADMIN', 'ADMIN')
  crear(@Body() dto: CrearSuscripcionDto) {
    return this.webhooks.crearSuscripcion(dto);
  }

  @Patch('suscripciones/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarSuscripcionDto) {
    return this.webhooks.actualizarSuscripcion(id, dto);
  }

  @Delete('suscripciones/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  eliminar(@Param('id') id: string) {
    return this.webhooks.eliminarSuscripcion(id);
  }

  @Post('suscripciones/:id/probar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  probar(@Param('id') id: string) {
    return this.webhooks.probarSuscripcion(id);
  }

  @Get('entregas')
  @Roles('SUPER_ADMIN', 'ADMIN')
  entregas(
    @Query('suscripcionId') suscripcionId?: string,
    @Query('evento') evento?: string,
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.webhooks.listarEntregas({ suscripcionId, evento, estado, page, limit });
  }

  @Post('reintentar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  reintentar() {
    return this.webhooks.reintentarPendientes();
  }
}
