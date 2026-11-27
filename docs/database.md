# PostgreSQL and tenancy

## Connections and migrations

Prisma 7 uses its PostgreSQL driver adapter. `DATABASE_URL` is the restricted pooled web connection; `MIGRATION_DATABASE_URL` is a separate privileged operator connection used only by CLI/migration processes. The web application verifies that its role is neither superuser, BYPASSRLS nor owner of any public table, and that all four tenant/audit tables have forced RLS. It refuses startup otherwise.

UUID keys and UTC `timestamptz(3)` values are used throughout. Mutable entities have `createdAt`/`updatedAt`; one-use tokens and immutable audit events need only lifecycle-specific timestamps. No generalized soft-delete mechanism exists: account/merchant/membership statuses retain identity and history, while expired secrets are cleaned according to their security lifetime.

Migrations seed roles/permissions, never credentials. New environments must provision a non-owner LOGIN role named `xelen_app`, with NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS, before migration. Runtime grants are explicit; no schema DDL, platform role writes or audit UPDATE/DELETE are granted. Restrict the migration identity to migration/operator jobs. Staging/production URLs require `sslmode=verify-full` and a trusted CA; confirm certificate verification for your provider and connection proxy.

For a new migration, generate a diff against a dedicated development database, review SQL and add the next migration directory. Preserve custom checks, grants, functions, triggers and RLS: Prisma does not represent every PostgreSQL security object. Never use `db push` in production or edit an applied migration. Pool maximum defaults to 10 per process; size against database capacity multiplied by replicas/workers, leaving operator headroom. If using PgBouncer, use transaction pooling and a direct migration connection.

## Initial relationships

- User: normalized unique email, Argon2id hash, verification/status and brute-force counters.
- Merchant: a tenant, initially PENDING; no invented KYC activation rule.
- MerchantMembership: unique `(tenantId,userId)`, status and merchant-scoped Role.
- BusinessProfile: one per tenant; required name and approved industry, with description for Other.
- Role/Permission/RolePermission: reusable role grants. UserRole assigns platform roles only. A database trigger rejects mixing platform roles with merchant membership roles.
- Session: verified factor, absolute expiry and revocation; all refresh tokens belong to one session.
- RefreshToken: HMAC, consumed/replacement pointers and expiry. Consumed tokens remain through absolute session expiry for reuse detection.
- MfaMethod: one confirmed TOTP/SMS per user/kind, encrypted TOTP secret or normalized phone and last accepted TOTP counter.
- MfaChallenge: scoped opaque-token HMAC, purpose, optional session, expiry, cumulative attempts, selected method, encrypted pending enrollment material and SMS HMAC/cooldown.
- RecoveryCode: user-scoped HMAC and single-use timestamp.
- UserToken: purpose-separated email-verification, password-reset and session-bound reauthentication grants. A shared table replaces redundant identically shaped token tables.
- AuditLog: append-only actor/tenant/action/entity/request correlation; contains no free-form credentials or request bodies.
- EmailOutbox: short-lived encrypted delivery payload, user FK, retry counter and lease. Global auth infrastructure, not a merchant-owned domain entity.
- RateLimitBucket: atomic HMAC-keyed count and expiry.

Indexes cover email, membership user/status and tenant, role/FK references, active/expired sessions, challenges/tokens, outbox scheduling, audit tenant/action/time and dashboard merchant status/time. BusinessProfile and membership also expose unique `(tenantId,id)` pairs for future tenant-composite relations.

## Tenant isolation

A verified access token resolves its current database session and User status. Merchant Guard looks up active membership for the route merchant UUID using the verified actor context. Permission Guard checks the membership's current role. Suspended merchants cannot enter merchant APIs. Profile repository rechecks active user/merchant status and membership/permission inside its transaction, scopes every query to tenantId, and writes its audit event in the same transaction.

`DatabaseService.tenant` sets actor, tenant and platform flag with `set_config(..., true)` inside a Prisma interactive transaction. Transaction-local settings clear on commit/rollback; never set tenant state on a pooled connection outside that transaction. RLS is forced on Merchant, BusinessProfile, MerchantMembership and AuditLog. Readable membership discovery is restricted to the actor's own memberships. A tenant context cannot reference another tenant's profile. Integration tests exercise guard, repository and direct runtime-role SQL isolation, including pooled cleanup.

RLS is defense in depth, not a substitute for parameterized SQL and verified membership: the application role can set GUC context. Arbitrary code execution/SQL injection with application credentials remains outside that boundary. Never accept raw tenant/actor context from a request body. Authorization checks precede entering tenant context; future repositories must follow the same rule. Future tenant-owned child relationships must use `(tenantId,parentId)` foreign keys to prevent cross-tenant references at the constraint level.

Platform reads require the verified SUPER_ADMIN database role, explicit permission, a TOTP session, an audited platform transaction, and database role verification in the RLS function. A merchant setting the platform flag alone does not acquire platform visibility.

## Future data and finance

Future entity groups: Product/ProductVariant/Inventory; Customer/Order/OrderItem; Payment/Transaction/Refund/Return; Settlement/Dispute; Subscription/Plan/Invoice; SupportTicket/Notification. Merchant-owned records require tenantId, indexes prefixed by tenant for expected queries and tenant-composite relationships. Payment webhook records need provider event uniqueness, signature verification, replay protection and transactional idempotency before processing.

Use integer minor units (BigInt represented as decimal strings over JSON) with explicit ISO currency, or reviewed PostgreSQL decimal precision. Never use floating-point money, assume all currencies have two decimal places, silently aggregate currencies, or store raw card details. No financial tables or payment-provider assumptions are introduced here. Audit retention, personal-data deletion, backup/PITR and production role provisioning require operational policy before deployment.
