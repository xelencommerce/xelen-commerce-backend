import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
if (!process.env.DATABASE_URL || !process.env.MIGRATION_DATABASE_URL)
  throw new Error('Run npm run local:init first.');
const runtime = new URL(process.env.DATABASE_URL);
const migrator = new URL(process.env.MIGRATION_DATABASE_URL);
const dockerUrl = (value: URL, database: string) => {
  const url = new URL(value);
  url.hostname = 'postgres';
  url.port = '5432';
  url.pathname = `/${database}`;
  return url.toString();
};
const values: Record<string, string> = {
  DATABASE_URL: dockerUrl(runtime, 'xelen_dev'),
  MIGRATION_DATABASE_URL: dockerUrl(migrator, 'xelen_dev'),
  TEST_DATABASE_URL: dockerUrl(runtime, 'xelen_test'),
  TEST_MIGRATION_DATABASE_URL: dockerUrl(migrator, 'xelen_test'),
  HOST: '0.0.0.0',
  SMTP_HOST: 'mailpit',
  SMTP_PORT: '1025',
  EMAIL_PROVIDER: 'smtp',
};
const lines = readFileSync('.env', 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('HOST='))
  .map((line) => {
    const key = line.split('=')[0] ?? '';
    return key in values ? `${key}=${values[key]}` : line;
  });
lines.push(
  'HOST=0.0.0.0',
  `POSTGRES_USER=${migrator.username}`,
  `POSTGRES_PASSWORD=${migrator.password}`,
  `APP_DATABASE_PASSWORD=${runtime.password}`,
);
writeFileSync('.env.docker', lines.join('\n') + '\n', { mode: 0o600 });
console.log('Created ignored .env.docker for isolated local containers. No secrets printed.');
