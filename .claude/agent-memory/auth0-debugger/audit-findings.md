# Auth0 Integration Audit Findings - 2026-02-18 (updated)

## Summary
Audited 20+ files across backend, frontend, and infrastructure.
Found 2 high, 5 medium, 4 low severity issues. No critical auth bypass.

## HIGH Severity

### H1: JWKS singleton has no explicit cache/cooldown config
- File: `jarble-api-main/src/services/auth.ts`, lines 8-18
- `createRemoteJWKSet` called without `cooldownDuration` or `cacheMaxAge`
- jose defaults (30s cooldown, 10min cache) apply internally, but no explicit config
- Risk: After key rotation, up to 10min of verification failures

### H2: /api/config-changed has no authentication
- File: `jarble-api-main/src/index.ts`, lines 424-453
- Only checks deploymentId exists. Anyone can trigger config sync + probe for valid IDs.

## MEDIUM Severity

### M1: SSE token in URL query param (proxy log leak)
- File: `jarble-api-main/src/index.ts`, lines 458-464, 589-596, 794-800
- `?token=` appears in access logs, browser history

### M2: Race condition in user auto-provisioning
- File: `jarble-api-main/src/services/auth.ts`, lines 57-159
- Concurrent first requests can both INSERT, second gets 500

### M3: Auth0 client ID hardcoded as fallback
- File: `Jarble-mvp/components/auth/Auth0Provider.tsx`, lines 6-9
- Missing env vars silently fall back to dev credentials

### M4: Frontend email_verified from stale Auth0 ID token
- Files: `Jarble-mvp/views/Dashboard.tsx:126`, `OnboardingWizard.tsx:437`
- Uses Auth0 SDK `user.email_verified` instead of DB-sourced `emailVerified`
- `trpc.user.me` exists but is never called from frontend

### M5: localStorage token storage (XSS risk)
- File: `Jarble-mvp/components/auth/Auth0Provider.tsx:16`
- `cacheLocation: "localstorage"` exposes tokens+refresh tokens to XSS

## LOW Severity

### L1: Account linking overwrites auth0Id silently
- File: `jarble-api-main/src/services/auth.ts`, lines 100-132

### L2: Debug endpoints gated only by NODE_ENV
- File: `jarble-api-main/src/index.ts`, lines 960-1028
- NODE_ENV defaults to "development" in env schema

### L3: Post Login Action only fires for auth0| users
- File: `infrastructure/auth0/post-email-verification-action.js`, line 38

### L4: AUTH0_DOMAIN defaults to "test.auth0.com"
- File: `jarble-api-main/src/utils/env.ts`, line 14
- Fail-safe (rejects tokens) but confusing error messages

## Positive Findings
- All sensitive tRPC routes use protectedProcedure
- SSE endpoints verify JWT + deployment ownership before streaming
- Stripe webhook uses signature verification
- Rate limiting well-structured (3 tiers, skip rules)
- M2M webhook auth works correctly
- CORS restrictive in production
- useRefreshTokens enabled
