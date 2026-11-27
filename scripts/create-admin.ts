import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { Configuration } from '../src/config/environment.js';
import { CryptoService } from '../src/infrastructure/security/crypto.service.js';
import { DeliveryService } from '../src/infrastructure/email/delivery.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
// Explicit operator-only command. The web application's DB role cannot assign platform roles.
// Input through environment, never CLI arguments or a checked-in credential.
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error('Set ADMIN_EMAIL to the authorized operator email.');
const config = new Configuration();
const delivery = new DeliveryService(config);
delivery.requireEmail();
const crypto = new CryptoService(config);
const token = crypto.token();
const id = randomUUID();
const passwordHash = await new PasswordService().hash(randomBytes(64).toString('base64url'));
const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error('An explicitly authorized migration connection is required.');
await client.connect();
try {
  await client.query('BEGIN');
  // Never silently promote an existing customer account.
  await client.query(
    'INSERT INTO "User" (id,email,"passwordHash","emailVerifiedAt","createdAt","updatedAt") VALUES ($1,$2,$3,now(),now(),now())',
    [id, email, passwordHash],
  );
  await client.query(
    'INSERT INTO "UserRole" ("userId","roleId") SELECT $1,id FROM "Role" WHERE name=$2',
    [id, 'SUPER_ADMIN'],
  );
  await client.query(
    'INSERT INTO "UserToken" (id,"userId",purpose,"tokenHash","expiresAt") VALUES ($1,$2,$3,$4,$5)',
    [
      randomUUID(),
      id,
      'PASSWORD_RESET',
      crypto.digest('password-reset', token),
      new Date(Date.now() + 15 * 60000),
    ],
  );
  await client.query('INSERT INTO "AuditLog" (id,"actorId",action) VALUES ($1,$2,$3)', [
    randomUUID(),
    id,
    'SUPER_ADMIN_PROVISIONED_BY_OPERATOR',
  ]);
  await client.query('COMMIT');
  await delivery.email(email, 'reset-password', token);
  console.log(
    'Operator created. A short-lived password setup email was sent; TOTP enrollment is mandatory at first login.',
  );
} catch (error) {
  await client.query('ROLLBACK');
  // Do not print provider errors, DB URLs, tokens, or secrets.
  console.error(
    'Operator provisioning or delivery failed. No existing account was promoted. Use the password-reset flow if the account was created.',
  );
  process.exitCode = 1;
  void error;
} finally {
  await client.end();
}
