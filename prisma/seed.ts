import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
if (process.env.NODE_ENV !== 'development')
  throw new Error('Development fixtures are disabled outside NODE_ENV=development.');
const url = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) ||
  !url.pathname.endsWith('_dev')
)
  throw new Error('Seeds require a local _dev database.');
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  // No passwords, administrator accounts, financial transactions, or fabricated financial totals.
  for (const name of [
    '[DEVELOPMENT FIXTURE] Northwind Demo',
    '[DEVELOPMENT FIXTURE] Orchard Demo',
  ]) {
    const exists = await client.query('SELECT id FROM "Merchant" WHERE name=$1', [name]);
    if (!exists.rowCount)
      await client.query(
        'INSERT INTO "Merchant" (id,name,status,"createdAt","updatedAt") VALUES ($1,$2,$3,now(),now())',
        [randomUUID(), name, 'PENDING'],
      );
  }
  console.log(
    'Seeded two explicitly labeled development merchants; no login credentials or financial fixtures.',
  );
} finally {
  await client.end();
}
