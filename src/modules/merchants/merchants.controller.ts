import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentTenant, Permissions, TenantRequired } from '../../common/decorators/access.js';
import type { TenantContext } from '../../types/auth.js';
import { BusinessProfileDto } from './dto/business-profile.dto.js';
import { TenantProfileRepository } from './tenant-profile.repository.js';
@ApiTags('Merchant onboarding')
@ApiBearerAuth()
@TenantRequired()
@ApiParam({
  name: 'merchantId',
  format: 'uuid',
  description:
    'A merchant membership is verified from the authenticated user before resolving this ID.',
})
@Controller('merchants/:merchantId/business-profile')
export class MerchantsController {
  constructor(private readonly profiles: TenantProfileRepository) {}
  @Get()
  @Permissions('merchant.profile.read')
  @ApiOperation({
    summary: 'Read the authorized merchant business profile with database RLS enforcement.',
  })
  get(@CurrentTenant() tenant: TenantContext) {
    return this.profiles.get(tenant);
  }
  @Patch()
  @Permissions('merchant.profile.update')
  @ApiOperation({
    summary:
      'Save the approved business name/industry fields. Does not approve KYC or activate the merchant.',
  })
  update(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: BusinessProfileDto,
    @Req() request: Request,
  ) {
    return this.profiles.update(tenant, body, String(request.id ?? ''));
  }
}
