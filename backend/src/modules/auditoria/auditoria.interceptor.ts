import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Auditoría global unificada (quién/qué/cuándo): intercepta toda petición
 * mutante (POST/PATCH/PUT/DELETE) y la registra en `auditoria_eventos` de
 * forma asíncrona — la escritura de auditoría jamás bloquea ni tira la
 * respuesta de negocio.
 *
 * Exclusiones: login (no hay usuario aún y el body lleva credenciales) e
 * ingestas de alto volumen autenticadas por API key (MDM, webhook de
 * pasarela) que tienen su propia bitácora.
 */

const METODOS_AUDITADOS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const RUTAS_EXCLUIDAS = [/^\/auth\//, /^\/mdm\/lecturas/, /^\/pasarelas\/webhook/];
const CLAVES_SENSIBLES = /password|contrasena|secreto|token|authorization|csd|apikey|api_key/i;
const MAX_PAYLOAD_CHARS = 2_000;

/** Clona el body eliminando claves sensibles y truncando su tamaño. */
export function sanitizarPayload(body: unknown): unknown {
  if (body === null || body === undefined || typeof body !== 'object') return undefined;
  const limpiar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(limpiar);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, val]) =>
          CLAVES_SENSIBLES.test(k) ? [k, '[redactado]'] : [k, limpiar(val)],
        ),
      );
    }
    return v;
  };
  const limpio = limpiar(body);
  const json = JSON.stringify(limpio);
  if (json.length <= MAX_PAYLOAD_CHARS) return limpio;
  return { _truncado: true, _preview: json.slice(0, MAX_PAYLOAD_CHARS) };
}

@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditoriaInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const metodo: string = req.method;
    const ruta: string = req.originalUrl ?? req.url ?? '';

    if (!METODOS_AUDITADOS.has(metodo)) return next.handle();
    if (RUTAS_EXCLUIDAS.some((r) => r.test(ruta))) return next.handle();

    const inicio = Date.now();
    const registrar = (statusCode: number) => {
      const segmentos = ruta.split('?')[0].split('/').filter(Boolean);
      this.prisma.auditoriaEvento
        .create({
          data: {
            usuarioId: req.user?.userId ?? req.user?.sub ?? null,
            usuarioEmail: req.user?.email ?? null,
            metodo,
            ruta: ruta.slice(0, 500),
            entidad: segmentos[0] ?? null,
            entidadId: req.params?.id ?? null,
            statusCode,
            duracionMs: Date.now() - inicio,
            ip: req.ip ?? req.socket?.remoteAddress ?? null,
            payload: sanitizarPayload(req.body) as never,
          },
        })
        .catch((e) => this.logger.warn(`No se pudo registrar auditoría de ${metodo} ${ruta}: ${e?.message}`));
    };

    return next.handle().pipe(
      tap({
        next: () => registrar(context.switchToHttp().getResponse()?.statusCode ?? 200),
        error: (err) => registrar(err?.status ?? err?.statusCode ?? 500),
      }),
    );
  }
}
