import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type Transaction,
} from '../../infrastructure/database/database.service.js';
import { ApiError } from '../../common/exceptions/api-error.js';
import type { AuthenticatedUser } from '../../types/auth.js';
import type { DashboardQueryDto } from './dto/dashboard-query.dto.js';
export function dashboardRange(query: DashboardQueryDto, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const end = query.period === 'custom' ? query.end : today;
  const startDate = new Date(`${today}T00:00:00Z`);
  startDate.setUTCDate(
    startDate.getUTCDate() - (query.period === 'weekly' ? 6 : query.period === 'monthly' ? 29 : 0),
  );
  const start = query.period === 'custom' ? query.start : startDate.toISOString().slice(0, 10);
  const valid = (date: string | undefined) =>
    Boolean(
      date &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date,
    );
  if (
    !valid(start) ||
    !valid(end) ||
    !start ||
    !end ||
    start > end ||
    Date.parse(end) - Date.parse(start) > 365 * 86400000 ||
    (query.period !== 'custom' && (query.start || query.end))
  )
    throw new ApiError(
      400,
      'INVALID_DATE_RANGE',
      'Use a valid UTC date range of at most 366 days. Custom requires both start and end.',
    );
  return {
    start,
    end,
    from: new Date(`${start}T00:00:00Z`),
    until: new Date(Date.parse(`${end}T00:00:00Z`) + 86400000),
    timezone: 'UTC',
  };
}
const unavailable = (reason: string) => ({
  availability: 'unavailable' as const,
  value: null,
  reason,
});
@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}
  async read(
    section: string,
    user: AuthenticatedUser,
    query: DashboardQueryDto,
    requestId: string,
  ) {
    const range = dashboardRange(query);
    return this.db.platform(
      user,
      `PLATFORM_DASHBOARD_${section.toUpperCase().replace(/-/g, '_')}`,
      requestId,
      async (tx) => {
        const dateRange = { start: range.start, end: range.end, timezone: range.timezone };
        const financial = {
          ...unavailable('PAYMENT_SOURCE_NOT_CONFIGURED'),
          currency: query.currency ?? null,
        };
        if (section === 'metrics')
          return {
            dateRange,
            activeMerchants: {
              availability: 'available',
              value: await tx.merchant.count({
                where: { status: 'ACTIVE', createdAt: { lt: range.until } },
              }),
              semantics:
                'Current ACTIVE merchants created before the end of the selected UTC day; historical status changes are not reconstructed.',
            },
            platformGmv: financial,
            totalTransactions: financial,
            failedPaymentRate: financial,
            openSupportTickets: unavailable('SUPPORT_SOURCE_NOT_CONFIGURED'),
            pendingKyc: unavailable('KYC_REVIEW_SOURCE_NOT_CONFIGURED'),
          };
        if (section === 'gmv')
          return {
            ...financial,
            dateRange,
            series: [],
            moneyEncoding:
              'integer minor units as decimal strings; currency required before production aggregation',
          };
        if (section === 'payment-health')
          return {
            ...financial,
            dateRange,
            distribution: [],
            refundVolume: null,
            chargebackRate: null,
          };
        if (section === 'risk-alerts')
          return {
            ...unavailable('RISK_SOURCE_NOT_CONFIGURED'),
            items: [],
            pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 },
          };
        if (section === 'settlements') return { ...financial, dateRange, items: [] };
        if (section === 'merchant-activity') return this.activity(tx, query, range);
        return {
          dateRange,
          activeMerchants: await tx.merchant.count({
            where: { status: 'ACTIVE', createdAt: { lt: range.until } },
          }),
          registeredMerchants: await tx.merchant.count({
            where: { createdAt: { gte: range.from, lt: range.until } },
          }),
          financial,
          support: unavailable('SUPPORT_SOURCE_NOT_CONFIGURED'),
          kyc: unavailable('KYC_REVIEW_SOURCE_NOT_CONFIGURED'),
          risk: unavailable('RISK_SOURCE_NOT_CONFIGURED'),
        };
      },
    );
  }
  private async activity(
    tx: Transaction,
    query: DashboardQueryDto,
    range: ReturnType<typeof dashboardRange>,
  ) {
    const where = {
      action: {
        in: query.status
          ? [query.status === 'REGISTERED' ? 'MERCHANT_REGISTERED' : query.status]
          : ['MERCHANT_REGISTERED', 'BUSINESS_PROFILE_UPDATED'],
      },
      tenantId: { not: null },
      createdAt: { gte: range.from, lt: range.until },
    };
    const total = await tx.auditLog.count({ where });
    const rows = await tx.auditLog.findMany({
      where,
      include: { merchant: { select: { id: true, name: true } } },
      orderBy:
        query.sort === 'name'
          ? [{ merchant: { name: query.direction } }, { id: 'asc' }]
          : [{ createdAt: query.direction }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      availability: 'available',
      items: rows.map((row) => ({
        id: row.id,
        merchantId: row.tenantId,
        name: row.merchant?.name ?? null,
        status: row.action === 'MERCHANT_REGISTERED' ? 'REGISTERED' : 'BUSINESS_PROFILE_UPDATED',
        plan: null,
        date: row.createdAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }
}
