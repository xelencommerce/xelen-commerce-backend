-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'MERCHANT');

-- CreateEnum
CREATE TYPE "FactorKind" AS ENUM ('TOTP', 'SMS', 'RECOVERY');

-- CreateEnum
CREATE TYPE "ChallengePurpose" AS ENUM ('REGISTRATION', 'LOGIN', 'ENROLLMENT', 'STEP_UP');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'REAUTHENTICATION');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200),
    "status" "MerchantStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "businessName" VARCHAR(200) NOT NULL,
    "industry" VARCHAR(100) NOT NULL,
    "otherIndustry" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantMembership" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MerchantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "scope" "RoleScope" NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mfaKind" "FactorKind" NOT NULL,
    "authenticatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "ipHash" VARCHAR(64) NOT NULL,
    "userAgent" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "replacedBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaMethod" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "FactorKind" NOT NULL,
    "secretCipher" TEXT,
    "phone" VARCHAR(16),
    "lastCounter" BIGINT,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MfaMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "purpose" "ChallengePurpose" NOT NULL,
    "sessionId" UUID,
    "selectedKind" "FactorKind",
    "pendingSecretCipher" TEXT,
    "phoneTarget" VARCHAR(16),
    "otpHash" VARCHAR(64),
    "otpExpiresAt" TIMESTAMPTZ(3),
    "lastSentAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "remember" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "tenantId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityId" UUID,
    "requestId" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" VARCHAR(64) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Merchant_status_createdAt_idx" ON "Merchant"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_tenantId_key" ON "BusinessProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_tenantId_id_key" ON "BusinessProfile"("tenantId", "id");

-- CreateIndex
CREATE INDEX "MerchantMembership_userId_status_idx" ON "MerchantMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "MerchantMembership_roleId_idx" ON "MerchantMembership"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantMembership_tenantId_userId_key" ON "MerchantMembership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantMembership_tenantId_id_key" ON "MerchantMembership"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MfaMethod_userId_kind_key" ON "MfaMethod"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MfaChallenge_tokenHash_key" ON "MfaChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "MfaChallenge_userId_idx" ON "MfaChallenge"("userId");

-- CreateIndex
CREATE INDEX "MfaChallenge_sessionId_idx" ON "MfaChallenge"("sessionId");

-- CreateIndex
CREATE INDEX "MfaChallenge_expiresAt_idx" ON "MfaChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_userId_codeHash_key" ON "RecoveryCode"("userId", "codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "UserToken_tokenHash_key" ON "UserToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UserToken_userId_purpose_idx" ON "UserToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "UserToken_sessionId_idx" ON "UserToken"("sessionId");

-- CreateIndex
CREATE INDEX "UserToken_expiresAt_idx" ON "UserToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_id_idx" ON "AuditLog"("tenantId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_id_idx" ON "AuditLog"("action", "createdAt", "id");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantMembership" ADD CONSTRAINT "MerchantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantMembership" ADD CONSTRAINT "MerchantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantMembership" ADD CONSTRAINT "MerchantMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaMethod" ADD CONSTRAINT "MfaMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaChallenge" ADD CONSTRAINT "MfaChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaChallenge" ADD CONSTRAINT "MfaChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Security invariants not represented by Prisma's declarative schema.
ALTER TABLE "User" ADD CONSTRAINT user_email_normalized CHECK (email = lower(btrim(email)));
ALTER TABLE "User" ADD CONSTRAINT user_failed_logins_nonnegative CHECK ("failedLogins" >= 0);
ALTER TABLE "MfaChallenge" ADD CONSTRAINT challenge_attempts_nonnegative CHECK (attempts >= 0 AND "resendCount" >= 0);
ALTER TABLE "MfaMethod" ADD CONSTRAINT mfa_method_shape CHECK (
  (kind = 'TOTP' AND "secretCipher" IS NOT NULL AND phone IS NULL) OR
  (kind = 'SMS' AND phone IS NOT NULL AND "secretCipher" IS NULL)
);
ALTER TABLE "BusinessProfile" ADD CONSTRAINT business_name_not_blank CHECK (length(btrim("businessName")) > 0);
ALTER TABLE "BusinessProfile" ADD CONSTRAINT other_industry_description CHECK (industry <> 'Other' OR length(btrim(coalesce("otherIndustry", ''))) > 0);
ALTER TABLE "Session" ADD CONSTRAINT session_expiry_valid CHECK ("expiresAt" > "createdAt");

CREATE SCHEMA app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE FUNCTION app_private.actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.actor_id', true), '')::uuid
$$;
CREATE FUNCTION app_private.tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
CREATE FUNCTION app_private.platform_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.platform_access', true) = 'true', false)
    AND EXISTS (
      SELECT 1 FROM public."UserRole" ur
      JOIN public."Role" r ON r.id = ur."roleId"
      JOIN public."User" u ON u.id = ur."userId"
      WHERE ur."userId" = app_private.actor_id()
        AND r.name = 'SUPER_ADMIN' AND r.scope = 'PLATFORM'
        AND u.status = 'ACTIVE' AND u."emailVerifiedAt" IS NOT NULL
    )
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app_private TO xelen_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO xelen_app;

ALTER TABLE "Merchant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Merchant" FORCE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON "Merchant" USING (id = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed()))
  WITH CHECK (id = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed()));
