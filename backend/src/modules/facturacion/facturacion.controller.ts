import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FacturacionService } from './facturacion.service';
import { FacturarPeriodoDto } from './dto/facturar-periodo.dto';

@Controller('facturacion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacturacionController {
  constructor(private readonly facturacion: FacturacionService) {}

  /** Cálculo de un consumo sin persistir (para revisión previa en UI). */
  @Get('consumo/:consumoId/calcular')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  calcularConsumo(@Param('consumoId') consumoId: string) {
    return this.facturacion.calcularConsumo(consumoId);
  }

  /** Previsualiza la facturación de un periodo completo (dry-run, no escribe nada). */
  @Get('periodo/preview')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  previsualizarPeriodo(
    @Query('periodo') periodo: string,
    @Query('rutaId') rutaId?: string,
    @Query('zonaId') zonaId?: string,
    @Query('contratoId') contratoId?: string,
  ) {
    return this.facturacion.previsualizarPeriodo({ periodo, rutaId, zonaId, contratoId });
  }

  /** Factura un consumo individual (crea Timbrado + Recibo). */
  @Post('consumo/:consumoId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  facturarConsumo(@Param('consumoId') consumoId: string) {
    return this.facturacion.facturarConsumo(consumoId);
  }

  /** Ejecuta la facturación masiva de un periodo. */
  @Post('periodo')
  @Roles('SUPER_ADMIN', 'ADMIN')
  ejecutarPeriodo(@Body() dto: FacturarPeriodoDto) {
    return this.facturacion.ejecutarPeriodo(dto);
  }
}
