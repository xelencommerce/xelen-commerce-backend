import 'reflect-metadata';
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request, { type Response as TestResponse } from 'supertest';
import pg from 'pg';
import * as OTPAuth from 'otpauth';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/bootstrap.js';
import { DatabaseService } from '../../src/infrastructure/database/database.service.js';
import { CryptoService } from '../../src/infrastructure/security/crypto.service.js';
import { EmailOutboxService } from '../../src/infrastructure/email/email-outbox.service.js';
import { DeliveryService } from '../../src/infrastructure/email/delivery.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { RateLimiter } from '../../src/infrastructure/database/rate-limiter.service.js';

class TestDelivery {
  failEmail = false;
  emails: { to: string; purpose: string; token: string }[] = [];
  messages: { to: string; code: string }[] = [];
  requireEmail() {}
  requireSms() {}
  async email(to: string, purpose: string, token: string) {
    if (this.failEmail) throw new Error('Simulated provider failure');
    this.emails.push({ to, purpose, token });
  }
  async sms(to: string, code: string) {
    this.messages.push({ to, code });
  }
  token(email: string, purpose: string) {
    const match = [...this.emails]
      .reverse()
      .find((item) => item.to === email && item.purpose === purpose);
    if (!match) throw new Error('Missing test delivery');
    return match.token;
  }
}
interface Identity {
  email: string;
  id: string;
  tenantId: string;
  challengeToken: string;
  access: string;
  cookies: string[];
  csrf: string;
  recoveryCodes: string[];
  totp?: OTPAuth.TOTP;
}
interface Flow {
  challengeToken: string;
  availableMethods: string[];
  status: string;
}
const password = 'Test-only-password1!';
const prefix = '/api/v1';
const origin = 'http://localhost:5173';
const cookiesFrom = (response: TestResponse): string[] => {
  const cookies = response.headers['set-cookie'] as unknown as string[] | undefined;
  return (cookies ?? []).map((cookie) => cookie.split(';')[0]!);
};
const issued = (response: TestResponse) => ({
  access: response.body.data.accessToken as string,
  csrf: response.body.data.csrfToken as string,
  cookies: cookiesFrom(response),
  recoveryCodes: (response.body.data.recoveryCodes ?? []) as string[],
});

