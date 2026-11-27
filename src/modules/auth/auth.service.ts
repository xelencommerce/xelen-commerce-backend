import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { CryptoService } from '../../infrastructure/security/crypto.service.js';
import { RateLimiter } from '../../infrastructure/database/rate-limiter.service.js';
import { DeliveryService } from '../../infrastructure/email/delivery.service.js';
import { EmailOutboxService } from '../../infrastructure/email/email-outbox.service.js';
import { PasswordService } from './password.service.js';
import { MfaService } from './mfa.service.js';
import { invalidCredentials, invalidChallenge } from '../../common/exceptions/api-error.js';
import type { RegisterDto, LoginDto, ResetPasswordDto } from './dto/auth.dto.js';
import type { AuthenticatedUser, RequestContext } from '../../types/auth.js';
const accepted = {
  status: 'REQUEST_ACCEPTED',
  message: 'If this request is eligible, an email will be delivered with the next steps.',
};
@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly mfa: MfaService,
    private readonly delivery: DeliveryService,
    private readonly limiter: RateLimiter,
    private readonly emails: EmailOutboxService,
  ) {}
  async register(input: RegisterDto, context: RequestContext) {
    await this.limiter.hit('registration-ip', context.ip, 5, 3600);
    this.delivery.requireEmail();
    const passwordHash = await this.passwords.hash(input.password);
    const existing = await this.db.user.findUnique({ where: { email: input.email } });
    if (existing) return accepted;
    const userId = randomUUID();
    const tenantId = randomUUID();
    const raw = this.crypto.token();
    try {
      await this.db.tenant(userId, tenantId, async (tx) => {
        const role = await tx.role.findUniqueOrThrow({ where: { name: 'MERCHANT_ADMIN' } });
        await tx.user.create({ data: { id: userId, email: input.email, passwordHash } });
        await tx.merchant.create({ data: { id: tenantId } });
        await tx.merchantMembership.create({ data: { tenantId, userId, roleId: role.id } });
        await tx.userToken.create({
          data: {
            userId,
            purpose: 'EMAIL_VERIFICATION',
            tokenHash: this.crypto.digest('email-verification', raw),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            tenantId,
            action: 'MERCHANT_REGISTERED',
            entityId: tenantId,
            requestId: context.requestId,
          },
        });
        await this.emails.enqueue(
          tx,
          userId,
          input.email,
          'verify-email',
          raw,
          new Date(Date.now() + 3600000),
        );
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')
        return accepted;
      throw error;
    }
    return accepted;
  }
  async resendVerification(email: string) {
    await this.limiter.hit('verification-email', email, 3, 3600);
    this.delivery.requireEmail();
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt || user.status === 'SUSPENDED') return accepted;
    const raw = this.crypto.token();
    await this.db.auth(user.id, async (tx) => {
      await tx.userToken.updateMany({
        where: { userId: user.id, purpose: 'EMAIL_VERIFICATION', usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.userToken.create({
        data: {
          userId: user.id,
          purpose: 'EMAIL_VERIFICATION',
          tokenHash: this.crypto.digest('email-verification', raw),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      await this.emails.enqueue(
        tx,
        user.id,
        email,
        'verify-email',
        raw,
        new Date(Date.now() + 3600000),
      );
    });
    return accepted;
  }
  async verifyEmail(raw: string) {
    const token = await this.db.userToken.findUnique({
      where: { tokenHash: this.crypto.digest('email-verification', raw) },
    });
    if (!token || token.purpose !== 'EMAIL_VERIFICATION') throw invalidChallenge();
    const result = await this.db.auth(token.userId, async (tx) => {
      const consumed = await tx.userToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!consumed.count) return null;
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (user.status === 'SUSPENDED') return null;
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'EMAIL_VERIFIED' } });
      return this.mfa.issue(tx, user.id, 'REGISTRATION', false);
    });
    if (!result) throw invalidChallenge();
    return result;
  }
  async login(input: LoginDto, context: RequestContext) {
    await this.limiter.hit('login-ip', context.ip, 30, 60);
    await this.limiter.hit('login-email', input.email, 10, 900);
    const user = await this.db.user.findUnique({
      where: { email: input.email },
      include: { methods: true, platformRoles: { include: { role: true } } },
    });
    const valid = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (
      !user ||
      !valid ||
      user.status === 'SUSPENDED' ||
      !user.emailVerifiedAt ||
      (user.lockedUntil && user.lockedUntil > new Date())
    ) {
      if (user && !valid)
        await this.db
          .$executeRaw`UPDATE "User" SET "failedLogins" = "failedLogins" + 1, "updatedAt" = now(), "lockedUntil" = CASE WHEN "failedLogins" + 1 >= 5 THEN now() + interval '15 minutes' ELSE "lockedUntil" END WHERE id = ${user.id}::uuid`;
      if (user)
        await this.db.auth(user.id, (tx) =>
          tx.auditLog.create({
            data: { actorId: user.id, action: 'LOGIN_REJECTED', requestId: context.requestId },
          }),
        );
      throw invalidCredentials();
    }
    return this.db.auth(user.id, async (tx) => {
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { methods: true },
      });
      if (
        current.passwordHash !== user.passwordHash ||
        current.status === 'SUSPENDED' ||
        !current.emailVerifiedAt ||
        (current.lockedUntil && current.lockedUntil > new Date())
      )
        throw invalidCredentials();
      await tx.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
      return this.mfa.issue(
        tx,
        user.id,
        current.methods.length ? 'LOGIN' : 'ENROLLMENT',
        input.remember,
      );
    });
  }
  async reauthenticate(principal: AuthenticatedUser, password: string) {
    await this.limiter.hit('reauthentication', principal.userId, 5, 900);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!(await this.passwords.verify(user.passwordHash, password))) throw invalidCredentials();
    return this.db.auth(user.id, async (tx) => {
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const session = await tx.session.findFirst({
        where: {
          id: principal.sessionId,
          userId: user.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!session || current.passwordHash !== user.passwordHash || current.status !== 'ACTIVE')
        throw invalidCredentials();
      return this.mfa.issue(tx, user.id, 'STEP_UP', false, principal.sessionId);
    });
  }
  async forgotPassword(email: string) {
    await this.limiter.hit('password-reset', email, 3, 3600);
    this.delivery.requireEmail();
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || !user.emailVerifiedAt || user.status === 'SUSPENDED') return accepted;
    const raw = this.crypto.token();
    await this.db.auth(user.id, async (tx) => {
      await tx.userToken.updateMany({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.userToken.create({
        data: {
          userId: user.id,
          purpose: 'PASSWORD_RESET',
          tokenHash: this.crypto.digest('password-reset', raw),
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
      });
      await this.emails.enqueue(
        tx,
        user.id,
        email,
        'reset-password',
        raw,
        new Date(Date.now() + 15 * 60000),
      );
    });
    return accepted;
  }
  async resetPassword(input: ResetPasswordDto) {
    const token = await this.db.userToken.findUnique({
      where: { tokenHash: this.crypto.digest('password-reset', input.token) },
    });
    if (!token || token.purpose !== 'PASSWORD_RESET') throw invalidChallenge();
    const passwordHash = await this.passwords.hash(input.password);
    const changed = await this.db.auth(token.userId, async (tx) => {
      const consumed = await tx.userToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!consumed.count) return false;
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash, failedLogins: 0, lockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.mfaChallenge.updateMany({
        where: { userId: token.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.userToken.updateMany({
        where: { userId: token.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.auditLog.create({ data: { actorId: token.userId, action: 'PASSWORD_RESET' } });
      return true;
    });
    if (!changed) throw invalidChallenge();
    return { status: 'PASSWORD_CHANGED', message: 'Password changed. Sign in again.' };
  }
}
