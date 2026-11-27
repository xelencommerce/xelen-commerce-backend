# Authentication and browser integration

## Approved flow

Public registration creates a pending user, pending merchant and Merchant Admin membership in one transaction. It cannot assign a platform role. Email ownership **must be verified before MFA enrollment or a session**; this additional step was explicitly approved. Registration, email resend and forgot-password use the same generic eligibility message for existing/unknown accounts.

1. POST `auth/register` with normalized email, password and matching confirmation. Receive 202 REQUEST_ACCEPTED; email delivery is queued transactionally.
2. Read the email's opaque token. The frontend must implement `/verify-email?token=...`, remove the token from the URL immediately, and POST it to `auth/verify-email`. No frontend changes were authorized in this milestone.
3. Receive MFA_ENROLLMENT_REQUIRED, challengeToken, availableMethods and expiry. Keep the challenge only in memory.
4. TOTP: POST `mfa/totp/setup`, show the real QR/URI, then POST `mfa/totp/confirm` with the challenge and current six-digit code. SMS: POST `mfa/challenge` with method SMS and normalized E.164 phone, then `mfa/verify` with the delivered code. Public methods still require possession of a valid scoped challenge.
5. Only confirmed MFA issues AUTHENTICATED, a short-lived bearer access token, and an HttpOnly refresh cookie. Save one-time recovery codes securely offline. GET `auth/me` for verified roles, memberships and navigation destination.

Normal login: password -> MFA_REQUIRED -> select factor -> verify -> session -> `me`. A verified user with no enrolled methods receives initial enrollment instead of a session. Merchant users can use TOTP, SMS or one-time recovery codes. SUPER_ADMIN accounts require TOTP for platform endpoints. A recovery-code session can perform recovery/re-enrollment but cannot access the platform dashboard until TOTP sign-in. Account/merchant status is not KYC approval.

## Passwords and abuse controls

Email is trimmed/lowercased, max 254 characters. Passwords are 8–128 characters with uppercase, number and non-whitespace special character; backend policy matches the current frontend. Confirmation is mandatory on register/reset. Argon2id uses 64 MiB memory, time cost 3, parallelism 1. Passwords, codes and bearer tokens never enter logs. Unknown-user login performs a dummy Argon2 verification and returns the same generic invalid-credentials response. Verify performance under production load and review breached-password screening as a later approved requirement.

Global request limit is 600/min/IP; login additionally 30/min/IP and 10/15 min/email. Five invalid password attempts lock an account for 15 minutes. Registration 5/hour/IP; reset and verification resend 3/hour/email; sensitive reauthentication 5/15 min/user. Buckets are atomic across replicas. Use a trusted ingress/WAF for traffic floods, payloads before the app and distributed bot abuse. Lockout plus cooldown intentionally limits abuse but may deny legitimate access during an attack; tune against operational evidence.

## Tokens, cookies and CSRF

Access: HS512, distinct signing secret, fixed issuer/audience/type/purpose, default 900 seconds. Browser keeps it in memory only. Every protected request checks the current DB session, user and current database roles/permissions, so revocation takes effect immediately. JWT signatures never establish frontend-chosen roles or tenancy.

Refresh: separate HS512 secret/audience/type/purpose. Only an HMAC of each token persists. Each rotation locks the session, consumes the old token and creates its replacement. Reuse revokes the session, including the newly rotated token. Session absolute expiry is 7 days, or 30 days for remember=true. Refresh does not extend the absolute lifetime. The client must serialize refresh across concurrent requests/tabs; stale parallel refreshes intentionally trigger reuse detection.

Production/staging cookie names are `__Host-xelen_refresh` and `__Host-xelen_csrf`; host-only Path=/, Secure, SameSite=Lax by default, and HttpOnly on refresh. CSRF is a signed random value, also returned in the authentication/refresh JSON for separate frontend origins. A refresh cookie is never serialized into JSON. With a refresh cookie present, **every unsafe request** needs an exact allowlisted Origin and matching signed CSRF cookie / `X-CSRF-Token`. Cross-site deployment may use SameSite=None only over secure staging/production; browser third-party cookie restrictions may require a same-site API domain/BFF.

Axios/fetch configuration: `withCredentials:true` / `credentials:'include'`; Bearer header for protected APIs; CSRF header for mutations. On reload, GET `/auth/csrf` with credentials, then POST `/auth/refresh` with returned token/header and credentials, then GET `/auth/me`. Read a newly rotated csrfToken from each session response. Do not read an HttpOnly cookie or store long-lived credentials in localStorage. Logout needs a valid access token; restore first if necessary. Clear in-memory auth/query caches after logout, and cancel/remove tenant queries before switching authorized tenants.

## MFA controls and sensitive actions

Challenges expire absolutely after 10 minutes. SMS codes expire after 5 minutes or earlier challenge expiry, are stored only as domain-separated HMACs, permit five cumulative failed attempts and at most five sends per challenge, with 45 seconds between sends. Resend does not reset attempts or extend the absolute deadline. Every successful challenge is consumed. TOTP uses SHA1, 6 digits, 30 seconds and a ±1-step clock window; a per-method monotonic accepted counter prevents replay across separate challenges. Keep servers time-synchronized.

TOTP secrets/pending secrets are AES-256-GCM encrypted with unique IVs. Ten random 96-bit recovery codes are disclosed once and stored only as HMACs; use is atomic and single-use. A confirmed method is required before session issuance; QR output is real enrollment material, not a fixture.

MFA modification: authenticated POST `reauthenticate` (current password) -> scoped STEP_UP challenge -> verify existing factor -> five-minute single-use session-bound reauthToken. Consume it at `mfa/enrollment`, `mfa/recovery-codes` or `mfa/remove`. Enrollment must be separately confirmed. Removal cannot remove the last factor or platform TOTP; it revokes all sessions. Replace platform TOTP through reauthenticated enrollment. Administrative recovery when all factors/codes are lost requires a reviewed operator policy; no bypass endpoint is provided.

## Recovery and privileged provisioning

Forgot-password returns generic 202. The random 256-bit link token expires after 15 minutes, is HMAC-stored, and is consumed once. Reset invalidates every session, outstanding challenge and user grant. Verification links expire after one hour. Email outbox payloads are encrypted, bounded by token lifetime, retried and deleted after completion/exhaustion. No debug token endpoint or log delivery exists.

`ADMIN_EMAIL=authorized@example.com npm run admin:create` runs an explicit privileged CLI with MIGRATION_DATABASE_URL and email delivery. It refuses to promote an existing customer account, creates no known password, audits provisioning and sends a short-lived password setup link. Operator provisioning attests the selected email; possession of that setup link and mandatory TOTP still precede login. Do not run the migration/operator identity in the web service. No privileged account is seeded automatically.

Rotate signing/HMAC/encryption keys through a planned operation: key changes invalidate tokens, and changing the MFA encryption key without decrypt/re-encrypt migration makes existing factors/outbox unreadable. Current v1 ciphertext has no key ring. A versioned key-rotation rollout and external secret manager remain production requirements.
