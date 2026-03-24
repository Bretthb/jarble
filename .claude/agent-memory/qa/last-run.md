# Last QA Run

## Run Details
- **Timestamp**: 2026-03-24T14:58:37Z
- **Git SHA**: 5da8a9e
- **Duration**: ~12 minutes
- **Pass rate**: 67% (8 pass, 1 warn, 4 env-skip)
- **Real bugs found**: 0
- **Environment issues**: 1 (auth injection incompatible with useRefreshTokens)

## Goals Tested

| # | Goal | Type | Status | Notes |
|---|------|------|--------|-------|
| 1 | Authenticated tRPC endpoints (8 endpoints) | API | WARN | 6/8 passed; 2 stale procedure names corrected |
| 2 | Dashboard page with auth | UI | ENV_SKIP | Auth0 SDK useRefreshTokens needs refresh_token |
| 3 | Billing page with auth | UI | ENV_SKIP | Same root cause |
| 4 | Settings page with auth | UI | ENV_SKIP | Same root cause |
| 5 | Deployments page with auth | UI | ENV_SKIP | Same root cause |
| 6 | Marketplace page | UI | PASS | 3 components, search, filters, tabs |
| 7 | Explore page | UI | PASS | All 4 sections, empty states correct |
| 8 | Public tRPC coverage gaps (8 endpoints) | API | PASS | All valid |
| 9 | Docs page | UI | PASS | 7 sections, sidebar, search |
| 10 | Register page | UI | PASS | Redirects to /login correctly |
| 11 | Homepage regression | UI | PASS | All sections intact |
| 12 | Public API regression (5 endpoints) | API | PASS | All healthy |

## Failures
None (real bugs). All failures are environment issues.

## Environment Issues

### Auth0 SPA SDK session injection incompatible with useRefreshTokens
- **Affects**: Goals 2-5 (all authenticated UI pages)
- **Root cause**: `Auth0Provider.tsx` uses `useRefreshTokens={true}`. SDK calls `_getTokenUsingRefreshToken()` on init, needs `refresh_token` in localStorage cache. Our injection only has `access_token`.
- **Console error**: `[Auth] Token refresh failed: Missing Refresh Token`
- **Fix needed**: `scripts/nightly-qa/lib/auth.mjs` must capture and pass `refresh_token` from Auth0 ROPG response

## Warnings

### Stale procedure names in test plan
- `skills.list` → correct: `skills.listCatalog`
- `platformCredentials.list` → correct: `platformCredentials.getByDeployment`

## Key Observations
- API auth works perfectly — all 8 authed endpoints return correct data via Bearer token
- user.me returns: email=smallradcomp@gmail.com, role=user, freeDeploymentUsed=false
- agentCredits: 3 tiers (500/$5, 2500/$20, 10000/$100)
- skills.listCatalog: 22 skills (Web Search, Weather, Calculator, etc.)
- Marketplace: 3 components (Sales Dashboard, Analytics Chart, Contact Form)
- Explore: 4 sections with proper empty states
- Docs: 7 doc sections with sidebar nav and search
- Homepage: beta banner (March 29th), hero, chat preview, 20+ integrations, 6 features
- All API responses under 15ms

## Healer Actions
(none needed — no real bugs found)

## Next Run Priorities
1. Fix auth injection to include refresh_token, then retest dashboard/billing/settings/deployments
2. Test onboarding wizard flow (create deployment)
3. Test chat page (/d/[id])
4. Run security tests (XSS, injection, auth bypass)
5. Test remaining docs sub-pages
