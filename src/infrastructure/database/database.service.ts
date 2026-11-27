import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { Configuration } from '../../config/environment.js';
import { ApiError } from '../../common/exceptions/api-error.js';
import type { AuthenticatedUser } from '../../types/auth.js';
export type Transaction = Prisma.TransactionClient;
@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: Configuration) {
    super({
      adapter: new PrismaPg({
        connectionString: config.values.DATABASE_URL,
        max: config.values.DB_POOL_MAX,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      }),
    });
  }
  async onModuleInit() {
    await this.$connect();
    const roles = await this.$queryRaw<
      { unsafe: boolean }[]
    >`SELECT (rolsuper OR rolbypassrls) AS unsafe FROM pg_roles WHERE rolname = current_user`;
    const owned = await this.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`;
    if (!roles[0] || roles[0].unsafe || Number(owned[0]?.count) > 0)
      throw new Error(
        'Unsafe database role: use a non-owner, non-superuser, NOBYPASSRLS application role.',
      );
    const policies = await this.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('Merchant', 'MerchantMembership', 'BusinessProfile', 'AuditLog') AND relrowsecurity AND relforcerowsecurity`;
    if (Number(policies[0]?.count) !== 4)
      throw new Error('Required tenant RLS migrations have not been applied.');
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  actor<T>(userId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.context(userId, null, false, work);
  }
  /** Consistent per-user lock order for password, MFA, refresh and revocation transitions. */
  auth<T>(userId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.actor(userId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      return work(tx);
    });
  }
  tenant<T>(userId: string, tenantId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.context(userId, tenantId, false, work);
  }
  private context<T>(
    userId: string,
    tenantId: string | null,
    platform: boolean,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.actor_id', ${userId}, true), set_config('app.tenant_id', ${tenantId ?? ''}, true), set_config('app.platform_access', ${platform ? 'true' : 'false'}, true)`;
        return work(tx);
      },
      { maxWait: 5000, timeout: 15000 },
    );
  }
  async platform<T>(
    principal: AuthenticatedUser,
    action: string,
    requestId: string,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.context(principal.userId, null, true, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${principal.userId}::uuid FOR UPDATE`;
      const session = await tx.session.findFirst({
        where: {
          id: principal.sessionId,
          userId: principal.userId,
          mfaKind: 'TOTP',
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
        },
      });
      const role = await tx.userRole.findFirst({
        where: {
          userId: principal.userId,
          role: {
            name: 'SUPER_ADMIN',
            scope: 'PLATFORM',
            permissions: { some: { permission: { key: 'platform.dashboard.read' } } },
          },
        },
      });
      if (!session || !role || principal.mfaKind !== 'TOTP')
        throw new ApiError(
          403,
          'FORBIDDEN',
          'Super Admin access requires an authorized TOTP session.',
        );
      await tx.auditLog.create({ data: { actorId: principal.userId, action, requestId } });
      return work(tx);
    });
  }
}
