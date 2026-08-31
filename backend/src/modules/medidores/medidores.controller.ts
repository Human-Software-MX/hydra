import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReemplazoService } from './reemplazo.service';
import { PrioridadReemplazo } from './reemplazo-scorer';
import { Roles, ROLES_OPERACION } from '../auth/roles.decorator';

@Roles(...ROLES_OPERACION)
@Controller('medidores')
export class MedidoresController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reemplazo: ReemplazoService,
  ) {}

  /**
   * Ranking de reemplazo del parque de medidores: prioriza por excepciones
   * VEE (submedición/medidor parado), % lecturas estimadas, edad y consumo.
   */
  @Get('ranking-reemplazo')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  async rankingReemplazo(
    @Query('zonaId') zonaId?: string,
    @Query('administracionId') administracionId?: string,
    @Query('prioridad') prioridad?: PrioridadReemplazo,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit = 100,
  ) {
    return this.reemplazo.ranking({ zonaId, administracionId, prioridad, limit });
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  async findAll(
    @Query('contratoId') contratoId?: string,
    @Query('zonaId') zonaId?: string,
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit = 200,
  ) {
    const where: Record<string, unknown> = {
      ...(contratoId && { contratoId }),
      ...(estado && { estado }),
      ...(zonaId && { contrato: { zonaId } }),
    };
    const medidores = await this.prisma.medidor.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        contrato: { select: { id: true, nombre: true, estado: true, zonaId: true } },
        marca: { select: { id: true, nombre: true } },
        modelo: { select: { id: true, nombre: true } },
      },
    });
    return medidores.map((m) => ({
      id: m.id,
      contratoId: m.contratoId,
      serie: m.serie,
      estado: m.estado,
      lecturaInicial: m.lecturaInicial,
      cobroDiferido: m.cobroDiferido,
      marca: m.marca?.nombre ?? null,
      modelo: m.modelo?.nombre ?? null,
      contrato: m.contrato,
    }));
  }

  @Get('bodega')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  async findBodega(
    @Query('zonaId') zonaId?: string,
    @Query('estado') estado?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit = 200,
  ) {
    const where = {
      ...(zonaId && { zonaId }),
      ...(estado && { estado }),
    };
    const medidores = await this.prisma.medidorBodega.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        marca: { select: { id: true, nombre: true } },
        modelo: { select: { id: true, nombre: true } },
      },
    });
    return medidores.map((m) => ({
      id: m.id,
      serie: m.serie,
      zonaId: m.zonaId,
      estado: m.estado,
      marca: m.marca?.nombre ?? null,
      modelo: m.modelo?.nombre ?? null,
    }));
  }
}