describe('PostgreSQL-backed security and API integration', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let admin: pg.Client;
  let crypto: CryptoService;
  const delivery = new TestDelivery();
  let merchantA: Identity;
  let merchantB: Identity;
  let superAdmin: Identity;
  const post = (path: string) => request(app.getHttpServer()).post(`${prefix}${path}`);
  const get = (path: string, user?: Identity) => {
    const query = request(app.getHttpServer()).get(`${prefix}${path}`);
    return user ? query.auth(user.access, { type: 'bearer' }) : query;
  };
  async function deliverAll() {
    for (let i = 0; i < 30 && (await db.emailOutbox.count()); i++)
      await app.get(EmailOutboxService).dispatchOne();
  }
  async function pending(): Promise<Identity> {
    const email = `test-${randomUUID()}@example.test`;
    const response = await post('/auth/register')
      .send({ email: ` ${email.toUpperCase()} `, password, confirmPassword: password })
      .expect(202);
    expect(response.body.data.status).toBe('REQUEST_ACCEPTED');
    expect(response.body.data.accessToken).toBeUndefined();
    const stored = await db.user.findUniqueOrThrow({ where: { email } });
    const membership = await admin.query(
      'SELECT "tenantId" FROM "MerchantMembership" WHERE "userId"=$1',
      [stored.id],
    );
    await deliverAll();
    const token = delivery.token(email, 'verify-email');
    const flow = await post('/auth/verify-email').send({ token }).expect(200);
    expect(flow.body.data.status).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(flow.headers['set-cookie']).toBeUndefined();
    return {
      email,
      id: stored.id,
      tenantId: membership.rows[0].tenantId,
      challengeToken: flow.body.data.challengeToken,
      access: '',
      csrf: '',
      cookies: [],
      recoveryCodes: [],
    };
  }
  async function registerTotp(): Promise<Identity> {
    const identity = await pending();
    const setup = await post('/auth/mfa/totp/setup')
      .send({ challengeToken: identity.challengeToken })
      .expect(200);
    identity.totp = OTPAuth.URI.parse(setup.body.data.otpauthUri) as OTPAuth.TOTP;
    const confirmed = await post('/auth/mfa/totp/confirm')
      .send({ challengeToken: identity.challengeToken, code: identity.totp.generate() })
      .expect(200);
    Object.assign(identity, issued(confirmed));
    return identity;
  }
  async function loginFlow(user: Identity): Promise<Flow> {
    return (
      await post('/auth/login').send({ email: user.email, password, remember: true }).expect(200)
    ).body.data;
  }
  async function allowNewTotp(user: Identity) {
    await admin.query('UPDATE "MfaMethod" SET "lastCounter"=NULL WHERE "userId"=$1 AND kind=$2', [
      user.id,
      'TOTP',
    ]);
  }
  async function loginTotp(user: Identity) {
    await allowNewTotp(user);
    const flow = await loginFlow(user);
    expect(flow.status).toBe('MFA_REQUIRED');
    await post('/auth/mfa/challenge')
      .send({ challengeToken: flow.challengeToken, method: 'TOTP' })
      .expect(200);
    const verified = await post('/auth/mfa/verify')
      .send({ challengeToken: flow.challengeToken, code: user.totp!.generate() })
      .expect(200);
    Object.assign(user, issued(verified));
    return user;
  }
  async function reauth(user: Identity): Promise<string> {
    await allowNewTotp(user);
    const flow = await post('/auth/reauthenticate')
      .auth(user.access, { type: 'bearer' })
      .send({ password })
      .expect(200);
    await post('/auth/mfa/challenge')
      .send({ challengeToken: flow.body.data.challengeToken, method: 'TOTP' })
      .expect(200);
    const verified = await post('/auth/mfa/verify')
      .send({ challengeToken: flow.body.data.challengeToken, code: user.totp!.generate() })
      .expect(200);
    expect(verified.body.data.status).toBe('REAUTHENTICATED');
    expect(verified.body.data.accessToken).toBeUndefined();
    return verified.body.data.reauthToken;
  }
  beforeAll(async () => {
    const runtime = process.env.TEST_DATABASE_URL;
    const migration = process.env.TEST_MIGRATION_DATABASE_URL;
    if (!runtime || !migration)
      throw new Error(
        'Set isolated TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL; integration tests are never silently skipped.',
      );
    for (const value of [runtime, migration]) {
      const url = new URL(value);
      if (
        !['127.0.0.1', 'localhost', 'postgres'].includes(url.hostname) ||
        url.pathname !== '/xelen_test'
      )
        throw new Error('Tests only permit the isolated local xelen_test database.');
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = runtime;
    process.env.REDIS_URL = '';
    process.env.CORS_ORIGINS = origin;
    process.env.DOCS_ENABLED = 'true';
    admin = new pg.Client({ connectionString: migration });
    await admin.connect();
    await admin.query('TRUNCATE "User", "Merchant", "RateLimitBucket" CASCADE');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DeliveryService)
      .useValue(delivery)
      .compile();
    app = module.createNestApplication({ bodyParser: false, logger: false });
    configureApplication(app);
    await app.init();
    db = app.get(DatabaseService);
    crypto = app.get(CryptoService);
  });
  beforeEach(async () => {
    if (db) await db.rateLimitBucket.deleteMany();
  });
  afterAll(async () => {
    await app?.close();
    await admin?.end();
  });

  test('readiness, OpenAPI, request IDs, validation, payload limits, JSON and safe errors', async () => {
    expect((await get('/health/ready').expect(200)).body.data).toEqual({
      status: 'ready',
      database: 'ready',
      redis: 'disabled',
    });
    const health = await get('/health/live').set('X-Request-Id', 'test-correlation').expect(200);
    expect(health.headers['x-request-id']).toBe('test-correlation');
    const docs = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(docs.body.paths[`${prefix}/auth/login`]).toBeDefined();
    expect(Object.keys(docs.body.paths).length).toBeGreaterThan(20);
    const invalid = await post('/auth/register')
      .send({
        email: 'invalid',
        password: 'bad',
        confirmPassword: 'different',
        role: 'SUPER_ADMIN',
      })
      .expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error).not.toHaveProperty('stack');
    const large = await post('/auth/login')
      .send({ email: 'user@example.test', password: 'x'.repeat(70000) })
      .expect(413);
    expect(large.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(large.headers['x-request-id']).toBeTruthy();
    await post('/auth/login').set('Content-Type', 'text/plain').send('bad').expect(415);
    const blocked = await post('/auth/login')
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    expect(blocked.body.requestId).toBeTruthy();
    const unknown = await get('/unknown').expect(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });
  test('registration is transactional, normalizes email, hashes passwords and requires email ownership', async () => {
    const email = `ownership-${randomUUID()}@example.test`;
    await post('/auth/register')
      .send({ email, password, confirmPassword: password, roles: ['SUPER_ADMIN'] })
      .expect(400);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    const registered = await post('/auth/register')
      .send({ email: ` ${email.toUpperCase()} `, password, confirmPassword: password })
      .expect(202);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$argon2id/);
    expect(user.emailVerifiedAt).toBeNull();
    expect(await db.userRole.count({ where: { userId: user.id } })).toBe(0);
    expect(
      (
        await post('/auth/register')
          .send({ email, password, confirmPassword: password })
          .expect(202)
      ).body.data,
    ).toEqual(registered.body.data);
    const rejected = await post('/auth/login').send({ email, password }).expect(401);
    expect(
      (await post('/auth/login').send({ email: 'absent@example.test', password }).expect(401)).body
        .error,
    ).toEqual(rejected.body.error);
    await deliverAll();
    const token = delivery.token(email, 'verify-email');
    expect(
      (await db.userToken.findFirstOrThrow({ where: { userId: user.id } })).tokenHash,
    ).not.toBe(token);
    const flow = await post('/auth/verify-email').send({ token }).expect(200);
    expect(flow.body.data.status).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(flow.body.data).not.toHaveProperty('accessToken');
    await post('/auth/verify-email').send({ token }).expect(401);
    await post('/auth/mfa/verify')
      .send({ challengeToken: flow.body.data.challengeToken, code: '123456' })
      .expect(401);
  });
  test('TOTP enrollment returns real QR, encrypted secrets and one-time recovery codes; challenge cannot replay', async () => {
    merchantA = await registerTotp();
    merchantB = await registerTotp();
    const method = await db.mfaMethod.findUniqueOrThrow({
      where: { userId_kind: { userId: merchantA.id, kind: 'TOTP' } },
    });
    expect(method.secretCipher).not.toContain(merchantA.totp!.secret.base32);
    expect(crypto.decrypt(method.secretCipher!)).toBe(merchantA.totp!.secret.base32);
    expect(merchantA.recoveryCodes).toHaveLength(10);
    expect(await db.recoveryCode.count({ where: { userId: merchantA.id } })).toBe(10);
    const recovery = await db.recoveryCode.findFirstOrThrow({ where: { userId: merchantA.id } });
    expect(merchantA.recoveryCodes).not.toContain(recovery.codeHash);
    await post('/auth/mfa/totp/confirm')
      .send({ challengeToken: merchantA.challengeToken, code: merchantA.totp!.generate() })
      .expect(401);
    const me = await get('/auth/me', merchantA).expect(200);
    expect(me.body.data.memberships[0].tenantId).toBe(merchantA.tenantId);
    expect(me.body.data.roles).toEqual([]);
    expect(me.body.data.dashboard).toBe('/merchant');
    const cookie = merchantA.cookies.find((value) => value.startsWith('xelen_refresh='));
    expect(cookie).toBeTruthy();
  });
  test('tenant access is enforced by guards, repository and forced RLS; no context leaks from pooled transactions', async () => {
    await request(app.getHttpServer())
      .patch(`${prefix}/merchants/${merchantA.tenantId}/business-profile`)
      .auth(merchantA.access, { type: 'bearer' })
      .send({ businessName: 'Merchant A', industry: 'Other', otherIndustry: 'Specialty shop' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${prefix}/merchants/${merchantB.tenantId}/business-profile`)
      .auth(merchantB.access, { type: 'bearer' })
      .send({ businessName: 'Merchant B', industry: 'Other', otherIndustry: 'Independent shop' })
      .expect(200);
    await get(`/merchants/${merchantA.tenantId}/business-profile`, merchantA).expect(200);
    await get(`/merchants/${merchantB.tenantId}/business-profile`, merchantA).expect(404);
    await request(app.getHttpServer())
      .patch(`${prefix}/merchants/${merchantB.tenantId}/business-profile`)
      .auth(merchantA.access, { type: 'bearer' })
      .send({ businessName: 'Intruder', industry: 'Other', otherIndustry: 'invalid' })
      .expect(404);
    await admin.query('UPDATE "Merchant" SET status=$1 WHERE id=$2', [
      'SUSPENDED',
      merchantA.tenantId,
    ]);
    await get(`/merchants/${merchantA.tenantId}/business-profile`, merchantA).expect(404);
    await admin.query('UPDATE "Merchant" SET status=$1 WHERE id=$2', [
      'PENDING',
      merchantA.tenantId,
    ]);
    expect(await db.businessProfile.findMany()).toEqual([]);
    expect(
      await db.tenant(merchantA.id, merchantA.tenantId, (tx) =>
        tx.businessProfile.findFirst({ where: { tenantId: merchantB.tenantId } }),
      ),
    ).toBeNull();
    await expect(
      db.tenant(merchantA.id, merchantA.tenantId, (tx) =>
        tx.businessProfile.updateMany({
          where: { tenantId: merchantA.tenantId },
          data: { tenantId: merchantB.tenantId },
        }),
      ),
    ).rejects.toThrow();
    expect(await db.merchant.findMany()).toEqual([]);
    await expect(db.$executeRaw`UPDATE "AuditLog" SET action='FORGED'`).rejects.toThrow();
    await expect(
      db.userRole.create({
        data: { userId: merchantA.id, roleId: '00000000-0000-4000-8000-000000000001' },
      }),
    ).rejects.toThrow();
    const rls = await admin.query(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('Merchant','BusinessProfile','MerchantMembership','AuditLog')",
    );
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    await admin.query('UPDATE "MerchantMembership" SET status=$1 WHERE "userId"=$2', [
      'REVOKED',
      merchantA.id,
    ]);
    await get(`/merchants/${merchantA.tenantId}/business-profile`, merchantA).expect(404);
    await admin.query('UPDATE "MerchantMembership" SET status=$1 WHERE "userId"=$2', [
      'ACTIVE',
      merchantA.id,
    ]);
  });
  test('deny-by-default authorization, strict JWT validation and no session before MFA', async () => {
    await get('/auth/me').expect(401);
    await get('/super-admin/dashboard/metrics', merchantA).expect(403);
    const flow = await loginFlow(merchantA);
    expect(flow).not.toHaveProperty('accessToken');
    await post('/auth/mfa/challenge')
      .send({ challengeToken: flow.challengeToken, method: 'TOTP' })
      .expect(200);
    // The enrollment counter was already consumed; the same TOTP is rejected across challenges.
    await post('/auth/mfa/verify')
      .send({ challengeToken: flow.challengeToken, code: merchantA.totp!.generate() })
      .expect(401);
    await allowNewTotp(merchantA);
    const valid = await post('/auth/mfa/verify')
      .send({ challengeToken: flow.challengeToken, code: merchantA.totp!.generate() })
      .expect(200);
    Object.assign(merchantA, issued(valid));
    const jwt = new JwtService();
    const claims = jwt.decode(merchantA.access) as Record<string, unknown>;
    delete claims.iat;
    delete claims.exp;
    delete claims.aud;
    delete claims.iss;
    for (const options of [
      { expiresIn: -1 },
      { audience: 'wrong-audience' },
      { issuer: 'wrong-issuer' },
      { algorithm: 'HS256' },
    ]) {
      const token = jwt.sign(claims, {
        secret: process.env.JWT_ACCESS_SECRET!,
        algorithm: 'HS512',
        issuer: 'xelen-commerce',
        audience: 'xelen-api',
        expiresIn: 300,
        ...options,
        header: { typ: 'at+jwt', alg: options.algorithm ?? 'HS512' },
      } as Parameters<JwtService['sign']>[1]);
      await request(app.getHttpServer())
        .get(`${prefix}/auth/me`)
        .auth(token, { type: 'bearer' })
        .expect(401);
    }
  });
  test('HttpOnly refresh rotates, CSRF is enforced, reuse revokes the entire session', async () => {
    await loginTotp(merchantA);
    const old = { ...merchantA, cookies: [...merchantA.cookies] };
    await post('/auth/refresh').set('Cookie', old.cookies).send({}).expect(403);
    await post('/auth/refresh')
      .set('Cookie', old.cookies)
      .set('Origin', origin)
      .set('X-CSRF-Token', 'forged')
      .send({})
      .expect(403);
    const next = await post('/auth/refresh')
      .set('Cookie', old.cookies)
      .set('Origin', origin)
      .set('X-CSRF-Token', old.csrf)
      .send({})
      .expect(200);
    const setCookies = next.headers['set-cookie'] as unknown as string[];
    expect(setCookies.find((value) => value.startsWith('xelen_refresh='))).toContain('HttpOnly');
    expect(next.body.data).not.toHaveProperty('refreshToken');
    expect(cookiesFrom(next)).not.toEqual(old.cookies);
    const renewed = { ...merchantA, ...issued(next) };
    await get('/auth/me', renewed).expect(200);
    await post('/auth/refresh')
      .set('Cookie', old.cookies)
      .set('Origin', origin)
      .set('X-CSRF-Token', old.csrf)
      .send({})
      .expect(401);
    await get('/auth/me', renewed).expect(401);
    expect(await db.auditLog.count()).toBe(0); // audit RLS requires explicit context
    const audit = await admin.query(
      'SELECT action FROM "AuditLog" WHERE "actorId"=$1 AND action=$2',
      [merchantA.id, 'REFRESH_REUSE_DETECTED'],
    );
    expect(audit.rowCount).toBe(1);
    await loginTotp(merchantA);
  });
  test('SMS enrollment validates E.164, hashes codes, enforces cooldown, expiry and single-use', async () => {
    const sms = await pending();
    await post('/auth/mfa/challenge')
      .send({ challengeToken: sms.challengeToken, method: 'SMS', phone: '+1000' })
      .expect(400);
    const sent = await post('/auth/mfa/challenge')
      .send({ challengeToken: sms.challengeToken, method: 'SMS', phone: '+14155552671' })
      .expect(200);
    expect(sent.body.data.maskedDestination).toBe('••••2671');
    const firstCode = delivery.messages.at(-1)!.code;
    const challenge = await db.mfaChallenge.findUniqueOrThrow({
      where: { tokenHash: crypto.digest('challenge', sms.challengeToken) },
    });
    expect(challenge.otpHash).not.toBe(firstCode);
    expect(challenge.otpHash).not.toContain(firstCode);
    await post('/auth/mfa/resend').send({ challengeToken: sms.challengeToken }).expect(429);
    await db.mfaChallenge.update({
      where: { id: challenge.id },
      data: { lastSentAt: new Date(Date.now() - 46000) },
    });
    await post('/auth/mfa/resend').send({ challengeToken: sms.challengeToken }).expect(200);
    const code = delivery.messages.at(-1)!.code;
    await db.mfaChallenge.update({
      where: { id: challenge.id },
      data: { otpExpiresAt: new Date(Date.now() - 1000) },
    });
    await post('/auth/mfa/verify').send({ challengeToken: sms.challengeToken, code }).expect(401);
    await db.mfaChallenge.update({
      where: { id: challenge.id },
      data: { otpExpiresAt: new Date(Date.now() + 60000) },
    });
    const verified = await post('/auth/mfa/verify')
      .send({ challengeToken: sms.challengeToken, code })
      .expect(200);
    expect(verified.body.data.accessToken).toBeTruthy();
    await post('/auth/mfa/verify').send({ challengeToken: sms.challengeToken, code }).expect(401);
    const flow = await loginFlow(sms);
    await post('/auth/mfa/challenge')
      .send({ challengeToken: flow.challengeToken, method: 'SMS', phone: '+442079460123' })
      .expect(400);
    await post('/auth/mfa/challenge')
      .send({ challengeToken: flow.challengeToken, method: 'SMS' })
      .expect(200);
    for (let count = 0; count < 5; count++)
      await post('/auth/mfa/verify')
        .send({ challengeToken: flow.challengeToken, code: '00000x' })
        .expect(401);
    await post('/auth/mfa/verify')
      .send({ challengeToken: flow.challengeToken, code: delivery.messages.at(-1)!.code })
      .expect(401);
  });
  test('password reset is generic, expiring, hashed, single-use and revokes every session', async () => {
    const actual = await post('/auth/forgot-password').send({ email: merchantB.email }).expect(202);
    expect(
      (await post('/auth/forgot-password').send({ email: 'absent@example.test' }).expect(202)).body
        .data,
    ).toEqual(actual.body.data);
    await deliverAll();
    const token = delivery.token(merchantB.email, 'reset-password');
    const stored = await db.userToken.findUniqueOrThrow({
      where: { tokenHash: crypto.digest('password-reset', token) },
    });
    expect(stored.tokenHash).not.toBe(token);
    const newPassword = 'Changed-password2!';
    await post('/auth/reset-password')
      .send({ token, password: 'weak', confirmPassword: 'weak' })
      .expect(400);
    await db.userToken.update({
      where: { id: stored.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await post('/auth/reset-password')
      .send({ token, password: newPassword, confirmPassword: newPassword })
      .expect(401);
    await db.userToken.update({
      where: { id: stored.id },
      data: { expiresAt: new Date(Date.now() + 60000) },
    });
    await post('/auth/reset-password')
      .send({ token, password: newPassword, confirmPassword: newPassword })
      .expect(200);
    await post('/auth/reset-password')
      .send({ token, password: newPassword, confirmPassword: newPassword })
      .expect(401);
    await get('/auth/me', merchantB).expect(401);
    await post('/auth/login').send({ email: merchantB.email, password }).expect(401);
    const user = await db.user.findUniqueOrThrow({ where: { id: merchantB.id } });
    expect(await app.get(PasswordService).verify(user.passwordHash, newPassword)).toBe(true);
  });
  test('recovery codes are single-use; sensitive MFA enrollment requires fresh password and factor', async () => {
    const code = merchantA.recoveryCodes[0]; // a later login response does not return recovery codes
    const storedCodes = await db.recoveryCode.count({
      where: { userId: merchantA.id, usedAt: null },
    });
    expect(storedCodes).toBe(10);
    expect(code).toBeUndefined(); // no secret recovery codes re-disclosed during login
    const grant = await reauth(merchantA);
    const generated = await post('/auth/mfa/recovery-codes')
      .auth(merchantA.access, { type: 'bearer' })
      .send({ reauthToken: grant })
      .expect(200);
    const recoveryCode = generated.body.data.recoveryCodes[0] as string;
    await post('/auth/mfa/recovery-codes')
      .auth(merchantA.access, { type: 'bearer' })
      .send({ reauthToken: grant })
      .expect(403);
    const flow = await loginFlow(merchantA);
    await post('/auth/mfa/challenge')
      .send({ challengeToken: flow.challengeToken, method: 'RECOVERY' })
      .expect(200);
    const result = await post('/auth/mfa/verify')
      .send({ challengeToken: flow.challengeToken, code: recoveryCode })
      .expect(200);
    Object.assign(merchantA, issued(result));
    const replay = await loginFlow(merchantA);
    await post('/auth/mfa/challenge')
      .send({ challengeToken: replay.challengeToken, method: 'RECOVERY' })
      .expect(200);
    await post('/auth/mfa/verify')
      .send({ challengeToken: replay.challengeToken, code: recoveryCode })
      .expect(401);
    await post('/auth/mfa/enrollment')
      .auth(merchantA.access, { type: 'bearer' })
      .send({ reauthToken: randomBytes(32).toString('base64url') })
      .expect(403);
    const renewed = await reauth(merchantA);
    const enrollment = await post('/auth/mfa/enrollment')
      .auth(merchantA.access, { type: 'bearer' })
      .send({ reauthToken: renewed })
      .expect(200);
    const setup = await post('/auth/mfa/totp/setup')
      .send({ challengeToken: enrollment.body.data.challengeToken })
      .expect(200);
    expect(setup.body.data.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });
  test('MFA changes require a single-use reauthentication grant and revoke sessions on removal', async () => {
    const grant = await reauth(merchantA);
    await post('/auth/mfa/remove')
      .auth(merchantA.access, { type: 'bearer' })
      .send({ reauthToken: grant, method: 'TOTP' })
      .expect(409);
    const enrollment = await post('/auth/mfa/enrollment')
      .auth(merchantA.access, { type: 'bearer' })
      .send({ reauthToken: grant })
      .expect(200);
    const challengeToken = enrollment.body.data.challengeToken as string;
    await post('/auth/mfa/challenge')
      .send({ challengeToken, method: 'SMS', phone: '+14155552671' })
      .expect(200);
    const added = await post('/auth/mfa/verify')
      .send({ challengeToken, code: delivery.messages.at(-1)!.code })
      .expect(200);
    expect(added.body.data.status).toBe('MFA_ENROLLED');
    expect(added.body.data.accessToken).toBeUndefined();
    const removalGrant = await reauth(merchantA);
    await post('/auth/mfa/remove')
      .auth(merchantA.access, { type: 'bearer' })
      .send({ reauthToken: removalGrant, method: 'SMS' })
      .expect(200);
    await get('/auth/me', merchantA).expect(401);
    await loginTotp(merchantA);
  });
  test('database constraints reject cross-tenant references, invalid role scope and non-normalized emails', async () => {
    await expect(
      admin.query(
        'INSERT INTO "BusinessProfile" (id,"tenantId","businessName",industry,"updatedAt") VALUES ($1,$2,$3,$4,now())',
        [randomUUID(), randomUUID(), 'Orphan', 'Other'],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin.query(
        'INSERT INTO "BusinessProfile" (id,"tenantId","businessName",industry,"otherIndustry","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
        [randomUUID(), randomUUID(), 'Orphan', 'Other', 'Description'],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      admin.query('UPDATE "MerchantMembership" SET "roleId"=$1 WHERE "userId"=$2', [
        '00000000-0000-4000-8000-000000000001',
        merchantA.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin.query('UPDATE "User" SET email=$1 WHERE id=$2', ['UPPER@EXAMPLE.TEST', merchantA.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin.query('UPDATE "User" SET email=$1 WHERE id=$2', [merchantA.email, merchantB.id]),
    ).rejects.toMatchObject({ code: '23505' });
  });
  test('Super Admin uses TOTP, audited platform access, real counts and unavailable financial sources', async () => {
    superAdmin = await pending();
    await admin.query('INSERT INTO "UserRole" ("userId","roleId") VALUES ($1,$2)', [
      superAdmin.id,
      '00000000-0000-4000-8000-000000000001',
    ]);
    await post('/auth/mfa/challenge')
      .send({ challengeToken: superAdmin.challengeToken, method: 'SMS', phone: '+14155552671' })
      .expect(403);
    const setup = await post('/auth/mfa/totp/setup')
      .send({ challengeToken: superAdmin.challengeToken })
      .expect(200);
    superAdmin.totp = OTPAuth.URI.parse(setup.body.data.otpauthUri) as OTPAuth.TOTP;
    const verified = await post('/auth/mfa/totp/confirm')
      .send({ challengeToken: superAdmin.challengeToken, code: superAdmin.totp.generate() })
      .expect(200);
    Object.assign(superAdmin, issued(verified));
    const metrics = await get('/super-admin/dashboard/metrics', superAdmin).expect(200);
    expect(metrics.body.data.platformGmv).toMatchObject({
      availability: 'unavailable',
      value: null,
    });
    expect(metrics.body.data.activeMerchants.value).toBe(0);
    for (const section of [
      'overview',
      'gmv',
      'payment-health',
      'risk-alerts',
      'settlements',
      'merchant-activity',
    ])
      await get(`/super-admin/dashboard/${section}`, superAdmin).expect(200);
    await admin.query('UPDATE "Merchant" SET status=$1 WHERE id=$2', [
      'ACTIVE',
      merchantA.tenantId,
    ]);
    const actualMetrics = await get('/super-admin/dashboard/metrics', superAdmin).expect(200);
    expect(actualMetrics.body.data.activeMerchants.value).toBe(1);
    await get('/operations/metrics', merchantA).expect(403);
    const activity = await get(
      '/super-admin/dashboard/merchant-activity?pageSize=1&sort=name&direction=asc',
      superAdmin,
    ).expect(200);
    expect(activity.body.data.items).toHaveLength(1);
    expect(activity.body.data.pagination.total).toBeGreaterThan(1);
    expect(activity.body.data.items[0].plan).toBeNull();
    await get(
      '/super-admin/dashboard/metrics?period=custom&start=2026-02-30&end=2026-03-01',
      superAdmin,
    ).expect(400);
    await get('/super-admin/dashboard/merchant-activity?pageSize=101', superAdmin).expect(400);
    await get('/super-admin/dashboard/merchant-activity?sort=unsafe', superAdmin).expect(400);
    expect((await get('/auth/me', superAdmin).expect(200)).body.data.roles).toContain(
      'SUPER_ADMIN',
    );
    const operations = await get('/operations/metrics', superAdmin).expect(200);
    expect(operations.body.data.requests).toBeGreaterThan(0);
    const audits = await admin.query(
      'SELECT id FROM "AuditLog" WHERE "actorId"=$1 AND action LIKE $2',
      [superAdmin.id, 'PLATFORM_DASHBOARD_%'],
    );
    expect(audits.rowCount).toBeGreaterThan(7);
    const flow = await loginFlow(superAdmin);
    await post('/auth/mfa/challenge')
      .send({ challengeToken: flow.challengeToken, method: 'RECOVERY' })
      .expect(200);
    const recovered = await post('/auth/mfa/verify')
      .send({ challengeToken: flow.challengeToken, code: superAdmin.recoveryCodes[0] })
      .expect(200);
    await get('/super-admin/dashboard/metrics', { ...superAdmin, ...issued(recovered) }).expect(
      403,
    );
  });
  test('encrypted outbox retries provider failures without delaying or exposing registration', async () => {
    const email = `outbox-${randomUUID()}@example.test`;
    delivery.failEmail = true;
    await post('/auth/register').send({ email, password, confirmPassword: password }).expect(202);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const job = await db.emailOutbox.findFirstOrThrow({ where: { userId: user.id } });
    expect(job.payloadCipher).not.toContain(email);
    await app.get(EmailOutboxService).dispatchOne();
    const failed = await db.emailOutbox.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAt.valueOf()).toBeGreaterThan(Date.now());
    delivery.failEmail = false;
    await db.emailOutbox.update({
      where: { id: job.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await app.get(EmailOutboxService).dispatchOne();
    expect(await db.emailOutbox.findUnique({ where: { id: job.id } })).toBeNull();
    expect(delivery.token(email, 'verify-email')).toHaveLength(43);
  });
  test('atomic rate limiting and session revocation', async () => {
    const limiter = app.get(RateLimiter);
    const key = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => limiter.hit('test', key, 3, 60)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    await loginTotp(merchantA);
    const first = merchantA.access;
    await loginTotp(merchantA);
    await post('/auth/logout-all').auth(merchantA.access, { type: 'bearer' }).send({}).expect(200);
    await get('/auth/me', merchantA).expect(401);
    await get('/auth/me', { ...merchantA, access: first }).expect(401);
  });
});
