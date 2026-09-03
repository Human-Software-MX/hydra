import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { administracionExcluidaDelSelector } from '@/common/administraciones-selector-excluidas';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CatalogosOperativosService {
  constructor(private readonly prisma: PrismaService) {}

  async findAdministraciones(params?: { uso?: string }) {
    const uso = params?.uso?.trim().toLowerCase();
    // Con filtro de uso solo se ofrecen administraciones que tengan al menos un tipo de
    // contratación activo de esa rama (doméstico = categoría tarifaria DOMESTICA).
    const usoFilter =
      uso === 'domestico' || uso === 'doméstico'
        ? { codigo: 'DOMESTICA' }
        : uso === 'no_domestico' || uso === 'no-domestico'
          ? { codigo: { not: 'DOMESTICA' } }
          : null;
    const rows = await this.prisma.administracion.findMany({
      select: { id: true, nombre: true },
      where: usoFilter
        ? {
            tiposContratacion: {
              some: { activo: true, claseTarifa: { categoria: usoFilter } },
            },
          }
        : undefined,
      orderBy: { nombre: 'asc' },
    });
    return rows.filter((r) => !administracionExcluidaDelSelector(r.nombre));
  }

  private activeFilter(activo?: string) {
    if (activo === 'true') return { activo: true };
    if (activo === 'false') return { activo: false };
    return {};
  }

  // ─── Marcas de Medidor ─────────────────────────────────────────────────────

  findMarcasMedidor(filters: { activo?: string }) {
    return this.prisma.catalogoMarcaMedidor.findMany({
      where: this.activeFilter(filters.activo),
      include: { modelos: true },
      orderBy: { nombre: 'asc' },
    });
  }

  createMarcaMedidor(data: { codigo: string; nombre: string }) {
    return this.prisma.catalogoMarcaMedidor.create({ data });
  }

  updateMarcaMedidor(id: string, data: { nombre?: string; activo?: boolean }) {
    return this.prisma.catalogoMarcaMedidor.update({ where: { id }, data });
  }

  // ─── Modelos de Medidor ────────────────────────────────────────────────────

  findModelosMedidor(filters: { activo?: string; marcaId?: string }) {
    return this.prisma.catalogoModeloMedidor.findMany({
      where: {
        ...this.activeFilter(filters.activo),
        ...(filters.marcaId ? { marcaId: filters.marcaId } : {}),
      },
      include: { marca: true },
      orderBy: { nombre: 'asc' },
    });
  }

  createModeloMedidor(data: { marcaId: string; codigo: string; nombre: string }) {
    return this.prisma.catalogoModeloMedidor.create({ data });
  }

  updateModeloMedidor(id: string, data: { nombre?: string; activo?: boolean }) {
    return this.prisma.catalogoModeloMedidor.update({ where: { id }, data });
  }

  // ─── Calibres ──────────────────────────────────────────────────────────────

  findCalibres(filters: { activo?: string }) {
    return this.prisma.catalogoCalibre.findMany({
      where: this.activeFilter(filters.activo),
      orderBy: { diametroMm: 'asc' },
    });
  }

  createCalibre(data: { codigo: string; descripcion: string; diametroMm?: number }) {
    return this.prisma.catalogoCalibre.create({ data });
  }

  // ─── Emplazamientos ────────────────────────────────────────────────────────

  findEmplazamientos(filters: { activo?: string }) {
    return this.prisma.catalogoEmplazamiento.findMany({
      where: this.activeFilter(filters.activo),
      orderBy: { descripcion: 'asc' },
    });
  }

  // ─── Tipos de Contador ─────────────────────────────────────────────────────

  findTiposContador(filters: { activo?: string }) {
    return this.prisma.catalogoTipoContador.findMany({
      where: this.activeFilter(filters.activo),
      orderBy: { descripcion: 'asc' },
    });
  }

  // ─── Formas de Pago ────────────────────────────────────────────────────────

  findFormasPago(filters: { activo?: string; tipoRecaudacion?: string }) {
    return this.prisma.formaPago.findMany({
      where: {
        ...this.activeFilter(filters.activo),
        ...(filters.tipoRecaudacion ? { tipoRecaudacion: filters.tipoRecaudacion } : {}),
      },
      orderBy: { nombre: 'asc' },
    });
  }

  createFormaPago(data: {
    codigo: string;
    nombre: string;
    tipoRecaudacion: string;
    aceptaEfectivo?: boolean;
    aceptaCheque?: boolean;
    aceptaTarjeta?: boolean;
    aceptaTransf?: boolean;
    requiereReferencia?: boolean;
  }) {
    return this.prisma.formaPago.create({ data });
  }

  updateFormaPago(id: string, data: { nombre?: string; activo?: boolean }) {
    return this.prisma.formaPago.update({ where: { id }, data });
  }

  // ─── Oficinas ──────────────────────────────────────────────────────────────

  findOficinas(filters: { activo?: string; administracionId?: string }) {
    return this.prisma.oficina.findMany({
      where: {
        ...this.activeFilter(filters.activo),
        ...(filters.administracionId ? { administracionId: filters.administracionId } : {}),
      },
      include: { administracion: true, tipoOficina: true },
      orderBy: { nombre: 'asc' },
    });
  }

  findTiposOficina(filters: { activo?: string }) {
    return this.prisma.tipoOficina.findMany({
      where: this.activeFilter(filters.activo),
      orderBy: { descripcion: 'asc' },
    });
  }

  // ─── Sectores Hidráulicos ──────────────────────────────────────────────────

  findSectoresHidraulicos(filters: { activo?: string; administracionId?: string }) {
    return this.prisma.sectorHidraulico.findMany({
      where: {
        ...this.activeFilter(filters.activo),
        ...(filters.administracionId ? { administracionId: filters.administracionId } : {}),
      },
      include: { administracion: true },
      orderBy: { nombre: 'asc' },
    });
  }

  // ─── Clases de Contrato ────────────────────────────────────────────────────

  findClasesContrato(filters: { activo?: string }) {
    return this.prisma.claseContrato.findMany({
      where: this.activeFilter(filters.activo),
      orderBy: { codigo: 'asc' },
    });
  }

  // ─── Tipos de Vía ─────────────────────────────────────────────────────────

  findTiposVia(filters: { activo?: string }) {
    return this.prisma.tipoVia.findMany({
      where: this.activeFilter(filters.activo),
      orderBy: { descripcion: 'asc' },
    });
  }

  // ─── Tipos de Variable ────────────────────────────────────────────────────

  findTiposVariable(filters: { activo?: string }) {
    return this.prisma.tipoVariable.findMany({
      where: this.activeFilter(filters.activo),
      orderBy: { nombre: 'asc' },
    });
  }

  createTipoVariable(data: {
    codigo: string;
    nombre: string;
    tipoDato: string;
    valoresPosibles?: Prisma.InputJsonValue;
    unidad?: string | null;
  }) {
    return this.prisma.tipoVariable.create({ data });
  }

  updateTipoVariable(
    id: string,
    data: {
      nombre?: string;
      tipoDato?: string;
      valoresPosibles?: Prisma.InputJsonValue | null;
      unidad?: string | null;
      activo?: boolean;
    },
  ) {
    const { valoresPosibles, ...rest } = data;
    return this.prisma.tipoVariable.update({
      where: { id },
      data: {
        ...rest,
        ...(valoresPosibles === null
          ? { valoresPosibles: Prisma.JsonNull }
          : valoresPosibles !== undefined
            ? { valoresPosibles }
            : {}),
      },
    });
  }

  // ─── Variables por Tipo Contratación ──────────────────────────────────────

  findVariablesTipoContratacion(tipoContratacionId: string) {
    return this.prisma.variableTipoContratacion.findMany({
      where: { tipoContratacionId },
      include: { tipoVariable: true },
      orderBy: { orden: 'asc' },
    });
  }

  assignVariableTipoContratacion(data: {
    tipoContratacionId: string;
    tipoVariableId: string;
    obligatorio?: boolean;
    valorDefecto?: string;
    orden?: number;
  }) {
    return this.prisma.variableTipoContratacion.upsert({
      where: {
        tipoContratacionId_tipoVariableId: {
          tipoContratacionId: data.tipoContratacionId,
          tipoVariableId: data.tipoVariableId,
        },
      },
      update: {
        obligatorio: data.obligatorio,
        valorDefecto: data.valorDefecto,
        orden: data.orden,
      },
      create: data,
    });
  }

  removeVariableTipoContratacion(tipoContratacionId: string, tipoVariableId: string) {
    return this.prisma.variableTipoContratacion.delete({
      where: {
        tipoContratacionId_tipoVariableId: {
          tipoContratacionId,
          tipoVariableId,
        },
      },
    });
  }
}
