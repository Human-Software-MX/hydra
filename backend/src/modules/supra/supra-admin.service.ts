import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupraClientService } from './supra-client.service';

export interface SaludSupra {
  habilitada: boolean;
  outbox: Record<string, number>;
  inbox: Record<string, number>;
  ultimaConciliacion: {
    fecha: Date;
    estado: string;
    detalle: unknown;
  } | null;
}

/** Observabilidad operativa de la integración SUPRA (panel/admin). */
@Injectable()
export class SupraAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SupraClientService,
  ) {}

  async salud(): Promise<SaludSupra> {
    const [outbox, inbox, ultimaConciliacion] = await Promise.all([
      this.prisma.supraComandoOutbox.groupBy({ by: ['estado'], _count: { _all: true } }),
      this.prisma.supraEventoInbox.groupBy({ by: ['estado'], _count: { _all: true } }),
      this.prisma.logProceso.findFirst({
        where: { tipo: 'batch', subTipo: 'conciliacion-supra' },
        orderBy: { inicio: 'desc' },
        select: { inicio: true, estado: true, detalle: true },
      }),
    ]);

    const aMapa = (rows: { estado: string; _count: { _all: number } }[]) =>
      Object.fromEntries(rows.map((r) => [r.estado, r._count._all]));

    return {
      habilitada: this.client.enabled,
      outbox: aMapa(outbox),
      inbox: aMapa(inbox),
      ultimaConciliacion: ultimaConciliacion
        ? {
            fecha: ultimaConciliacion.inicio,
            estado: ultimaConciliacion.estado,
            detalle: ultimaConciliacion.detalle,
          }
        : null,
    };
  }
}
