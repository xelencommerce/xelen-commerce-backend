import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { CryptoService } from '../security/crypto.service.js';
import { ApiError } from '../../common/exceptions/api-error.js';
@Injectable()
export class RateLimiter {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
  ) {}
  async hit(namespace: string, key: string, max: number, seconds: number): Promise<void> {
    const hash = this.crypto.digest('rate-limit', `${namespace}:${key}`);
    const rows = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt") VALUES (${hash}, 1, now() + ${seconds} * interval '1 second')
      ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RateLimitBucket"."expiresAt" <= now() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= now() THEN now() + ${seconds} * interval '1 second' ELSE "RateLimitBucket"."expiresAt" END RETURNING "count"`;
    if ((rows[0]?.count ?? max + 1) > max)
      throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }
}
