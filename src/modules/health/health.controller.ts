import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/access.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { ApiError } from '../../common/exceptions/api-error.js';
@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}
  @Get('live')
  @ApiOperation({ summary: 'Process liveness, without exposing infrastructure credentials.' })
  live() {
    return { status: 'ok' };
  }
  @Get('ready')
  @ApiOperation({ summary: 'Database readiness and Redis readiness if configured.' })
  async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      const redis = await this.redis.ready();
      if (redis === 'unavailable') throw new Error();
      return { status: 'ready', database: 'ready', redis };
    } catch {
      throw new ApiError(503, 'NOT_READY', 'Required infrastructure is not ready.');
    }
  }
}
