import { Controller, Get, Post, Param, Query, Body, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import { VeeService } from './vee.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class AnalizarDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodo debe tener formato YYYY-MM' })
  periodo!: string;

  @IsOptional()
  @IsString()
  loteId?: string;
}

class ResolverDto {
  @IsOptional()
  @IsString()
  motivo?: string;
}

class DescartarDto {
  @IsString()
  @MinLength(3)
  motivo!: string;
}

class CorregirDto {
  @IsInt()
  @Min(0)
  lecturaActual!: number;

  @IsString()
  @MinLength(3)
  motivo!: string;
}

@Controller('vee')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VeeController {
  constructor(private readonly vee: VeeService) {}

  /** Corre las reglas VEE sobre las lecturas del periodo (idempotente). */
  @Post('analizar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  analizar(@Body() dto: AnalizarDto) {
    return this.vee.analizarPeriodo(dto);
  }

  /** Cola de excepciones con filtros. */
  @Get('excepciones')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  excepciones(
    @Query('estado') estado?: string,
    @Query('regla') regla?: string,
    @Query('severidad') severidad?: string,
    @Query('periodo') periodo?: string,
    @Query('contratoId') contratoId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.vee.listar({ estado, regla, severidad, periodo, contratoId, page, limit });
  }

  /** Resumen de pendientes por regla/severidad. */
  @Get('resumen')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  resumen(@Query('periodo') periodo?: string) {
    return this.vee.resumen(periodo);
  }

  @Post('excepciones/:id/aceptar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  aceptar(@Param('id') id: string, @Body() dto: ResolverDto) {
    return this.vee.aceptar(id, dto);
  }

  @Post('excepciones/:id/descartar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  descartar(@Param('id') id: string, @Body() dto: DescartarDto) {
    return this.vee.descartar(id, dto);
  }

  /** Edición VEE: corrige la lectura preservando el valor original (trazable). */
  @Post('excepciones/:id/corregir')
  @Roles('SUPER_ADMIN', 'ADMIN')
  corregir(@Param('id') id: string, @Body() dto: CorregirDto) {
    return this.vee.corregir(id, dto);
  }
}
