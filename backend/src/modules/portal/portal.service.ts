import {
  Injectable,
  ForbiddenException,
  GoneException,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { adeudoFifo } from '../restricciones/restricciones.service';
import { SupraClientService } from '../supra/supra-client.service';
import { SupraMapService } from '../supra/supra-map.service';
import { minorToPesos } from '../supra/supra.config';
import { MetodoPagoPortal } from './dto/crear-intento-portal.dto';

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supra: SupraClientService,
    private readonly supraMapa: SupraMapService,
  ) {}

  private assertOwns(contratoId: string, contratoIds: string[]) {
    if (!contratoIds.includes(contratoId)) {
      throw new ForbiddenException('No tienes acceso a este contrato');
    }
  }

  async getContratos(contratoIds: string[]) {
    return this.prisma.contrato.findMany({
      where: { id: { in: contratoIds } },
      select: {
        id: true,
        nombre: true,
        rfc: true,
        tipoContrato: true,
        tipoServicio: true,
        estado: true,
        direccion: true,
        fecha: true,
        ceaNumContrato: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  async getConsumos(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);
    return this.prisma.consumo.findMany({
      where: { contratoId },
      orderBy: { periodo: 'desc' },
    });
  }

  async getTimbrados(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);
    return this.prisma.timbrado.findMany({
      where: { contratoId },
      include: { recibos: true },
      orderBy: { periodo: 'desc' },
    });
  }

  async getRecibos(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);
    return this.prisma.recibo.findMany({
      where: { contratoId },
      orderBy: { fechaVencimiento: 'desc' },
    });
  }

  async getPagos(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);
    return this.prisma.pago.findMany({
      where: { contratoId },
      orderBy: { fecha: 'desc' },
    });
  }

  /**
   * Saldo del contrato a nivel padrón: Σ saldoVigente de recibos − Σ pagos.
   * `Recibo.saldoVencido` NO se suma (es el arrastre de recibos anteriores,
   * que ya se cuentan uno a uno); el vencido se obtiene aplicando los pagos
   * FIFO a los recibos con fecha de vencimiento pasada.
   */
  async getSaldos(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);

    // Fuente de verdad: obligations abiertas en SUPRA (vencido = due_at < hoy).
    if (this.supra.enabled) {
      const customerId = await this.supraMapa.get('contrato', contratoId);
      if (!customerId) return { vencido: 0, vigente: 0, total: 0, intereses: 0 };
      const abiertas = await this.supra.listOpenObligations(customerId);
      const ahora = Date.now();
      let vencidoMinor = 0;
      let vigenteMinor = 0;
      for (const o of abiertas) {
        const abierto = Number(o.amount_due_minor) - Number(o.amount_settled_minor);
        if (abierto <= 0) continue;
        if (o.due_at && new Date(o.due_at).getTime() < ahora) vencidoMinor += abierto;
        else vigenteMinor += abierto;
      }
      return {
        vencido: minorToPesos(vencidoMinor),
        vigente: minorToPesos(vigenteMinor),
        total: minorToPesos(vencidoMinor + vigenteMinor),
        intereses: 0,
      };
    }

    const hoy = new Date().toISOString().slice(0, 10);
    const [recibos, pagadoAgg] = await Promise.all([
      this.prisma.recibo.findMany({
        where: { contratoId },
        select: { saldoVigente: true, fechaVencimiento: true },
        orderBy: { fechaVencimiento: 'asc' },
      }),
      this.prisma.pago.aggregate({ where: { contratoId }, _sum: { monto: true } }),
    ]);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const pagado = Number(pagadoAgg._sum.monto ?? 0);
    const facturado = recibos.reduce((s, r) => s + Number(r.saldoVigente), 0);
    const total = Math.max(0, r2(facturado - pagado));
    const vencido = adeudoFifo(recibos.filter((r) => r.fechaVencimiento < hoy), pagado).monto;
    const vigente = r2(total - vencido);
    return { vencido, vigente, total, intereses: 0 };
  }

  /**
   * Pago en línea desde el portal: crea un intento de pago (SPEI/OXXO/tarjeta)
   * vía la pasarela configurada. El monto no puede exceder el saldo total.
   */
  /**
   * Pago en línea del portal — SUPRA es el único motor de pagos:
   *  - SPEI con conector bank_transfer configurado (`SUPRA_SPEI_INSTANCE_ID`):
   *    instrucción de depósito nativa (CLABE + referencia) por obligación.
   *  - Resto (o sin conector SPEI): liga de checkout alojado (/pay/<token>).
   * La confirmación llega por webhook (payment.succeeded / payment_link.*);
   * Hydra nunca ejecuta el pago.
   */
  async crearIntentoPago(
    contratoId: string,
    contratoIds: string[],
    data: { monto: number; metodo: MetodoPagoPortal },
  ) {
    this.assertOwns(contratoId, contratoIds);
    if (!(data.monto > 0)) {
      throw new BadRequestException('El monto debe ser mayor a cero');
    }
    if (!this.supra.enabled) {
      throw new ServiceUnavailableException(
        'El pago en línea no está disponible: requiere la integración con SUPRA (Payment Engine)',
      );
    }

    const customerId = await this.supraMapa.get('contrato', contratoId);
    if (!customerId) {
      throw new BadRequestException('El contrato no está sincronizado con SUPRA');
    }
    const abiertas = await this.supra.listOpenObligations(customerId);
    if (abiertas.length === 0) {
      throw new BadRequestException('El contrato no tiene adeudos por pagar');
    }
    abiertas.sort((a, b) =>
      (a.due_at ?? a.created_at).localeCompare(b.due_at ?? b.created_at),
    );
    const objetivo = abiertas[0];
    const abiertoMinor = Number(objetivo.amount_due_minor) - Number(objetivo.amount_settled_minor);

    // SPEI nativo: instrucción de depósito del conector bank_transfer.
    const speiInstanceId = process.env.SUPRA_SPEI_INSTANCE_ID;
    if (data.metodo === 'spei' && speiInstanceId) {
      const instruccion = await this.supra.createBankTransferInstruction(
        speiInstanceId,
        objetivo.id,
      );
      const intento = await this.prisma.intentoPago.upsert({
        where: { referencia: instruccion.reference },
        create: {
          contratoId,
          pasarela: 'supra',
          metodo: 'spei',
          referencia: instruccion.reference,
          monto: minorToPesos(instruccion.amount),
          estado: 'pendiente',
          origen: 'portal',
        },
        update: {},
      });
      return {
        ...intento,
        datos: { clabe: instruccion.clabe, referencia: instruccion.reference },
      };
    }

    const link = await this.supra.createPaymentLink({
      obligation: objetivo.id,
      description: `Pago de servicio de agua — contrato ${contratoId.slice(0, 8)}`,
    });

    // Espejo local del intento para el historial del portal; el estado se
    // actualiza por eventos de SUPRA y por refresco en getIntentosPago.
    const intento = await this.prisma.intentoPago.create({
      data: {
        contratoId,
        pasarela: 'supra',
        metodo: data.metodo,
        referencia: link.token,
        monto: minorToPesos(abiertoMinor),
        estado: 'pendiente',
        urlPago: this.supra.checkoutUrl(link),
        expiraEn: link.expires_at ? new Date(link.expires_at) : null,
        origen: 'portal',
      },
    });
    await this.supraMapa.save('intento', intento.id, link.id);
    return { ...intento, datos: null };
  }

  /** Intentos de pago en línea del contrato (referencias SPEI, checkouts). */
  async getIntentosPago(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);

    // Historial desde el espejo local; los pendientes con liga de checkout se
    // refrescan desde SUPRA (la verdad vive allá).
    const intentos = await this.prisma.intentoPago.findMany({
      where: { contratoId },
      orderBy: { createdAt: 'desc' },
    });
    if (!this.supra.enabled) return intentos;

    const refrescados = [] as typeof intentos;
    for (const intento of intentos) {
      if (intento.estado !== 'pendiente' || intento.pasarela !== 'supra') {
        refrescados.push(intento);
        continue;
      }
      const linkId = await this.supraMapa.get('intento', intento.id);
      if (!linkId) {
        refrescados.push(intento);
        continue;
      }
      try {
        const link = await this.supra.getPaymentLink(linkId);
        const estado =
          link.status === 'completed'
            ? 'pagado'
            : link.status === 'canceled'
              ? 'cancelado'
              : link.status === 'expired'
                ? 'expirado'
                : 'pendiente';
        if (estado !== intento.estado) {
          refrescados.push(
            await this.prisma.intentoPago.update({
              where: { id: intento.id },
              data: { estado },
            }),
          );
        } else {
          refrescados.push(intento);
        }
      } catch {
        refrescados.push(intento);
      }
    }
    return refrescados;
  }

  /**
   * Simula la confirmación de un intento de pago del propio contrato.
   * Solo funciona con PASARELA_PROVIDER=simulada (modo demo) — el guard
   * de modo vive en PasarelasService.simularPagoExitoso.
   */
  async simularPagoIntento(contratoId: string, contratoIds: string[], _intentoId: string) {
    this.assertOwns(contratoId, contratoIds);
    // La pasarela simulada fue RETIRADA (SUPRA es el único motor de pagos).
    // En sandbox, el pago se confirma en el checkout de SUPRA (/pay/<token>).
    throw new GoneException(
      'La simulación local fue retirada: confirma el pago en el checkout de SUPRA (sandbox)',
    );
  }

  /**
   * T13: Descarga del XML CFDI timbrado desde el portal.
   * Misma fuente que `TimbradoService.obtenerXml` (columna `timbrado.xml`),
   * pero validando SIEMPRE que el timbrado pertenezca a un contrato del
   * usuario del portal antes de entregarlo.
   */
  async getTimbradoDescarga(timbradoId: string, contratoIds: string[]) {
    const timbrado = await this.prisma.timbrado.findUnique({
      where: { id: timbradoId },
      select: { id: true, contratoId: true, uuid: true, xml: true },
    });
    if (!timbrado) throw new NotFoundException('Timbrado no encontrado');
    this.assertOwns(timbrado.contratoId, contratoIds);
    if (!timbrado.xml) {
      throw new BadRequestException('El comprobante aún no está timbrado');
    }
    return { xml: timbrado.xml, uuid: timbrado.uuid, timbradoId: timbrado.id };
  }

  /** T14: Update datos fiscales from portal. */
  async updateDatosFiscales(
    contratoId: string,
    contratoIds: string[],
    data: { rfc?: string; razonSocial?: string; regimenFiscal?: string; constanciaFiscalUrl?: string },
  ) {
    this.assertOwns(contratoId, contratoIds);
    if (!data.rfc && !data.razonSocial && !data.regimenFiscal && !data.constanciaFiscalUrl) {
      throw new BadRequestException('No se proporcionaron campos a actualizar');
    }
    return this.prisma.contrato.update({
      where: { id: contratoId },
      data: {
        ...(data.rfc && { rfc: data.rfc }),
        ...(data.razonSocial !== undefined && { razonSocial: data.razonSocial }),
        ...(data.regimenFiscal !== undefined && { regimenFiscal: data.regimenFiscal }),
        ...(data.constanciaFiscalUrl !== undefined && { constanciaFiscalUrl: data.constanciaFiscalUrl }),
      },
      select: {
        id: true,
        nombre: true,
        rfc: true,
        razonSocial: true,
        regimenFiscal: true,
        constanciaFiscalUrl: true,
      },
    });
  }

  /** T14: Get datos fiscales. */
  async getDatosFiscales(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);
    return this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: {
        id: true,
        nombre: true,
        rfc: true,
        razonSocial: true,
        regimenFiscal: true,
        constanciaFiscalUrl: true,
      },
    });
  }

  /** T15: Get contacts linked to contrato. */
  async getContactos(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);
    return this.prisma.rolPersonaContrato.findMany({
      where: { contratoId, activo: true },
      include: { persona: { select: { id: true, nombre: true, rfc: true, email: true, telefono: true, tipo: true } } },
      orderBy: { fechaDesde: 'desc' },
    });
  }

  /** T15: Link a persona as contact of contrato. */
  async addContacto(
    contratoId: string,
    contratoIds: string[],
    data: { personaId?: string; nombre?: string; rfc?: string; email?: string; telefono?: string; rol: string },
  ) {
    this.assertOwns(contratoId, contratoIds);

    let personaId = data.personaId;
    if (!personaId) {
      // Create new persona if not existing
      if (!data.nombre) throw new BadRequestException('nombre es requerido para crear un contacto nuevo');
      const persona = await this.prisma.persona.create({
        data: {
          nombre: data.nombre,
          rfc: data.rfc ?? null,
          email: data.email ?? null,
          telefono: data.telefono ?? null,
        },
      });
      personaId = persona.id;
    }

    return this.prisma.rolPersonaContrato.create({
      data: {
        personaId,
        contratoId,
        rol: data.rol,
      },
      include: { persona: { select: { id: true, nombre: true, rfc: true, email: true, telefono: true } } },
    });
  }

  /** T4: Orders visible from portal. */
  async getOrdenes(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);
    return this.prisma.orden.findMany({
      where: { contratoId },
      include: { seguimientos: { orderBy: { fecha: 'desc' }, take: 3 } },
      orderBy: { fechaSolicitud: 'desc' },
    });
  }

  /**
   * Reporte de fuga desde el portal: se registra como `QuejaAclaracion`
   * (tipo 'Queja', categoria 'Fuga', canal 'Portal') vinculada al contrato
   * del usuario autenticado. El folio devuelto es el id del registro.
   */
  async crearReporteFuga(
    contratoId: string,
    contratoIds: string[],
    data: { descripcion: string; ubicacion?: string },
  ) {
    this.assertOwns(contratoId, contratoIds);
    const descripcion = data.ubicacion
      ? `${data.descripcion}\n\nReferencia de ubicación: ${data.ubicacion}`
      : data.descripcion;
    return this.prisma.quejaAclaracion.create({
      data: {
        contratoId,
        tipo: 'Queja',
        categoria: 'Fuga',
        descripcion,
        prioridad: 'Alta',
        canal: 'Portal',
        areaAsignada: 'Operación y mantenimiento',
      },
    });
  }

  /** Reportes de fuga del contrato (quejas categoria 'Fuga') con su estado. */
  async getReportesFuga(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);
    return this.prisma.quejaAclaracion.findMany({
      where: { contratoId, tipo: 'Queja', categoria: 'Fuga' },
      orderBy: { fecha: 'desc' },
    });
  }

  /** T1: Estado operativo visible from portal. */
  async getEstadoOperativo(contratoId: string, contratoIds: string[]) {
    this.assertOwns(contratoId, contratoIds);
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: { id: true, nombre: true, estado: true, bloqueadoJuridico: true, fechaReconexionPrevista: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    let montoAdeudo: number;
    const customerId = this.supra.enabled
      ? await this.supraMapa.get('contrato', contratoId)
      : null;
    if (customerId) {
      // Verdad financiera: saldo por cobrar de SUPRA.
      const balance = await this.supra.getBalance(customerId);
      montoAdeudo = Math.max(0, minorToPesos(balance.receivable_balance));
    } else {
      const [facturadoAgg, pagadoAgg] = await Promise.all([
        this.prisma.timbrado.aggregate({ where: { contratoId, estado: 'Timbrada OK' }, _sum: { total: true } }),
        this.prisma.pago.aggregate({ where: { contratoId }, _sum: { monto: true } }),
      ]);
      montoAdeudo = Math.max(0, Number(facturadoAgg._sum.total ?? 0) - Number(pagadoAgg._sum.monto ?? 0));
    }
    return {
      contratoId,
      estado: contrato.estado,
      bloqueadoJuridico: contrato.bloqueadoJuridico,
      tieneAdeudo: montoAdeudo > 0.01,
      montoAdeudo,
      fechaReconexionPrevista: contrato.fechaReconexionPrevista,
    };
  }
}
