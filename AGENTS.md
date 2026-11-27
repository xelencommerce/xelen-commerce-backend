# Backend development instructions

- Keep this a strict TypeScript NestJS modular monolith. Preserve the separate frontend; changes there require explicit approval.
- Controllers validate/authorize and delegate. Modules own business behavior. Infrastructure owns external clients. Do not introduce circular imports or speculative business modules.
- Every route requires authentication unless explicitly `@Public()`. Platform routes require a fresh database role, permission, and a TOTP-authenticated session.
- Merchant routes require verified active membership, permissions, and tenant-scoped transactions. Use `DatabaseService.tenant()` only with verified context. Scope every query; retain forced RLS. Never reuse a transaction outside its callback or use session-scoped tenant GUCs.
- Future tenant-owned relationships must include composite tenant constraints. Runtime database roles must be non-owner, non-superuser and NOBYPASSRLS. DDL and role assignment use a separate operator connection.
- Never log credentials, OTPs, challenge/reset/refresh/access tokens, enrollment URIs, recovery codes, message payloads, cookies, authorization headers, or environment contents.
- Do not fabricate production dashboard data, payment contracts, verification statuses or KYC requirements. Missing sources use explicit unavailable/null values.
- No paid providers or cloud resources without authorization. Keep test delivery fakes in `test/`, never public debug endpoints.
- Keep `.env*`, generated clients, local database data and `README.md` ignored; README remains on this computer as requested. Commit `.env.example` and migrations only. Do not commit/push without instructions.
- Before database changes, read the available PostgreSQL best-practices skill. Add a new versioned migration; never rewrite a migration already applied.
- Run `npm run check` and `npm audit --audit-level=moderate`. Integration tests require the isolated local `xelen_test` database and must fail closed for other targets.
