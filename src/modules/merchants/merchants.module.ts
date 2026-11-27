import { Module } from '@nestjs/common';
import { MerchantsController } from './merchants.controller.js';
import { TenantProfileRepository } from './tenant-profile.repository.js';
@Module({ controllers: [MerchantsController], providers: [TenantProfileRepository] })
export class MerchantsModule {}
