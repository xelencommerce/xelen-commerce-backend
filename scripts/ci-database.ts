import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
if (process.env.CI !== 'true') throw new Error('Ephemeral CI bootstrap only.');
const connection = new URL(process.env.CI_POSTGRES_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(connection.hostname))
  throw new Error('CI bootstrap only accepts a local PostgreSQL service.');
const password = randomBytes(24).toString('hex');
const admin = new pg.Client({ connectionString: connection.toString() });
await admin.connect();
try {
  await admin.query(
    `CREATE ROLE xelen_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`,
  );
  for (const name of ['xelen_dev', 'xelen_test']) {
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${name} TO xelen_app`);
  }
} finally {
  await admin.end();
}
const url = (database: string, app = false) => {
  const target = new URL(connection);
  target.pathname = `/${database}`;
  if (app) {
    target.username = 'xelen_app';
    target.password = password;
  }
  return target.toString();
};
const values: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: url('xelen_dev', true),
  MIGRATION_DATABASE_URL: url('xelen_dev'),
  TEST_DATABASE_URL: url('xelen_test', true),
  TEST_MIGRATION_DATABASE_URL: url('xelen_test'),
  JWT_ACCESS_SECRET: randomBytes(64).toString('base64url'),
  JWT_REFRESH_SECRET: randomBytes(64).toString('base64url'),
  TOKEN_HASH_SECRET: randomBytes(64).toString('base64url'),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
const content = readFileSync('.env.example', 'utf8')
  .split('\n')
  .map((line) => {
    const key = line.split('=')[0] ?? '';
    return key in values ? `${key}=${values[key]}` : line;
  })
  .join('\n');
writeFileSync('.env', content, { mode: 0o600 });
console.log('Configured isolated ephemeral CI databases.');
