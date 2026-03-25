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

## Known Issues (from 2026-02-18 audit, updated 2026-03-25)
See `audit-findings.md` for full report.
- **C1**: Auth0Provider delayed mount (useEffect) breaks callback — use useState initializer instead
- **C2**: Refresh tokens failing — `fertft` "Token could not be decoded or is missing in DB"
- Resource server `token_dialect: "access_token"` (opaque) — should be `access_token_authz`
- SPA App Client ID: `1VR30862RmZIFR44UIM8aVHYEt3K2Rsh`
- Resource Server ID: `698bd51b0b50585493cbcce2`
- Google OAuth uses Auth0 dev keys (production should use custom credentials)

## Patterns
- M2M auth uses shared secret (AUTH0_M2M_SECRET), not client credentials flow
- SSE endpoints accept `?token=` query param for EventSource (no header support)
- User auto-provisioning on first JWT verification in `getUserFromToken()`
- Email-by-email account linking in `getUserFromToken()` (Google + email/pass merge)
- JWKS cached as singleton, no explicit TTL/cooldown configured
- Rate limit key extraction uses unverified JWT `sub` claim (by design, for perf)
