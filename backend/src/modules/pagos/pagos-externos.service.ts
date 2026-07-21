import { randomUUID } from 'node:crypto';
import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EtlPagosService } from './etl-pagos.service';
import { CarteraService } from '../cartera/cartera.service';
import { SupraApiError, SupraClientService } from '../supra/supra-client.service';
import { SupraMapService } from '../supra/supra-map.service';
import { pesosToMinor, supraRef } from '../supra/supra.config';

@Injectable()
export class PagosExternosService {
  private readonly logger = new Logger(PagosExternosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly etl: EtlPagosService,
    private readonly cartera: CarteraService,
    private readonly supra: SupraClientService,
    private readonly supraMapa: SupraMapService,
  ) {}

  /**
   * Resuelve el contrato desde el número crudo del recaudador: primero por
   * `numeroContrato` (numérico, sin ceros a la izquierda), luego por
   * `ceaNumContrato` exacto. Nunca por substring del cuid (el matching previo
   * `id contains` no funciona con datos reales).
   */
  private async resolverContrato(contratoRaw: string | null | undefined): Promise<string | null> {
    if (!contratoRaw) return null;
    const limpio = contratoRaw.trim().replace(/^0+/, '');
    const numero = Number(limpio);
    if (Number.isInteger(numero) && numero > 0) {
      const porNumero = await this.prisma.contrato.findUnique({
        where: { numeroContrato: numero },
        select: { id: true },
      });
      if (porNumero) return porNumero.id;
    }
    const porCea = await this.prisma.contrato.findFirst({
      where: { ceaNumContrato: { in: [contratoRaw.trim(), limpio] } },
      select: { id: true },
    });
    return porCea?.id ?? null;
  }

  /**
   * Statement source de SUPRA por recaudador (una vez, cacheado en SupraMapa):
   * los archivos importados ahí son la capa de VERIFICACIÓN — la conciliación
   * de SUPRA observa, nunca mueve dinero.
   */
  private async ensureStatementSource(recaudador: string): Promise<string> {
    const cached = await this.supraMapa.get('statement_source', recaudador);
    if (cached) return cached;
    const source = await this.supra.createStatementSource({
      name: `Recaudador ${recaudador}`,
      kind: 'psp_report',
      matching_config: { date_window_days: 5, enable_heuristic: true, enable_grouping: true },
    });
    await this.supraMapa.save('statement_source', recaudador, source.id);
    return source.id;
  }

