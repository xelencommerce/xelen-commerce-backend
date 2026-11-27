import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { Configuration } from '../../config/environment.js';
import { CryptoService } from '../../infrastructure/security/crypto.service.js';
import {
  DatabaseService,
  type Transaction,
} from '../../infrastructure/database/database.service.js';
import { ApiError, invalidCredentials } from '../../common/exceptions/api-error.js';
import type { AuthenticatedUser, RequestContext } from '../../types/auth.js';
import type { FactorKind } from '../../generated/prisma/client.js';
export interface AuthenticationResult {
  data: Record<string, unknown>;
  refresh?: { token: string; expiresAt: Date };
}
interface TokenClaims {
  sub: string;
  sid: string;
  jti: string;
  purpose: 'access' | 'refresh';
  exp: number;
  iat: number;
}
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: Configuration,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
  ) {}
  private async sign(
    userId: string,
    sessionId: string,
    id: string,
    purpose: 'access' | 'refresh',
    expiresAt?: Date,
  ): Promise<string> {
    const env = this.config.values;
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId, jti: id, purpose },
      {
        secret: purpose === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET,
        algorithm: 'HS512',
        issuer: env.JWT_ISSUER,
        audience: purpose === 'access' ? env.JWT_AUDIENCE : `${env.JWT_AUDIENCE}:refresh`,
        expiresIn:
          purpose === 'access'
            ? env.JWT_ACCESS_TTL
            : Math.max(1, Math.floor(((expiresAt?.valueOf() ?? 0) - Date.now()) / 1000)),
        header: { alg: 'HS512', typ: purpose === 'access' ? 'at+jwt' : 'rt+jwt' },
      },
    );
  }
  private async claims(token: string, purpose: 'access' | 'refresh'): Promise<TokenClaims> {
    try {
      const env = this.config.values;
      const decoded = this.jwt.decode(token, { complete: true }) as {
        header?: { typ?: string };
      } | null;
      if (decoded?.header?.typ !== (purpose === 'access' ? 'at+jwt' : 'rt+jwt')) throw new Error();
      const payload = await this.jwt.verifyAsync<TokenClaims>(token, {
        secret: purpose === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET,
        algorithms: ['HS512'],
        issuer: env.JWT_ISSUER,
        audience: purpose === 'access' ? env.JWT_AUDIENCE : `${env.JWT_AUDIENCE}:refresh`,
      });
      if (
        typeof payload.exp !== 'number' ||
        typeof payload.iat !== 'number' ||
        payload.exp <= payload.iat ||
        payload.iat > Date.now() / 1000 + 60 ||
        payload.purpose !== purpose ||
        ![payload.sub, payload.sid, payload.jti].every(
          (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
        )
      )
        throw new Error();
      return payload;
    } catch {
      throw invalidCredentials();
    }
  }
  async principal(userId: string, sessionId: string): Promise<AuthenticatedUser> {
    const session = await this.db.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
      },
      include: {
        user: {
          include: {
            platformRoles: {
              include: { role: { include: { permissions: { include: { permission: true } } } } },
            },
          },
        },
      },
    });
    if (!session) throw invalidCredentials();
    return {
      userId,
      sessionId,
      email: session.user.email,
      mfaKind: session.mfaKind,
      roles: session.user.platformRoles.map((item) => item.role.name),
      permissions: [
        ...new Set(
          session.user.platformRoles.flatMap((item) =>
            item.role.permissions.map((permission) => permission.permission.key),
          ),
        ),
      ],
    };
  }
  async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    const claims = await this.claims(accessToken, 'access');
    return this.principal(claims.sub, claims.sid);
  }
  async me(principal: AuthenticatedUser) {
    const memberships = await this.db.actor(principal.userId, (tx) =>
      tx.merchantMembership.findMany({
        where: { userId: principal.userId, status: 'ACTIVE' },
        select: {
          tenantId: true,
          role: {
            select: {
              name: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      }),
    );
    return {
      id: principal.userId,
      email: principal.email,
      roles: principal.roles,
      permissions: principal.permissions,
      memberships: memberships.map((item) => ({
        tenantId: item.tenantId,
        role: item.role.name,
        permissions: item.role.permissions.map((permission) => permission.permission.key),
      })),
      dashboard: principal.roles.includes('SUPER_ADMIN') ? '/admin/master-dashboard' : '/merchant',
      mfaVerified: true,
    };
  }
  async issue(
    tx: Transaction,
    userId: string,
    mfaKind: FactorKind,
    remember: boolean,
    context: RequestContext,
  ): Promise<AuthenticationResult> {
    const expiresAt = new Date(
      Date.now() +
        (remember ? this.config.values.JWT_REMEMBER_TTL : this.config.values.JWT_REFRESH_TTL) *
          1000,
    );
    const session = await tx.session.create({
      data: {
        userId,
        mfaKind,
        expiresAt,
        ipHash: this.crypto.digest('ip', context.ip),
        userAgent: context.userAgent.slice(0, 200),
      },
    });
    await tx.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE', failedLogins: 0, lockedUntil: null },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'SESSION_CREATED',
        entityId: session.id,
        requestId: context.requestId,
      },
    });
    const tokens = await this.rotateInto(tx, userId, session.id, expiresAt);
    return tokens;
  }
  private async rotateInto(
    tx: Transaction,
    userId: string,
    sessionId: string,
    expiresAt: Date,
  ): Promise<AuthenticationResult> {
    const id = randomUUID();
    const refresh = await this.sign(userId, sessionId, id, 'refresh', expiresAt);
    await tx.refreshToken.create({
      data: { id, sessionId, tokenHash: this.crypto.digest('refresh', refresh), expiresAt },
    });
    return {
      data: {
        status: 'AUTHENTICATED',
        accessToken: await this.sign(userId, sessionId, randomUUID(), 'access'),
        tokenType: 'Bearer',
        expiresIn: this.config.values.JWT_ACCESS_TTL,
      },
      refresh: { token: refresh, expiresAt },
    };
  }
  async refresh(raw: string): Promise<AuthenticationResult> {
    const claims = await this.claims(raw, 'refresh');
    const result = await this.db.auth(claims.sub, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${claims.sid}::uuid FOR UPDATE`;
      const session = await tx.session.findUnique({
        where: { id: claims.sid },
        include: { user: true },
      });
      if (
        !session ||
        session.userId !== claims.sub ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        session.user.status !== 'ACTIVE' ||
        !session.user.emailVerifiedAt
      )
        return null;
      const token = await tx.refreshToken.findUnique({ where: { id: claims.jti } });
      if (
        !token ||
        token.sessionId !== session.id ||
        token.consumedAt ||
        !this.crypto.equal(token.tokenHash, this.crypto.digest('refresh', raw)) ||
        token.expiresAt <= new Date()
      ) {
        await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({
          data: { actorId: claims.sub, action: 'REFRESH_REUSE_DETECTED', entityId: session.id },
        });
        return null;
      }
      const next = await this.rotateInto(tx, claims.sub, session.id, session.expiresAt);
      const nextClaims = await this.claims(next.refresh!.token, 'refresh');
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date(), replacedBy: nextClaims.jti },
      });
      return next;
    });
    if (!result)
      throw new ApiError(
        401,
        'SESSION_REVOKED',
        'The session is no longer valid. Please sign in again.',
      );
    return result;
  }
  async logout(principal: AuthenticatedUser, all = false): Promise<void> {
    await this.db.auth(principal.userId, async (tx) => {
      await tx.session.updateMany({
        where: {
          userId: principal.userId,
          ...(all ? {} : { id: principal.sessionId }),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: principal.userId,
          action: all ? 'ALL_SESSIONS_REVOKED' : 'SESSION_REVOKED',
          entityId: all ? null : principal.sessionId,
        },
      });
    });
  }
}
