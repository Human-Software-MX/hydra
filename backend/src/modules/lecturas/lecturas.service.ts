import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';

interface ParsedLectura {
  contrato: string;
  cliente: string;
  lecturaAnterior: number | null;
  lecturaActual: number | null;
  codigoIncidencia: string | null;
  codigoLecturista: string;
  urlFoto: string | null;
  consumoHistorico: number[];
  datosRaw: object;
}

@Injectable()
export class LecturasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  parseArchivoPlano(contenido: string): ParsedLectura[] {
    const lineas = contenido.split('\n').filter((l) => l.trim().length > 0);
    return lineas
      .map((linea, idx) => {
        try {
          return {
            contrato: linea.substring(14, 22).trim(),
            cliente: linea.substring(22, 102).trim(),
            lecturaAnterior: parseInt(linea.substring(110, 119).trim()) || null,
            lecturaActual: this.extraerLecturaActual(linea),
            codigoIncidencia: this.extraerIncidencia(linea),
            codigoLecturista: linea.substring(102, 109).trim(),
            urlFoto: null,
            consumoHistorico: [],
            datosRaw: { linea: idx + 1, raw: linea.substring(0, 80) },
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ParsedLectura[];
  }

  private extraerLecturaActual(linea: string): number | null {
    if (linea.length < 538) return null;
    const val = linea.substring(529, 538).trim();
    const n = parseInt(val);
    return isNaN(n) ? null : n;
  }

  private extraerIncidencia(linea: string): string | null {
    if (linea.length < 466) return null;
    const codigo = linea.substring(464, 466).trim();
    return codigo || null;
  }

  async cargarLote(params: {
    zonaId?: string;
    rutaId?: string;
    periodo: string;
    tipoLote: string;
    archivoNombre: string;
    contenido: string;
    cargadoPor?: string;
  }) {
    const parsed = this.parseArchivoPlano(params.contenido);
    if (parsed.length === 0) {
      throw new BadRequestException('El archivo no contiene registros válidos');
    }

    const sinDatos = parsed.filter((p) => p.lecturaActual === null && !p.codigoIncidencia);
    if (sinDatos.length > 0) {
      throw new BadRequestException({
        message: 'Lote rechazado: contratos sin lectura ni incidencia',
        contratos: sinDatos.map((p) => p.contrato),
      });
    }

    const lote = await this.prisma.loteLecturas.create({
      data: {
        zonaId: params.zonaId ?? null,
        rutaId: params.rutaId ?? null,
        periodo: params.periodo,
        tipoLote: params.tipoLote,
        archivoNombre: params.archivoNombre,
        estado: 'Validando',
        totalRegistros: parsed.length,
        cargadoPor: params.cargadoPor ?? null,
      },
    });

    let totalValidos = 0;
    let totalConError = 0;
    const errores: { contrato: string; motivo: string }[] = [];

    for (const p of parsed) {
      const incidencia = p.codigoIncidencia
        ? await this.prisma.catalogoIncidencia.findUnique({ where: { codigo: p.codigoIncidencia } })
        : null;

      const esEstimada = incidencia?.esAveria ?? false;
      const consumoEstimado = esEstimada ? await this.calcularEstimada(p.contrato) : null;
      const estado =
        p.lecturaActual !== null ? 'Valida' : esEstimada ? 'Estimada' : 'NoValida';

      const lectura = await this.prisma.lectura.create({
        data: {
          loteId: lote.id,
          contratoId: p.contrato,
          periodo: params.periodo,
          lecturaActual: p.lecturaActual,
          lecturaAnterior: p.lecturaAnterior,
          consumoReal:
            p.lecturaActual !== null && p.lecturaAnterior !== null
              ? p.lecturaActual - p.lecturaAnterior
              : null,
          consumoEstimado,
          esEstimada,
          incidenciaId: incidencia?.id ?? null,
          urlFoto: p.urlFoto,
          estado,
          datosRaw: p.datosRaw,
        },
      });

      if (estado === 'Valida' || estado === 'Estimada') {
        void this.webhooks.emitir('lectura.capturada', {
          lecturaId: lectura.id,
          contratoId: p.contrato,
          periodo: params.periodo,
          lecturaActual: p.lecturaActual,
          esEstimada,
        });
      }

      if (estado === 'Valida' || estado === 'Estimada') totalValidos++;
      else {
        totalConError++;
        errores.push({ contrato: p.contrato, motivo: 'Sin lectura válida' });
      }
    }

    await this.prisma.loteLecturas.update({
      where: { id: lote.id },
      data: {
        estado: totalConError === 0 ? 'Valido' : 'Rechazado',
        totalValidos,
        totalConError,
        errores: errores.length > 0 ? errores : undefined,
      },
    });

    return { loteId: lote.id, totalRegistros: parsed.length, totalValidos, totalConError, errores };
  }

  private async calcularEstimada(contratoId: string): Promise<number> {
    const ultimas = await this.prisma.lectura.findMany({
      where: { contratoId, esEstimada: false, consumoReal: { not: null } },
      orderBy: { periodo: 'desc' },
      take: 3,
      select: { consumoReal: true },
    });
    if (ultimas.length === 0) return 0;
    const suma = ultimas.reduce((s, l) => s + (l.consumoReal ?? 0), 0);
    return Math.round(suma / ultimas.length);
  }

  async findLotes(params: { zonaId?: string; rutaId?: string; periodo?: string; estado?: string }) {
    return this.prisma.loteLecturas.findMany({
      where: {
        ...(params.zonaId && { zonaId: params.zonaId }),
        ...(params.rutaId && { rutaId: params.rutaId }),
        ...(params.periodo && { periodo: { contains: params.periodo } }),
        ...(params.estado && { estado: params.estado }),
      },
      include: {
        zona: { select: { id: true, nombre: true } },
        ruta: { select: { id: true, sector: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLecturas(params: {
    loteId?: string;
    contratoId?: string;
    rutaId?: string;
    zonaId?: string;
    periodo?: string;
    estado?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {
      ...(params.loteId && { loteId: params.loteId }),
      ...(params.contratoId && { contratoId: params.contratoId }),
      ...(params.estado && { estado: params.estado }),
      ...(params.periodo && { periodo: { contains: params.periodo } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.lectura.findMany({
        where,
        include: {
          incidencia: { select: { codigo: true, descripcion: true, esAveria: true } },
          lecturista: { select: { codigo: true, nombre: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.lectura.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getLecturistas() {
    return this.prisma.lecturista.findMany({ include: { contratista: true }, orderBy: { nombre: 'asc' } });
  }

  async getIncidencias() {
    return this.prisma.catalogoIncidencia.findMany({ orderBy: { codigo: 'asc' } });
  }

  async createMensaje(data: { loteId?: string; contratoId?: string; mensaje: string; tipo?: string }) {
    return this.prisma.mensajeLecturista.create({ data });
  }

  async getMensajes(params: { loteId?: string; contratoId?: string }) {
    return this.prisma.mensajeLecturista.findMany({
      where: {
        ...(params.loteId && { loteId: params.loteId }),
        ...(params.contratoId && { contratoId: params.contratoId }),
        visible: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
