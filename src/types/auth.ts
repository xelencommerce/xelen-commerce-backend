export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  email: string;
  roles: string[];
  permissions: string[];
  mfaKind: 'TOTP' | 'SMS' | 'RECOVERY';
}
export interface TenantContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  permissions: string[];
}
export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string;
}