ALTER TABLE "BusinessProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusinessProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_isolation ON "BusinessProfile" USING ("tenantId" = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed()))
  WITH CHECK ("tenantId" = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed()));
ALTER TABLE "MerchantMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MerchantMembership" FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON "MerchantMembership" FOR SELECT USING (
  "userId" = (SELECT app_private.actor_id()) OR "tenantId" = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed())
);
CREATE POLICY membership_insert ON "MerchantMembership" FOR INSERT WITH CHECK ("tenantId" = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed()));
CREATE POLICY membership_update ON "MerchantMembership" FOR UPDATE USING ("tenantId" = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed()))
  WITH CHECK ("tenantId" = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed()));
CREATE POLICY membership_delete ON "MerchantMembership" FOR DELETE USING ("tenantId" = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed()));
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON "AuditLog" FOR SELECT USING ("tenantId" = (SELECT app_private.tenant_id()) OR "actorId" = (SELECT app_private.actor_id()) OR (SELECT app_private.platform_allowed()));
CREATE POLICY audit_append ON "AuditLog" FOR INSERT WITH CHECK (
  ("actorId" = (SELECT app_private.actor_id()) OR "actorId" IS NULL)
  AND ("tenantId" IS NULL OR "tenantId" = (SELECT app_private.tenant_id()) OR (SELECT app_private.platform_allowed()))
);

CREATE FUNCTION app_private.check_role_scope() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'MerchantMembership' THEN
    IF NOT EXISTS (SELECT 1 FROM public."Role" WHERE id = NEW."roleId" AND scope = 'MERCHANT') THEN
      RAISE EXCEPTION 'Invalid membership role scope' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public."Role" WHERE id = NEW."roleId" AND scope = 'PLATFORM') THEN
      RAISE EXCEPTION 'Invalid platform role scope' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.check_role_scope() FROM PUBLIC;
CREATE TRIGGER membership_role_scope BEFORE INSERT OR UPDATE OF "roleId" ON "MerchantMembership" FOR EACH ROW EXECUTE FUNCTION app_private.check_role_scope();
CREATE TRIGGER platform_role_scope BEFORE INSERT OR UPDATE OF "roleId" ON "UserRole" FOR EACH ROW EXECUTE FUNCTION app_private.check_role_scope();

INSERT INTO "Role" (id, name, scope) VALUES
 ('00000000-0000-4000-8000-000000000001', 'SUPER_ADMIN', 'PLATFORM'),
 ('00000000-0000-4000-8000-000000000002', 'MERCHANT_ADMIN', 'MERCHANT');
INSERT INTO "Permission" (id, key) VALUES
 ('00000000-0000-4000-8000-000000000011', 'platform.dashboard.read'),
 ('00000000-0000-4000-8000-000000000012', 'merchant.profile.read'),
 ('00000000-0000-4000-8000-000000000013', 'merchant.profile.update');
INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011'),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000012'),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000013');

GRANT SELECT, INSERT, UPDATE ON "User", "Merchant", "BusinessProfile", "MerchantMembership" TO xelen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Session", "RefreshToken", "MfaMethod", "MfaChallenge", "RecoveryCode", "UserToken", "RateLimitBucket" TO xelen_app;
GRANT SELECT ON "Role", "Permission", "RolePermission", "UserRole" TO xelen_app;
GRANT SELECT, INSERT ON "AuditLog" TO xelen_app;
-- The runtime role has no schema ownership, DDL, role-assignment writes, or audit UPDATE/DELETE privileges.
