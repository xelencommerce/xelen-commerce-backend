import { Injectable } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import {
  DatabaseService,
  type Transaction,
} from '../../infrastructure/database/database.service.js';
import { CryptoService } from '../../infrastructure/security/crypto.service.js';
import { DeliveryService } from '../../infrastructure/email/delivery.service.js';
import { SessionService, type AuthenticationResult } from './session.service.js';
import { ApiError, invalidChallenge } from '../../common/exceptions/api-error.js';
import {
  CHALLENGE_TTL_MS,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
} from '../../common/constants/security.js';
import type { ChallengePurpose, Prisma } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, RequestContext } from '../../types/auth.js';
import type { MfaChallengeDto } from './dto/auth.dto.js';
const challengeInclude = {
  user: { include: { methods: true, platformRoles: { include: { role: true } } } },
  session: true,
} satisfies Prisma.MfaChallengeInclude;
type Challenge = Prisma.MfaChallengeGetPayload<{ include: typeof challengeInclude }>;
@Injectable()
export class MfaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly delivery: DeliveryService,
    private readonly sessions: SessionService,
  ) {}
  async issue(
    tx: Transaction,
    userId: string,
    purpose: ChallengePurpose,
    remember: boolean,
    sessionId?: string,
  ) {
    const raw = this.crypto.token();
    await tx.mfaChallenge.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.mfaChallenge.create({
      data: {
        userId,
        purpose,
        tokenHash: this.crypto.digest('challenge', raw),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        remember,
        sessionId,
      },
    });
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: { methods: true, platformRoles: { include: { role: true } } },
    });
    const platform = user.platformRoles.some((item) => item.role.name === 'SUPER_ADMIN');
    const methods =
      purpose === 'LOGIN' || purpose === 'STEP_UP'
        ? user.methods.map((method) => method.kind).filter((kind) => !platform || kind === 'TOTP')
        : platform
          ? ['TOTP']
          : ['TOTP', 'SMS'];
    if (
      (purpose === 'LOGIN' || purpose === 'STEP_UP') &&
      (await tx.recoveryCode.count({ where: { userId, usedAt: null } }))
    )
      methods.push('RECOVERY');
    return {
      status:
        purpose === 'REGISTRATION' || purpose === 'ENROLLMENT'
          ? 'MFA_ENROLLMENT_REQUIRED'
          : 'MFA_REQUIRED',
      challengeToken: raw,
      expiresIn: CHALLENGE_TTL_MS / 1000,
      availableMethods: methods,
    };
  }
  private async locked<T>(
    raw: string,
    work: (tx: Transaction, challenge: Challenge) => Promise<T>,
  ): Promise<T> {
    const hash = this.crypto.digest('challenge', raw);
    const reference = await this.db.mfaChallenge.findUnique({
      where: { tokenHash: hash },
      select: { id: true, userId: true },
    });
    if (!reference) throw invalidChallenge();
    return this.db.auth(reference.userId, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MfaChallenge" WHERE "id" = ${reference.id}::uuid FOR UPDATE`;
      const challenge = await tx.mfaChallenge.findUniqueOrThrow({
        where: { id: reference.id },
        include: challengeInclude,
      });
      if (
        challenge.consumedAt ||
        challenge.expiresAt <= new Date() ||
        challenge.attempts >= MAX_OTP_ATTEMPTS ||
        challenge.user.status === 'SUSPENDED' ||
        !challenge.user.emailVerifiedAt ||
        (challenge.session &&
          (challenge.session.revokedAt || challenge.session.expiresAt <= new Date()))
      )
        throw invalidChallenge();
      return work(tx, challenge);
    });
  }
  private isEnrollment(challenge: Challenge): boolean {
    return challenge.purpose === 'REGISTRATION' || challenge.purpose === 'ENROLLMENT';
  }
  private assertEnrollment(challenge: Challenge) {
    if (!this.isEnrollment(challenge) || (challenge.user.methods.length && !challenge.sessionId))
      throw invalidChallenge();
  }
  async setupTotp(raw: string) {
    const result = await this.locked(raw, async (tx, challenge) => {
      this.assertEnrollment(challenge);
      const totp = new OTPAuth.TOTP({
        issuer: 'Xelen Commerce',
        label: challenge.user.email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: new OTPAuth.Secret({ size: 20 }),
      });
      await tx.mfaChallenge.update({
        where: { id: challenge.id },
        data: {
          selectedKind: 'TOTP',
          pendingSecretCipher: this.crypto.encrypt(totp.secret.base32),
          otpHash: null,
        },
      });
      return { uri: totp.toString() };
    });
    return {
      status: 'ENROLLMENT_PENDING',
      otpauthUri: result.uri,
      qrCodeDataUrl: await QRCode.toDataURL(result.uri, { errorCorrectionLevel: 'M', width: 256 }),
      expiresIn: CHALLENGE_TTL_MS / 1000,
    };
  }
  async challenge(input: MfaChallengeDto) {
    if (input.method === 'SMS') return this.sendSms(input.challengeToken, input.phone);
    return this.locked(input.challengeToken, async (tx, challenge) => {
      if (input.phone)
        throw new ApiError(
          400,
          'INVALID_FACTOR',
          'Phone numbers are only accepted for SMS enrollment.',
        );
      if (
        input.method === 'RECOVERY' &&
        (this.isEnrollment(challenge) ||
          !(await tx.recoveryCode.count({ where: { userId: challenge.userId, usedAt: null } })))
      )
        throw invalidChallenge();
      if (
        input.method === 'TOTP' &&
        !challenge.user.methods.some((method) => method.kind === 'TOTP')
      )
        throw new ApiError(
          400,
          'ENROLLMENT_REQUIRED',
          'Set up and confirm your authenticator first.',
        );
      await tx.mfaChallenge.update({
        where: { id: challenge.id },
        data: { selectedKind: input.method, pendingSecretCipher: null, otpHash: null },
      });
      return { status: 'CODE_REQUIRED', method: input.method };
    });
  }
  async sendSms(raw: string, suppliedPhone?: string) {
    this.delivery.requireSms();
    const prepared = await this.locked(raw, async (tx, challenge) => {
      if (challenge.user.platformRoles.some((item) => item.role.name === 'SUPER_ADMIN'))
        throw new ApiError(
          403,
          'TOTP_REQUIRED',
          'Super Admin accounts require an authenticator app.',
        );
      const enrolling = this.isEnrollment(challenge);
      if (enrolling) this.assertEnrollment(challenge);
      if (!enrolling && suppliedPhone)
        throw new ApiError(400, 'INVALID_FACTOR', 'Use the enrolled phone number.');
      const phone = enrolling
        ? (suppliedPhone ?? challenge.phoneTarget)
        : challenge.user.methods.find((method) => method.kind === 'SMS')?.phone;
      if (
        !phone ||
        !parsePhoneNumberFromString(phone)?.isValid() ||
        parsePhoneNumberFromString(phone)?.number !== phone
      )
        throw new ApiError(400, 'INVALID_PHONE', 'Use a valid E.164 phone number.');
      if (challenge.lastSentAt && Date.now() - challenge.lastSentAt.valueOf() < RESEND_COOLDOWN_MS)
        throw new ApiError(
          429,
          'RESEND_COOLDOWN',
          'Wait 45 seconds before requesting another code.',
        );
      if (challenge.resendCount >= 5)
        throw new ApiError(429, 'RESEND_LIMIT', 'Start a new verification challenge.');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const hash = this.crypto.digest(`sms:${challenge.id}`, code);
      await tx.mfaChallenge.update({
        where: { id: challenge.id },
        data: {
          selectedKind: 'SMS',
          pendingSecretCipher: null,
          phoneTarget: phone,
          otpHash: hash,
          otpExpiresAt: new Date(Math.min(Date.now() + OTP_TTL_MS, challenge.expiresAt.valueOf())),
          lastSentAt: new Date(),
          resendCount: { increment: 1 },
        },
      });
      return { id: challenge.id, phone, code, hash };
    });
    try {
      await this.delivery.sms(prepared.phone, prepared.code);
    } catch (error) {
      await this.db.mfaChallenge.updateMany({
        where: { id: prepared.id, otpHash: prepared.hash },
        data: { otpHash: null },
      });
      throw error;
    }
    return {
      status: 'CODE_SENT',
      method: 'SMS',
      maskedDestination: `••••${prepared.phone.slice(-4)}`,
      resendAfter: 45,
    };
  }
  async resend(raw: string) {
    const challenge = await this.db.mfaChallenge.findUnique({
      where: { tokenHash: this.crypto.digest('challenge', raw) },
    });
    if (!challenge || challenge.selectedKind !== 'SMS') throw invalidChallenge();
    return this.sendSms(raw);
  }
  private totp(secret: string, code: string): bigint | null {
    if (!/^\d{6}$/.test(code)) return null;
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const delta = totp.validate({ token: code, window: 1 });
    return delta === null ? null : BigInt(Math.floor(Date.now() / 30000) + delta);
  }
  private async verifyCode(tx: Transaction, challenge: Challenge, code: string): Promise<boolean> {
    if (challenge.selectedKind === 'SMS')
      return Boolean(
        /^\d{6}$/.test(code) &&
        challenge.otpHash &&
        challenge.otpExpiresAt &&
        challenge.otpExpiresAt > new Date() &&
        this.crypto.equal(challenge.otpHash, this.crypto.digest(`sms:${challenge.id}`, code)),
      );
    if (challenge.selectedKind === 'RECOVERY') {
      if (this.isEnrollment(challenge)) return false;
      const updated = await tx.recoveryCode.updateMany({
        where: {
          userId: challenge.userId,
          codeHash: this.crypto.digest(
            `recovery:${challenge.userId}`,
            code.replace(/-/g, '').toUpperCase(),
          ),
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      return updated.count === 1;
    }
    if (challenge.selectedKind !== 'TOTP') return false;
    if (this.isEnrollment(challenge) && challenge.pendingSecretCipher)
      return this.totp(this.crypto.decrypt(challenge.pendingSecretCipher), code) !== null;
    const method = challenge.user.methods.find((item) => item.kind === 'TOTP');
    if (!method?.secretCipher) return false;
    const counter = this.totp(this.crypto.decrypt(method.secretCipher), code);
    if (counter === null) return false;
    const updated = await tx.mfaMethod.updateMany({
      where: { id: method.id, OR: [{ lastCounter: null }, { lastCounter: { lt: counter } }] },
      data: { lastCounter: counter },
    });
    return updated.count === 1;
  }
  private async recoveryCodes(tx: Transaction, userId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, () => randomBytes(12).toString('hex').toUpperCase());
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({
        userId,
        codeHash: this.crypto.digest(`recovery:${userId}`, code),
      })),
    });
    return codes.map((code) => code.match(/.{1,6}/g)!.join('-'));
  }
  async verify(
    raw: string,
    code: string,
    context: RequestContext,
    requireTotpEnrollment = false,
  ): Promise<AuthenticationResult> {
    const result = await this.locked(
      raw,
      async (tx, challenge): Promise<AuthenticationResult | null> => {
        if (
          requireTotpEnrollment &&
          (!this.isEnrollment(challenge) ||
            challenge.selectedKind !== 'TOTP' ||
            !challenge.pendingSecretCipher)
        )
          throw invalidChallenge();
        if (!challenge.selectedKind) throw invalidChallenge();
        const valid = await this.verifyCode(tx, challenge, code);
        await tx.mfaChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
        });
        if (!valid) {
          await tx.auditLog.create({
            data: {
              actorId: challenge.userId,
              action: 'MFA_VERIFICATION_FAILED',
              requestId: context.requestId,
            },
          });
          return null;
        }
        const enrolling = this.isEnrollment(challenge);
        let recoveryCodes: string[] | undefined;
        if (enrolling) {
          this.assertEnrollment(challenge);
          const kind = challenge.selectedKind;
          if (kind === 'RECOVERY') throw invalidChallenge();
          const secretCipher = kind === 'TOTP' ? challenge.pendingSecretCipher : null;
          const phone = kind === 'SMS' ? challenge.phoneTarget : null;
          if ((kind === 'TOTP' && !secretCipher) || (kind === 'SMS' && !phone))
            throw invalidChallenge();
          const method = {
            secretCipher,
            phone,
            lastCounter:
              kind === 'TOTP' ? this.totp(this.crypto.decrypt(secretCipher!), code) : null,
            confirmedAt: new Date(),
          };
          await tx.mfaMethod.upsert({
            where: { userId_kind: { userId: challenge.userId, kind } },
            create: { userId: challenge.userId, kind, ...method },
            update: method,
          });
          if (!(await tx.recoveryCode.count({ where: { userId: challenge.userId } })))
            recoveryCodes = await this.recoveryCodes(tx, challenge.userId);
          await tx.auditLog.create({
            data: {
              actorId: challenge.userId,
              action: 'MFA_ENROLLED',
              requestId: context.requestId,
            },
          });
        }
        await tx.mfaChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date(), otpHash: null, pendingSecretCipher: null },
        });
        if (challenge.purpose === 'STEP_UP') {
          const token = this.crypto.token();
          await tx.userToken.create({
            data: {
              userId: challenge.userId,
              sessionId: challenge.sessionId,
              purpose: 'REAUTHENTICATION',
              tokenHash: this.crypto.digest('reauthentication', token),
              expiresAt: new Date(Date.now() + 300000),
            },
          });
          return { data: { status: 'REAUTHENTICATED', reauthToken: token, expiresIn: 300 } };
        }
        if (enrolling && challenge.sessionId)
          return { data: { status: 'MFA_ENROLLED', ...(recoveryCodes ? { recoveryCodes } : {}) } };
        const session = await this.sessions.issue(
          tx,
          challenge.userId,
          challenge.selectedKind,
          challenge.remember,
          context,
        );
        if (recoveryCodes) session.data.recoveryCodes = recoveryCodes;
        return session;
      },
    );
    if (!result) throw invalidChallenge();
    return result;
  }
  private async consumeReauth(tx: Transaction, principal: AuthenticatedUser, raw: string) {
    const grant = await tx.userToken.updateMany({
      where: {
        userId: principal.userId,
        sessionId: principal.sessionId,
        purpose: 'REAUTHENTICATION',
        user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
        session: { id: principal.sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
        tokenHash: this.crypto.digest('reauthentication', raw),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (grant.count !== 1)
      throw new ApiError(
        403,
        'REAUTHENTICATION_REQUIRED',
        'Confirm your password and MFA before this action.',
      );
  }
  async enrollment(principal: AuthenticatedUser, reauthToken: string) {
    return this.db.auth(principal.userId, async (tx) => {
      await this.consumeReauth(tx, principal, reauthToken);
      return this.issue(tx, principal.userId, 'ENROLLMENT', false, principal.sessionId);
    });
  }
  async regenerateRecovery(principal: AuthenticatedUser, raw: string) {
    return this.db.auth(principal.userId, async (tx) => {
      await this.consumeReauth(tx, principal, raw);
      await tx.recoveryCode.deleteMany({ where: { userId: principal.userId } });
      const codes = await this.recoveryCodes(tx, principal.userId);
      await tx.auditLog.create({
        data: { actorId: principal.userId, action: 'RECOVERY_CODES_REGENERATED' },
      });
      return { recoveryCodes: codes };
    });
  }
  async remove(principal: AuthenticatedUser, raw: string, kind: 'TOTP' | 'SMS') {
    return this.db.auth(principal.userId, async (tx) => {
      await this.consumeReauth(tx, principal, raw);
      if (principal.roles.includes('SUPER_ADMIN') && kind === 'TOTP')
        throw new ApiError(
          409,
          'TOTP_REQUIRED',
          'Enroll a replacement authenticator instead of removing Super Admin TOTP.',
        );
      if ((await tx.mfaMethod.count({ where: { userId: principal.userId } })) <= 1)
        throw new ApiError(
          409,
          'MFA_REQUIRED',
          'Enroll another method before removing your last verification factor.',
        );
      await tx.mfaMethod.deleteMany({ where: { userId: principal.userId, kind } });
      await tx.session.updateMany({
        where: { userId: principal.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.mfaChallenge.updateMany({
        where: { userId: principal.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.auditLog.create({ data: { actorId: principal.userId, action: 'MFA_REMOVED' } });
      return { status: 'MFA_REMOVED', message: 'Sign in again with your remaining factor.' };
    });
  }
}
