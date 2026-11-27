import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { Configuration } from './config/environment.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { MerchantsModule } from './modules/merchants/merchants.module.js';
import { SuperAdminModule } from './modules/super-admin/super-admin.module.js';
import { HealthController } from './modules/health/health.controller.js';
import {
  RequestRateGuard,
  AuthenticationGuard,
  RoleGuard,
  TenantGuard,
  PermissionGuard,
} from './common/guards/access.guards.js';
import { OperationsController } from './infrastructure/logging/operational-metrics.js';
@Module({
  imports: [
    InfrastructureModule,
    LoggerModule.forRootAsync({
      imports: [InfrastructureModule],
      inject: [Configuration],
      useFactory: (config: Configuration) => ({
        pinoHttp: {
          level: config.values.NODE_ENV === 'test' ? 'silent' : 'info',
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              req.id ??
              (typeof incoming === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(incoming)
                ? incoming
                : randomUUID());
            res.setHeader('X-Request-Id', String(id));
            return id;
          },
          serializers: {
            req: (req) => ({
              id: req.id,
              method: req.method,
              path: String(req.url ?? '').split('?')[0],
            }),
            res: (res) => ({ statusCode: res.statusCode }),
            err: () => ({ type: 'RequestError' }),
          },
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body',
            'res.body',
            'res.headers["set-cookie"]',
          ],
        },
      }),
    }),
    AuthModule,
    MerchantsModule,
    SuperAdminModule,
  ],
  controllers: [HealthController, OperationsController],
  providers: [
    { provide: APP_GUARD, useClass: RequestRateGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RoleGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
