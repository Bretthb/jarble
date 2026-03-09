# Auth0 Debugger - Agent Memory

## Architecture Summary
- **Backend**: `jarble-api-main/` - Express + tRPC, `jose` JWKS verification
- **Frontend**: `Jarble-mvp/` - Next.js 15, `@auth0/auth0-react`, tRPC React Query
- **Auth0 Tenant**: `jarble-dev.us.auth0.com`
- **API Audience**: `https://api.jarble.ai`
- **Claims Namespace**: `https://api.jarble.ai` (email, name, email_verified)

## Key Auth Files
- Backend JWT: `jarble-api-main/src/services/auth.ts`
- tRPC context: `jarble-api-main/src/trpc/context.ts`
- tRPC middleware: `jarble-api-main/src/trpc/middleware.ts`
- Main server: `jarble-api-main/src/index.ts`
- Rate limiting: `jarble-api-main/src/middleware/rateLimit.ts`
- Env config: `jarble-api-main/src/utils/env.ts`
- Frontend Auth0Provider: `Jarble-mvp/components/auth/Auth0Provider.tsx`
- Frontend providers: `Jarble-mvp/app/providers.tsx`
- Auth0 Action: `infrastructure/auth0/post-email-verification-action.js`

## Known Issues (from 2026-02-18 audit)
See `audit-findings.md` for full report.

## Patterns
- M2M auth uses shared secret (AUTH0_M2M_SECRET), not client credentials flow
- SSE endpoints accept `?token=` query param for EventSource (no header support)
- User auto-provisioning on first JWT verification in `getUserFromToken()`
- Email-by-email account linking in `getUserFromToken()` (Google + email/pass merge)
- JWKS cached as singleton, no explicit TTL/cooldown configured
- Rate limit key extraction uses unverified JWT `sub` claim (by design, for perf)
