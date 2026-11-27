import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const db = app.get(DatabaseService);
  const now = new Date();
  const counts = await db.$transaction(async (tx) => {
    const challenges = await tx.mfaChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
    const grants = await tx.userToken.deleteMany({ where: { expiresAt: { lt: now } } });
    const outbox = await tx.emailOutbox.deleteMany({ where: { expiresAt: { lt: now } } });
    const rates = await tx.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } });
    // Keep consumed refresh tokens through the session's absolute lifetime for reuse detection.
    const sessions = await tx.session.deleteMany({ where: { expiresAt: { lt: now } } });
    return {
      challenges: challenges.count,
      grants: grants.count,
      rates: rates.count,
      outbox: outbox.count,
      sessions: sessions.count,
    };
  });
  console.log(JSON.stringify(counts));
} finally {
  await app.close();
}
