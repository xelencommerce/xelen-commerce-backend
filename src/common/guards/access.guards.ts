import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { SessionService } from '../../modules/auth/session.service.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { RateLimiter } from '../../infrastructure/database/rate-limiter.service.js';
import { ApiError } from '../exceptions/api-error.js';
const metadata = <T>(reflector: Reflector, context: ExecutionContext, key: string) =>
  reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
@Injectable()
export class RequestRateGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiter) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (!/^\/api\/v1\/health\/(live|ready)$/.test(request.path))
      await this.limiter.hit('request-ip', request.ip ?? 'unknown', 600, 60);
    return true;
  }
}
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (metadata<boolean>(this.reflector, context, 'public')) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length > 8192)
      throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to access this resource.');
    request.auth = await this.sessions.authenticate(authorization.slice(7));
    return true;
  }
}
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const required = metadata<string[]>(this.reflector, context, 'roles') ?? [];
    if (!required.length) return true;
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (
      !auth ||
      !required.some((role) => auth.roles.includes(role)) ||
      (required.includes('SUPER_ADMIN') && auth.mfaKind !== 'TOTP')
    )
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
    return true;
  }
}
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (!metadata<boolean>(this.reflector, context, 'tenantRequired')) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.auth;
    const tenantId = request.params.merchantId;
    if (typeof tenantId !== 'string' || !isUUID(tenantId))
      throw new ApiError(400, 'INVALID_TENANT', 'Use a valid merchant identifier.');
    if (!user)
      throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to access this resource.');
    const membership = await this.db.actor(user.userId, (tx) =>
      tx.merchantMembership.findFirst({
        where: { tenantId, userId: user.userId, status: 'ACTIVE' },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      }),
    );
    if (!membership) throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
    const merchant = await this.db.tenant(user.userId, tenantId, (tx) =>
      tx.merchant.findFirst({
        where: { id: tenantId, status: { not: 'SUSPENDED' } },
        select: { id: true },
      }),
    );
    if (!merchant) throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
    request.tenant = {
      userId: user.userId,
      tenantId,
      membershipId: membership.id,
      permissions: membership.role.permissions.map((item) => item.permission.key),
    };
    return true;
  }
}
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const required = metadata<string[]>(this.reflector, context, 'permissions') ?? [];
    if (!required.length) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const allowed = request.tenant?.permissions ?? request.auth?.permissions ?? [];
    if (!required.every((permission) => allowed.includes(permission)))
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this operation.');
    return true;
  }
}
