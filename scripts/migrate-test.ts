import 'dotenv/config';
import { execFileSync } from 'node:child_process';
const url = new URL(process.env.TEST_MIGRATION_DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) ||
  url.pathname !== '/xelen_test'
)
  throw new Error('Only the isolated local xelen_test database is permitted.');
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, MIGRATION_DATABASE_URL: url.toString() },
});
