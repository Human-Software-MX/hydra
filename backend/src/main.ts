import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

/** Comma-separated env values, trimmed and de-duplicated (e.g. multiple prod/staging URLs). */
function parseOriginList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // rawBody: necesario para verificar la firma HMAC de los webhooks de SUPRA
  // sobre el cuerpo crudo (POST /api/integraciones/supra/webhook).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');

  // Global validation pipe — rejects unknown fields and validates DTOs
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT ?? 3001;

  // T17: Internal app + portal + legacy single-origin. All vars support comma-separated lists.
  // CORS_ORIGIN is always merged when set (not only when internal/portal are empty), so
  // production can set e.g. CORS_INTERNAL_ORIGIN + CORS_ORIGIN without dropping the latter.
  const DEFAULT_DEV_ORIGIN = 'http://localhost:8080';
  const fromInternal = parseOriginList(process.env.CORS_INTERNAL_ORIGIN);
  const fromPortal = parseOriginList(process.env.CORS_PORTAL_ORIGIN);
  const fromLegacy = parseOriginList(process.env.CORS_ORIGIN);

  let allowedOrigins = [...new Set([...fromInternal, ...fromPortal, ...fromLegacy])];
  if (allowedOrigins.length === 0) {
    allowedOrigins = [DEFAULT_DEV_ORIGIN];
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, mobile apps, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS denied: origin '${origin}' not in allowlist`);
        // Use (null, false) per cors package contract; Error breaks preflight handling for some clients.
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  });

  await app.listen(port, '0.0.0.0');
  console.log(`API running at http://0.0.0.0:${port} — allowed origins: ${allowedOrigins.join(', ')}`);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