  /**
   * Exporta las filas staged a SUPRA como statement lines (idempotente por
   * external_id = id del PagoExterno). Best-effort: SUPRA caído nunca bloquea
   * la carga del archivo; re-subir/re-exportar no duplica.
   */
  private async exportarLineasASupra(
    recaudador: string,
    filas: { id: string; monto: unknown; fechaPagoReal: Date; referencia: string | null; contratoRaw: string | null }[],
  ): Promise<void> {
    if (!this.supra.enabled || filas.length === 0) return;
    try {
      const sourceId = await this.ensureStatementSource(recaudador);
      const res = await this.supra.importStatementLines(
        sourceId,
        filas.map((f) => ({
          external_id: f.id,
          kind: 'payment',
          amount: pesosToMinor(Number(f.monto)),
          currency: 'MXN',
          value_date: f.fechaPagoReal.toISOString().slice(0, 10),
          reference: f.referencia ?? undefined,
          counterparty_ref: f.contratoRaw ?? undefined,
        })),
      );
      this.logger.log(
        `Statement lines exportadas a SUPRA (${recaudador}): ${res.imported} nuevas, ${res.skipped} ya existentes`,
      );
    } catch (err) {
      this.logger.warn(
        `Export de statement lines a SUPRA falló (${recaudador}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async uploadArchivo(params: { recaudador: string; archivoNombre: string; contenido: string }) {
    const registros = this.etl.parseArchivo(params.recaudador, params.contenido);
    if (registros.length === 0) throw new BadRequestException('Archivo sin registros');

    let procesados = 0;
    let rechazados = 0;
    const errores: string[] = [];
    const filasStaged: {
      id: string;
      monto: unknown;
      fechaPagoReal: Date;
      referencia: string | null;
      contratoRaw: string | null;
    }[] = [];

    for (const r of registros) {
      if (r.error || !r.monto || r.monto <= 0) {
        rechazados++;
        errores.push(r.error ?? 'Monto inválido');
        await this.prisma.pagoExterno.create({
          data: {
            recaudador: params.recaudador,
            archivoNombre: params.archivoNombre,
            contratoRaw: r.contratoRaw,
            monto: r.monto || 0,
            fechaPagoReal: r.fechaPagoReal,
            formaPago: r.formaPago ?? this.etl.formaPagoDefecto(params.recaudador),
            canal: r.canal,
            oficina: r.oficina,
            estado: 'rechazado',
            motivoRechazo: r.error ?? 'Validación fallida',
            datosRaw: r.datosRaw,
          },
        });
        continue;
      }

      const contratoId = await this.resolverContrato(r.contratoRaw);

      const fila = await this.prisma.pagoExterno.create({
        data: {
          recaudador: params.recaudador,
          archivoNombre: params.archivoNombre,
          referencia: r.referencia,
          contratoRaw: r.contratoRaw,
          contratoId,
          monto: r.monto,
          fechaPagoReal: r.fechaPagoReal,
          formaPago: r.formaPago ?? this.etl.formaPagoDefecto(params.recaudador),
          canal: r.canal,
          oficina: r.oficina,
          estado: 'pendiente_conciliar',
          datosRaw: r.datosRaw,
        },
      });
      filasStaged.push({
        id: fila.id,
        monto: fila.monto,
        fechaPagoReal: fila.fechaPagoReal,
        referencia: fila.referencia,
        contratoRaw: fila.contratoRaw,
      });
      procesados++;
    }

    // Capa de verificación: las líneas del archivo van también a la
    // statement reconciliation de SUPRA (best-effort, idempotente).
    await this.exportarLineasASupra(params.recaudador, filasStaged);

    return { procesados, rechazados, total: registros.length, errores };
  }

  async findAll(params: { estado?: string; recaudador?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const where = {
      ...(params.estado && { estado: params.estado }),
      ...(params.recaudador && { recaudador: params.recaudador }),
    };
    const [data, total] = await Promise.all([
      this.prisma.pagoExterno.findMany({
        where,
        orderBy: { fechaPagoReal: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pagoExterno.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Concilia un pago de recaudador. Con SUPRA activo, el registro va PRIMERO a
   * SUPRA (`POST /v1/payments`, idempotente por `hydra:pago:<id>`); si SUPRA lo
   * rechaza, el pago externo queda `pendiente_conciliar` y el operador ve el
   * error — nunca existe dinero local que SUPRA desconozca.
   */
  async conciliar(id: string, contratoId: string, reciboId?: string) {
    const pago = await this.prisma.pagoExterno.findUnique({ where: { id } });
    if (!pago) throw new NotFoundException('Pago externo no encontrado');
    if (pago.estado !== 'pendiente_conciliar')
      throw new BadRequestException('El pago ya fue procesado');

    const pagoId = randomUUID();
    let supraPaymentId: string | null = null;

    if (this.supra.enabled) {
      const customerId = await this.supraMapa.ensureCustomer(contratoId);
      let allocations: { obligation: string; amount: string }[] | undefined;
      if (reciboId) {
        const obligationId = await this.supraMapa.ensureObligation(reciboId);
        allocations = [{ obligation: obligationId, amount: pesosToMinor(Number(pago.monto)) }];
      }
      try {
        const supraPayment = await this.supra.recordPayment({
          customer: customerId,
          amount: pesosToMinor(Number(pago.monto)),
          received_at: pago.fechaPagoReal.toISOString(),
          external_ref: supraRef.pago(pagoId),
          allocations,
        });
        supraPaymentId = supraPayment.id;
      } catch (err) {
        if (err instanceof SupraApiError) {
          this.logger.error(`SUPRA rechazó el pago externo ${id} (${err.code}): ${err.message}`);
          throw new BadGatewayException(`SUPRA rechazó el pago: ${err.message}`);
        }
        throw err;
      }
    }

    const pagoAplicado = await this.prisma.pago.create({
      data: {
        id: pagoId,
        contratoId,
        reciboId: reciboId ?? null,
        monto: pago.monto,
        fecha: pago.fechaPagoReal.toISOString().split('T')[0],
        tipo: pago.formaPago ?? 'EFECTIVO',
        concepto: `Pago externo ${pago.recaudador} - Ref: ${pago.referencia ?? pago.id}`,
        origen: 'externo',
      },
    });
    if (supraPaymentId) {
      await this.supraMapa.save('pago', pagoId, supraPaymentId);
    }

    await this.prisma.pagoExterno.update({
      where: { id },
      data: { estado: 'conciliado', contratoId, reciboId },
    });

    // Cierra el ciclo de verificación: match determinista línea↔payment en la
    // statement reconciliation de SUPRA (best-effort).
    if (supraPaymentId) {
      await this.matchearLineaSupra(pago.recaudador, id, supraPaymentId);
    }

    // Aplica el pago conciliado a la cartera (FIFO) y refresca el estado de cuenta.
    await this.cartera.aplicarPago(pagoAplicado.id);

    return { pagoExternoId: id, pagoAplicadoId: pagoAplicado.id, supraPaymentId };
  }

  /** Match manual línea (external_id = PagoExterno.id) → payment en SUPRA. */
  private async matchearLineaSupra(
    recaudador: string,
    pagoExternoId: string,
    supraPaymentId: string,
  ): Promise<void> {
    try {
      const sourceId = await this.supraMapa.get('statement_source', recaudador);
      if (!sourceId) return; // el archivo se subió antes de habilitar la exportación
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const res = await this.supra.listStatementLines({
          source: sourceId,
          limit: 100,
          starting_after: cursor,
        });
        const linea = res.data.find((l) => l.external_id === pagoExternoId);
        if (linea) {
          if (linea.status === 'unmatched') {
            await this.supra.createReconciliationMatch({
              line: linea.id,
              target_type: 'payment',
              target: supraPaymentId,
            });
          }
          return;
        }
        if (!res.has_more || !res.next_cursor) return;
        cursor = res.next_cursor;
      }
    } catch (err) {
      this.logger.warn(
        `Match de statement line falló (${pagoExternoId}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Corre la conciliación de SUPRA para un recaudador y devuelve el run. */
  async reconciliarRecaudador(recaudador: string) {
    this.supra.assertEnabled();
    const sourceId = await this.supraMapa.get('statement_source', recaudador);
    if (!sourceId) {
      throw new NotFoundException(
        `El recaudador ${recaudador} no tiene statement source en SUPRA (sube un archivo primero)`,
      );
    }
    return this.supra.reconcileStatementSource(sourceId);
  }

  /** Excepciones de conciliación abiertas en SUPRA (cola del operador). */
  async excepcionesConciliacion(status?: string) {
    this.supra.assertEnabled();
    const res = await this.supra.listReconciliationExceptions({ status: status ?? 'open' });
    return res.data;
  }

  async resolverExcepcionConciliacion(
    id: string,
    dto: { resolution: 'write_off' | 'corrected' | 'matched_late' | 'rejected'; note?: string },
  ) {
    this.supra.assertEnabled();
    return this.supra.resolveReconciliationException(id, dto);
  }

  async rechazar(id: string, motivo: string) {
    const pago = await this.prisma.pagoExterno.findUnique({ where: { id } });
    if (!pago) throw new NotFoundException('Pago externo no encontrado');
    return this.prisma.pagoExterno.update({
      where: { id },
      data: { estado: 'rechazado', motivoRechazo: motivo },
    });
  }
}
