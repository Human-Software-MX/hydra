import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { tenancyContext, TENANT_DEFAULT } from './tenancy.context';

class CrearOrganismoDto {
  @Matches(/^[a-z0-9][a-z0-9-]{1,30}$/, {
    message: 'slug: minúsculas, dígitos y guiones (2-31 caracteres)',
  })
  slug!: string;

  @IsString()
  @MinLength(3)
  nombre!: string;

  /** Connection string del tenant; también puede venir de TENANT_<SLUG>_DATABASE_URL. */
  @IsOptional()
  @IsString()
  dbUrl?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

class ActualizarOrganismoDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  nombre?: string;

  @IsOptional()
  @IsString()
  dbUrl?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

/** El dbUrl jamás se devuelve completo (contiene credenciales). */
const publico = (o: { id: string; slug: string; nombre: string; dbUrl: string | null; activo: boolean; config: unknown; createdAt: Date }) => ({
  id: o.id,
  slug: o.slug,
  nombre: o.nombre,
  activo: o.activo,
  config: o.config,
  baseDedicada: Boolean(o.dbUrl),
  createdAt: o.createdAt,
});

@Controller('organismos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganismosController {
  constructor(private readonly prisma: PrismaService) {}

  /** Organismo del request actual (branding/config para el frontend). */
  @Get('actual')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERADOR', 'ATENCION_CLIENTES')
  actual() {
    const ctx = tenancyContext.getStore();
    return {
      slug: ctx?.slug ?? TENANT_DEFAULT,
      nombre: ctx?.nombre ?? null,
      esDefault: (ctx?.slug ?? TENANT_DEFAULT) === TENANT_DEFAULT,
    };
  }

  @Get()
  @Roles('SUPER_ADMIN')
  async listar() {
    const organismos = await this.prisma.organismo.findMany({ orderBy: { createdAt: 'asc' } });
    return organismos.map(publico);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  async crear(@Body() dto: CrearOrganismoDto) {
    const o = await this.prisma.organismo.create({
      data: {
        slug: dto.slug,
        nombre: dto.nombre,
        dbUrl: dto.dbUrl ?? null,
        config: (dto.config as never) ?? undefined,
      },
    });
    return publico(o);
  }

  @Patch(':slug')
  @Roles('SUPER_ADMIN')
  async actualizar(@Param('slug') slug: string, @Body() dto: ActualizarOrganismoDto) {
    const existe = await this.prisma.organismo.findUnique({ where: { slug }, select: { id: true } });
    if (!existe) throw new NotFoundException('Organismo no encontrado');
    const o = await this.prisma.organismo.update({
      where: { slug },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.dbUrl !== undefined && { dbUrl: dto.dbUrl }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
        ...(dto.config !== undefined && { config: dto.config as never }),
      },
    });
    return publico(o);
  }

  /** Desactiva (no borra) un organismo — sus datos viven en su propia base. */
  @Delete(':slug')
  @Roles('SUPER_ADMIN')
  async desactivar(@Param('slug') slug: string) {
    const existe = await this.prisma.organismo.findUnique({ where: { slug }, select: { id: true } });
    if (!existe) throw new NotFoundException('Organismo no encontrado');
    await this.prisma.organismo.update({ where: { slug }, data: { activo: false } });
    return { desactivado: true };
  }
}
