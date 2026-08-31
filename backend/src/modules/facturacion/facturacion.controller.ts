import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FacturacionService } from './facturacion.service';
import { FacturarPeriodoDto } from './dto/facturar-periodo.dto';
import { CancelarLoteDto } from './dto/cancelar-lote.dto';
import { RefacturarConsumoDto } from './dto/refacturar-consumo.dto';

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

  // ─── Lotes de facturación ───────────────────────────────────────────────

  /** Lista lotes de facturación con filtros por periodo y estado. */
  @Get('lotes')
  @Roles('SUPER_ADMIN', 'ADMIN')
  listarLotes(
    @Query('periodo') periodo?: string,
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.facturacion.listarLotes({ periodo, estado, page, limit });
  }

  /** Detalle de un lote con totales de timbrados por estado. */
  @Get('lotes/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  obtenerLote(@Param('id') id: string) {
    return this.facturacion.obtenerLote(id);
  }

  /** Cancela un lote completo (sin CFDI sellado y sin pagos aplicados). */
  @Post('lotes/:id/cancelar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  cancelarLote(@Param('id') id: string, @Body() dto: CancelarLoteDto, @Req() req: any) {
    return this.facturacion.cancelarLote(id, {
      motivo: dto.motivo,
      canceladoPor: dto.canceladoPor ?? this.usuarioDe(req),
    });
  }

  /** Cancela un lote y vuelve a facturar el periodo con los filtros originales. */
  @Post('lotes/:id/reprocesar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  reprocesarLote(@Param('id') id: string, @Body() dto: CancelarLoteDto, @Req() req: any) {
    return this.facturacion.reprocesarLote(id, {
      motivo: dto.motivo,
      canceladoPor: dto.canceladoPor ?? this.usuarioDe(req),
    });
  }

  /** Refactura un consumo individual (cancela su factura previa y la regenera). */
  @Post('consumos/:id/refacturar')
  @Roles('SUPER_ADMIN', 'ADMIN')
  refacturarConsumo(@Param('id') id: string, @Body() dto: RefacturarConsumoDto, @Req() req: any) {
    return this.facturacion.refacturarConsumo(id, {
      motivo: dto.motivo,
      canceladoPor: dto.canceladoPor ?? this.usuarioDe(req),
    });
  }

  private usuarioDe(req: any): string | undefined {
    return req?.user?.email ?? req?.user?.id ?? req?.user?.sub ?? undefined;
  }
}
