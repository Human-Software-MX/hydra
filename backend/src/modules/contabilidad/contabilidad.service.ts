import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { conMonitoreo } from '../../common/monitoreo.helper';

@Injectable()
export class ContabilidadService {
  constructor(private readonly prisma: PrismaService) {}

  async getReglas(tipoTransaccion?: string) {
    return this.prisma.reglaContable.findMany({
      where: { activo: true, ...(tipoTransaccion && { tipoTransaccion }) },
      orderBy: [{ tipoTransaccion: 'asc' }, { orden: 'asc' }],
    });
  }

  async createRegla(data: {
    nombre: string;
    tipoTransaccion: string;
    indicador: string;
    cuentaContable: string;
    descripcionSAP: string;
    orden?: number;
  }) {
    return this.prisma.reglaContable.create({ data });
  }

  async generarPolizaCobros(fecha: string, periodo: string) {
    return conMonitoreo(
      this.prisma,
      'POLIZA_COBROS',
      async (ctx) => {
        const res = await this.generarPolizaCobrosInterno(fecha, periodo);
        if ('totalLineas' in res && typeof res.totalLineas === 'number')
          ctx.registros = res.totalLineas;
        ctx.detalle = { fecha, periodo, ...res };
        return res;
      },
      { subTipo: periodo },
    );
  }

  private async generarPolizaCobrosInterno(fecha: string, periodo: string) {
    const pagos = await this.prisma.pago.findMany({
      where: { fecha },
      include: { contrato: { select: { id: true, zonaId: true } } },
    });

    if (pagos.length === 0) return { message: 'No hay pagos para la fecha indicada' };

    const reglas = await this.getReglas('Pago');
    const numero = await this.generarNumeroPoliza();
    const total = pagos.reduce((s, p) => s + Number(p.monto), 0);
    const lineas: any[] = [];
    let posicion = 1;

    const porTipo = new Map<string, number>();
    for (const pago of pagos) {
      porTipo.set(pago.tipo, (porTipo.get(pago.tipo) ?? 0) + Number(pago.monto));
    }

    for (const [tipo, monto] of porTipo.entries()) {
      const regla = reglas.find((r) => r.descripcionSAP.includes(tipo)) ?? reglas[0];
      if (!regla) continue;
      lineas.push({
        posicion: posicion++,
        indicador: regla.indicador,
        monto,
        cuentaContable: regla.cuentaContable,
        fecha: new Date(fecha),
        descripcion: `${regla.descripcionSAP} - ${tipo}`,
        texto: `COBRO ${tipo}`,
      });
    }

    lineas.push({
      posicion: posicion++,
      indicador: '15',
      monto: total,
      cuentaContable: '11221111031001',
      fecha: new Date(fecha),
      descripcion: 'TOTAL COBROS DEL DIA',
      texto: `TOTAL ${fecha}`,
    });

    const poliza = await this.prisma.poliza.create({
      data: {
        numero,
        tipo: 'Cobros',
        periodo,
        fecha: new Date(fecha),
        descripcion: `COBRO VENTANILLA ${fecha}`,
        moneda: 'MXN',
        lineas: { create: lineas },
      },
      include: { lineas: true },
    });

    const idoc = this.generarIdoc(poliza);
    await this.prisma.poliza.update({
      where: { id: poliza.id },
      data: { archivoIdoc: idoc, estado: 'exportada' },
    });

    return { polizaId: poliza.id, numero, totalLineas: lineas.length, idoc };
  }

  async generarPolizaFacturacion(fecha: string, periodo: string) {
    return conMonitoreo(
      this.prisma,
      'POLIZA_FACTURACION',
      async (ctx) => {
        const res = await this.generarPolizaFacturacionInterno(fecha, periodo);
        if ('timbrados' in res && typeof res.timbrados === 'number')
          ctx.registros = res.timbrados;
        ctx.detalle = { fecha, periodo, ...res };
        return res;
      },
      { subTipo: periodo },
    );
  }

