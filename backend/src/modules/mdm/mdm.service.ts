import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';

/**
 * MDM ligero (Meter Data Management) — series de intervalo AMI/AMR.
 *
 * Las lecturas de intervalo son INDEPENDIENTES de la lectura de facturación
 * (módulo lecturas/): el billing sigue tomando su lectura mensual certificada
 * y estas series solo alimentan analítica, alertas de fuga lado-cliente y
 * futura facturación horaria/diferenciada. Mantenerlas desacopladas es la
 * práctica recomendada (SWAN Forum / AWWA): un dato de telemetría con ruido
 * jamás debe contaminar el ciclo comercial.
 *
 * Configuración:
 *   HYDRA_JOBS_ENABLED = true | false   (master switch, default false)
 *   JOB_FUGAS_CRON     = cron (default "0 7 * * *" — diario 07:00, tras la
 *                        ventana nocturna 00:00-06:00 que analiza)
 *   MDM_INGEST_API_KEY = API key para colectores IoT (ver MdmIngestGuard)
 *
 * Nota de zona horaria: las ventanas "locales" usan la hora local del proceso;
 * en producción el servicio debe correr con TZ=America/Mexico_City.
 */

export interface LecturaIngest {
  medidorId?: string;
  medidorSerie?: string;
  timestamp: string;
  m3Acumulado: number;
  caudalLh?: number;
  origen?: string;
  alarmas?: Record<string, unknown>;
}

export interface CandidatoFuga {
  medidorId: string;
  serie: string;
  contratoId: string;
  horasContinuas: number;
  litrosEstimados: number;
}

const MAX_LECTURAS_POR_REQUEST = 10000;
const MAX_PUNTOS_SERIE = 50000;

