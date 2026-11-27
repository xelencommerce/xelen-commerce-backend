import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
export class DashboardQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'weekly', 'monthly', 'custom'], default: 'today' })
  @IsOptional()
  @IsIn(['today', 'weekly', 'monthly', 'custom'])
  period: 'today' | 'weekly' | 'monthly' | 'custom' = 'today';
  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'UTC calendar date; custom requires both start and end.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  start?: string;
  @ApiPropertyOptional({ example: '2026-11-27' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  end?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100000, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;
  @ApiPropertyOptional({ enum: ['date', 'name'], default: 'date' })
  @IsOptional()
  @IsIn(['date', 'name'])
  sort: 'date' | 'name' = 'date';
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction: 'asc' | 'desc' = 'desc';
  @ApiPropertyOptional({ enum: ['REGISTERED', 'BUSINESS_PROFILE_UPDATED'] })
  @IsOptional()
  @IsIn(['REGISTERED', 'BUSINESS_PROFILE_UPDATED'])
  status?: 'REGISTERED' | 'BUSINESS_PROFILE_UPDATED';
  @ApiPropertyOptional({
    example: 'USD',
    description:
      'Requested currency only; no exchange conversion or financial aggregation exists yet.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}
