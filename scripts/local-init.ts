import { userInfo } from 'node:os';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('Existing .env preserved.');
} else {
  const localOwner = encodeURIComponent(userInfo().username);
  const password = randomBytes(24).toString('hex');
  const migrationPassword = randomBytes(24).toString('hex');
  const values: Record<string, string> = {
    DATABASE_URL: `postgresql://xelen_app:${password}@127.0.0.1:55432/xelen_dev`,
    MIGRATION_DATABASE_URL: `postgresql://${localOwner}:${migrationPassword}@127.0.0.1:55432/xelen_dev`,
    TEST_DATABASE_URL: `postgresql://xelen_app:${password}@127.0.0.1:55432/xelen_test`,
    TEST_MIGRATION_DATABASE_URL: `postgresql://${localOwner}:${migrationPassword}@127.0.0.1:55432/xelen_test`,
    JWT_ACCESS_SECRET: randomBytes(64).toString('base64url'),
    JWT_REFRESH_SECRET: randomBytes(64).toString('base64url'),
    TOKEN_HASH_SECRET: randomBytes(64).toString('base64url'),
    MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
  const content = readFileSync('.env.example', 'utf8')
    .split('\n')
    .map((line) => {
      const key = line.split('=')[0] ?? '';
      return values[key] ? `${key}=${values[key]}` : line;
    })
    .join('\n');
  writeFileSync('.env', content, { mode: 0o600, flag: 'wx' });
  console.log('Created .env with generated local-only secrets. No credentials were printed.');
}
