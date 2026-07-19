import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { RestriccionesService } from '../restricciones/restricciones.service';
import { BUCKET_FIELD, EPSILON, enGrupoControl } from './cartera.util';
import { calcularUplift } from './uplift';

/**
 * Dunning como datos: reglas configurables (`ReglaDunning`) que mapean días de
 * mora → acción → canal, segmentables por tipo de contratación / tipo de
 * servicio. El pipeline nocturno evalúa el `EstadoCuenta` materializado y
 * ORIGINA acciones reutilizando los módulos existentes (notificaciones,
 * restricciones LGA, órdenes de corte) — no los reimplementa.
 *
 * Toda acción ejecutada/fallida/omitida queda en `AccionCobranza` con
 * referencia cruzada (notificación, restricción u orden generada).
 */

const ACCIONES_VALIDAS = [
  'notificar_aviso',
  'notificar_requerimiento',
  'generar_restriccion',
  'generar_corte',
  'ofrecer_convenio',
  'proponer_incobrable',
] as const;
export type AccionDunning = (typeof ACCIONES_VALIDAS)[number];

/** Tipo de AccionCobranza que registra cada acción de regla. */
const TIPO_ACCION: Record<AccionDunning, string> = {
  notificar_aviso: 'aviso',
  notificar_requerimiento: 'requerimiento',
  generar_restriccion: 'restriccion',
  generar_corte: 'corte',
  ofrecer_convenio: 'convenio_ofrecido',
  proponer_incobrable: 'incobrable',
};

type CanalDunning = 'email' | 'whatsapp' | 'ambos';

