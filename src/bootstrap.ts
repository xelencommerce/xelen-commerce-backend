import 'reflect-metadata';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import { Configuration } from './config/environment.js';
import { CryptoService } from './infrastructure/security/crypto.service.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { OperationalMetrics } from './infrastructure/logging/operational-metrics.js';
import { ErrorResponseDto } from './common/exceptions/error-response.dto.js';
import { browserSecurity } from './common/middleware/browser-security.js';
export function configureApplication(app: INestApplication) {
  const config = app.get(Configuration);
  const env = config.values;
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', env.TRUST_PROXY_HOPS);
  app.useLogger(app.get(Logger));
  const metrics = app.get(OperationalMetrics);
  app.use((request: Request, response: Response, next: NextFunction) => {
    const incoming = request.headers['x-request-id'];
    request.id =
      typeof incoming === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(incoming)
        ? incoming
        : randomUUID();
    response.setHeader('X-Request-Id', request.id);
    const started = performance.now();
    response.once('finish', () => metrics.record(response.statusCode, performance.now() - started));
    next();
  });
  app.use(helmet());
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => callback(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
  });
  app.use(cookieParser());
  app.use(browserSecurity(config, app.get(CryptoService)));
  app.use(express.json({ limit: '64kb', strict: true }));
  app.setGlobalPrefix(env.API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter(app.get(Logger)));
  app.enableShutdownHooks();
  if (env.DOCS_ENABLED) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Xelen Commerce API')
        .setDescription(
          'Modular commerce backend. Financial endpoints explicitly report unavailable sources. Browser refresh uses HttpOnly cookies plus signed CSRF and Origin checks.',
        )
        .setVersion('1.0.0')
        .addBearerAuth()
        .addCookieAuth(config.refreshCookie)
        .build(),
      { extraModels: [ErrorResponseDto] },
    );
    for (const path of Object.values(document.paths)) {
      for (const method of ['get', 'post', 'patch'] as const) {
        const operation = path?.[method];
        if (!operation) continue;
        for (const status of [400, 401, 403, 404, 413, 415, 429, 500, 503]) {
          const existing = operation.responses[String(status)];
          if (existing && '$ref' in existing) continue;
          operation.responses[String(status)] = {
            description:
              existing?.description ??
              'Sanitized machine-readable API error. See docs/api.md for error codes and authorization requirements.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponseDto' } },
            },
          };
        }
      }
    }
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: { persistAuthorization: false },
    });
    return document;
  }
  return null;
}