@Injectable()
export class MdmService {
  private readonly logger = new Logger(MdmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  private jobsHabilitados(): boolean {
    return (process.env.HYDRA_JOBS_ENABLED ?? 'false').toLowerCase() === 'true';
  }

  /** Envuelve un job con bitácora LogProceso — mismo patrón que BatchService.conLog. */
  private async conLog<T extends { registros?: number; errores?: number }>(
    subTipo: string,
    fn: () => Promise<T & Record<string, unknown>>,
  ): Promise<T> {
    const log = await this.prisma.logProceso.create({
      data: { tipo: 'batch', subTipo, estado: 'Iniciado' },
    });
    const inicio = Date.now();
    try {
      const resultado = await fn();
      await this.prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: 'Completado',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          registros: resultado.registros ?? 0,
          errores: resultado.errores ?? 0,
          detalle: JSON.parse(JSON.stringify(resultado)),
        },
      });
      return resultado;
    } catch (e: any) {
      await this.prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: 'Error',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          errores: 1,
          errorMsg: e?.message ?? 'Error',
        },
      });
      throw e;
    }
  }

  // ─── Ingesta bulk idempotente ──────────────────────────────────────────────

  /**
   * Ingesta masiva de lecturas de intervalo.
   *
   * - Idempotente: reenvíos del colector no duplican (createMany + skipDuplicates
   *   apoyado en el @@unique([medidorId, timestamp])).
   * - Resuelve el medidor por `medidorSerie` cuando el colector no conoce el id.
   * - Monotonicidad NO estricta del totalizador: un acumulado menor al anterior
   *   se acepta y se marca con alarma `flujoInverso` (puede ser reflujo real,
   *   vuelta del odómetro o cambio de medidor — el dato vale más que el rechazo).
   */
  async ingestarLecturas(lecturas: LecturaIngest[]): Promise<{
    insertadas: number;
    duplicadas: number;
    conError: number;
    errores: Array<{ indice: number; error: string }>;
  }> {
    if (!Array.isArray(lecturas) || lecturas.length === 0) {
      throw new BadRequestException('El payload no contiene lecturas');
    }
    if (lecturas.length > MAX_LECTURAS_POR_REQUEST) {
      throw new BadRequestException(
        `Máximo ${MAX_LECTURAS_POR_REQUEST} lecturas por request (recibidas: ${lecturas.length})`,
      );
    }

    // Resolución de medidores en bloque (por id y por serie).
    const ids = [...new Set(lecturas.map((l) => l.medidorId).filter(Boolean))] as string[];
    const series = [
      ...new Set(lecturas.filter((l) => !l.medidorId && l.medidorSerie).map((l) => l.medidorSerie)),
    ] as string[];

    const [porId, porSerie] = await Promise.all([
      ids.length
        ? this.prisma.medidor.findMany({ where: { id: { in: ids } }, select: { id: true } })
        : Promise.resolve([]),
      series.length
        ? this.prisma.medidor.findMany({
            where: { serie: { in: series } },
            select: { id: true, serie: true },
          })
        : Promise.resolve([]),
    ]);
    const idsValidos = new Set(porId.map((m) => m.id));
    // `Medidor.serie` no es única en el esquema: si una serie mapea a más de un
    // medidor la lectura se rechaza como ambigua (mejor error que dato mal imputado).
    const idsPorSerie = new Map<string, string[]>();
    for (const m of porSerie) {
      idsPorSerie.set(m.serie, [...(idsPorSerie.get(m.serie) ?? []), m.id]);
    }

    const errores: Array<{ indice: number; error: string }> = [];
    const validas: Array<{
      medidorId: string;
      timestamp: Date;
      m3Acumulado: number;
      caudalLh?: number;
      origen?: string;
      alarmas?: Record<string, unknown>;
    }> = [];

    lecturas.forEach((l, indice) => {
      let medidorId = l.medidorId;
      if (medidorId) {
        if (!idsValidos.has(medidorId)) {
          errores.push({ indice, error: `Medidor '${medidorId}' no existe` });
          return;
        }
      } else if (l.medidorSerie) {
        const candidatos = idsPorSerie.get(l.medidorSerie) ?? [];
        if (candidatos.length === 0) {
          errores.push({ indice, error: `Serie '${l.medidorSerie}' no corresponde a ningún medidor` });
          return;
        }
        if (candidatos.length > 1) {
          errores.push({ indice, error: `Serie '${l.medidorSerie}' es ambigua (${candidatos.length} medidores)` });
          return;
        }
        medidorId = candidatos[0];
      } else {
        errores.push({ indice, error: 'La lectura no trae medidorId ni medidorSerie' });
        return;
      }

      const ts = new Date(l.timestamp);
      if (isNaN(ts.getTime())) {
        errores.push({ indice, error: `timestamp inválido: '${l.timestamp}'` });
        return;
      }
      const m3 = Number(l.m3Acumulado);
      if (!isFinite(m3) || m3 < 0) {
        errores.push({ indice, error: `m3Acumulado inválido: '${l.m3Acumulado}'` });
        return;
      }

      validas.push({
        medidorId,
        timestamp: ts,
        m3Acumulado: m3,
        caudalLh: l.caudalLh != null ? Number(l.caudalLh) : undefined,
        origen: l.origen,
        alarmas: l.alarmas,
      });
    });

    // Validación de monotonicidad (no estricta) por medidor: se compara contra
    // la última lectura ya persistida y contra las previas del mismo payload.
    // Los backfills (timestamp anterior al último persistido) no se comparan —
    // casi siempre son reenvíos que el skipDuplicates absorbe.
    const porMedidor = new Map<string, typeof validas>();
    for (const v of validas) {
      porMedidor.set(v.medidorId, [...(porMedidor.get(v.medidorId) ?? []), v]);
    }
    await Promise.all(
      [...porMedidor.entries()].map(async ([medidorId, filas]) => {
        filas.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const ultima = await this.prisma.lecturaIntervalo.findFirst({
          where: { medidorId },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true, m3Acumulado: true },
        });
        let prev = ultima
          ? { ts: ultima.timestamp.getTime(), m3: Number(ultima.m3Acumulado) }
          : null;
        for (const fila of filas) {
          const ts = fila.timestamp.getTime();
          if (prev && ts > prev.ts) {
            if (fila.m3Acumulado < prev.m3 - 0.0005) {
              fila.alarmas = { ...(fila.alarmas ?? {}), flujoInverso: true };
            }
            prev = { ts, m3: fila.m3Acumulado };
          } else if (!prev) {
            prev = { ts, m3: fila.m3Acumulado };
          }
        }
      }),
    );

    const res = await this.prisma.lecturaIntervalo.createMany({
      data: validas.map((v) => ({
        medidorId: v.medidorId,
        timestamp: v.timestamp,
        m3Acumulado: v.m3Acumulado,
        caudalLh: v.caudalLh,
        ...(v.origen ? { origen: v.origen } : {}),
        ...(v.alarmas ? { alarmas: v.alarmas as Prisma.InputJsonValue } : {}),
      })),
      skipDuplicates: true,
    });

    return {
      insertadas: res.count,
      duplicadas: validas.length - res.count,
      conError: errores.length,
      errores: errores.slice(0, 20),
    };
  }

  // ─── Serie de un medidor (cruda o agregada) ────────────────────────────────

  private claveBucket(d: Date, resolucion: 'hora' | 'dia'): string {
    const p = (n: number) => String(n).padStart(2, '0');
    const dia = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return resolucion === 'dia' ? dia : `${dia} ${p(d.getHours())}:00`;
  }

  /**
   * Serie de intervalo de un medidor entre `desde` y `hasta`.
   * `resolucion` opcional ('hora' | 'dia') agrega los puntos calculando el
   * consumo como delta del acumulado (anclado en la última lectura previa al
   * rango para no perder el primer delta).
   */
  async serieMedidor(medidorId: string, desde: string, hasta: string, resolucion?: string) {
    if (!desde || !hasta) {
      throw new BadRequestException('Parámetros desde y hasta son obligatorios');
    }
    if (resolucion && !['hora', 'dia'].includes(resolucion)) {
      throw new BadRequestException("resolucion debe ser 'hora' o 'dia'");
    }
    const inicio = new Date(/^\d{4}-\d{2}-\d{2}$/.test(desde) ? `${desde}T00:00:00` : desde);
    const fin = new Date(/^\d{4}-\d{2}-\d{2}$/.test(hasta) ? `${hasta}T23:59:59.999` : hasta);
    if (isNaN(inicio.getTime()) || isNaN(fin.getTime()) || inicio > fin) {
      throw new BadRequestException('Rango de fechas inválido');
    }

    const medidor = await this.prisma.medidor.findUnique({
      where: { id: medidorId },
      select: { id: true, serie: true, contratoId: true },
    });
    if (!medidor) throw new NotFoundException('Medidor no encontrado');

    const [ancla, lecturas] = await Promise.all([
      this.prisma.lecturaIntervalo.findFirst({
        where: { medidorId, timestamp: { lt: inicio } },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true, m3Acumulado: true },
      }),
      this.prisma.lecturaIntervalo.findMany({
        where: { medidorId, timestamp: { gte: inicio, lte: fin } },
        orderBy: { timestamp: 'asc' },
        take: MAX_PUNTOS_SERIE,
      }),
    ]);

    let prevM3 = ancla ? Number(ancla.m3Acumulado) : null;

    if (!resolucion) {
      const puntos = lecturas.map((l) => {
        const m3 = Number(l.m3Acumulado);
        const consumoM3 = prevM3 != null ? Math.round((m3 - prevM3) * 1000) / 1000 : null;
        prevM3 = m3;
        return {
          timestamp: l.timestamp,
          m3Acumulado: m3,
          caudalLh: l.caudalLh != null ? Number(l.caudalLh) : null,
          origen: l.origen,
          alarmas: l.alarmas,
          consumoM3,
        };
      });
      return { medidor, desde: inicio, hasta: fin, resolucion: 'cruda', total: puntos.length, puntos };
    }

    // Agregación por bucket local (hora o día): consumo = suma de deltas.
    const buckets = new Map<
      string,
      { consumoM3: number; lecturas: number; m3Inicial: number; m3Final: number; sumaCaudal: number; nCaudal: number }
    >();
    for (const l of lecturas) {
      const m3 = Number(l.m3Acumulado);
      const clave = this.claveBucket(l.timestamp, resolucion as 'hora' | 'dia');
      const b =
        buckets.get(clave) ??
        { consumoM3: 0, lecturas: 0, m3Inicial: prevM3 ?? m3, m3Final: m3, sumaCaudal: 0, nCaudal: 0 };
      if (prevM3 != null) b.consumoM3 += m3 - prevM3;
      b.lecturas++;
      b.m3Final = m3;
      if (l.caudalLh != null) {
        b.sumaCaudal += Number(l.caudalLh);
        b.nCaudal++;
      }
      buckets.set(clave, b);
      prevM3 = m3;
    }

    const puntos = [...buckets.entries()].map(([bucket, b]) => ({
      bucket,
      consumoM3: Math.round(b.consumoM3 * 1000) / 1000,
      lecturas: b.lecturas,
      m3Inicial: b.m3Inicial,
      m3Final: b.m3Final,
      caudalPromedioLh: b.nCaudal ? Math.round((b.sumaCaudal / b.nCaudal) * 100) / 100 : null,
    }));

    return { medidor, desde: inicio, hasta: fin, resolucion, total: puntos.length, puntos };
  }

  // ─── Detección de fugas lado-cliente (flujo continuo nocturno) ─────────────

  /**
   * Detección de fuga lado-cliente por flujo continuo nocturno (00:00–06:00
   * local): en un domicilio sano el consumo nocturno cae a cero; caudal
   * sostenido ≥ `horasMinimas` con caudal > `caudalMinimoLh` (o delta positivo
   * del acumulado cuando el medidor no reporta caudal) es el clásico indicador
   * de fuga en la instalación interior del usuario.
   *
   * Efectos: registra la corrida en LogProceso y persiste la alarma `fuga` en
   * la última LecturaIntervalo de cada medidor candidato (fuente del endpoint
   * GET /mdm/alertas). La notificación al usuario la dispara el cron.
   */
  async detectarFugas(params: { horasMinimas?: number; caudalMinimoLh?: number } = {}) {
    const horasMinimas = params.horasMinimas ?? 6;
    const caudalMinimoLh = params.caudalMinimoLh ?? 2;

    // Última ventana nocturna completa (si aún no dan las 06:00, la de ayer).
    const ahora = new Date();
    const finNoche = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 6, 0, 0);
    if (ahora < finNoche) finNoche.setDate(finNoche.getDate() - 1);
    const inicioNoche = new Date(finNoche);
    inicioNoche.setHours(0, 0, 0, 0);
    const fechaNoche = this.claveBucket(inicioNoche, 'dia');

    return this.conLog(`fugas:${fechaNoche}`, async () => {
      // Solo medidores con telemetría reciente (últimas 24 h).
      const activos = await this.prisma.lecturaIntervalo.groupBy({
        by: ['medidorId'],
        where: { timestamp: { gte: new Date(ahora.getTime() - 24 * 3600e3) } },
      });
      const medidores = activos.length
        ? await this.prisma.medidor.findMany({
            where: { id: { in: activos.map((a) => a.medidorId) } },
            select: { id: true, serie: true, contratoId: true },
          })
        : [];

      const candidatos: CandidatoFuga[] = [];

      for (const medidor of medidores) {
        const [ancla, lecturas] = await Promise.all([
          this.prisma.lecturaIntervalo.findFirst({
            where: { medidorId: medidor.id, timestamp: { lt: inicioNoche } },
            orderBy: { timestamp: 'desc' },
            select: { timestamp: true, m3Acumulado: true },
          }),
          this.prisma.lecturaIntervalo.findMany({
            where: { medidorId: medidor.id, timestamp: { gte: inicioNoche, lte: finNoche } },
            orderBy: { timestamp: 'asc' },
            select: { timestamp: true, m3Acumulado: true, caudalLh: true },
          }),
        ]);
        if (lecturas.length < 2) continue; // sin resolución suficiente en la noche

        // Corrida continua más larga de flujo dentro de la ventana.
        let prev = ancla
          ? { ts: ancla.timestamp.getTime(), m3: Number(ancla.m3Acumulado) }
          : null;
        let corrida: { ts: number; m3: number; litrosCaudal: number } | null = null;
        let mejor = { horas: 0, litros: 0 };

        for (const l of lecturas) {
          const ts = l.timestamp.getTime();
          const m3 = Number(l.m3Acumulado);
          const caudal = l.caudalLh != null ? Number(l.caudalLh) : null;
          const delta = prev ? m3 - prev.m3 : null;
          const conFlujo = caudal != null ? caudal > caudalMinimoLh : delta != null && delta > 0;

          if (conFlujo && prev) {
            if (!corrida) corrida = { ts: prev.ts, m3: prev.m3, litrosCaudal: 0 };
            const dtHoras = (ts - prev.ts) / 3600e3;
            corrida.litrosCaudal += (caudal ?? 0) * dtHoras;
            const horas = (ts - corrida.ts) / 3600e3;
            // Estimación: delta del totalizador; si no avanza (solo caudal), integra caudal·dt.
            const litros = Math.max((m3 - corrida.m3) * 1000, corrida.litrosCaudal);
            if (horas > mejor.horas) mejor = { horas, litros };
          } else if (!conFlujo) {
            corrida = null;
          }
          prev = { ts, m3 };
        }

        if (mejor.horas + 1e-9 >= horasMinimas) {
          const candidato: CandidatoFuga = {
            medidorId: medidor.id,
            serie: medidor.serie,
            contratoId: medidor.contratoId,
            horasContinuas: Math.round(mejor.horas * 100) / 100,
            litrosEstimados: Math.round(mejor.litros * 10) / 10,
          };
          candidatos.push(candidato);
          await this.marcarAlarmaFuga(candidato, fechaNoche);
        }
      }

      this.logger.log(
        `Detección de fugas ${fechaNoche}: ${candidatos.length}/${medidores.length} medidores con flujo nocturno continuo`,
      );
      return {
        fechaNoche,
        ventana: { desde: inicioNoche, hasta: finNoche },
        parametros: { horasMinimas, caudalMinimoLh },
        medidoresRevisados: medidores.length,
        candidatos,
        registros: candidatos.length,
        errores: 0,
      };
    });
  }

  /** Persiste la alarma de fuga en la última LecturaIntervalo del medidor. */
  private async marcarAlarmaFuga(candidato: CandidatoFuga, fechaNoche: string) {
    const ultima = await this.prisma.lecturaIntervalo.findFirst({
      where: { medidorId: candidato.medidorId },
      orderBy: { timestamp: 'desc' },
      select: { id: true, alarmas: true },
    });
    if (!ultima) return;
    const previas =
      ultima.alarmas && typeof ultima.alarmas === 'object' && !Array.isArray(ultima.alarmas)
        ? (ultima.alarmas as Record<string, unknown>)
        : {};
    await this.prisma.lecturaIntervalo.update({
      where: { id: ultima.id },
      data: {
        alarmas: {
          ...previas,
          fuga: {
            detectada: true,
            fecha: fechaNoche,
            horasContinuas: candidato.horasContinuas,
            litrosEstimados: candidato.litrosEstimados,
            detectadaEn: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });
  }

  /** Últimas alarmas de fuga persistidas en las series (GET /mdm/alertas). */
  async alertasFuga(limit = 50) {
    return this.prisma.lecturaIntervalo.findMany({
      where: { alarmas: { path: ['fuga', 'detectada'], equals: true } },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { medidor: { select: { serie: true, contratoId: true } } },
    });
  }

  // ─── Notificación al usuario ───────────────────────────────────────────────

  /**
   * Réplica local del resolutor de destinatario de NotificacionesService
   * (allá es privado y ese módulo se trabaja en paralelo — no se toca).
   * TODO(integración notificaciones): cuando NotificacionesService exponga un
   * `notificarAlertaFuga(...)` o haga público su resolutor, consolidar aquí.
   */
  private async destinatarioContrato(
    contratoId: string,
  ): Promise<{ email?: string; telefono?: string }> {
    const roles = await this.prisma.rolPersonaContrato.findMany({
      where: { contratoId, activo: true },
      include: { persona: { select: { email: true, telefono: true } } },
    });
    const prioridad = (rol: string) => {
      const i = ['CONTACTO', 'PROPIETARIO', 'FISCAL'].indexOf(rol);
      return i === -1 ? 99 : i;
    };
    const ordenados = [...roles].sort((a, b) => prioridad(a.rol) - prioridad(b.rol));
    return {
      email: ordenados.find((r) => r.persona.email)?.persona.email ?? undefined,
      telefono: ordenados.find((r) => r.persona.telefono)?.persona.telefono ?? undefined,
    };
  }

  /**
   * Avisa a cada usuario con fuga detectada usando los canales genéricos ya
   * exportados por NotificacionesService (enviarEmail / enviarWhatsApp), que
   * además dejan bitácora en notificacion_logs. El tipo 'alerta_fuga' se pasa
   * con cast porque el union TipoNotificacion de ese módulo aún no lo incluye
   * (la columna en BD es String, así que es seguro).
   * Anti-spam: máximo un aviso por contrato cada 3 días.
   */
  async notificarFugas(candidatos: CandidatoFuga[]) {
    let enviados = 0;
    let omitidos = 0;
    let errores = 0;

    for (const c of candidatos) {
      try {
        const hace3dias = new Date();
        hace3dias.setDate(hace3dias.getDate() - 3);
        const yaAvisado = await this.prisma.notificacionLog.findFirst({
          where: { contratoId: c.contratoId, tipo: 'alerta_fuga', enviado: true, createdAt: { gte: hace3dias } },
          select: { id: true },
        });
        if (yaAvisado) {
          omitidos++;
          continue;
        }

        const dest = await this.destinatarioContrato(c.contratoId);
        const litros = c.litrosEstimados.toFixed(0);
        const asunto = 'Posible fuga de agua detectada en su domicilio';
        const cuerpo =
          `<p>Estimado usuario,</p>` +
          `<p>Su medidor <strong>${c.serie}</strong> registró <strong>flujo continuo durante ` +
          `${c.horasContinuas.toFixed(1)} horas</strong> en horario nocturno (aprox. ` +
          `<strong>${litros} litros</strong>), lo que suele indicar una <strong>fuga en su ` +
          `instalación interior</strong> (sanitario, tinaco, tubería).</p>` +
          `<p>Le recomendamos revisar sus instalaciones o solicitar apoyo técnico. ` +
          `Detectarla a tiempo evita consumos elevados en su próximo recibo.</p>`;
        const msgWa =
          `💧 Alerta de posible fuga: su medidor ${c.serie} registró flujo continuo ` +
          `${c.horasContinuas.toFixed(1)} h durante la noche (~${litros} L). ` +
          `Revise sanitarios, tinaco y tuberías para evitar un recibo elevado.`;

        let alguno = false;
        if (dest.email) {
          const r = await this.notificaciones.enviarEmail({
            destinatario: dest.email,
            asunto,
            cuerpo,
            tipo: 'alerta_fuga' as any,
            contratoId: c.contratoId,
          });
          alguno = alguno || r.enviado;
        }
        if (dest.telefono) {
          const r = await this.notificaciones.enviarWhatsApp({
            telefono: dest.telefono,
            mensaje: msgWa,
            tipo: 'alerta_fuga' as any,
            contratoId: c.contratoId,
          });
          alguno = alguno || r.enviado;
        }
        if (alguno) enviados++;
        else omitidos++; // sin datos de contacto o canales caídos
      } catch (e: any) {
        errores++;
        this.logger.error(`Error notificando fuga del contrato ${c.contratoId}: ${e?.message}`);
      }
    }

    return { candidatos: candidatos.length, enviados, omitidos, errores };
  }

  // ─── Cron nocturno ─────────────────────────────────────────────────────────

  @Cron(process.env.JOB_FUGAS_CRON ?? '0 7 * * *', { name: 'deteccion-fugas' })
  async cronFugas() {
    if (!this.jobsHabilitados()) return;
    const res = await this.detectarFugas();
    const avisos = await this.notificarFugas(res.candidatos);
    this.logger.log(
      `Cron fugas ${res.fechaNoche}: ${res.candidatos.length} candidatos, ${avisos.enviados} avisos enviados`,
    );
  }
}
