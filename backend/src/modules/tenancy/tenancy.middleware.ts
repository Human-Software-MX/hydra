import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ContextoTenant, TENANT_DEFAULT, tenancyContext } from './tenancy.context';

/**
 * Resuelve el organismo del request y lo instala en el AsyncLocalStorage.
 *
 * Resolución del slug (en orden): header `X-Organismo`, o primer segmento del
 * subdominio si HYDRA_TENANCY_SUBDOMAIN=true (p. ej. `cea.hydra.mx` → `cea`).
 * Sin slug (o slug 'default') el request corre sobre la base principal, igual
 * que siempre — el modo mono-organismo no cambia en nada.
 *
 * El registro de organismos vive en la base default; se cachea 60 s en
 * memoria para no pagar una consulta por request.
 */

const CACHE_TTL_MS = 60_000;

@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenancyMiddleware.name);
  private readonly cache = new Map<string, { expira: number; ctx: ContextoTenant | null }>();

  constructor(private readonly prisma: PrismaService) {}

  private slugDeRequest(req: Request): string {
    const header = (req.headers['x-organismo'] as string | undefined)?.trim().toLowerCase();
    if (header) return header;
    if ((process.env.HYDRA_TENANCY_SUBDOMAIN ?? 'false').toLowerCase() === 'true') {
      const host = (req.headers.host ?? '').split(':')[0];
      const partes = host.split('.');
      if (partes.length > 2 && partes[0] !== 'www') return partes[0].toLowerCase();
    }
    return TENANT_DEFAULT;
  }

  private async resolverOrganismo(slug: string): Promise<ContextoTenant | null> {
    const cacheado = this.cache.get(slug);
    if (cacheado && cacheado.expira > Date.now()) return cacheado.ctx;

    // La consulta del registro corre SIN contexto de tenant → base default.
    const organismo = await this.prisma.organismo.findUnique({
      where: { slug },
      select: { slug: true, nombre: true, dbUrl: true, activo: true },
    });

    let ctx: ContextoTenant | null = null;
    if (organismo?.activo) {
      const dbUrl =
        organismo.dbUrl ??
        process.env[`TENANT_${slug.toUpperCase().replace(/-/g, '_')}_DATABASE_URL`] ??
        undefined;
      ctx = { slug: organismo.slug, nombre: organismo.nombre, dbUrl };
    }
    this.cache.set(slug, { expira: Date.now() + CACHE_TTL_MS, ctx });
    return ctx;
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const slug = this.slugDeRequest(req);
    if (slug === TENANT_DEFAULT) {
      return tenancyContext.run({ slug: TENANT_DEFAULT }, next);
    }

    let ctx: ContextoTenant | null = null;
    try {
      ctx = await this.resolverOrganismo(slug);
    } catch (e: any) {
      this.logger.error(`Resolución de organismo "${slug}" falló: ${e?.message}`);
      return res.status(503).json({ statusCode: 503, message: 'Registro de organismos no disponible' });
    }
    if (!ctx) {
      return res.status(404).json({ statusCode: 404, message: `Organismo "${slug}" no existe o está inactivo` });
    }
    if (!ctx.dbUrl) {
      return res.status(503).json({
        statusCode: 503,
        message: `Organismo "${slug}" sin base de datos configurada (Organismo.dbUrl o TENANT_${slug.toUpperCase().replace(/-/g, '_')}_DATABASE_URL)`,
      });
    }
    return tenancyContext.run(ctx, next);
  }
}
