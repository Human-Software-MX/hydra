import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { SupraClientService, SupraObligation, SupraPayment } from '../supra/supra-client.service';
import { SupraMapService } from '../supra/supra-map.service';
import { SupraOutboxService } from '../supra/supra-outbox.service';
import { minorToPesos, supraRef } from '../supra/supra.config';
import { DunningService } from './dunning.service';
import {
  BUCKET_FIELD,
  EPSILON,
  bucketPorDias,
  categoriaPorDias,
  diasEntre,
  hoyIso,
  round2,
  scoreMorosidad,
} from './cartera.util';

/**
 * Cartera vencida — libro de partida abierta (open-item).
 *
 * Un `DocumentoCartera` por recibo con `montoOriginal = recibo.saldoVigente`
 * (SOLO los cargos del periodo; NUNCA el arrastre `saldoVencido`, que duplica
 * la deuda al componerse recibo a recibo — ver docs/design/cartera-cobranza.md §1).
 * Los pagos se aplican explícitamente a documentos (`AplicacionPago`) en orden
 * FIFO por vencimiento, y el `EstadoCuenta` materializado por contrato expone
 * buckets de aging, score de morosidad y banderas de convenio/restricción.
 *
 * Todo el recálculo es idempotente: puede correr cada noche (cron) y bajo
 * demanda al registrar un pago sin duplicar aplicaciones ni documentos.
 *
 *   HYDRA_JOBS_ENABLED = true | false  (master switch, default false)
 *   JOB_CARTERA_CRON   = cron (default "0 2 * * *" — diario, 02:00)
 *   JOB_DUNNING_CRON   = cron (default "0 3 * * *" — diario, 03:00)
 */

export interface ResultadoRecalculo {
  contratoId: string;
  documentos: number;
  aplicacionesNuevas: number;
  saldoTotal: number;
  saldoVencido: number;
}

@Injectable()
export class CarteraService {
  private readonly logger = new Logger(CarteraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dunning: DunningService,
    private readonly webhooks: WebhooksService,
    private readonly supraOutbox: SupraOutboxService,
    private readonly supra: SupraClientService,
    private readonly supraMapa: SupraMapService,
  ) {}

  private jobsHabilitados(): boolean {
    return (process.env.HYDRA_JOBS_ENABLED ?? 'false').toLowerCase() === 'true';
  }

  /** Envuelve un job con bitácora LogProceso (patrón de batch.service). */
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

  // ─── Recálculo por contrato (núcleo idempotente) ──────────────────────────

