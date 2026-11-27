import { Injectable, Controller, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, Roles, Permissions } from '../../common/decorators/access.js';
import { DatabaseService } from '../database/database.service.js';
import type { AuthenticatedUser } from '../../types/auth.js';
@Injectable()
export class OperationalMetrics {
  private requests = 0;
  private failures = 0;
  private totalDurationMs = 0;
  record(status: number, durationMs: number) {
    this.requests++;
    if (status >= 500) this.failures++;
    this.totalDurationMs += durationMs;
  }
  snapshot() {
    return {
      scope: 'process-lifetime',
      requests: this.requests,
      serverErrors: this.failures,
      meanDurationMs: this.requests
        ? Math.round((this.totalDurationMs / this.requests) * 100) / 100
        : 0,
      uptimeSeconds: Math.floor(process.uptime()),
      residentMemoryBytes: process.memoryUsage().rss,
    };
  }
}
@ApiTags('Operations')
@ApiBearerAuth()
@Roles('SUPER_ADMIN')
@Permissions('platform.dashboard.read')
@Controller('operations')
export class OperationsController {
  constructor(
    private readonly metrics: OperationalMetrics,
    private readonly db: DatabaseService,
  ) {}
  @Get('metrics')
  @ApiOperation({
    summary: 'Audited Super Admin process counters. No external monitoring service is configured.',
  })
  metricsSnapshot(@CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.db.platform(user, 'OPERATIONAL_METRICS_READ', String(request.id ?? ''), async () =>
      this.metrics.snapshot(),
    );
  }
}
