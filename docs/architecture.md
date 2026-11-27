# Architecture

## Scope and boundaries

This is a modular monolith. The backend directory was empty before this milestone; there was no framework, ORM or backend implementation to migrate. Existing React routes, authentication schemas and dashboard fixture contracts were inspected read-only. No frontend source changes are included.

```text
src/
  config/                 Validated environment and cookie policy
  common/
    constants/            Challenge and security limits
    decorators/           Explicit access policies and OpenAPI envelopes
    exceptions/           Machine-readable errors
    filters/              Sanitized exception responses
    guards/               Authentication, role, tenant, permission, request limits
    interceptors/         Success envelope
    middleware/           Browser Origin/CSRF/content-type policy
  infrastructure/
    database/             Prisma adapter, scoped transactions and atomic rate limits
    email/                SMTP delivery and encrypted durable outbox
    logging/              Pino integration and protected process metrics
    redis/                Optional connection and tenant key convention
    security/             Domain-separated HMACs, AES-GCM and CSRF signatures
    queues/ storage/ sms/ Reserved integration locations; no speculative clients
  modules/
    auth/                 Registration, verification, sessions, MFA, recovery, DTOs
    merchants/            Tenant-owned business profile and repository
    super-admin/          Shared dashboard contracts for all frontend layouts
    health/               Liveness and dependency readiness
  types/                  Verified request/user/tenant contexts
prisma/                   Schema, immutable migrations, development seed
scripts/                  Local databases, migration, operator and cleanup commands
test/                     Unit tests and isolated real-PostgreSQL HTTP tests
docs/                     Architecture, contracts and operational instructions
```

Controllers own HTTP validation/delegation. Auth services own state transitions; SessionService owns tokens/session revocation; MfaService owns enrollment and replay controls. TenantProfileRepository adds value by enforcing membership, permission and tenant scope inside the database transaction. Other services use Prisma directly instead of a generic repository for every table. Global infrastructure modules have no business-module imports.

## Configuration and state

All runtime configuration is parsed once through Zod. Explicit allowlisted CORS origins, bounded payloads, fail-closed providers and privileged-route guards are defaults. Server sessions and token hashes are persistent in PostgreSQL. No role/membership information from a browser is trusted. Redis is optional and is not required for authentication, rate limiting, email delivery or local tests.

Atomic PostgreSQL rate-limit buckets are sufficient for this initial deployment and work across application instances. Their HMAC keys contain no raw email/IP. Clean expired buckets with `auth:cleanup`. Move the limiter behind a Redis adapter if measured load warrants it; preserve atomic increments and tenant context. External gateway limits are still required for traffic before the application and for health probes.

## Delivery and jobs

Email creation is a transactionally committed encrypted outbox write. A bounded worker claims one row with `FOR UPDATE SKIP LOCKED`, a 60-second lease and at most five attempts. Failures retry after 5/10/20/40 seconds, bounded at five minutes. Expired or obsolete tokens are not delivered. Final completion/exhaustion is audited and the encrypted payload is deleted. SMTP delivery is at least once: a crash between send and completion may repeat the same single-use link. Provider delivery guarantees and bounce handling remain integration work.

No BullMQ dependency is installed: this durable, low-volume email workload does not require Redis. Adopt BullMQ for later notification/storage workflows when their contracts and operational requirements exist. Carry verified tenant IDs in future merchant jobs and cache/storage keys; authorize again at execution time.

SMS uses the configured provider synchronously with a finite timeout. Codes are random and only HMACs are stored. Provider failure invalidates the pending code. No production/debug inbox endpoint, test code, bypass or fixture auth exists.

## Future modules

Approved future modules become siblings under `modules`: products, inventory, orders, customers/CRM, payments, settlements, subscriptions, disputes, support, notifications and platform settings. Do not finalize their schemas before requirements/provider contracts. Cross-module calls use exported services; data access stays within the owning module. Publish domain events through a transactional outbox when workflows require reliable asynchronous boundaries.
