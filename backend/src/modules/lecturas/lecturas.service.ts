import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { conMonitoreo } from '../../common/monitoreo.helper';

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
  private readonly logger = new Logger(LecturasService.name);

  /** Dígitos por defecto de un medidor cuando el contrato/medidor no expone `digitos`. */
  private readonly DIGITOS_DEFAULT = 5;
  /** Banda de plausibilidad (m³) para aceptar un consumo reconstruido por vuelta de contador. */
  private readonly CONSUMO_MAX_PLAUSIBLE = 10000;

  constructor(private readonly prisma: PrismaService) {}

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
    archivoHash?: string;
    cargadoPor?: string;
    /**
     * B2/re-upload: cuando es `true`, un archivo corregido REEMPLAZA las lecturas
     * previas del mismo (contrato, periodo) en lugar de rechazarlas por colisión
     * con `@@unique([contratoId, periodo])`. Es una decisión explícita del
     * operador (no un upsert silencioso) y queda registrada en el LogProceso.
     */
    reemplazar?: boolean;
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

    // B1 — Idempotencia: rechaza una re-carga idéntica (mismo periodo + hash de archivo).
    if (params.archivoHash) {
      const duplicado = await this.prisma.loteLecturas.findFirst({
        where: { periodo: params.periodo, archivoHash: params.archivoHash },
        select: { id: true, archivoNombre: true, createdAt: true },
      });
      if (duplicado) {
        throw new ConflictException({
          message:
            'Archivo duplicado: este mismo archivo ya fue cargado para este periodo. Carga cancelada.',
          loteExistenteId: duplicado.id,
          archivoNombre: duplicado.archivoNombre,
          cargadoEl: duplicado.createdAt,
        });
      }
    }

    return conMonitoreo(
      this.prisma,
      'VALIDACION_LECTURAS',
      async (ctx) => {
        const lote = await this.prisma.loteLecturas.create({
          data: {
            zonaId: params.zonaId ?? null,
            rutaId: params.rutaId ?? null,
            periodo: params.periodo,
            tipoLote: params.tipoLote,
            archivoNombre: params.archivoNombre,
            archivoHash: params.archivoHash ?? null,
            estado: 'Validando',
            totalRegistros: parsed.length,
            cargadoPor: params.cargadoPor ?? null,
          },
        });

        let totalValidos = 0;
        let totalConError = 0;
        let totalReemplazadas = 0;
        const errores: { contrato: string; motivo: string }[] = [];

        for (const p of parsed) {
          // B2 — El campo del archivo trae el NÚMERO de contrato, no el id (cuid).
          // Resolvemos el contrato real para respetar la FK lecturas.contrato_id.
          const contrato = await this.resolverContrato(p.contrato);
          if (!contrato) {
            totalConError++;
            errores.push({ contrato: p.contrato, motivo: 'Contrato no encontrado' });
            continue;
          }

          const incidencia = p.codigoIncidencia
            ? await this.prisma.catalogoIncidencia.findUnique({
                where: { codigo: p.codigoIncidencia },
              })
            : null;

          const esEstimada = incidencia?.esAveria ?? false;
          const consumoEstimado = esEstimada ? await this.calcularEstimada(contrato.id) : null;

          // B2 — Consumo con guarda de vuelta de contador (rollover) y clamp de negativos.
          const calc = this.calcularConsumo(p.lecturaActual, p.lecturaAnterior, contrato.digitos);

          let estado =
            p.lecturaActual !== null ? 'Valida' : esEstimada ? 'Estimada' : 'NoValida';
          let motivoInvalidacion: string | null = null;

          if (p.lecturaActual !== null && calc.motivo) {
            // Lectura presente pero consumo negativo/implausible → no persistimos negativo.
            estado = 'NoValida';
            motivoInvalidacion = calc.motivo;
          }

          const lecturaData = {
            loteId: lote.id,
            contratoId: contrato.id,
            periodo: params.periodo,
            lecturaActual: p.lecturaActual,
            lecturaAnterior: p.lecturaAnterior,
            consumoReal: calc.consumo,
            consumoEstimado,
            esEstimada,
            incidenciaId: incidencia?.id ?? null,
            urlFoto: p.urlFoto,
            estado,
            motivoInvalidacion,
            datosRaw: {
              ...(p.datosRaw as object),
              digitosMedidor: calc.digitosUsados,
              ...(calc.rollover ? { rolloverAplicado: true } : {}),
            },
          };

          try {
            if (params.reemplazar) {
              // Corrección explícita: elimina la lectura previa del (contrato, periodo)
              // y reinserta la corregida de forma atómica por renglón.
              const replaced = await this.prisma.$transaction(async (tx) => {
                const { count } = await tx.lectura.deleteMany({
                  where: { contratoId: contrato.id, periodo: params.periodo },
                });
                await tx.lectura.create({ data: lecturaData });
                return count;
              });
              if (replaced > 0) totalReemplazadas += replaced;
            } else {
              await this.prisma.lectura.create({ data: lecturaData });
            }
          } catch (err: unknown) {
            // Choca contra @@unique([contratoId, periodo]): ya existe lectura del periodo.
            totalConError++;
            errores.push({
              contrato: p.contrato,
              motivo:
                'El periodo ya tiene lecturas cargadas para este contrato; reenvíe con la opción Reemplazar para corregir',
            });
            this.logger.warn(
              `Lectura duplicada contrato=${contrato.id} periodo=${params.periodo}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            continue;
          }

          if (estado === 'Valida' || estado === 'Estimada') totalValidos++;
          else {
            totalConError++;
            errores.push({ contrato: p.contrato, motivo: motivoInvalidacion ?? 'Sin lectura válida' });
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

        ctx.registros = totalValidos + totalConError;
        ctx.errores = totalConError;
        ctx.detalle = {
          loteId: lote.id,
          periodo: params.periodo,
          archivoNombre: params.archivoNombre,
          reemplazar: params.reemplazar ?? false,
          totalReemplazadas,
        };

        return {
          loteId: lote.id,
          totalRegistros: parsed.length,
          totalValidos,
          totalConError,
          totalReemplazadas,
          errores,
        };
      },
      { subTipo: params.tipoLote, usuarioId: params.cargadoPor },
    );
  }

  /**
   * B2 — Resuelve el contrato real (cuid) a partir del número de contrato del archivo plano.
   * Devuelve también los dígitos del medidor para la guarda de rollover.
   */
  private async resolverContrato(
    numero: string,
  ): Promise<{ id: string; digitos: number | null } | null> {
    const num = numero.trim();
    if (!num) return null;

    // 1) Coincidencia exacta por número CEA — clave de negocio del archivo plano.
    //    Es determinista y tiene prioridad sobre el fallback entero.
    let contrato = await this.prisma.contrato.findFirst({
      where: { ceaNumContrato: num },
      select: { id: true, medidor: { select: { digitos: true } } },
    });

    // 2) Fallback por numeroContrato (entero) — SOLO si no hubo match CEA y es
    //    inequívoco. Un OR ciego con findFirst podía enlazar la lectura a OTRO
    //    contrato cuyo numeroContrato coincidiera con el número CEA de este;
    //    ante ambigüedad NO se adivina, se rechaza el renglón.
    if (!contrato) {
      const asInt = /^\d+$/.test(num) ? parseInt(num, 10) : NaN;
      if (Number.isFinite(asInt)) {
        const candidatos = await this.prisma.contrato.findMany({
          where: { numeroContrato: asInt },
          select: { id: true, medidor: { select: { digitos: true } } },
          take: 2,
        });
        if (candidatos.length === 1) contrato = candidatos[0];
      }
    }

    if (!contrato) return null;
    return { id: contrato.id, digitos: contrato.medidor?.digitos ?? null };
  }

  /**
   * B2 — Consumo con guarda de vuelta de contador (rollover) y clamp de negativos.
   * - delta >= 0            → consumo normal.
   * - delta < 0 y plausible → el contador dio la vuelta en 10^dígitos; reconstruye el consumo.
   * - delta < 0 implausible → devuelve consumo null + motivo (nunca persiste un negativo).
   */
  private calcularConsumo(
    actual: number | null,
    anterior: number | null,
    digitos: number | null,
  ): { consumo: number | null; motivo?: string; rollover?: boolean; digitosUsados: number } {
    const digitosUsados = digitos && digitos > 0 ? digitos : this.DIGITOS_DEFAULT;
    if (actual === null || anterior === null) return { consumo: null, digitosUsados };

    const delta = actual - anterior;
    if (delta >= 0) return { consumo: delta, digitosUsados };

    // actual < anterior → posible vuelta de contador (wrap en 10^dígitos).
    const wrap = Math.pow(10, digitosUsados);
    const wrapped = actual + wrap - anterior;
    if (wrapped >= 0 && wrapped <= this.CONSUMO_MAX_PLAUSIBLE) {
      return { consumo: wrapped, rollover: true, digitosUsados };
    }

    // Negativo genuino o implausible: se marca, no se persiste un consumo negativo.
    return {
      consumo: null,
      motivo: 'Consumo negativo o implausible (posible cambio/reinicio de medidor)',
      digitosUsados,
    };
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
