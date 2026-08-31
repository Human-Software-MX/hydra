import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FacturacionService } from '../facturacion/facturacion.service';
import { construirCfdiXml, CfdiConcepto, CfdiEmisor, CfdiReceptor } from './cfdi/cfdi-builder';
import { crearPacProvider } from './pac/pac.factory';
import { PacProvider } from './pac/pac-provider.interface';

const RFC_PUBLICO_GENERAL = 'XAXX010101000';
const CLAVE_PROD_SERV_AGUA = '83101509'; // Servicios de suministro de agua

@Injectable()
export class TimbradoService {
  private readonly logger = new Logger('TimbradoService');
  private readonly pac: PacProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly facturacion: FacturacionService,
  ) {
    this.pac = crearPacProvider();
  }

  private emisor(): CfdiEmisor {
    return {
      rfc: process.env.CFDI_EMISOR_RFC ?? 'EKU9003173C9',
      nombre: process.env.CFDI_EMISOR_NOMBRE ?? 'ORGANISMO OPERADOR DE AGUA',
      regimenFiscal: process.env.CFDI_EMISOR_REGIMEN ?? '603',
      codigoPostal: process.env.CFDI_EMISOR_CP ?? '76000',
    };
  }

  /** Timbra un Timbrado pendiente: construye el CFDI, lo sella vía PAC y persiste. */
  async timbrar(timbradoId: string) {
    const timbrado = await this.prisma.timbrado.findUnique({
      where: { id: timbradoId },
      include: {
        contrato: {
          select: {
            id: true,
            nombre: true,
            rfc: true,
            razonSocial: true,
            regimenFiscal: true,
            numeroContrato: true,
            domicilio: { select: { codigoPostal: true } },
          },
        },
      },
    });
    if (!timbrado) throw new NotFoundException('Timbrado no encontrado');
    if (timbrado.estado === 'Timbrada OK') throw new BadRequestException('El comprobante ya está timbrado');
    if (!timbrado.consumoId) throw new BadRequestException('El timbrado no tiene consumo asociado');

    try {
      const factura = await this.facturacion.calcularConsumo(timbrado.consumoId);
      const conceptos: CfdiConcepto[] = factura.lineas.map((l) => {
        const esConsumo = l.m3 > 0;
        return {
          claveProdServ: CLAVE_PROD_SERV_AGUA,
          claveUnidad: esConsumo ? 'MTQ' : 'E48',
          cantidad: esConsumo ? l.m3 : 1,
          descripcion: l.concepto,
          valorUnitario: esConsumo ? l.precioUnitario : l.importe,
          importe: l.importe,
          objetoImp: l.ivaPct > 0 ? '02' : '01',
          ivaTasa: l.ivaPct > 0 ? l.ivaPct / 100 : undefined,
          ivaImporte: l.ivaPct > 0 ? l.iva : undefined,
        };
      });

      const receptor = this.construirReceptor(timbrado.contrato);
      const fecha = new Date().toISOString().slice(0, 19);
      const folio = String(timbrado.contrato.numeroContrato) + '-' + timbrado.periodo.replace('-', '');

      const { xml, totales } = construirCfdiXml({
        serie: process.env.CFDI_SERIE ?? 'A',
        folio,
        fecha,
        formaPago: process.env.CFDI_FORMA_PAGO ?? '99',
        metodoPago: (process.env.CFDI_METODO_PAGO as 'PUE' | 'PPD') ?? 'PUE',
        emisor: this.emisor(),
        receptor,
        conceptos,
      });

      // Reconciliación: el CFDI debe cuadrar con los importes ya facturados.
      if (Math.abs(totales.total - factura.total) > 0.02) {
        throw new BadRequestException(
          `Descuadre CFDI (${totales.total}) vs factura (${factura.total}); revise tarifas.`,
        );
      }

      const timbre = await this.pac.timbrar(xml, { uuidSugerido: undefined });

      return this.prisma.timbrado.update({
        where: { id: timbradoId },
        data: {
          estado: 'Timbrada OK',
          uuid: timbre.uuid,
          serie: process.env.CFDI_SERIE ?? 'A',
          folio,
          formaPago: process.env.CFDI_FORMA_PAGO ?? '99',
          metodoPago: (process.env.CFDI_METODO_PAGO as string) ?? 'PUE',
          usoCfdi: receptor.usoCFDI,
          fechaTimbrado: timbre.fechaTimbrado,
          selloCfdi: timbre.selloCFDI,
          selloSat: timbre.selloSAT,
          noCertificadoSat: timbre.noCertificadoSAT,
          rfcProvCertif: timbre.rfcProvCertif,
          cadenaOriginalSat: timbre.cadenaOriginalSAT ?? null,
          xml: timbre.xmlTimbrado,
          pacProveedor: this.pac.nombre,
          error: null,
        },
      });
    } catch (e: any) {
      this.logger.error(`Error al timbrar ${timbradoId}: ${e?.message}`);
      await this.prisma.timbrado.update({
        where: { id: timbradoId },
        data: { estado: 'Error PAC', error: e?.message ?? 'Error de timbrado' },
      });
      throw e instanceof BadRequestException ? e : new BadRequestException(e?.message ?? 'Error de timbrado');
    }
  }

  private construirReceptor(contrato: {
    nombre: string;
    rfc: string;
    razonSocial: string | null;
    regimenFiscal: string | null;
    domicilio: { codigoPostal: string | null } | null;
  }): CfdiReceptor {
    const rfc = (contrato.rfc ?? '').trim().toUpperCase();
    const esPublicoGeneral = !rfc || rfc === RFC_PUBLICO_GENERAL;

    if (esPublicoGeneral) {
      return {
        rfc: RFC_PUBLICO_GENERAL,
        nombre: 'PUBLICO EN GENERAL',
        domicilioFiscalCP: this.emisor().codigoPostal,
        regimenFiscal: '616', // Sin obligaciones fiscales
        usoCFDI: 'S01', // Sin efectos fiscales
      };
    }
    return {
      rfc,
      nombre: (contrato.razonSocial ?? contrato.nombre).toUpperCase(),
      domicilioFiscalCP: contrato.domicilio?.codigoPostal ?? this.emisor().codigoPostal,
      regimenFiscal: contrato.regimenFiscal ?? '616',
      usoCFDI: process.env.CFDI_USO ?? 'G03',
    };
  }

  /** Timbra en lote todos los comprobantes pendientes de un periodo. */
  async timbrarPeriodo(params: { periodo: string; contratoId?: string }) {
    const pendientes = await this.prisma.timbrado.findMany({
      where: {
        periodo: params.periodo,
        estado: { in: ['Pendiente', 'Error PAC'] },
        consumoId: { not: null },
        ...(params.contratoId && { contratoId: params.contratoId }),
      },
      select: { id: true },
    });

    const ok: string[] = [];
    const errores: Array<{ timbradoId: string; error: string }> = [];
    for (const t of pendientes) {
      try {
        const res = await this.timbrar(t.id);
        ok.push(res.uuid);
      } catch (e: any) {
        errores.push({ timbradoId: t.id, error: e?.message ?? 'Error' });
      }
    }

    return {
      periodo: params.periodo,
      procesados: pendientes.length,
      timbrados: ok.length,
      conError: errores.length,
      errores,
    };
  }

  /** Devuelve el XML timbrado para descarga. */
  async obtenerXml(timbradoId: string): Promise<string> {
    const t = await this.prisma.timbrado.findUnique({
      where: { id: timbradoId },
      select: { xml: true, estado: true },
    });
    if (!t) throw new NotFoundException('Timbrado no encontrado');
    if (!t.xml) throw new BadRequestException('El comprobante aún no está timbrado');
    return t.xml;
  }
}
