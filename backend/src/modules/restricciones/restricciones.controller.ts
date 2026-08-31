import { Controller, Get, Post, Param, Query, Body, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import { RestriccionesService } from './restricciones.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class ProgramarDto {
  @IsString()
  @MinLength(1)
  contratoId!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaProgramada debe ser YYYY-MM-DD' })
  fechaProgramada?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  personasVivienda?: number;

  @IsOptional()
  @IsString()
  notas?: string;
}

class AplicarDto {
  @IsString()
  @MinLength(2)
  dispositivo!: string;

  @IsOptional()
  @IsObject()
  evidencia?: object;
}

class RevertirDto {
  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsObject()
  evidencia?: object;
}

class CancelarDto {
  @IsString()
  @MinLength(3)
  motivo!: string;
}

@Controller('restricciones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RestriccionesController {
  constructor(private readonly restricciones: RestriccionesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  listar(
    @Query('estado') estado?: string,
    @Query('contratoId') contratoId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.restricciones.listar({ estado, contratoId, page, limit });
  }

  /** Contratos candidatos a restricción (autorización humana previa). */
  @Get('candidatos')
  @Roles('SUPER_ADMIN', 'ADMIN')
  candidatos(
    @Query('minRecibosVencidos', new DefaultValuePipe(2), ParseIntPipe) minRecibosVencidos = 2,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.restricciones.candidatos({ minRecibosVencidos, limit });
  }

  /** Programa la restricción (crea orden de trabajo + aviso previo al usuario). */
  @Post('programar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  programar(@Body() dto: ProgramarDto) {
    return this.restricciones.programar(dto);
  }

  /** Registra la aplicación en campo (dispositivo restrictor + evidencia). */
  @Post(':id/aplicar')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  aplicar(@Param('id') id: string, @Body() dto: AplicarDto) {
    return this.restricciones.aplicar(id, dto);
  }

  /** Revierte la restricción (reconexión a flujo pleno). */
  @Post(':id/revertir')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  revertir(@Param('id') id: string, @Body() dto: RevertirDto) {
    return this.restricciones.revertir(id, dto);
  }

  @Post(':id/cancelar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  cancelar(@Param('id') id: string, @Body() dto: CancelarDto) {
    return this.restricciones.cancelar(id, dto.motivo);
  }

  /** Corre la verificación de reversas automáticas bajo demanda. */
  @Post('verificar-reversas')
  @Roles('SUPER_ADMIN', 'ADMIN')
  verificarReversas() {
    return this.restricciones.verificarReversas();
  }
}
