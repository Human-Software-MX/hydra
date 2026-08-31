import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

/** OpenAPI/Swagger sólo se expone fuera de producción (o con ENABLE_SWAGGER=true). */
function shouldExposeSwagger(): boolean {
  if (process.env.ENABLE_SWAGGER === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

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

  // La API vive detrás de un reverse proxy (Easypanel/Traefik): sin esto
  // `req.ip` sería la del proxy y el rate limiting metería a todos los
  // clientes en un solo cubo. Se confía exactamente en 1 salto — con `true`
  // el cliente podría falsear X-Forwarded-For y evadir el limitador.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api');

  // Cabeceras de seguridad. Esta API sirve JSON, no HTML: se desactiva la CSP
  // (no aplica) y se deja crossOriginResourcePolicy permisivo para que el
  // frontend, alojado en otro origen, pueda descargar PDFs de cotización.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Global validation pipe — rejects unknown fields and validates DTOs
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // OpenAPI. SwaggerModule registra sus rutas (/api/docs y /api/docs-json)
  // directamente en el adaptador Express, POR FUERA del pipeline de guards de
  // Nest, así que la cadena global (JwtAuth/Internal/Throttler) no las toca: la
  // documentación es alcanzable de forma anónima sin necesidad de @Public().
  // Se apaga en producción para no filtrar la superficie de la API.
  if (shouldExposeSwagger()) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CEA Querétaro — Hydra API')
      .setDescription('Contract-to-Cash-Flow. Autenticación por Bearer JWT (POST /api/auth/login).')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log('Swagger docs en /api/docs (JSON: /api/docs-json)');
  }

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
