import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('auditoria')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditoriaController {
  constructor(private readonly prisma: PrismaService) {}

  /** Bitácora global de mutaciones: quién hizo qué, cuándo y con qué resultado. */
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async listar(
    @Query('entidad') entidad?: string,
    @Query('usuarioEmail') usuarioEmail?: string,
    @Query('metodo') metodo?: string,
    @Query('entidadId') entidadId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    const where: Prisma.AuditoriaEventoWhereInput = {
      ...(entidad && { entidad }),
      ...(usuarioEmail && { usuarioEmail: { contains: usuarioEmail, mode: 'insensitive' } }),
      ...(metodo && { metodo: metodo.toUpperCase() }),
      ...(entidadId && { entidadId }),
      ...((desde || hasta) && {
        createdAt: {
          ...(desde && { gte: new Date(`${desde}T00:00:00Z`) }),
          ...(hasta && { lte: new Date(`${hasta}T23:59:59Z`) }),
        },
      }),
    };
    const take = Math.min(limit, 200);
    const [data, total] = await Promise.all([
      this.prisma.auditoriaEvento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take,
      }),
      this.prisma.auditoriaEvento.count({ where }),
    ]);
    return { data, total, page, limit: take };
  }
}
