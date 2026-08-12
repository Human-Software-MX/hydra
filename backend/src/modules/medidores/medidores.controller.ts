import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles, ROLES_OPERACION } from '../auth/roles.decorator';

@Roles(...ROLES_OPERACION)
@Controller('medidores')
export class MedidoresController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
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
