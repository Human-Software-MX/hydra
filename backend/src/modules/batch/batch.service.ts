import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { FacturacionService } from '../facturacion/facturacion.service';
import { TimbradoService } from '../timbrados/timbrado.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';

/**
 * Procesos batch del ciclo comercial (facturación mensual, timbrado, avisos).
 *
 * Los crons se configuran por env y el master switch HYDRA_JOBS_ENABLED
 * (default: apagado) evita ejecuciones sorpresa en desarrollo o en réplicas.
 * Cada corrida queda registrada en LogProceso (módulo de monitoreo) con
 * conteos y detalle, y puede dispararse manualmente desde BatchController.
 *
 *   HYDRA_JOBS_ENABLED       = true | false   (default false)
 *   JOB_FACTURACION_CRON     = cron (default "0 2 1 * *"  — día 1, 02:00)
 *   JOB_TIMBRADO_CRON        = cron (default "0 4 1 * *"  — día 1, 04:00)
 *   JOB_VENCIMIENTOS_CRON    = cron (default "0 9 * * *"  — diario, 09:00)
 *   JOB_VENCIMIENTO_DIAS     = días de anticipación del aviso (default 3)
 */
@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facturacion: FacturacionService,
    private readonly timbrado: TimbradoService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  private jobsHabilitados(): boolean {
    return (process.env.HYDRA_JOBS_ENABLED ?? 'false').toLowerCase() === 'true';
  }

  /** Periodo natural anterior al actual, formato YYYY-MM. */
  periodoAnterior(ref = new Date()): string {
    const d = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Envuelve un job con bitácora LogProceso (Iniciado → Completado/Error). */
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

  // ─── Job: facturación mensual del periodo anterior ────────────────────────

  @Cron(process.env.JOB_FACTURACION_CRON ?? '0 2 1 * *', { name: 'facturacion-mensual' })
  async cronFacturacion() {
    if (!this.jobsHabilitados()) return;
    await this.ejecutarFacturacion(this.periodoAnterior());
  }

  async ejecutarFacturacion(periodo: string) {
    this.logger.log(`Batch facturación del periodo ${periodo}`);
    return this.conLog(`facturacion:${periodo}`, async () => {
      const res = await this.facturacion.ejecutarPeriodo({ periodo });
      return { ...res, registros: res.generados, errores: res.conError };
    });
  }

  // ─── Job: timbrado masivo del periodo anterior ────────────────────────────

  @Cron(process.env.JOB_TIMBRADO_CRON ?? '0 4 1 * *', { name: 'timbrado-mensual' })
  async cronTimbrado() {
    if (!this.jobsHabilitados()) return;
    await this.ejecutarTimbrado(this.periodoAnterior());
  }

  async ejecutarTimbrado(periodo: string) {
    this.logger.log(`Batch timbrado del periodo ${periodo}`);
    return this.conLog(`timbrado:${periodo}`, async () => {
      const res = await this.timbrado.timbrarPeriodo({ periodo });
      return { ...res, registros: res.timbrados, errores: res.conError };
    });
  }

  // ─── Job: avisos de vencimiento próximos ──────────────────────────────────

  @Cron(process.env.JOB_VENCIMIENTOS_CRON ?? '0 9 * * *', { name: 'avisos-vencimiento' })
  async cronVencimientos() {
    if (!this.jobsHabilitados()) return;
    await this.ejecutarAvisosVencimiento();
  }

  async ejecutarAvisosVencimiento() {
    const dias = parseInt(process.env.JOB_VENCIMIENTO_DIAS ?? '3', 10);
    const objetivo = new Date();
    objetivo.setDate(objetivo.getDate() + dias);
    const fechaObjetivo = objetivo.toISOString().slice(0, 10);

    this.logger.log(`Batch avisos de vencimiento (${fechaObjetivo}, ${dias} días de anticipación)`);
    return this.conLog(`vencimientos:${fechaObjetivo}`, async () => {
      const recibos = await this.prisma.recibo.findMany({
        where: { fechaVencimiento: fechaObjetivo },
        include: { pagos: { select: { monto: true } } },
      });

      let enviados = 0;
      let errores = 0;
      const detalle: Array<{ reciboId: string; resultado: string }> = [];

      for (const r of recibos) {
        const pagado = r.pagos.reduce((s, p) => s + Number(p.monto), 0);
        const pendiente = Number(r.saldoVigente) + Number(r.saldoVencido) - pagado;
        if (pendiente <= 0) {
          detalle.push({ reciboId: r.id, resultado: 'pagado' });
          continue;
        }

        // Evita repetir el aviso si ya se envió uno en los últimos 7 días.
        const hace7dias = new Date();
        hace7dias.setDate(hace7dias.getDate() - 7);
        const yaAvisado = await this.prisma.notificacionLog.findFirst({
          where: {
            contratoId: r.contratoId,
            tipo: 'aviso_vencimiento',
            enviado: true,
            createdAt: { gte: hace7dias },
          },
          select: { id: true },
        });
        if (yaAvisado) {
          detalle.push({ reciboId: r.id, resultado: 'ya_avisado' });
          continue;
        }

        try {
          const res = await this.notificaciones.notificarVencimiento(r.id);
          if (res.email || res.whatsapp) enviados++;
          detalle.push({ reciboId: r.id, resultado: `email:${res.email} wa:${res.whatsapp}` });
        } catch (e: any) {
          errores++;
          detalle.push({ reciboId: r.id, resultado: `error: ${e?.message}` });
        }
      }

      return {
        fechaObjetivo,
        candidatos: recibos.length,
        enviados,
        registros: enviados,
        errores,
        detalle: detalle.slice(0, 50),
      };
    });
  }

  // ─── Consulta de ejecuciones ──────────────────────────────────────────────

  async ultimasEjecuciones(limit = 30) {
    return this.prisma.logProceso.findMany({
      where: { tipo: 'batch' },
      orderBy: { inicio: 'desc' },
      take: limit,
    });
  }
}
