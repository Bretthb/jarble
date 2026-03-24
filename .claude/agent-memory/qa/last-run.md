# Last QA Run

## Run Details
- **Timestamp**: 2026-03-24T15:23:29Z
- **Git SHA**: 01eab8e
- **Duration**: ~15 minutes
- **Pass rate**: 43% (3 pass, 1 warn, 3 env-skip out of 7 goals)
- **Real bugs found**: 0
- **Environment issues**: 1 (Auth0 refresh token rotation invalidates injected refresh_token)

## Goals Tested

| # | Goal | Type | Status | Notes |
|---|------|------|--------|-------|
| 1 | Dashboard page with auth | UI | WARN | Renders correctly on FIRST load. Auth0 SDK background refresh rejects token (403). Session cleared on 2nd navigation. |
| 2 | Deployments page with auth | UI | ENV_SKIP | Same refresh_token rotation issue as Goal 1 |
| 3 | Billing page with auth | UI | ENV_SKIP | Same refresh_token rotation issue as Goal 1 |
| 4 | Settings page with auth | UI | ENV_SKIP | Same refresh_token rotation issue as Goal 1 |
| 5 | Authenticated API endpoints (11) | API | PASS | 11/11 passed (8 authed + 1 unauthed + 3 public) |
| 6 | Privacy + Terms pages | UI | PASS | Both render with 14 sections each, comprehensive content |
| 7 | Homepage regression | UI | PASS | All sections intact, no regressions |

## Failures
None (real bugs). All issues are environment-level.

## Environment Issues

### Auth0 Refresh Token Rotation Invalidates Injected Token
- **Affects**: Goals 1-4 (all authenticated UI pages after first navigation)
- **Root cause**: Auth0 has refresh token rotation enabled. The ROPG-granted refresh_token is valid for exactly ONE use. When the Auth0 SPA SDK detects the `auth0.*.is.authenticated` cookie, it immediately calls `POST /oauth/token` to refresh, consuming the single-use token. The refreshed token is returned by Auth0 but the SDK stores it internally — so on subsequent navigations the original injected token is gone.
- **Console error**: `[Auth] Token refresh failed: a: Unknown or invalid refresh token.`
- **Key insight**: The dashboard DID render authenticated content on the first load (before SDK refresh kicked in), proving the page code is correct and the injection format is valid.
- **Impact**: Auth-UI testing can verify first-load rendering but not navigation flows.
- **Possible fixes**:
  1. Disable refresh token rotation in Auth0 dev tenant settings
  2. Intercept and block the SDK's refresh attempt in test mode
  3. Accept first-load testing as sufficient (proves page rendering works)

## Warnings

### Dashboard First-Load PASS, Second-Load FAIL
- Dashboard on first load showed: user avatar "SM", email "smallradcomp@gmail.com", "Deployments" heading, "No deployments yet" empty state, email verification banner
- After SDK consumed refresh_token: session cleared, shows "Please log in to view your dashboard"
- This is an environment issue, not a code bug

## Key Observations
- API auth works perfectly — all 8 authed endpoints return correct data via Bearer token
- skills.listCatalog now returns 23 skills (was 22 in previous run — 1 new skill added)
- Privacy page: 14 sections including GDPR, EU AI Act, data minimization — genuine platform-specific content
- Terms page: 14 sections including AI-specific terms, BYOK model — not boilerplate
- Both legal pages last updated March 10, 2026, with Table of Contents and anchor links
- Homepage: Beta banner (March 29th), hero, chat preview, 20+ integrations, 6 features — consistent with previous runs
- All API response times under 0.3s (user.me slowest at 0.209s, others <15ms)

## Healer Actions
(none needed — no real bugs found)

## Next Run Priorities
1. Investigate disabling Auth0 refresh token rotation for dev tenant to enable full auth UI testing
2. Test onboarding wizard flow (create deployment)
3. Test chat page (/d/[id]) — requires a deployment to exist
4. Run security tests (XSS, injection, auth bypass)
5. Test docs sub-pages (/docs/api, /docs/architecture, etc.)
6. Test marketplace detail page (/marketplace/[id])
7. Test /beta and /analytics pages
