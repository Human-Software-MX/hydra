import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Tandeo — calendarios de suministro por sector hidráulico.
 *
 * Modela la realidad mexicana de suministro intermitente: cada sector tiene
 * bloques horarios de servicio por día de la semana. Además del CRUD, expone
 * `estaEnSuministro(sectorId, datetime)` como base para futura facturación
 * diferenciada (p. ej. no penalizar consumo cero fuera de tandeo, o tarificar
 * distinto el agua entregada fuera de calendario).
 *
 * Formato del Json `horario` (claves = días, valores = pares [inicio, fin)):
 *   { "lun": [["06:00","12:00"]], "mar": [["06:00","09:00"],["18:00","21:00"]], ... }
 */

const DIAS_VALIDOS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
type DiaSemana = (typeof DIAS_VALIDOS)[number];
/** getDay() → clave de día (0 = domingo). */
const DIA_POR_GETDAY: DiaSemana[] = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export type HorarioSuministro = Partial<Record<DiaSemana, Array<[string, string]>>>;

@Injectable()
export class TandeoService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Validación del horario ────────────────────────────────────────────────

  /**
   * Valida y normaliza el Json `horario`. Reglas:
   * - Objeto plano con claves ∈ {lun..dom} (al menos un día).
   * - Cada día: array de pares ["HH:MM","HH:MM"] con inicio < fin.
   * - Sin traslapes entre bloques del mismo día.
   */
  validarHorario(horario: unknown): HorarioSuministro {
    if (!horario || typeof horario !== 'object' || Array.isArray(horario)) {
      throw new BadRequestException('horario debe ser un objeto { lun: [["HH:MM","HH:MM"]], ... }');
    }
    const claves = Object.keys(horario as object);
    if (claves.length === 0) {
      throw new BadRequestException('horario debe definir al menos un día');
    }
    const normalizado: HorarioSuministro = {};
    for (const clave of claves) {
      if (!DIAS_VALIDOS.includes(clave as DiaSemana)) {
        throw new BadRequestException(
          `Día inválido en horario: '${clave}' (válidos: ${DIAS_VALIDOS.join(', ')})`,
        );
      }
      const bloques = (horario as Record<string, unknown>)[clave];
      if (!Array.isArray(bloques)) {
        throw new BadRequestException(`horario.${clave} debe ser un array de pares ["HH:MM","HH:MM"]`);
      }
      const pares: Array<[string, string]> = bloques.map((b, i) => {
        if (!Array.isArray(b) || b.length !== 2 || typeof b[0] !== 'string' || typeof b[1] !== 'string') {
          throw new BadRequestException(`horario.${clave}[${i}] debe ser un par ["HH:MM","HH:MM"]`);
        }
        const [inicio, fin] = b as [string, string];
        if (!HORA_REGEX.test(inicio) || !HORA_REGEX.test(fin)) {
          throw new BadRequestException(`horario.${clave}[${i}]: horas inválidas (formato HH:MM 00:00–23:59)`);
        }
        if (inicio >= fin) {
          throw new BadRequestException(`horario.${clave}[${i}]: el inicio (${inicio}) debe ser menor al fin (${fin})`);
        }
        return [inicio, fin];
      });
      // Traslapes dentro del día (bloques ordenados por inicio; fin exclusivo).
      const ordenados = [...pares].sort((a, b) => a[0].localeCompare(b[0]));
      for (let i = 1; i < ordenados.length; i++) {
        if (ordenados[i][0] < ordenados[i - 1][1]) {
          throw new BadRequestException(
            `horario.${clave}: los bloques ${ordenados[i - 1].join('-')} y ${ordenados[i].join('-')} se traslapan`,
          );
        }
      }
      normalizado[clave as DiaSemana] = ordenados;
    }
    return normalizado;
  }

  private validarVigencia(vigenteDesde?: string, vigenteHasta?: string | null) {
    if (vigenteDesde && vigenteHasta && vigenteHasta < vigenteDesde) {
      throw new BadRequestException('vigenteHasta no puede ser anterior a vigenteDesde');
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async crear(params: {
    sectorId: string;
    nombre: string;
    horario: unknown;
    vigenteDesde: string;
    vigenteHasta?: string;
    activo?: boolean;
    notas?: string;
  }) {
    const sector = await this.prisma.sectorHidraulico.findUnique({
      where: { id: params.sectorId },
      select: { id: true },
    });
    if (!sector) throw new NotFoundException('Sector hidráulico no encontrado');

    const horario = this.validarHorario(params.horario);
    this.validarVigencia(params.vigenteDesde, params.vigenteHasta);

    return this.prisma.calendarioSuministro.create({
      data: {
        sectorId: params.sectorId,
        nombre: params.nombre,
        horario: horario as Prisma.InputJsonValue,
        vigenteDesde: params.vigenteDesde,
        vigenteHasta: params.vigenteHasta ?? null,
        activo: params.activo ?? true,
        notas: params.notas ?? null,
      },
    });
  }

  async listar(params: { sectorId?: string; activo?: boolean } = {}) {
    return this.prisma.calendarioSuministro.findMany({
      where: {
        ...(params.sectorId && { sectorId: params.sectorId }),
        ...(params.activo !== undefined && { activo: params.activo }),
      },
      include: { sector: { select: { codigo: true, nombre: true } } },
      orderBy: [{ sectorId: 'asc' }, { vigenteDesde: 'desc' }],
    });
  }

  async obtener(id: string) {
    const cal = await this.prisma.calendarioSuministro.findUnique({
      where: { id },
      include: { sector: { select: { codigo: true, nombre: true } } },
    });
    if (!cal) throw new NotFoundException('Calendario de suministro no encontrado');
    return cal;
  }

  async actualizar(
    id: string,
    params: {
      nombre?: string;
      horario?: unknown;
      vigenteDesde?: string;
      vigenteHasta?: string;
      activo?: boolean;
      notas?: string;
    },
  ) {
    const actual = await this.obtener(id);
    const horario = params.horario !== undefined ? this.validarHorario(params.horario) : undefined;
    this.validarVigencia(
      params.vigenteDesde ?? actual.vigenteDesde,
      params.vigenteHasta !== undefined ? params.vigenteHasta : actual.vigenteHasta,
    );

    return this.prisma.calendarioSuministro.update({
      where: { id },
      data: {
        ...(params.nombre !== undefined && { nombre: params.nombre }),
        ...(horario !== undefined && { horario: horario as Prisma.InputJsonValue }),
        ...(params.vigenteDesde !== undefined && { vigenteDesde: params.vigenteDesde }),
        ...(params.vigenteHasta !== undefined && { vigenteHasta: params.vigenteHasta }),
        ...(params.activo !== undefined && { activo: params.activo }),
        ...(params.notas !== undefined && { notas: params.notas }),
      },
    });
  }

  async eliminar(id: string) {
    await this.obtener(id);
    await this.prisma.calendarioSuministro.delete({ where: { id } });
    return { eliminado: true, id };
  }

  // ─── Consulta de vigencia / suministro ─────────────────────────────────────

  /** Calendario activo del sector vigente a la fecha (YYYY-MM-DD, default hoy local). */
  async calendarioVigente(sectorId: string, fecha?: string) {
    const f = fecha ?? this.fechaLocal(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
      throw new BadRequestException('fecha debe ser YYYY-MM-DD');
    }
    return this.prisma.calendarioSuministro.findFirst({
      where: {
        sectorId,
        activo: true,
        vigenteDesde: { lte: f },
        OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: f } }],
      },
      orderBy: { vigenteDesde: 'desc' },
      include: { sector: { select: { codigo: true, nombre: true } } },
    });
  }

  /**
   * ¿Hay suministro programado en el sector en ese instante? (hora local del
   * proceso; en producción TZ=America/Mexico_City). Sin calendario vigente se
   * asume suministro continuo (no todos los sectores tienen tandeo).
   * Helper exportado — base para futura facturación diferenciada por tandeo.
   */
  async estaEnSuministro(
    sectorId: string,
    datetime: Date,
  ): Promise<{
    enSuministro: boolean;
    conTandeo: boolean;
    calendarioId?: string;
    dia?: DiaSemana;
    hora?: string;
    bloques?: Array<[string, string]>;
  }> {
    if (isNaN(datetime.getTime())) {
      throw new BadRequestException('datetime inválido');
    }
    const cal = await this.calendarioVigente(sectorId, this.fechaLocal(datetime));
    if (!cal) return { enSuministro: true, conTandeo: false };

    const dia = DIA_POR_GETDAY[datetime.getDay()];
    const horario = cal.horario as HorarioSuministro;
    const bloques = horario[dia] ?? [];
    const p = (n: number) => String(n).padStart(2, '0');
    const hora = `${p(datetime.getHours())}:${p(datetime.getMinutes())}`;
    const enSuministro = bloques.some(([inicio, fin]) => inicio <= hora && hora < fin);

    return { enSuministro, conTandeo: true, calendarioId: cal.id, dia, hora, bloques };
  }

  private fechaLocal(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
}
