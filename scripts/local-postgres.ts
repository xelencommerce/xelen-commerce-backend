import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging')
  throw new Error('Local database bootstrap is disabled outside development/test.');
const owner = new URL(process.env.MIGRATION_DATABASE_URL ?? '').username;
if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(owner))
  throw new Error('Use a valid local migration role name.');
const root = resolve('.local');
const data = resolve(root, 'pgdata');
const socket = resolve(root, 'socket');
mkdirSync(root, { recursive: true });
mkdirSync(socket, { recursive: true });
if (!existsSync(resolve(data, 'PG_VERSION')))
  execFileSync(
    'initdb',
    [
      '-D',
      data,
      '--auth-local=trust',
      '--auth-host=scram-sha-256',
      '--encoding=UTF8',
      `--username=${owner}`,
    ],
    { stdio: 'ignore' },
  );
try {
  execFileSync('pg_ctl', ['-D', data, 'status'], { stdio: 'ignore' });
} catch {
  execFileSync(
    'pg_ctl',
    [
      '-D',
      data,
      '-l',
      resolve(root, 'postgres.log'),
      '-o',
      `-p 55432 -h 127.0.0.1 -k ${socket}`,
      'start',
    ],
    { stdio: 'ignore' },
  );
}
const admin = new pg.Client({ host: socket, port: 55432, user: owner, database: 'postgres' });
await admin.connect();
const password = new URL(process.env.DATABASE_URL ?? '').password;
const migrationPassword = new URL(process.env.MIGRATION_DATABASE_URL ?? '').password;
if (!/^[a-f0-9]{48}$/.test(migrationPassword))
  throw new Error('Use a generated migration password for local bootstrap.');
await admin.query(`ALTER ROLE "${owner}" PASSWORD '${migrationPassword}'`);
if (!/^[a-f0-9]{48}$/.test(password))
  throw new Error('Use the generated local database password for bootstrap.');
// Role/database identifiers are fixed; the validated generated secret is never logged.
await admin.query(
  `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='xelen_app') THEN CREATE ROLE xelen_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'; END IF; END $$`,
);
for (const name of ['xelen_dev', 'xelen_test']) {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE ${name}`);
  await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${name} TO xelen_app`);
}
await admin.end();
console.log(
  'Dedicated local PostgreSQL cluster is ready on 127.0.0.1:55432. Existing databases on port 5432 were not modified.',
);
