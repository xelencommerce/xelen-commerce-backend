import { Global, Module } from '@nestjs/common';
import { Configuration } from '../config/environment.js';
import { DatabaseService } from './database/database.service.js';
import { CryptoService } from './security/crypto.service.js';
import { RateLimiter } from './database/rate-limiter.service.js';
import { RedisService } from './redis/redis.service.js';
import { DeliveryService } from './email/delivery.service.js';
import { EmailOutboxService } from './email/email-outbox.service.js';
import { OperationalMetrics } from './logging/operational-metrics.js';
@Global()
@Module({
  providers: [
    Configuration,
    DatabaseService,
    CryptoService,
    RateLimiter,
    RedisService,
    DeliveryService,
    EmailOutboxService,
    OperationalMetrics,
  ],
  exports: [
    Configuration,
    DatabaseService,
    CryptoService,
    RateLimiter,
    RedisService,
    DeliveryService,
    EmailOutboxService,
    OperationalMetrics,
  ],
})
export class InfrastructureModule {}
