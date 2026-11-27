import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Configuration } from '../../config/environment.js';
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client?: Redis;
  constructor(private readonly config: Configuration) {}
  async onModuleInit() {
    if (!this.config.values.REDIS_URL) return;
    this.client = new Redis(this.config.values.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      retryStrategy: () => null,
    });
    this.client.on('error', () => undefined);
    await this.client.connect();
  }
  async ready(): Promise<'disabled' | 'ready' | 'unavailable'> {
    if (!this.client) return 'disabled';
    try {
      return (await this.client.ping()) === 'PONG' ? 'ready' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
  tenantKey(tenantId: string, key: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('Verified tenant context required.');
    return `xelen:tenant:${tenantId}:${key}`;
  }
  async onModuleDestroy() {
    if (this.client) await this.client.quit().catch(() => this.client?.disconnect());
  }
}
