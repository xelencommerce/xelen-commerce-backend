import { randomBytes } from 'node:crypto';
import { parseEnvironment, Configuration } from '../../src/config/environment.js';
import { cookieOptions } from '../../src/common/middleware/browser-security.js';
import { CryptoService } from '../../src/infrastructure/security/crypto.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { dashboardRange } from '../../src/modules/super-admin/dashboard.service.js';
import { DashboardQueryDto } from '../../src/modules/super-admin/dto/dashboard-query.dto.js';
const environment = () => ({
  DATABASE_URL: 'postgresql://xelen_app:local@127.0.0.1/xelen_test',
  JWT_ACCESS_SECRET: randomBytes(64).toString('hex'),
  JWT_REFRESH_SECRET: randomBytes(64).toString('hex'),
  TOKEN_HASH_SECRET: randomBytes(64).toString('hex'),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});
describe('Security primitives', () => {
  test('rejects reused keys, weak keys, wildcard CORS and insecure production configuration', () => {
    const valid = environment();
    expect(parseEnvironment(valid).PORT).toBe(4000);
    for (const patch of [
      { JWT_ACCESS_SECRET: 'weak' },
      { JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET },
      { CORS_ORIGINS: '*' },
      { NODE_ENV: 'production' },
      { MFA_ENCRYPTION_KEY: 'bad' },
      { COOKIE_SAME_SITE: 'none' },
    ])
      expect(() => parseEnvironment({ ...valid, ...patch })).toThrow('Invalid environment');
  });
  test('secure deployments require verified DB TLS and use host-only HttpOnly refresh cookies', () => {
    const values = {
      ...environment(),
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://xelen_app:local@db.example.test/xelen?sslmode=verify-full',
      FRONTEND_URL: 'https://app.example.test',
      CORS_ORIGINS: 'https://app.example.test',
      EMAIL_PROVIDER: 'smtp',
      DOCS_ENABLED: 'false',
    };
    const parsed = parseEnvironment(values);
    const config = Object.create(Configuration.prototype) as Configuration;
    Object.defineProperty(config, 'values', { value: parsed });
    expect(config.refreshCookie).toBe('__Host-xelen_refresh');
    expect(cookieOptions(config)).toMatchObject({
      secure: true,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    });
    expect(cookieOptions(config)).not.toHaveProperty('domain');
    expect(() =>
      parseEnvironment({
        ...values,
        DATABASE_URL: 'postgresql://xelen_app:local@db.example.test/xelen',
      }),
    ).toThrow('sslmode=verify-full');
  });
  test('encrypts with authenticated, randomized ciphertext and detects tampering', () => {
    const crypto = new CryptoService({ values: parseEnvironment(environment()) } as Configuration);
    const secret = randomBytes(20).toString('hex');
    const encrypted = crypto.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(crypto.encrypt(secret)).not.toBe(encrypted);
    expect(crypto.decrypt(encrypted)).toBe(secret);
    const pieces = encrypted.split('.');
    pieces[3] = Buffer.from('tampered').toString('base64url');
    expect(() => crypto.decrypt(pieces.join('.'))).toThrow();
    expect(crypto.digest('reset', secret)).not.toBe(crypto.digest('refresh', secret));
    expect(crypto.equal('short', 'longer')).toBe(false);
    const csrf = crypto.csrf();
    expect(crypto.validCsrf(csrf)).toBe(true);
    expect(crypto.validCsrf(`${csrf}x`)).toBe(false);
    expect(crypto.validCsrf(`${csrf}.suffix`)).toBe(false);
  });
  test('hashes with Argon2id and safely verifies unknown users', async () => {
    const service = new PasswordService();
    await service.onModuleInit();
    const hash = await service.hash('Example-password1!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await service.verify(hash, 'Example-password1!')).toBe(true);
    expect(await service.verify(hash, 'wrong')).toBe(false);
    expect(await service.verify(null, 'wrong')).toBe(false);
  });
});
describe('UTC dashboard ranges', () => {
  const now = new Date('2026-03-02T22:00:00Z');
  test.each([
    ['today', '2026-03-02'],
    ['weekly', '2026-02-24'],
    ['monthly', '2026-02-01'],
  ] as const)('%s has an inclusive UTC calendar boundary', (period, start) => {
    const result = dashboardRange(Object.assign(new DashboardQueryDto(), { period }), now);
    expect(result.start).toBe(start);
    expect(result.until.toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });
  test.each([
    { period: 'custom', start: '2026-02-30', end: '2026-03-02' },
    { period: 'custom', start: '2026-03-02', end: '2026-03-01' },
    { period: 'custom', start: '2024-01-01', end: '2026-01-01' },
    { period: 'custom' },
    { start: '2026-03-01' },
  ])('rejects invalid or ambiguous ranges %j', (patch) => {
    expect(() => dashboardRange(Object.assign(new DashboardQueryDto(), patch), now)).toThrow();
  });
});
