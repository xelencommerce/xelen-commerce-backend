import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { DatabaseService, type Transaction } from '../database/database.service.js';
import { CryptoService } from '../security/crypto.service.js';
import { Configuration } from '../../config/environment.js';
import { DeliveryService } from './delivery.service.js';
import { z } from 'zod';
const messageSchema = z.object({
  to: z.email(),
  purpose: z.enum(['verify-email', 'reset-password']),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
/** Durable encrypted email outbox. No credentials or delivery payloads enter logs. */
@Injectable()
export class EmailOutboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly config: Configuration,
    private readonly delivery: DeliveryService,
  ) {}
  enqueue(
    tx: Transaction,
    userId: string,
    to: string,
    purpose: 'verify-email' | 'reset-password',
    token: string,
    expiresAt: Date,
  ) {
    const payloadCipher = this.crypto.encrypt(JSON.stringify({ to, purpose, token }));
    return tx.emailOutbox.create({ data: { userId, payloadCipher, expiresAt } });
  }
  onApplicationBootstrap() {
    if (this.config.values.EMAIL_PROVIDER === 'disabled') return;
    this.timer = setInterval(() => {
      if (!this.active && !this.stopped) {
        this.active = this.dispatchOne()
          .catch(() => undefined)
          .finally(() => {
            this.active = undefined;
          });
      }
    }, 1000);
    this.timer.unref();
  }
  async dispatchOne(): Promise<void> {
    const job = await this.db.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "EmailOutbox" WHERE "nextAttemptAt" <= now() AND ("leaseUntil" IS NULL OR "leaseUntil" < now()) ORDER BY "nextAttemptAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
      const id = candidates[0]?.id;
      if (!id) return null;
      return tx.emailOutbox.update({
        where: { id },
        data: { leaseUntil: new Date(Date.now() + 60000), attempts: { increment: 1 } },
      });
    });
    if (!job) return;
    let delivered = false;
    if (job.expiresAt > new Date()) {
      try {
        const message = messageSchema.parse(JSON.parse(this.crypto.decrypt(job.payloadCipher)));
        // Obsolete or consumed links must not be delivered after a resend/reset.
        const hash = this.crypto.digest(
          message.purpose === 'verify-email' ? 'email-verification' : 'password-reset',
          message.token,
        );
        const valid = await this.db.userToken.findFirst({
          where: {
            userId: job.userId,
            tokenHash: hash,
            usedAt: null,
            expiresAt: { gt: new Date() },
          },
        });
        if (valid) await this.delivery.email(message.to, message.purpose, message.token);
        delivered = true;
      } catch {
        /* Retry without logging recipient, token, provider error or payload. */
      }
    }
    if (delivered || job.expiresAt <= new Date() || job.attempts >= 5) {
      await this.db.actor(job.userId, async (tx) => {
        await tx.emailOutbox.delete({ where: { id: job.id } });
        await tx.auditLog.create({
          data: {
            actorId: job.userId,
            action: delivered ? 'EMAIL_DELIVERY_COMPLETED' : 'EMAIL_DELIVERY_EXHAUSTED',
          },
        });
      });
    } else {
      await this.db.emailOutbox.update({
        where: { id: job.id },
        data: {
          leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** (job.attempts - 1))),
        },
      });
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
}
