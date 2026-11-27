# API contracts

Base path `/api/v1`. Swagger is enabled in local/test environments at `/api/docs`, machine-readable at `/api/docs-json`; `npm run openapi` exports `docs/openapi.json`. Response DTOs document the success envelope. All endpoints use JSON; unexpected DTO fields are rejected. Request payload maximum is 64 KiB. Correlation IDs are generated or accept 1–80 alphanumeric/underscore/hyphen characters from `X-Request-Id`.

```json
{ "success": true, "data": {}, "meta": { "requestId": "correlation-id" } }
```

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "The request contains invalid data." },
  "requestId": "correlation-id"
}
```

No error contains database/provider details, stack traces or rejected secret values. Important codes: VALIDATION_ERROR (400), INVALID_DATE_RANGE/INVALID_PHONE/INVALID_FACTOR (400), AUTHENTICATION_REQUIRED/INVALID_CREDENTIALS/INVALID_CHALLENGE/SESSION_REVOKED (401), FORBIDDEN/REAUTHENTICATION_REQUIRED/CSRF_REJECTED/ORIGIN_REJECTED/TOTP_REQUIRED (403), NOT_FOUND (404), MFA_REQUIRED (409), PAYLOAD_TOO_LARGE (413), JSON_REQUIRED (415), RATE_LIMITED/RESEND_COOLDOWN/RESEND_LIMIT (429), EMAIL_UNAVAILABLE/SMS_UNAVAILABLE/NOT_READY (503). DTO errors intentionally omit field values. Enums and limits appear in OpenAPI; preserve local client validation for field-level UX.

## Authentication endpoints

All paths below are prefixed by `/api/v1/auth`. Public means no bearer session; factor operations still require an authorized opaque challenge. Cookie-bearing mutations always require browser CSRF/Origin checks.

| Method/path                 | Access and request                                                              | Result                                                                       |
| --------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| POST `/register`            | Public: email, password, confirmPassword                                        | 202 generic accepted; pending merchant transaction, verification email       |
| POST `/verify-email`        | Public: token (43 URL-safe characters)                                          | Enrollment challenge, no session                                             |
| POST `/verify-email/resend` | Public: email                                                                   | 202 generic accepted                                                         |
| POST `/login`               | Public: email, password, optional remember boolean                              | MFA/enrollment challenge, availableMethods, expiresIn                        |
| POST `/mfa/challenge`       | Public: challengeToken, method TOTP/SMS/RECOVERY; phone only for SMS enrollment | CODE_REQUIRED or CODE_SENT with masked destination/cooldown                  |
| POST `/mfa/verify`          | Public: challengeToken, code (6–32 chars; factor-specific validation)           | AUTHENTICATED, MFA_ENROLLED or REAUTHENTICATED                               |
| POST `/mfa/resend`          | Public: challengeToken                                                          | SMS resend; 45-second cooldown                                               |
| POST `/mfa/totp/setup`      | Public: enrollment challengeToken                                               | Real otpauthUri and PNG QR data URL                                          |
| POST `/mfa/totp/confirm`    | Public: enrollment challengeToken, six-digit code                               | Confirmed enrollment/session or added method                                 |
| POST `/reauthenticate`      | Bearer: current password                                                        | STEP_UP challenge for another factor                                         |
| POST `/mfa/enrollment`      | Bearer: reauthToken                                                             | Authorized new/replacement enrollment challenge                              |
| POST `/mfa/recovery-codes`  | Bearer: reauthToken                                                             | Ten new codes, disclosed once; invalidates old codes                         |
| POST `/mfa/remove`          | Bearer: reauthToken, method TOTP/SMS                                            | Remove eligible method and revoke sessions                                   |
| GET `/csrf`                 | Public, credentials included                                                    | csrfToken and readable signed cookie                                         |
| POST `/refresh`             | Refresh cookie, allowlisted Origin, X-CSRF-Token                                | Rotated cookies/access token; no refresh token in JSON                       |
| POST `/logout`              | Bearer                                                                          | Revoke current session, clear cookies                                        |
| POST `/logout-all`          | Bearer                                                                          | Revoke all sessions, clear cookies                                           |
| POST `/forgot-password`     | Public: email                                                                   | 202 generic accepted                                                         |
| POST `/reset-password`      | Public: token, password, confirmPassword                                        | PASSWORD_CHANGED; all sessions invalidated                                   |
| GET `/me`                   | Bearer                                                                          | Identity, current roles/permissions, memberships and intended dashboard path |

Only AUTHENTICATED returns accessToken, tokenType=Bearer, expiresIn and csrfToken, plus HttpOnly cookies. Initial enrollment also returns recoveryCodes once. REAUTHENTICATED returns a short-lived reauthToken, never a new session. Client handling must branch on `status`. The backend navigation hint `/admin/master-dashboard` is an intended protected destination, not a production auth bypass or change to the existing frontend development-only preview route.

## Merchant profile

GET/PATCH `/merchants/:merchantId/business-profile` requires bearer, active membership and `merchant.profile.read`/`merchant.profile.update`. Missing membership and unknown merchant both return 404. PATCH accepts businessName, one of the existing 15 frontend industries and required otherIndustry when industry=Other. It updates the profile/name and appends an audit event transactionally. No endpoint approves KYC, accepts document uploads, or activates a merchant.

## Dashboard

All seven GET endpoints under `/super-admin/dashboard/` require SUPER_ADMIN, `platform.dashboard.read`, and a TOTP-authenticated session. Each successful platform read is audited.

| Endpoint            | Available data                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `overview`          | Real current-active and selected-period registered merchant counts; availability of missing domains |
| `metrics`           | Active merchant KPI, explicit unavailable/null financial/support/KYC KPIs                           |
| `gmv`               | Empty series, unavailable reason and requested currency (nullable)                                  |
| `payment-health`    | Empty distribution and null refund/chargeback figures                                               |
| `risk-alerts`       | Unavailable empty items with pagination                                                             |
| `settlements`       | Unavailable empty records                                                                           |
| `merchant-activity` | Real registration/business-profile audit events, tenant/name, timestamp, null plan                  |

Shared query DTO: period=today|weekly|monthly|custom; custom requires start/end YYYY-MM-DD. Today is current UTC calendar day; weekly is trailing seven calendar days inclusive; monthly is trailing thirty days inclusive. Start/end are inclusive UTC days, implemented as `[start 00:00, day-after-end 00:00)`. Maximum range 366 days; nonexistent/reversed dates are rejected. Explicit dates with a non-custom period are rejected.

Pagination: page 1–100000 (default 1), pageSize 1–100 (default 10), total, totalPages; zero results have totalPages=0. Merchant activity supports sort=date|name, direction=asc|desc, status=REGISTERED|BUSINESS_PROFILE_UPDATED. Stable UUID tie-breaker prevents ambiguous ordering. No arbitrary SQL column input is accepted. Currency is a requested uppercase three-letter code only; no conversion is performed. Client adapters for V1/collapsed/Bento should consume these same contracts and render unavailable/empty states rather than frontend mock totals. These contracts intentionally do not claim the frontend fixture status/plan data is authoritative.

### Financial definitions and unresolved decisions

Only two merchant counts are implemented. `activeMerchants` means **currently** ACTIVE merchants created before the selected end-of-day; historical activation/deactivation cannot be reconstructed yet. `registeredMerchants` counts tenant creation within the selected UTC range. Activity reflects actual registration/profile audit events; neither implies KYC approval or live payment readiness.

Production GMV needs approved paid-order recognition time, gross/net treatment, taxes/shipping, refunds/cancellations and currency policy. Total transactions needs eligible payment attempt/status/provider-event deduplication rules. Failed payment rate needs a defined denominator, terminal status mapping, retries and exclusion rules. Payment health, refund volume, chargeback rate and settlements need authoritative provider/ledger sources and reconciliation. Support tickets, pending KYC and risk alerts need their own approved workflows and status definitions. Until approved, these values are unavailable/null, not zero. Future money uses integer minor-unit decimal strings with currency; future rates need an explicit integer-basis-point or decimal contract. No financial calculations are simulated.

## Operations

GET `/health/live` is public process liveness; GET `/health/ready` checks PostgreSQL and configured Redis, returning 503 when required infrastructure is unavailable. GET `/operations/metrics` is audited Super Admin/TOTP-only and returns bounded process-lifetime request/error/latency counters, uptime and resident memory. These counters reset per process and do not replace an external metrics system.
