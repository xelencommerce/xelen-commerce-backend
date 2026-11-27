# Configuration and operations

Copy `.env.example` or use `local:init`. No real credentials are committed. Separate development, isolated test, staging and production environments/databases/keys. `DATABASE_URL` must use the restricted runtime role; only tooling needs `MIGRATION_DATABASE_URL`. Never include migration credentials in the production web process. Production/staging must have HTTPS frontend/exact CORS origins, verified database TLS, enabled SMTP and disabled public Swagger. Use an external secret manager and TLS ingress before exposure.

| Configuration                                       | Meaning                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| NODE_ENV, HOST, PORT, API_PREFIX                    | Environment; default loopback:4000, fixed api/v1                             |
| DATABASE_URL, DB_POOL_MAX                           | Restricted runtime pool, default max 10                                      |
| MIGRATION_DATABASE_URL                              | Privileged CLI/migration identity, not runtime                               |
| TEST_DATABASE_URL, TEST_MIGRATION_DATABASE_URL      | Local xelen_test connections only                                            |
| REDIS_URL                                           | Optional dependency; omitted means disabled                                  |
| JWT_ACCESS_SECRET, JWT_REFRESH_SECRET               | Distinct random secrets, at least 64 characters                              |
| TOKEN_HASH_SECRET                                   | Third distinct random HMAC key, at least 64 characters                       |
| MFA_ENCRYPTION_KEY                                  | Random 32-byte key encoded base64; protect for backup/restore                |
| JWT_ACCESS_TTL / JWT_REFRESH_TTL / JWT_REMEMBER_TTL | Seconds: default 900 / 604800 / 2592000; bounded                             |
| JWT_ISSUER / JWT_AUDIENCE                           | Explicit token trust boundary                                                |
| FRONTEND_URL / CORS_ORIGINS                         | Exact origins without paths/wildcards; comma-separated CORS                  |
| COOKIE_SAME_SITE                                    | lax by default; none requires secure deployment                              |
| TRUST_PROXY_HOPS                                    | Default 0; configure only for a fixed trusted ingress path                   |
| DOCS_ENABLED                                        | true locally; must be false for staging/production                           |
| EMAIL_PROVIDER / EMAIL_FROM                         | disabled or smtp; approved sending identity                                  |
| SMTP_HOST/PORT/USER/PASSWORD/SECURE                 | Configurable delivery, finite timeouts; TLS required outside development     |
| SMS_PROVIDER / TWILIO_*                             | disabled or explicitly configured Twilio; no real service has been activated |

Request logs contain correlation ID, method, path, status and duration. Query strings, headers, bodies, cookie values and exception/provider details are excluded. Pino redaction is defense in depth, not permission to add sensitive structured fields. Audit records store controlled action names and IDs. Production error responses are sanitized. Forward structured logs to a secured central collector during deployment; no paid monitoring/error-reporting service is configured here.

Email delivery uses the encrypted database outbox and automatic bounded retries. Monitor EMAIL_DELIVERY_EXHAUSTED audit events, queue age/size and provider delivery/bounce reports. Run `auth:cleanup` periodically for expired challenges, grants, rate buckets and expired sessions with cascading refresh tokens. Do not delete consumed refresh-token records before absolute session expiry. Audit retention is a separate reviewed operation; the web role cannot erase audit records.

Health probes should use readiness/liveness separately. Graceful SIGTERM/SIGINT closes the HTTP app, PostgreSQL pool, optional Redis connection and outbox worker. Outbox leases permit safe recovery after process loss. Process counters are available to authorized Super Admins; use platform logs/metrics for aggregated latency and alerting. Resource/load testing and production pool sizing remain deployment work.

CI runs npm ci, isolated PostgreSQL role/database setup, migrations, typecheck, lint, formatting, Jest, build and npm audit. The workflow assumes backend is the repository root; adjust working-directory/path filters only if adopting a monorepo. CI PostgreSQL credentials are ephemeral test fixtures. Current transitive overrides pin patched Effect 3, Glob 14 and Minimatch 11; re-evaluate/remove when upstream ranges are patched. Full tests/build and coverage discovery validate their compatibility.

The Dockerfile has separate tooling/runtime targets, omits dev dependencies from runtime and uses the node user. Compose is local-only with loopback host ports, persistent PostgreSQL volume and Mailpit. Docker was not available on the current computer, so container execution/image builds remain to be verified in Docker/CI. The application and both migrations were tested against native PostgreSQL instead.

Before production: configure/review SMTP and optional SMS, domain/TLS/CORS/CSRF behavior, protected operator provisioning, secret/key rotation, durable backups/PITR with restore drills, RLS grants under managed pooling, abuse controls/alerts, load tests and independent security review. Set provider spending limits and SMS anti-fraud policy before enabling SMS. No cloud resources were provisioned. No regulatory compliance certification is claimed.