  /**
   * Materializa/actualiza la cartera de un contrato dentro de una transacción:
   *
   * 1. Upsert de `DocumentoCartera` por recibo (montoOriginal = saldoVigente).
   * 2. Aplica FIFO los pagos con remanente sin aplicar (self-healing: cubre
   *    tanto el pago recién creado como pagos históricos del backfill).
   * 3. Deriva saldo/diasVencido/bucket/estado por documento (convenio activo
   *    → `en_convenio`; `incobrable` se preserva y queda fuera del vencido).
   * 4. Recalcula el `EstadoCuenta` (buckets, score, categoría, banderas).
   */
  private async recalcularContratoTx(
    tx: Prisma.TransactionClient,
    contratoId: string,
    hoy: string,
  ): Promise<ResultadoRecalculo> {
    // 1. Un documento por recibo. montoOriginal = SOLO cargos del periodo
    //    (saldoVigente); el arrastre saldoVencido NUNCA entra: los recibos
    //    anteriores ya son documentos propios (evita el doble conteo).
    const recibos = await tx.recibo.findMany({
      where: { contratoId },
      select: {
        id: true,
        saldoVigente: true,
        fechaVencimiento: true,
        createdAt: true,
        timbrado: { select: { periodo: true, fechaEmision: true } },
      },
      orderBy: { fechaVencimiento: 'asc' },
    });

    for (const r of recibos) {
      const montoOriginal = round2(Number(r.saldoVigente));
      const fechaEmision = r.timbrado?.fechaEmision || r.createdAt.toISOString().slice(0, 10);
      await tx.documentoCartera.upsert({
        where: { reciboId: r.id },
        create: {
          contratoId,
          reciboId: r.id,
          tipo: 'recibo',
          periodo: r.timbrado?.periodo ?? null,
          montoOriginal,
          saldo: montoOriginal,
          fechaEmision,
          fechaVencimiento: r.fechaVencimiento,
        },
        update: {
          montoOriginal,
          periodo: r.timbrado?.periodo ?? null,
          fechaEmision,
          fechaVencimiento: r.fechaVencimiento,
        },
      });
    }

    const [convenioActivo, restriccionVigente] = await Promise.all([
      tx.convenio.findFirst({ where: { contratoId, estado: 'Activo' }, select: { id: true } }),
      tx.restriccionServicio.findFirst({
        where: { contratoId, estado: { in: ['programada', 'aplicada'] } },
        select: { id: true },
      }),
    ]);

    // 2. Aplicación FIFO de pagos con remanente (AplicacionPago = verdad).
    const [documentos, pagos, aplicaciones] = await Promise.all([
      tx.documentoCartera.findMany({
        where: { contratoId },
        orderBy: [{ fechaVencimiento: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.pago.findMany({
        where: { contratoId },
        select: { id: true, monto: true, fecha: true, reciboId: true },
        orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.aplicacionPago.findMany({
        where: { documento: { contratoId } },
        select: { pagoId: true, documentoCarteraId: true, monto: true },
      }),
    ]);

    const abonadoPorDoc = new Map<string, number>();
    const aplicadoPorPago = new Map<string, number>();
    for (const a of aplicaciones) {
      abonadoPorDoc.set(a.documentoCarteraId, round2((abonadoPorDoc.get(a.documentoCarteraId) ?? 0) + Number(a.monto)));
      aplicadoPorPago.set(a.pagoId, round2((aplicadoPorPago.get(a.pagoId) ?? 0) + Number(a.monto)));
    }

    const saldoDoc = (d: (typeof documentos)[0]) =>
      round2(Number(d.montoOriginal) - (abonadoPorDoc.get(d.id) ?? 0));

    let aplicacionesNuevas = 0;
    for (const p of pagos) {
      let disponible = round2(Number(p.monto) - (aplicadoPorPago.get(p.id) ?? 0));
      if (disponible <= EPSILON) continue;

      // El recibo explícito del pago tiene prioridad; después FIFO por vencimiento.
      const objetivos: typeof documentos = [];
      if (p.reciboId) {
        const directo = documentos.find((d) => d.reciboId === p.reciboId);
        if (directo) objetivos.push(directo);
      }
      objetivos.push(...documentos);

      const vistos = new Set<string>();
      for (const d of objetivos) {
        if (disponible <= EPSILON) break;
        if (vistos.has(d.id)) continue;
        vistos.add(d.id);
        if (d.estado === 'incobrable') continue; // requiere manejo manual
        const saldo = saldoDoc(d);
        if (saldo <= EPSILON) continue;
        const abono = round2(Math.min(disponible, saldo));
        await tx.aplicacionPago.create({
          data: { pagoId: p.id, documentoCarteraId: d.id, monto: abono, fecha: p.fecha },
        });
        abonadoPorDoc.set(d.id, round2((abonadoPorDoc.get(d.id) ?? 0) + abono));
        disponible = round2(disponible - abono);
        aplicacionesNuevas++;
      }
      // Sobrante: queda como saldo a favor implícito del pago (sin Anticipo
      // automático — la caja gestiona sus anticipos; el remanente se aplicará
      // solo al primer documento nuevo que se emita).
    }

    // 3. Derivados por documento + 4. acumuladores del estado de cuenta.
    let saldoTotal = 0;
    let saldoCorriente = 0;
    let saldoVencido = 0;
    const buckets = { bucketCorriente: 0, bucket1_30: 0, bucket31_60: 0, bucket61_90: 0, bucket90_mas: 0 };
    let docsVencidos = 0;
    let diasMoraMax = 0;

    for (const d of documentos) {
      const abonado = round2(abonadoPorDoc.get(d.id) ?? 0);
      const saldo = Math.max(0, round2(Number(d.montoOriginal) - abonado));
      const esIncobrable = d.estado === 'incobrable';
      const dias = !esIncobrable && saldo > EPSILON ? Math.max(0, diasEntre(d.fechaVencimiento, hoy)) : 0;
      const bucket = bucketPorDias(dias);

      let estado: string;
      if (esIncobrable) estado = 'incobrable';
      else if (saldo <= EPSILON) estado = 'pagado';
      else if (convenioActivo) estado = 'en_convenio';
      else if (dias > 0) estado = 'vencido';
      else if (abonado > EPSILON) estado = 'parcial';
      else estado = 'vigente';

      await tx.documentoCartera.update({
        where: { id: d.id },
        data: {
          montoAbonado: abonado,
          saldo,
          diasVencido: dias,
          bucket,
          estado,
          convenioId: estado === 'en_convenio' ? convenioActivo!.id : esIncobrable ? d.convenioId : null,
          recalculadoEn: new Date(),
        },
      });

      // Incobrables y pagados quedan fuera de los saldos del estado de cuenta.
      if (esIncobrable || saldo <= EPSILON) continue;
      saldoTotal = round2(saldoTotal + saldo);
      // Documentos en convenio: cuentan en saldoTotal pero no en vencido/buckets
      // (la bandera enConvenio los representa; excluidos del dunning).
      if (estado === 'en_convenio') continue;
      buckets[BUCKET_FIELD[bucket]] = round2(buckets[BUCKET_FIELD[bucket]] + saldo);
      if (dias > 0) {
        saldoVencido = round2(saldoVencido + saldo);
        docsVencidos++;
        if (dias > diasMoraMax) diasMoraMax = dias;
      } else {
        saldoCorriente = round2(saldoCorriente + saldo);
      }
    }

    const datosEstado = {
      saldoTotal,
      saldoCorriente,
      saldoVencido,
      ...buckets,
      docsVencidos,
      diasMoraMax,
      scoreMorosidad: scoreMorosidad(docsVencidos, diasMoraMax),
      categoria: categoriaPorDias(diasMoraMax),
      enConvenio: Boolean(convenioActivo),
      restringido: Boolean(restriccionVigente),
      recalculadoEn: new Date(),
    };
    await tx.estadoCuenta.upsert({
      where: { contratoId },
      create: { contratoId, ...datosEstado },
      update: datosEstado,
    });

    return {
      contratoId,
      documentos: documentos.length,
      aplicacionesNuevas,
      saldoTotal,
      saldoVencido,
    };
  }

  /** Recalcula la cartera de UN contrato (transaccional e idempotente). */
  async recalcularContrato(contratoId: string): Promise<ResultadoRecalculo> {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    const hoy = hoyIso();

    // Con SUPRA activo y contrato sincronizado, la proyección se construye
    // desde la verdad financiera de SUPRA (obligations + allocations); los
    // contratos aún no sincronizados conservan el cálculo local.
    if (this.supra.enabled) {
      const customerId = await this.supraMapa.get('contrato', contratoId);
      if (customerId) {
        return this.recalcularContratoDesdeSupra(contratoId, customerId, hoy);
      }
    }
    return this.prisma.$transaction((tx) => this.recalcularContratoTx(tx, contratoId, hoy));
  }

  /**
   * Proyección de cartera desde SUPRA (fuente de verdad):
   *
   *  - `DocumentoCartera` por obligation con external_ref `hydra:recibo:<id>`
   *    (montoOriginal/montoAbonado/saldo desde amount_due/settled_minor;
   *    written_off → incobrable; canceled → se elimina el documento).
   *  - `AplicacionPago` re-proyectada desde las allocations de los payments
   *    del customer (fecha de liquidación por documento — insumo de propensión).
   *  - `EstadoCuenta` con la misma derivación local (buckets, score, categoría,
   *    banderas enConvenio/restringido — dominio Hydra).
   *
   * Idempotente: puede correr por evento o por cron (reproyección) sin duplicar.
   */
  private async recalcularContratoDesdeSupra(
    contratoId: string,
    customerId: string,
    hoy: string,
  ): Promise<ResultadoRecalculo> {
    // 1. Verdad financiera desde SUPRA (fuera de la transacción local).
    const [obligations, payments] = await Promise.all([
      this.supra.listAllObligationsByCustomer(customerId),
      this.supra.listAllPaymentsByCustomer(customerId).catch(() => [] as SupraPayment[]),
    ]);
    const prefijo = 'hydra:recibo:';
    const deRecibo = obligations.filter((o) => o.external_ref?.startsWith(prefijo));
    const reciboPorObligation = new Map<string, string>(
      deRecibo.map((o) => [o.id, o.external_ref!.slice(prefijo.length)]),
    );

    // Allocations por obligation (detalle por payment — incluye la fecha).
    // Los payments sin allocations en el listado se resuelven con GET por lotes
    // de 10 en paralelo (antes: un GET secuencial por payment — N+1).
    const sinDetalle = payments.filter((p) => !p.allocations);
    const detallePorId = new Map(payments.filter((p) => p.allocations).map((p) => [p.id, p]));
    for (let i = 0; i < sinDetalle.length; i += 10) {
      const lote = await Promise.all(
        sinDetalle.slice(i, i + 10).map((p) => this.supra.getPayment(p.id).catch(() => null)),
      );
      for (const detalle of lote) {
        if (detalle) detallePorId.set(detalle.id, detalle);
      }
    }

    const allocationsPorObligation = new Map<
      string,
      { supraPaymentId: string; monto: number; fecha: string }[]
    >();
    for (const p of payments) {
      const detalle = detallePorId.get(p.id);
      if (!detalle?.allocations) continue;
      for (const a of detalle.allocations) {
        if (!reciboPorObligation.has(a.obligation)) continue;
        const lista = allocationsPorObligation.get(a.obligation) ?? [];
        lista.push({
          supraPaymentId: detalle.id,
          monto: minorToPesos(a.amount),
          fecha: (detalle.received_at ?? detalle.created_at ?? '').substring(0, 10),
        });
        allocationsPorObligation.set(a.obligation, lista);
      }
    }

    // Mapa payment SUPRA → pago espejo local (para AplicacionPago.pagoId).
    // El reverse de los no-referenciados por external_ref va en UNA query.
    const espejoPorSupraId = new Map<string, string>();
    const sinRef: string[] = [];
    for (const p of payments) {
      const ref = p.external_ref;
      if (ref?.startsWith('hydra:pago:')) {
        espejoPorSupraId.set(p.id, ref.slice('hydra:pago:'.length));
      } else {
        sinRef.push(p.id);
      }
    }
    for (const [supraId, hydraId] of await this.supraMapa.reverseMany('pago', sinRef)) {
      espejoPorSupraId.set(supraId, hydraId);
    }
    const pagosLocales = await this.prisma.pago.findMany({
      where: { id: { in: [...new Set(espejoPorSupraId.values())] } },
      select: { id: true },
    });
    const pagosExistentes = new Set(pagosLocales.map((p) => p.id));

    // Metadatos de presentación desde el recibo/timbrado local (periodo, emisión).
    const recibosLocales = await this.prisma.recibo.findMany({
      where: { id: { in: [...reciboPorObligation.values()] } },
      select: {
        id: true,
        fechaVencimiento: true,
        createdAt: true,
        timbrado: { select: { periodo: true, fechaEmision: true } },
      },
    });
    const reciboLocal = new Map(recibosLocales.map((r) => [r.id, r]));

    const [convenioActivo, restriccionVigente] = await Promise.all([
      this.prisma.convenio.findFirst({ where: { contratoId, estado: 'Activo' }, select: { id: true } }),
      this.prisma.restriccionServicio.findFirst({
        where: { contratoId, estado: { in: ['programada', 'aplicada'] } },
        select: { id: true },
      }),
    ]);

    // 2. Proyección transaccional.
    return this.prisma.$transaction(async (tx) => {
      let saldoTotal = 0;
      let saldoCorriente = 0;
      let saldoVencido = 0;
      const buckets = { bucketCorriente: 0, bucket1_30: 0, bucket31_60: 0, bucket61_90: 0, bucket90_mas: 0 };
      let docsVencidos = 0;
      let diasMoraMax = 0;
      let aplicacionesNuevas = 0;
      let documentosProyectados = 0;

      for (const o of deRecibo) {
        const reciboId = reciboPorObligation.get(o.id)!;

        if (o.status === 'canceled') {
          // Lote cancelado / refacturación: el documento sale de cartera.
          await tx.aplicacionPago.deleteMany({ where: { documento: { reciboId } } });
          await tx.documentoCartera.deleteMany({ where: { reciboId } });
          continue;
        }

        const local = reciboLocal.get(reciboId);
        const montoOriginal = round2(minorToPesos(o.amount_due_minor));
        const abonado = round2(minorToPesos(o.amount_settled_minor));
        const saldo = Math.max(0, round2(montoOriginal - abonado));
        const esIncobrable = o.status === 'written_off';
        const fechaVencimiento =
          local?.fechaVencimiento ?? (o.due_at ? o.due_at.substring(0, 10) : hoy);
        const fechaEmision =
          local?.timbrado?.fechaEmision ||
          local?.createdAt.toISOString().slice(0, 10) ||
          o.created_at.substring(0, 10);
        const dias = !esIncobrable && saldo > EPSILON ? Math.max(0, diasEntre(fechaVencimiento, hoy)) : 0;
        const bucket = bucketPorDias(dias);

        let estado: string;
        if (esIncobrable) estado = 'incobrable';
        else if (saldo <= EPSILON) estado = 'pagado';
        else if (convenioActivo) estado = 'en_convenio';
        else if (dias > 0) estado = 'vencido';
        else if (abonado > EPSILON) estado = 'parcial';
        else estado = 'vigente';

        const doc = await tx.documentoCartera.upsert({
          where: { reciboId },
          create: {
            contratoId,
            reciboId,
            tipo: 'recibo',
            periodo: local?.timbrado?.periodo ?? null,
            montoOriginal,
            montoAbonado: abonado,
            saldo,
            fechaEmision,
            fechaVencimiento,
            diasVencido: dias,
            bucket,
            estado,
            convenioId: estado === 'en_convenio' ? convenioActivo!.id : null,
            recalculadoEn: new Date(),
          },
          update: {
            montoOriginal,
            montoAbonado: abonado,
            saldo,
            periodo: local?.timbrado?.periodo ?? null,
            fechaEmision,
            fechaVencimiento,
            diasVencido: dias,
            bucket,
            estado,
            convenioId: estado === 'en_convenio' ? convenioActivo!.id : null,
            recalculadoEn: new Date(),
          },
        });
        documentosProyectados++;

        // AplicacionPago = proyección exacta de las allocations de SUPRA.
        await tx.aplicacionPago.deleteMany({ where: { documentoCarteraId: doc.id } });
        for (const a of allocationsPorObligation.get(o.id) ?? []) {
          const pagoLocal = espejoPorSupraId.get(a.supraPaymentId);
          if (!pagoLocal || !pagosExistentes.has(pagoLocal)) continue; // espejo aún no materializado
          await tx.aplicacionPago.create({
            data: {
              pagoId: pagoLocal,
              documentoCarteraId: doc.id,
              monto: a.monto,
              fecha: a.fecha || hoy,
            },
          });
          aplicacionesNuevas++;
        }

        if (esIncobrable || saldo <= EPSILON) continue;
        saldoTotal = round2(saldoTotal + saldo);
        if (estado === 'en_convenio') continue;
        buckets[BUCKET_FIELD[bucket]] = round2(buckets[BUCKET_FIELD[bucket]] + saldo);
        if (dias > 0) {
          saldoVencido = round2(saldoVencido + saldo);
          docsVencidos++;
          if (dias > diasMoraMax) diasMoraMax = dias;
        } else {
          saldoCorriente = round2(saldoCorriente + saldo);
        }
      }

      const datosEstado = {
        saldoTotal,
        saldoCorriente,
        saldoVencido,
        ...buckets,
        docsVencidos,
        diasMoraMax,
        scoreMorosidad: scoreMorosidad(docsVencidos, diasMoraMax),
        categoria: categoriaPorDias(diasMoraMax),
        enConvenio: Boolean(convenioActivo),
        restringido: Boolean(restriccionVigente),
        recalculadoEn: new Date(),
      };
      await tx.estadoCuenta.upsert({
        where: { contratoId },
        create: { contratoId, ...datosEstado },
        update: datosEstado,
      });

      return {
        contratoId,
        documentos: documentosProyectados,
        aplicacionesNuevas,
        saldoTotal,
        saldoVencido,
      };
    });
  }

  /** Recalcula un contrato o, sin argumento, toda la cartera (backfill). */
  async recalcular(contratoId?: string) {
    if (contratoId) return this.recalcularContrato(contratoId);
    return this.reconstruirCarteraInicial();
  }

  /**
   * Backfill masivo paginado: materializa documentos, re-aplica los pagos
   * históricos FIFO y deja el estado de cuenta de todos los contratos.
   * Regenerable — correrlo de nuevo no duplica nada.
   */
  async reconstruirCarteraInicial() {
    const pageSize = 200;
    const hoy = hoyIso();
    let cursor: string | undefined;
    let contratos = 0;
    let documentos = 0;
    let aplicaciones = 0;
    let errores = 0;
    const detalle: Array<{ contratoId: string; error: string }> = [];

    for (;;) {
      const lote = await this.prisma.contrato.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (lote.length === 0) break;

      for (const c of lote) {
        try {
          const r = await this.prisma.$transaction((tx) => this.recalcularContratoTx(tx, c.id, hoy));
          contratos++;
          documentos += r.documentos;
          aplicaciones += r.aplicacionesNuevas;
        } catch (e: any) {
          errores++;
          if (detalle.length < 50) detalle.push({ contratoId: c.id, error: e?.message ?? 'Error' });
          this.logger.error(`Recalculo de cartera falló para contrato ${c.id}: ${e?.message}`);
        }
      }
      cursor = lote[lote.length - 1].id;
    }

    this.logger.log(`Cartera reconstruida: ${contratos} contratos, ${documentos} documentos, ${aplicaciones} aplicaciones nuevas, ${errores} errores`);
    return { contratos, documentos, aplicaciones, registros: contratos, errores, detalle };
  }

  // ─── Hook post-pago (caja, conciliación externa, convenios) ───────────────

  /**
   * Aplica un pago recién registrado a la cartera (FIFO; el `reciboId`
   * explícito del pago tiene prioridad) y refresca el `EstadoCuenta`.
   * Nunca lanza: un fallo de cartera no debe tirar el registro del pago —
   * el recálculo nocturno es la red de seguridad idempotente.
   */
  async aplicarPago(pagoId: string): Promise<ResultadoRecalculo | null> {
    try {
      const pago = await this.prisma.pago.findUnique({
        where: { id: pagoId },
        select: { id: true, contratoId: true, monto: true, fecha: true, tipo: true, reciboId: true },
      });
      if (!pago) return null;
      const resultado = await this.recalcularContrato(pago.contratoId);
      void this.webhooks.emitir('pago.aplicado', {
        pagoId: pago.id,
        contratoId: pago.contratoId,
        reciboId: pago.reciboId,
        monto: Number(pago.monto),
        fecha: pago.fecha,
        tipo: pago.tipo,
        saldoTotal: resultado.saldoTotal,
        saldoVencido: resultado.saldoVencido,
      });
      return resultado;
    } catch (e: any) {
      this.logger.error(`aplicarPago(${pagoId}) falló: ${e?.message}`);
      return null;
    }
  }

  // ─── Marcar incobrable (siempre manual, con autorización) ─────────────────

  async marcarIncobrable(contratoId: string, params: { motivo: string; autorizadoPor: string }) {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const abiertos = await this.prisma.documentoCartera.findMany({
      where: { contratoId, saldo: { gt: EPSILON }, estado: { notIn: ['pagado', 'incobrable'] } },
      select: { id: true, saldo: true, diasVencido: true, reciboId: true },
    });
    if (abiertos.length === 0) {
      throw new BadRequestException('El contrato no tiene documentos abiertos que marcar como incobrables');
    }

    const saldoAlMomento = round2(abiertos.reduce((s, d) => s + Number(d.saldo), 0));
    const diasMoraAlMomento = abiertos.reduce((m, d) => Math.max(m, d.diasVencido), 0);

    const accion = await this.prisma.$transaction(async (tx) => {
      await tx.documentoCartera.updateMany({
        where: { id: { in: abiertos.map((d) => d.id) } },
        data: { estado: 'incobrable', recalculadoEn: new Date() },
      });
      // SUPRA (fuente de verdad financiera): write-off de las obligations de
      // los recibos marcados, encolado en la MISMA transacción del cambio
      // local (autorización ya validada aquí).
      for (const d of abiertos) {
        if (!d.reciboId) continue;
        await this.supraOutbox.encolar(
          'obligation.write_off',
          { reciboId: d.reciboId, contratoId, motivo: params.motivo },
          `${supraRef.recibo(d.reciboId)}:write_off`,
          { tx },
        );
      }
      return tx.accionCobranza.create({
        data: {
          contratoId,
          tipo: 'incobrable',
          canal: 'interno',
          estado: 'ejecutada',
          saldoAlMomento,
          diasMoraAlMomento,
          motivo: params.motivo,
          autorizadoPor: params.autorizadoPor,
        },
      });
    });

    // Refresca el estado de cuenta (los incobrables salen de saldos y buckets).
    await this.recalcularContrato(contratoId);
    return { accion, documentosMarcados: abiertos.length, saldoAlMomento };
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  async listarCartera(params: {
    administracionId?: string;
    zonaId?: string;
    bucket?: string;
    minDiasMora?: number;
    categoria?: string;
    scoreMin?: number;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;

    const bucketField = params.bucket ? BUCKET_FIELD[params.bucket] : undefined;
    if (params.bucket && !bucketField) {
      throw new BadRequestException(`bucket inválido: ${params.bucket} (use ${Object.keys(BUCKET_FIELD).join(' | ')})`);
    }

    const where: Prisma.EstadoCuentaWhereInput = {
      saldoTotal: { gt: 0 },
      ...(params.categoria && { categoria: params.categoria }),
      ...(params.scoreMin != null && { scoreMorosidad: { gte: params.scoreMin } }),
      ...(params.minDiasMora != null && { diasMoraMax: { gte: params.minDiasMora } }),
      ...(bucketField && { [bucketField]: { gt: 0 } }),
      ...((params.zonaId || params.administracionId) && {
        contrato: {
          ...(params.zonaId && { zonaId: params.zonaId }),
          ...(params.administracionId && { zona: { administracionId: params.administracionId } }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.estadoCuenta.findMany({
        where,
        include: {
          contrato: {
            select: {
              numeroContrato: true,
              nombre: true,
              estado: true,
              tipoServicio: true,
              zonaId: true,
              zona: { select: { nombre: true, administracionId: true, administracion: { select: { nombre: true } } } },
            },
          },
        },
        orderBy: [{ saldoVencido: 'desc' }, { scoreMorosidad: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.estadoCuenta.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /** Resumen de aging por administración/zona para el dashboard. */
  async aging(params: { administracionId?: string; zonaId?: string } = {}) {
    const rows = await this.prisma.estadoCuenta.findMany({
      where: {
        saldoTotal: { gt: 0 },
        ...((params.zonaId || params.administracionId) && {
          contrato: {
            ...(params.zonaId && { zonaId: params.zonaId }),
            ...(params.administracionId && { zona: { administracionId: params.administracionId } }),
          },
        }),
      },
      select: {
        saldoTotal: true,
        saldoCorriente: true,
        saldoVencido: true,
        bucketCorriente: true,
        bucket1_30: true,
        bucket31_60: true,
        bucket61_90: true,
        bucket90_mas: true,
        docsVencidos: true,
        contrato: {
          select: {
            zonaId: true,
            zona: {
              select: {
                id: true,
                nombre: true,
                administracionId: true,
                administracion: { select: { id: true, nombre: true } },
              },
            },
          },
        },
      },
    });

    type Agg = {
      administracionId: string | null;
      administracion: string | null;
      zonaId: string | null;
      zona: string | null;
      contratos: number;
      contratosVencidos: number;
      saldoTotal: number;
      saldoCorriente: number;
      saldoVencido: number;
      bucketCorriente: number;
      bucket1_30: number;
      bucket31_60: number;
      bucket61_90: number;
      bucket90_mas: number;
    };
    const nuevoAgg = (base: Partial<Agg>): Agg => ({
      administracionId: null,
      administracion: null,
      zonaId: null,
      zona: null,
      contratos: 0,
      contratosVencidos: 0,
      saldoTotal: 0,
      saldoCorriente: 0,
      saldoVencido: 0,
      bucketCorriente: 0,
      bucket1_30: 0,
      bucket31_60: 0,
      bucket61_90: 0,
      bucket90_mas: 0,
      ...base,
    });
    const acumular = (agg: Agg, r: (typeof rows)[0]) => {
      agg.contratos++;
      if (Number(r.saldoVencido) > 0) agg.contratosVencidos++;
      agg.saldoTotal = round2(agg.saldoTotal + Number(r.saldoTotal));
      agg.saldoCorriente = round2(agg.saldoCorriente + Number(r.saldoCorriente));
      agg.saldoVencido = round2(agg.saldoVencido + Number(r.saldoVencido));
      agg.bucketCorriente = round2(agg.bucketCorriente + Number(r.bucketCorriente));
      agg.bucket1_30 = round2(agg.bucket1_30 + Number(r.bucket1_30));
      agg.bucket31_60 = round2(agg.bucket31_60 + Number(r.bucket31_60));
      agg.bucket61_90 = round2(agg.bucket61_90 + Number(r.bucket61_90));
      agg.bucket90_mas = round2(agg.bucket90_mas + Number(r.bucket90_mas));
    };

    const total = nuevoAgg({});
    const porZona = new Map<string, Agg>();
    for (const r of rows) {
      acumular(total, r);
      const zona = r.contrato.zona;
      const key = zona?.id ?? 'sin_zona';
      let agg = porZona.get(key);
      if (!agg) {
        agg = nuevoAgg({
          administracionId: zona?.administracionId ?? null,
          administracion: zona?.administracion?.nombre ?? null,
          zonaId: zona?.id ?? null,
          zona: zona?.nombre ?? 'Sin zona',
        });
        porZona.set(key, agg);
      }
      acumular(agg, r);
    }

    return {
      total,
      zonas: [...porZona.values()].sort((a, b) => b.saldoVencido - a.saldoVencido),
    };
  }

  /** Estado de cuenta completo de un contrato (documentos, aplicaciones, acciones). */
  async estadoCuentaContrato(contratoId: string) {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: {
        id: true,
        numeroContrato: true,
        nombre: true,
        estado: true,
        tipoServicio: true,
        zona: { select: { nombre: true, administracion: { select: { nombre: true } } } },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    let estadoCuenta = await this.prisma.estadoCuenta.findUnique({ where: { contratoId } });
    if (!estadoCuenta) {
      await this.recalcularContrato(contratoId);
      estadoCuenta = await this.prisma.estadoCuenta.findUnique({ where: { contratoId } });
    }

    const [documentos, acciones] = await Promise.all([
      this.prisma.documentoCartera.findMany({
        where: { contratoId },
        orderBy: { fechaVencimiento: 'asc' },
        include: {
          aplicaciones: {
            orderBy: { createdAt: 'asc' },
            include: { pago: { select: { id: true, fecha: true, monto: true, tipo: true, concepto: true } } },
          },
        },
      }),
      this.prisma.accionCobranza.findMany({
        where: { contratoId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return { contrato, estadoCuenta, documentos, acciones };
  }

  async listarAcciones(params: {
    contratoId?: string;
    tipo?: string;
    campanaId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const where = {
      ...(params.contratoId && { contratoId: params.contratoId }),
      ...(params.tipo && { tipo: params.tipo }),
      ...(params.campanaId && { campanaId: params.campanaId }),
    };
    const [data, total] = await Promise.all([
      this.prisma.accionCobranza.findMany({
        where,
        include: { contrato: { select: { numeroContrato: true, nombre: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.accionCobranza.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  // ─── Jobs (mismo patrón que batch.service) ────────────────────────────────

  @Cron(process.env.JOB_CARTERA_CRON ?? '0 2 * * *', { name: 'cartera-recalculo' })
  async cronCartera() {
    if (!this.jobsHabilitados()) return;
    await this.ejecutarRecalculoNocturno();
  }

  async ejecutarRecalculoNocturno() {
    this.logger.log('Batch recálculo de cartera');
    return this.conLog('cartera:recalculo', () => this.reconstruirCarteraInicial());
  }

  @Cron(process.env.JOB_DUNNING_CRON ?? '0 3 * * *', { name: 'cartera-dunning' })
  async cronDunning() {
    if (!this.jobsHabilitados()) return;
    await this.ejecutarDunningNocturno();
  }

  async ejecutarDunningNocturno() {
    this.logger.log('Batch dunning de cobranza');
    return this.conLog('cartera:dunning', async () => {
      const res = await this.dunning.evaluar({ dryRun: false });
      return { ...res, registros: res.ejecutadas, errores: res.fallidas };
    });
  }
}