  private async generarPolizaFacturacionInterno(fecha: string, periodo: string) {
    const timbrados = await this.prisma.timbrado.findMany({
      where: { fechaEmision: fecha, estado: 'Timbrada OK' },
    });

    if (timbrados.length === 0) return { message: 'No hay timbrados para la fecha' };

    const numero = await this.generarNumeroPoliza();
    const totalFacturado = timbrados.reduce((s, t) => s + Number(t.total), 0);
    const totalIva = timbrados.reduce((s, t) => s + Number(t.iva), 0);

    const poliza = await this.prisma.poliza.create({
      data: {
        numero,
        tipo: 'Facturacion',
        periodo,
        fecha: new Date(fecha),
        descripcion: `FACTURACION DIARIA ${fecha}`,
        lineas: {
          create: [
            {
              posicion: 1,
              indicador: '01',
              monto: totalFacturado - totalIva,
              cuentaContable: '40000000001001',
              fecha: new Date(fecha),
              descripcion: 'INGRESOS POR FACTURACION',
            },
            {
              posicion: 2,
              indicador: '01',
              monto: totalIva,
              cuentaContable: '21160000001001',
              fecha: new Date(fecha),
              descripcion: 'IVA TRASLADADO',
            },
            {
              posicion: 3,
              indicador: '40',
              monto: totalFacturado,
              cuentaContable: '12110000001001',
              fecha: new Date(fecha),
              descripcion: 'CUENTAS POR COBRAR CLIENTES',
            },
          ],
        },
      },
      include: { lineas: true },
    });

    const idoc = this.generarIdoc(poliza);
    await this.prisma.poliza.update({ where: { id: poliza.id }, data: { archivoIdoc: idoc } });
    return { polizaId: poliza.id, numero, totalFacturado, timbrados: timbrados.length };
  }

  generarIdoc(poliza: any): string {
    const num = poliza.numero.toString().padStart(10, '0');
    const fecha = new Date(poliza.fecha).toISOString().substring(0, 10).replace(/-/g, '');
    const lines: string[] = [];

    lines.push(`Aqua_SAP     ${num}` + ' '.repeat(200) + `${fecha}000001`);
    lines.push(
      `Interfaz_AquaCis_SAP_Cabecera ` +
        `0000000000${num}${num.substring(2)}00000000` +
        ' '.repeat(20) +
        `${fecha}0310000${fecha}02  MXN` +
        ' '.repeat(20) +
        `${fecha}0000000000${num}` +
        ' '.repeat(16) +
        `ASN ${poliza.numero} ${(poliza.descripcion ?? '').substring(0, 50)}`,
    );

    for (const linea of poliza.lineas ?? []) {
      const pos = linea.posicion.toString().padStart(6, '0');
      const monto = Number(linea.monto).toFixed(2).padStart(20, ' ');
      lines.push(
        `Interfaz_AquaCis_SAP_Posicion ` +
          `0000000000${num}${pos}00000000` +
          ' '.repeat(15) +
          `               ${linea.indicador} ${monto}` +
          ' '.repeat(20) +
          `0.00` +
          ' '.repeat(16) +
          `${fecha}` +
          ' '.repeat(20) +
          `${(linea.descripcion ?? '').substring(0, 30).padEnd(30)}` +
          ' '.repeat(20) +
          `${(linea.texto ?? '').substring(0, 20).padEnd(20)}` +
          ' '.repeat(20) +
          `${linea.cuentaContable}`,
      );
    }

    return lines.join('\n');
  }

  async findPolizas(params: {
    tipo?: string;
    periodo?: string;
    estado?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      ...(params.tipo && { tipo: params.tipo }),
      ...(params.periodo && { periodo: params.periodo }),
      ...(params.estado && { estado: params.estado }),
    };
    const [data, total] = await Promise.all([
      this.prisma.poliza.findMany({
        where,
        include: { lineas: { orderBy: { posicion: 'asc' } } },
        orderBy: { fecha: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.poliza.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async getPoliza(id: string) {
    const p = await this.prisma.poliza.findUnique({
      where: { id },
      include: { lineas: { orderBy: { posicion: 'asc' } } },
    });
    if (!p) throw new NotFoundException('Póliza no encontrada');
    return p;
  }

  private async generarNumeroPoliza(): Promise<string> {
    const ultima = await this.prisma.poliza.findFirst({
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });
    const siguiente = ultima ? parseInt(ultima.numero) + 1 : 1584000;
    return siguiente.toString();
  }
}
