import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type Transaction,
} from '../../infrastructure/database/database.service.js';
import { ApiError } from '../../common/exceptions/api-error.js';
import type { TenantContext } from '../../types/auth.js';
import type { BusinessProfileDto } from './dto/business-profile.dto.js';
@Injectable()
export class TenantProfileRepository {
  constructor(private readonly db: DatabaseService) {}
  private async authorize(tx: Transaction, context: TenantContext, permission: string) {
    const member = await tx.merchantMembership.findFirst({
      where: {
        id: context.membershipId,
        userId: context.userId,
        tenantId: context.tenantId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
        merchant: { status: { not: 'SUSPENDED' } },
        role: { permissions: { some: { permission: { key: permission } } } },
      },
    });
    if (!member) throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
  }
  async get(context: TenantContext) {
    return this.db.tenant(context.userId, context.tenantId, async (tx) => {
      await this.authorize(tx, context, 'merchant.profile.read');
      const merchant = await tx.merchant.findUnique({
        where: { id: context.tenantId },
        select: { id: true, name: true, status: true, profile: true },
      });
      if (!merchant) throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
      return merchant;
    });
  }
  async update(context: TenantContext, data: BusinessProfileDto, requestId: string) {
    return this.db.tenant(context.userId, context.tenantId, async (tx) => {
      await this.authorize(tx, context, 'merchant.profile.update');
      const profile = {
        businessName: data.businessName,
        industry: data.industry,
        otherIndustry: data.industry === 'Other' ? data.otherIndustry : null,
      };
      await tx.merchant.update({
        where: { id: context.tenantId },
        data: { name: data.businessName },
      });
      const result = await tx.businessProfile.upsert({
        where: { tenantId: context.tenantId },
        create: { tenantId: context.tenantId, ...profile },
        update: profile,
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'BUSINESS_PROFILE_UPDATED',
          entityId: result.id,
          requestId,
        },
      });
      return result;
    });
  }
}
