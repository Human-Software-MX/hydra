import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SupraClientService } from './supra-client.service';
import { minorToPesos } from './supra.config';

export interface DiferenciaConciliacion {
  contratoId: string;
  customerId: string;
  saldoLocal: number;
  saldoSupra: number;
  diferencia: number;
}

/**
 * Conciliación espejo↔SUPRA: compara el `EstadoCuenta` proyectado localmente
 * contra las obligations abiertas de recibo en SUPRA, por contrato. Es el
 * detector de divergencia de la integración (criterio de salida: diferencias
 * en 0 sostenidas). Solo OBSERVA — nunca corrige dinero; una diferencia se
 * investiga y se resuelve reproyectando (`POST /cartera/recalcular`).
 *
 * Nota de alcance: compara únicamente obligations `hydra:recibo:*` — las
 * consolidadas de convenio (`hydra:convenio:*`) no se proyectan como
 * DocumentoCartera y quedan fuera de ambos lados de la comparación.
 */
@Injectable()
export class SupraConciliacionService {
  private readonly logger = new Logger(SupraConciliacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supra: SupraClientService,
  ) {}

  /** Corre la conciliación dejando bitácora en LogProceso (subTipo
   *  `conciliacion-supra`) — insumo de GET /integraciones/supra/admin/salud. */
  async conciliar(muestra = 100): Promise<{
    revisados: number;
    conDiferencia: number;
    tolerancia: number;
    diferencias: DiferenciaConciliacion[];
  }> {
    this.supra.assertEnabled();
    const log = await this.prisma.logProceso.create({
      data: { tipo: 'batch', subTipo: 'conciliacion-supra', estado: 'Iniciado' },
    });
    const inicio = Date.now();
    try {
      const resultado = await this.conciliarCore(muestra);
      await this.prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: 'Completado',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          registros: resultado.revisados,
          errores: resultado.conDiferencia,
          detalle: JSON.parse(JSON.stringify({ ...resultado, diferencias: resultado.diferencias.slice(0, 20) })),
        },
      });
      return resultado;
    } catch (e) {
      await this.prisma.logProceso.update({
        where: { id: log.id },
        data: {
          estado: 'Error',
          fin: new Date(),
          duracionMs: Date.now() - inicio,
          errores: 1,
          errorMsg: e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    }
  }

  private async conciliarCore(muestra: number): Promise<{
    revisados: number;
    conDiferencia: number;
    tolerancia: number;
    diferencias: DiferenciaConciliacion[];
  }> {
    const TOLERANCIA = 0.01;

    // Muestra: los contratos sincronizados con actividad más reciente.
    const mapeos = await this.prisma.supraMapa.findMany({
      where: { entidad: 'contrato' },
      orderBy: { updatedAt: 'desc' },
      take: muestra,
      select: { hydraId: true, supraId: true },
    });

    const diferencias: DiferenciaConciliacion[] = [];
    for (const m of mapeos) {
      const [estado, abiertas] = await Promise.all([
        this.prisma.estadoCuenta.findUnique({
          where: { contratoId: m.hydraId },
          select: { saldoTotal: true },
        }),
        this.supra.listOpenObligations(m.supraId),
      ]);
      const saldoLocal = Number(estado?.saldoTotal ?? 0);
      const abiertoMinor = abiertas
        .filter((o) => o.external_ref?.startsWith('hydra:recibo:'))
        .reduce((s, o) => s + Number(o.amount_due_minor) - Number(o.amount_settled_minor), 0);
      const saldoSupra = minorToPesos(abiertoMinor);
      const diferencia = Math.round((saldoLocal - saldoSupra) * 100) / 100;
      if (Math.abs(diferencia) > TOLERANCIA) {
        diferencias.push({
          contratoId: m.hydraId,
          customerId: m.supraId,
          saldoLocal,
          saldoSupra,
          diferencia,
        });
      }
    }

    if (diferencias.length > 0) {
      this.logger.warn(
        `Conciliación espejo↔SUPRA: ${diferencias.length}/${mapeos.length} contratos con diferencia`,
      );
    }
    return {
      revisados: mapeos.length,
      conDiferencia: diferencias.length,
      tolerancia: TOLERANCIA,
      diferencias,
    };
  }

  /** Cron diario 04:00 (tras el recálculo de cartera de las 02:00). */
  @Cron(process.env.JOB_CONCILIACION_SUPRA_CRON ?? '0 4 * * *', { name: 'conciliacion-supra' })
  async cronConciliar() {
    if ((process.env.HYDRA_JOBS_ENABLED ?? 'false').toLowerCase() !== 'true') return;
    if (!this.supra.enabled) return;
    const resultado = await this.conciliar(500).catch((e) => {
      this.logger.error(`Conciliación espejo↔SUPRA falló: ${e instanceof Error ? e.message : e}`);
      return null;
    });
    if (resultado && resultado.conDiferencia > 0) {
      this.logger.error(
        `⚠ Conciliación espejo↔SUPRA con ${resultado.conDiferencia} diferencia(s): ` +
          JSON.stringify(resultado.diferencias.slice(0, 10)),
      );
    }
  }
}
