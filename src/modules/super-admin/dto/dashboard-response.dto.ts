import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class DateRangeResponseDto {
  @ApiProperty({ format: 'date' }) start!: string;
  @ApiProperty({ format: 'date' }) end!: string;
  @ApiProperty({ enum: ['UTC'] }) timezone!: string;
}
export class MetricResponseDto {
  @ApiProperty({ enum: ['available', 'unavailable'] }) availability!: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Missing sources use null; never interpret unavailable as zero.',
  })
  value!: number | null;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() semantics?: string;
}
export class FinancialResponseDto extends MetricResponseDto {
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
}
export class MetricsResponseDto {
  @ApiProperty({ type: DateRangeResponseDto }) dateRange!: DateRangeResponseDto;
  @ApiProperty({ type: MetricResponseDto }) activeMerchants!: MetricResponseDto;
  @ApiProperty({ type: FinancialResponseDto }) platformGmv!: FinancialResponseDto;
  @ApiProperty({ type: FinancialResponseDto }) totalTransactions!: FinancialResponseDto;
  @ApiProperty({ type: FinancialResponseDto }) failedPaymentRate!: FinancialResponseDto;
  @ApiProperty({ type: MetricResponseDto }) openSupportTickets!: MetricResponseDto;
  @ApiProperty({ type: MetricResponseDto }) pendingKyc!: MetricResponseDto;
}
export class OverviewResponseDto {
  @ApiProperty({ type: DateRangeResponseDto }) dateRange!: DateRangeResponseDto;
  @ApiProperty() activeMerchants!: number;
  @ApiProperty() registeredMerchants!: number;
  @ApiProperty({ type: FinancialResponseDto }) financial!: FinancialResponseDto;
  @ApiProperty({ type: MetricResponseDto }) support!: MetricResponseDto;
  @ApiProperty({ type: MetricResponseDto }) kyc!: MetricResponseDto;
  @ApiProperty({ type: MetricResponseDto }) risk!: MetricResponseDto;
}
export class PaginationResponseDto {
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class MerchantActivityResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) merchantId!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ enum: ['REGISTERED', 'BUSINESS_PROFILE_UPDATED'] }) status!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Subscription source is not integrated.',
  })
  plan!: string | null;
  @ApiProperty({ format: 'date-time' }) date!: string;
}
export class ActivityPageResponseDto {
  @ApiProperty({ enum: ['available'] }) availability!: string;
  @ApiProperty({ type: [MerchantActivityResponseDto] }) items!: MerchantActivityResponseDto[];
  @ApiProperty({ type: PaginationResponseDto }) pagination!: PaginationResponseDto;
}
export class GmvResponseDto extends FinancialResponseDto {
  @ApiProperty({ type: DateRangeResponseDto }) dateRange!: DateRangeResponseDto;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    maxItems: 0,
    description: 'Empty until a financial contract is approved.',
  })
  series!: unknown[];
  @ApiProperty() moneyEncoding!: string;
}
export class PaymentHealthResponseDto extends FinancialResponseDto {
  @ApiProperty({ type: DateRangeResponseDto }) dateRange!: DateRangeResponseDto;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    maxItems: 0,
  })
  distribution!: unknown[];
  @ApiProperty({ type: Number, nullable: true }) refundVolume!: null;
  @ApiProperty({ type: Number, nullable: true }) chargebackRate!: null;
}
export class SettlementsResponseDto extends FinancialResponseDto {
  @ApiProperty({ type: DateRangeResponseDto }) dateRange!: DateRangeResponseDto;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    maxItems: 0,
  })
  items!: unknown[];
}
export class RiskPageResponseDto extends MetricResponseDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    maxItems: 0,
  })
  items!: unknown[];
  @ApiProperty({ type: PaginationResponseDto }) pagination!: PaginationResponseDto;
}