interface ContextoCampana {
  id: string;
  administracionId: string | null;
  bucketObjetivo: string | null;
  /** % del universo reservado como grupo control (experimento A/B). */
  grupoControlPct?: number | null;
}

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
    private readonly restricciones: RestriccionesService,
  ) {}

  // ─── Pipeline de evaluación ───────────────────────────────────────────────

  /**
   * Evalúa la cartera vencida contra las reglas de dunning activas.
   *
   * 1. Contratos con `saldoVencido > 0` en EstadoCuenta, excluyendo convenio
   *    activo, bloqueo jurídico y restricción vigente (banderas materializadas
   *    — el cron de cartera corre antes que este).
   * 2. Regla aplicable de mayor `diasMoraMin` alcanzada que cumpla
   *    `minDocsVencidos`/`montoMinimo`; en empate gana la más específica
   *    (segmento definido) — así "restricción doméstico" le gana al fallback
   *    genérico "corte" para contratos domésticos.
   * 3. Idempotencia: se omite si ya hay una AccionCobranza de esa regla dentro
   *    de `reintentoDias` (patrón `yaAvisado`).
   * 4. Ejecuta y registra SIEMPRE la AccionCobranza (ejecutada | fallida | omitida).
   */
  async evaluar(params: { dryRun?: boolean; campana?: ContextoCampana | null } = {}) {
    const dryRun = params.dryRun ?? false;
    const campana = params.campana ?? null;

    const reglas = await this.prisma.reglaDunning.findMany({
      where: { activo: true },
      orderBy: [{ diasMoraMin: 'asc' }, { orden: 'asc' }],
    });
    if (reglas.length === 0) {
      return { dryRun, evaluados: 0, ejecutadas: 0, fallidas: 0, omitidas: 0, sinRegla: 0, acciones: [], mensaje: 'No hay reglas de dunning activas' };
    }

    const bucketField = campana?.bucketObjetivo ? BUCKET_FIELD[campana.bucketObjetivo] : undefined;
    const estados = await this.prisma.estadoCuenta.findMany({
      where: {
        saldoVencido: { gt: 0 },
        enConvenio: false,
        restringido: false,
        ...(bucketField && { [bucketField]: { gt: 0 } }),
        contrato: {
          bloqueadoJuridico: false,
          ...(campana?.administracionId && { zona: { administracionId: campana.administracionId } }),
        },
      },
      include: {
        contrato: {
          select: {
            id: true,
            numeroContrato: true,
            nombre: true,
            tipoContratacionId: true,
            tipoServicio: true,
            puntoServicio: { select: { cortable: true } },
          },
        },
      },
      orderBy: { saldoVencido: 'desc' },
    });

    let ejecutadas = 0;
    let fallidas = 0;
    let omitidas = 0;
    let sinRegla = 0;
    const acciones: Array<{
      contratoId: string;
      numeroContrato: number;
      regla: string;
      accion: string;
      estado: string;
      detalle?: string;
    }> = [];

    for (const ec of estados) {
      const c = ec.contrato;
      const saldoVencido = Number(ec.saldoVencido);

      const aplicables = reglas.filter(
        (r) =>
          (!r.tipoContratacionId || r.tipoContratacionId === c.tipoContratacionId) &&
          (!r.tipoServicio || this.normaliza(r.tipoServicio) === this.normaliza(c.tipoServicio)) &&
          ec.diasMoraMax >= r.diasMoraMin &&
          ec.docsVencidos >= r.minDocsVencidos &&
          saldoVencido >= Number(r.montoMinimo),
      );
      if (aplicables.length === 0) {
        sinRegla++;
        continue;
      }

      const especificidad = (r: (typeof reglas)[0]) =>
        (r.tipoContratacionId ? 1 : 0) + (r.tipoServicio ? 1 : 0);
      const regla = [...aplicables].sort(
        (a, b) => b.diasMoraMin - a.diasMoraMin || especificidad(b) - especificidad(a) || a.orden - b.orden,
      )[0];

      // Idempotencia por regla dentro de la ventana de reintento (cualquier
      // estado: una fallida tampoco se reintenta cada noche — se revisa manual).
      const desde = new Date(Date.now() - regla.reintentoDias * 86_400_000);
      const previa = await this.prisma.accionCobranza.findFirst({
        where: { contratoId: c.id, reglaId: regla.id, createdAt: { gte: desde } },
        select: { id: true },
      });
      if (previa) {
        omitidas++;
        continue;
      }

      // Experimento A/B: los contratos del grupo control se registran pero NO
      // se gestionan — son la línea base contra la que se mide el uplift.
      if (campana && enGrupoControl(campana.id, c.id, Number(campana.grupoControlPct ?? 0))) {
        omitidas++;
        if (!dryRun) {
          await this.prisma.accionCobranza.create({
            data: {
              contratoId: c.id,
              campanaId: campana.id,
              reglaId: regla.id,
              etapa: regla.orden,
              tipo: 'control',
              canal: 'interno',
              estado: 'omitida',
              esControl: true,
              saldoAlMomento: saldoVencido,
              diasMoraAlMomento: ec.diasMoraMax,
              motivo: 'Grupo control del experimento A/B — sin gestión',
            },
          });
        }
        acciones.push({
          contratoId: c.id,
          numeroContrato: c.numeroContrato,
          regla: regla.nombre,
          accion: 'control',
          estado: dryRun ? 'dry_run_control' : 'control',
        });
        continue;
      }

      if (dryRun) {
        ejecutadas++;
        acciones.push({
          contratoId: c.id,
          numeroContrato: c.numeroContrato,
          regla: regla.nombre,
          accion: regla.accion,
          estado: 'dry_run',
        });
        continue;
      }

      const resultado = await this.ejecutarAccion(regla, ec, campana);
      if (resultado.estado === 'ejecutada') ejecutadas++;
      else if (resultado.estado === 'fallida') fallidas++;
      else omitidas++;
      acciones.push({
        contratoId: c.id,
        numeroContrato: c.numeroContrato,
        regla: regla.nombre,
        accion: regla.accion,
        estado: resultado.estado,
        detalle: resultado.detalle,
      });
    }

    const res = {
      dryRun,
      evaluados: estados.length,
      ejecutadas,
      fallidas,
      omitidas,
      sinRegla,
      acciones: acciones.slice(0, 100),
    };
    this.logger.log(
      `Dunning ${dryRun ? '(dry-run) ' : ''}evaluados=${res.evaluados} ejecutadas=${ejecutadas} fallidas=${fallidas} omitidas=${omitidas} sinRegla=${sinRegla}`,
    );
    return res;
  }

  private normaliza(v: string | null | undefined): string {
    return (v ?? '').trim().toLowerCase();
  }

  private async ejecutarAccion(
    regla: { id: string; orden: number; nombre: string; accion: string; canal: string | null },
    ec: {
      contratoId: string;
      saldoVencido: Prisma.Decimal;
      diasMoraMax: number;
      docsVencidos: number;
      contrato: { id: string; puntoServicio: { cortable: boolean } | null };
    },
    campana: ContextoCampana | null,
  ): Promise<{ estado: 'ejecutada' | 'fallida' | 'omitida'; detalle?: string }> {
    const contratoId = ec.contratoId;
    const saldoVencido = Number(ec.saldoVencido);
    const canal = (regla.canal as CanalDunning | null) ?? 'ambos';
    const accion = regla.accion as AccionDunning;

    const base = {
      contratoId,
      campanaId: campana?.id ?? null,
      reglaId: regla.id,
      etapa: regla.orden,
      tipo: TIPO_ACCION[accion] ?? accion,
      saldoAlMomento: saldoVencido,
      diasMoraAlMomento: ec.diasMoraMax,
    };
    const registrar = (data: {
      estado: 'ejecutada' | 'fallida' | 'omitida';
      canal?: string;
      motivo?: string;
      restriccionId?: string;
      ordenId?: string;
    }) =>
      this.prisma.accionCobranza.create({
        data: {
          ...base,
          estado: data.estado,
          canal: data.canal ?? null,
          motivo: data.motivo ?? null,
          restriccionId: data.restriccionId ?? null,
          ordenId: data.ordenId ?? null,
        },
      });

    try {
      switch (accion) {
        case 'notificar_aviso': {
          const res = await this.notificaciones.notificarAvisoCobranza({
            contratoId,
            saldoVencido,
            diasMora: ec.diasMoraMax,
            canal,
          });
          const enviado = res.email || res.whatsapp;
          await registrar({
            estado: enviado ? 'ejecutada' : 'fallida',
            canal,
            ...(enviado ? {} : { motivo: 'Sin destinatario o envío fallido' }),
          });
          return { estado: enviado ? 'ejecutada' : 'fallida' };
        }

        case 'notificar_requerimiento': {
          const res = await this.notificaciones.notificarRequerimientoPago({
            contratoId,
            saldoVencido,
            diasMora: ec.diasMoraMax,
            docsVencidos: ec.docsVencidos,
            canal,
          });
          const enviado = res.email || res.whatsapp;
          await registrar({
            estado: enviado ? 'ejecutada' : 'fallida',
            canal,
            ...(enviado ? {} : { motivo: 'Sin destinatario o envío fallido' }),
          });
          return { estado: enviado ? 'ejecutada' : 'fallida' };
        }

        case 'generar_restriccion': {
          // RestriccionesService aplica sus propias guardas (convenio, jurídico,
          // cortable, aviso previo LGA); si rechaza, la acción queda fallida.
          try {
            const { restriccion } = await this.restricciones.programar({
              contratoId,
              autorizadoPor: 'dunning-automatico',
              notas: `Originada por regla de dunning "${regla.nombre}"`,
            });
            await registrar({ estado: 'ejecutada', canal: 'orden', restriccionId: restriccion.id });
            return { estado: 'ejecutada' };
          } catch (e: any) {
            const motivo = `Restricción rechazada: ${e?.message ?? 'error'}`;
            await registrar({ estado: 'fallida', canal: 'orden', motivo });
            return { estado: 'fallida', detalle: motivo };
          }
        }

        case 'generar_corte': {
          if (ec.contrato.puntoServicio?.cortable === false) {
            const motivo = 'Punto de servicio no cortable (usuario protegido)';
            await registrar({ estado: 'omitida', canal: 'orden', motivo });
            return { estado: 'omitida', detalle: motivo };
          }
          const pendiente = await this.prisma.orden.findFirst({
            where: { contratoId, tipo: 'Corte', estado: { in: ['Pendiente', 'En proceso'] } },
            select: { id: true },
          });
          if (pendiente) {
            const motivo = 'Ya existe una orden de corte pendiente';
            await registrar({ estado: 'omitida', canal: 'orden', motivo, ordenId: pendiente.id });
            return { estado: 'omitida', detalle: motivo };
          }
          const fechaProgramada = new Date();
          fechaProgramada.setDate(fechaProgramada.getDate() + 5); // plazo de aviso
          const orden = await this.prisma.orden.create({
            data: {
              contratoId,
              tipo: 'Corte',
              estado: 'Pendiente',
              prioridad: 'Alta',
              origenAutomatico: true,
              eventoOrigen: 'dunning_adeudo',
              fechaProgramada,
              notas: `Corte por adeudo vencido de $${saldoVencido.toFixed(2)} (${ec.docsVencidos} documentos, ${ec.diasMoraMax} días de mora). Regla: ${regla.nombre}.`,
            },
          });
          await registrar({ estado: 'ejecutada', canal: 'orden', ordenId: orden.id });
          return { estado: 'ejecutada' };
        }

        case 'ofrecer_convenio': {
          const res = await this.notificaciones.notificarAvisoCobranza({
            contratoId,
            saldoVencido,
            diasMora: ec.diasMoraMax,
            canal,
            ofrecerConvenio: true,
          });
          const enviado = res.email || res.whatsapp;
          await registrar({
            estado: enviado ? 'ejecutada' : 'fallida',
            canal,
            motivo: enviado ? 'Convenio ofrecido al usuario' : 'Sin destinatario o envío fallido',
          });
          return { estado: enviado ? 'ejecutada' : 'fallida' };
        }

        case 'proponer_incobrable': {
          // NUNCA automático: solo se marca candidato para revisión manual
          // (POST /cartera/contratos/:id/incobrable con motivo y autorización).
          await registrar({
            estado: 'ejecutada',
            canal: 'interno',
            motivo: 'Candidato a incobrable — requiere autorización manual',
          });
          return { estado: 'ejecutada' };
        }

        default: {
          const motivo = `Acción de dunning desconocida: ${regla.accion}`;
          await registrar({ estado: 'fallida', motivo });
          return { estado: 'fallida', detalle: motivo };
        }
      }
    } catch (e: any) {
      const motivo = e?.message ?? 'Error al ejecutar la acción';
      this.logger.error(`Dunning ${regla.accion} falló para contrato ${contratoId}: ${motivo}`);
      try {
        await registrar({ estado: 'fallida', motivo });
      } catch {
        /* la bitácora nunca debe tumbar el pipeline */
      }
      return { estado: 'fallida', detalle: motivo };
    }
  }

  // ─── Reglas de dunning (CRUD + semilla) ───────────────────────────────────

  async listarReglas() {
    return this.prisma.reglaDunning.findMany({ orderBy: [{ orden: 'asc' }, { diasMoraMin: 'asc' }] });
  }

  async crearRegla(data: {
    nombre: string;
    orden?: number;
    activo?: boolean;
    tipoContratacionId?: string;
    tipoServicio?: string;
    diasMoraMin: number;
    minDocsVencidos?: number;
    montoMinimo?: number;
    accion: string;
    canal?: string;
    reintentoDias?: number;
  }) {
    return this.prisma.reglaDunning.create({
      data: {
        nombre: data.nombre,
        orden: data.orden ?? 0,
        activo: data.activo ?? true,
        tipoContratacionId: data.tipoContratacionId ?? null,
        tipoServicio: data.tipoServicio ?? null,
        diasMoraMin: data.diasMoraMin,
        minDocsVencidos: data.minDocsVencidos ?? 1,
        montoMinimo: data.montoMinimo ?? 0,
        accion: data.accion,
        canal: data.canal ?? null,
        reintentoDias: data.reintentoDias ?? 15,
      },
    });
  }

  async actualizarRegla(id: string, data: Partial<Parameters<DunningService['crearRegla']>[0]>) {
    const regla = await this.prisma.reglaDunning.findUnique({ where: { id } });
    if (!regla) throw new NotFoundException('Regla de dunning no encontrada');
    return this.prisma.reglaDunning.update({
      where: { id },
      data: {
        ...(data.nombre !== undefined && { nombre: data.nombre }),
        ...(data.orden !== undefined && { orden: data.orden }),
        ...(data.activo !== undefined && { activo: data.activo }),
        ...(data.tipoContratacionId !== undefined && { tipoContratacionId: data.tipoContratacionId || null }),
        ...(data.tipoServicio !== undefined && { tipoServicio: data.tipoServicio || null }),
        ...(data.diasMoraMin !== undefined && { diasMoraMin: data.diasMoraMin }),
        ...(data.minDocsVencidos !== undefined && { minDocsVencidos: data.minDocsVencidos }),
        ...(data.montoMinimo !== undefined && { montoMinimo: data.montoMinimo }),
        ...(data.accion !== undefined && { accion: data.accion }),
        ...(data.canal !== undefined && { canal: data.canal || null }),
        ...(data.reintentoDias !== undefined && { reintentoDias: data.reintentoDias }),
      },
    });
  }

  async eliminarRegla(id: string) {
    const regla = await this.prisma.reglaDunning.findUnique({ where: { id } });
    if (!regla) throw new NotFoundException('Regla de dunning no encontrada');
    await this.prisma.reglaDunning.delete({ where: { id } });
    return { eliminada: true, id };
  }

  /**
   * Siembra las 4 reglas ejemplo del diseño — SOLO si la tabla está vacía.
   * El criterio "doméstico" usa `Contrato.tipoServicio = 'Doméstico'` (valor
   * del seed actual; R3 del diseño — validar con el organismo). La regla de
   * corte queda como fallback genérico (sin segmento): para contratos
   * domésticos pierde el empate a 35 días contra la regla específica de
   * restricción, así el corte solo alcanza a los no domésticos.
   */
  async seedReglasDefault() {
    const existentes = await this.prisma.reglaDunning.count();
    if (existentes > 0) {
      return { seeded: false, total: existentes, mensaje: 'Ya existen reglas de dunning; no se sembró nada' };
    }
    await this.prisma.reglaDunning.createMany({
      data: [
        {
          nombre: 'Aviso de adeudo (5 días de mora)',
          orden: 1,
          diasMoraMin: 5,
          minDocsVencidos: 1,
          accion: 'notificar_aviso',
          canal: 'ambos',
          reintentoDias: 15,
        },
        {
          nombre: 'Requerimiento de pago (20 días de mora)',
          orden: 2,
          diasMoraMin: 20,
          minDocsVencidos: 1,
          accion: 'notificar_requerimiento',
          canal: 'ambos',
          reintentoDias: 15,
        },
        {
          nombre: 'Restricción a mínimo vital — doméstico (35 días de mora)',
          orden: 3,
          tipoServicio: 'Doméstico',
          diasMoraMin: 35,
          minDocsVencidos: 2,
          accion: 'generar_restriccion',
          reintentoDias: 30,
        },
        {
          nombre: 'Corte de servicio — no doméstico (35 días de mora)',
          orden: 4,
          diasMoraMin: 35,
          minDocsVencidos: 2,
          accion: 'generar_corte',
          reintentoDias: 30,
        },
      ],
    });
    const total = await this.prisma.reglaDunning.count();
    return { seeded: true, total };
  }

  // ─── Campañas de cobranza ─────────────────────────────────────────────────

  async listarCampanas(params: { estado?: string; page?: number; limit?: number } = {}) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const where = { ...(params.estado && { estado: params.estado }) };
    const [data, total] = await Promise.all([
      this.prisma.campanaCobranza.findMany({
        where,
        include: { _count: { select: { acciones: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.campanaCobranza.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async obtenerCampana(id: string) {
    const campana = await this.prisma.campanaCobranza.findUnique({
      where: { id },
      include: {
        _count: { select: { acciones: true } },
        acciones: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { contrato: { select: { numeroContrato: true, nombre: true } } },
        },
      },
    });
    if (!campana) throw new NotFoundException('Campaña no encontrada');
    return campana;
  }

  async crearCampana(data: {
    nombre: string;
    descripcion?: string;
    administracionId?: string;
    bucketObjetivo?: string;
    fechaInicio?: string;
    fechaFin?: string;
    grupoControlPct?: number;
  }) {
    if (data.bucketObjetivo && !BUCKET_FIELD[data.bucketObjetivo]) {
      throw new BadRequestException(`bucketObjetivo inválido: ${data.bucketObjetivo} (use ${Object.keys(BUCKET_FIELD).join(' | ')})`);
    }
    if (data.grupoControlPct !== undefined && (data.grupoControlPct < 0 || data.grupoControlPct > 50)) {
      throw new BadRequestException('grupoControlPct debe estar entre 0 y 50');
    }
    return this.prisma.campanaCobranza.create({
      data: {
        nombre: data.nombre,
        descripcion: data.descripcion ?? null,
        administracionId: data.administracionId ?? null,
        bucketObjetivo: data.bucketObjetivo ?? null,
        grupoControlPct: data.grupoControlPct ?? null,
        fechaInicio: data.fechaInicio ? new Date(`${data.fechaInicio}T12:00:00`) : null,
        fechaFin: data.fechaFin ? new Date(`${data.fechaFin}T12:00:00`) : null,
      },
    });
  }

  /**
   * Mide el uplift de la campaña: tasa de pago y recuperación del grupo
   * tratamiento vs el grupo control dentro de una ventana posterior a cada
   * acción. La diferencia es el efecto causal atribuible a la gestión.
   */
  async medirUplift(campanaId: string, ventanaDias = 30) {
    const campana = await this.prisma.campanaCobranza.findUnique({
      where: { id: campanaId },
      select: { id: true, nombre: true, estado: true, grupoControlPct: true },
    });
    if (!campana) throw new NotFoundException('Campaña no encontrada');

    // Primera acción por contrato (si un contrato tuvo varias etapas, la
    // ventana corre desde la primera gestión de la campaña).
    const acciones = await this.prisma.accionCobranza.findMany({
      where: { campanaId },
      orderBy: { createdAt: 'asc' },
      select: { contratoId: true, esControl: true, saldoAlMomento: true, createdAt: true },
    });
    const porContrato = new Map<string, (typeof acciones)[0]>();
    for (const a of acciones) {
      if (!porContrato.has(a.contratoId)) porContrato.set(a.contratoId, a);
    }
    if (porContrato.size === 0) {
      return { campanaId, nombre: campana.nombre, ventanaDias, participantes: 0, mensaje: 'La campaña no tiene acciones registradas; ejecútela primero' };
    }

    const contratoIds = [...porContrato.keys()];
    const pagos = await this.prisma.pago.findMany({
      where: { contratoId: { in: contratoIds } },
      select: { contratoId: true, monto: true, createdAt: true },
    });
    const pagosPorContrato = new Map<string, Array<{ monto: number; createdAt: Date }>>();
    for (const p of pagos) {
      const arr = pagosPorContrato.get(p.contratoId) ?? [];
      arr.push({ monto: Number(p.monto), createdAt: p.createdAt });
      pagosPorContrato.set(p.contratoId, arr);
    }

    const ventanaMs = ventanaDias * 86_400_000;
    const participantes = contratoIds.map((contratoId) => {
      const accion = porContrato.get(contratoId)!;
      const desde = accion.createdAt.getTime();
      const hasta = desde + ventanaMs;
      const montoPagado = (pagosPorContrato.get(contratoId) ?? [])
        .filter((p) => p.createdAt.getTime() >= desde && p.createdAt.getTime() <= hasta)
        .reduce((s, p) => s + p.monto, 0);
      return {
        contratoId,
        esControl: accion.esControl,
        saldoAlMomento: Number(accion.saldoAlMomento),
        montoPagado: montoPagado > EPSILON ? montoPagado : 0,
      };
    });

    return {
      campanaId,
      nombre: campana.nombre,
      estado: campana.estado,
      grupoControlPct: campana.grupoControlPct !== null ? Number(campana.grupoControlPct) : null,
      ventanaDias,
      participantes: participantes.length,
      ...calcularUplift(participantes),
    };
  }

  /**
   * Ejecuta la campaña: corre el pipeline de dunning acotado al segmento de la
   * campaña (administración y/o bucket objetivo) y etiqueta las acciones con
   * `campanaId`. La primera ejecución activa la campaña.
   */
  async ejecutarCampana(id: string, dryRun = false) {
    const campana = await this.prisma.campanaCobranza.findUnique({ where: { id } });
    if (!campana) throw new NotFoundException('Campaña no encontrada');
    if (campana.estado === 'finalizada') {
      throw new BadRequestException('La campaña ya está finalizada');
    }

    if (!dryRun && campana.estado === 'borrador') {
      await this.prisma.campanaCobranza.update({
        where: { id },
        data: { estado: 'activa', fechaInicio: campana.fechaInicio ?? new Date() },
      });
    }

    const res = await this.evaluar({
      dryRun,
      campana: {
        id: campana.id,
        administracionId: campana.administracionId,
        bucketObjetivo: campana.bucketObjetivo,
        grupoControlPct: campana.grupoControlPct !== null ? Number(campana.grupoControlPct) : null,
      },
    });
    return { campanaId: id, nombre: campana.nombre, ...res };
  }
}
