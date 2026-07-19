import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PagosService } from './pagos.service';

@Controller('pagos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PagosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pagosService: PagosService,
  ) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  async findAll(
    @Query('contratoId') contratoId?: string,
    @Query('origen') origen?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    const where = {
      ...(contratoId && { contratoId }),
      ...(origen && { origen }),
    };
    const [data, total] = await Promise.all([
      this.prisma.pago.findMany({
        where,
        include: {
          contrato: { select: { nombre: true } },
          recibo: { select: { id: true, saldoVigente: true } },
        },
        orderBy: { fecha: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pago.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR')
  async crear(
    @Body()
    body: {
      contratoId: string;
      reciboId?: string;
      timbradoId?: string;
      convenioId?: string;
      monto: number;
      tipo: string;
      concepto?: string;
      fecha?: string;
    },
  ) {
    return this.pagosService.crear(body);
  }
}
