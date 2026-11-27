import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, Permissions, Roles } from '../../common/decorators/access.js';
import type { AuthenticatedUser } from '../../types/auth.js';
import { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { DashboardService } from './dashboard.service.js';
import { ApiSuccess } from '../../common/decorators/api-success.js';
import {
  OverviewResponseDto,
  MetricsResponseDto,
  GmvResponseDto,
  PaymentHealthResponseDto,
  RiskPageResponseDto,
  SettlementsResponseDto,
  ActivityPageResponseDto,
} from './dto/dashboard-response.dto.js';
@ApiTags('Super Admin dashboard')
@ApiBearerAuth()
@Roles('SUPER_ADMIN')
@Permissions('platform.dashboard.read')
@Controller('super-admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('overview')
  @ApiOperation({
    summary:
      'Real merchant counts and explicit unavailable sources. Platform-wide access is audited.',
  })
  @ApiSuccess(OverviewResponseDto)
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
    @Req() req: Request,
  ) {
    return this.dashboard.read('overview', user, query, String(req.id ?? ''));
  }
  @Get('metrics')
  @ApiOperation({
    summary: 'Merchant count and availability-tagged KPI values. No fabricated financial metrics.',
  })
  @ApiSuccess(MetricsResponseDto)
  metrics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
    @Req() req: Request,
  ) {
    return this.dashboard.read('metrics', user, query, String(req.id ?? ''));
  }
  @Get('gmv')
  @ApiOperation({
    summary:
      'Unavailable until authoritative paid-order, refund, currency and recognition rules exist.',
  })
  @ApiSuccess(GmvResponseDto)
  gmv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
    @Req() req: Request,
  ) {
    return this.dashboard.read('gmv', user, query, String(req.id ?? ''));
  }
  @Get('payment-health')
  @ApiOperation({
    summary: 'Unavailable payment-health distribution; no live provider data exists.',
  })
  @ApiSuccess(PaymentHealthResponseDto)
  paymentHealth(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
    @Req() req: Request,
  ) {
    return this.dashboard.read('payment-health', user, query, String(req.id ?? ''));
  }
  @Get('risk-alerts')
  @ApiOperation({
    summary: 'An unavailable, empty paginated risk feed until risk-source integration.',
  })
  @ApiSuccess(RiskPageResponseDto)
  alerts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
    @Req() req: Request,
  ) {
    return this.dashboard.read('risk-alerts', user, query, String(req.id ?? ''));
  }
  @Get('settlements')
  @ApiOperation({
    summary: 'Unavailable settlement records until a settlement-ledger contract exists.',
  })
  @ApiSuccess(SettlementsResponseDto)
  settlements(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
    @Req() req: Request,
  ) {
    return this.dashboard.read('settlements', user, query, String(req.id ?? ''));
  }
  @Get('merchant-activity')
  @ApiOperation({
    summary:
      'Real registration/profile audit events with UTC filters, stable sorting and pagination.',
  })
  @ApiSuccess(ActivityPageResponseDto)
  activity(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
    @Req() req: Request,
  ) {
    return this.dashboard.read('merchant-activity', user, query, String(req.id ?? ''));
  }
}
