# Last QA Run

## Run Details
- **Timestamp**: 2026-04-23T02:32:43.513Z
- **Git SHA**: 27e3b8f
- **Duration**: ~12 minutes
- **Pass rate**: 73% (8 pass, 2 warn, 0 fail, 1 error, 6 skip out of 17 goals)
- **Real bugs found**: 0
- **Actionable gaps found**: 1 (echo runtime not seeded in runtimeCatalog DB)
- **Environment issues**: 2 (Chrome single-instance lock blocked UI; auth token RSA sig invalid)

## Goals Tested

| # | Goal | Type | Status | Notes |
|---|------|------|--------|-------|
| 1 | API Health Check | API | PASS | 200 OK in 0.22s — API live |
| 2 | user.me Auth | API | WARN | 401 — auth token had invalid RSA sig (environment, not API bug) |
| 3 | org.list — New Router | API | PASS | Router registered, returns 401 (protected, correct) |
| 4 | org.create — New Router | API | PASS | Procedure exists, returns 401 (correct) |
| 5 | deployment.list — Post-Rewrite | API | PASS | Router split didn't break routing |
| 6 | subagents.list — New Router | API | PASS | Router registered, returns 401 |
| 7 | Removed marketplace → 404 | API | PASS | Clean NOT_FOUND, not 500 |
| 8 | Removed benchmarks → 404 | API | PASS | Clean NOT_FOUND, not 500 |
| 9 | runtimeCatalog.list + echo | API | WARN | Only openclaw in catalog; echo runtime handler exists but not seeded in DB |
| 10 | user.acceptTerms — TOS | API | PASS | Procedure registered, returns 401 |
| 11 | Auth0 Login | UI | ERROR | Chrome single-instance lock blocked Playwright — can't open new browser session |
| 12 | Dashboard Load | UI | SKIP | Blocked by Goal 11 |
| 13 | /orgs (New Page) | UI | SKIP | Blocked by Goal 11 |
| 14 | Consent Modal | UI | SKIP | Blocked by Goal 11 |
| 15 | Deployment Wizard (Focus) | UI | SKIP | Blocked by Goal 11 — PRIMARY FOCUS NOT TESTED |
| 16 | /billing page | UI | SKIP | Blocked by Goal 11 |
| 17 | /admin/announcements | UI | SKIP | Blocked by Goal 11 |

## Key Findings

### All New API Routers Confirmed Registered
- `org` router: `org.list`, `org.create` — confirmed as protectedProcedures, return 401 (correct)
- `subagents` router: `subagents.list` — confirmed as protectedProcedure, returns 401 (correct)
- `user.acceptTerms` — TOS consent procedure confirmed registered
- All new endpoints wired up correctly after massive refactor

### Removed Routers Return Clean 404
- `marketplace.browse` → 404 NOT_FOUND (not 500) ✓
- `benchmarks.listDomains` → 404 NOT_FOUND (not 500) ✓
- `deployment.list` routing intact after procedures1.ts/procedures2.ts split ✓

### echo Runtime Not Seeded in DB
- PR #176 added `runtimes/handlers/echo.ts` for the echo dummy runtime
- `runtimeCatalog.list` returns only `openclaw` — echo is not in the DB table
- echo runtime cannot be selected in the onboarding wizard until a DB seed/migration adds it
- This may be intentional (dev-only runtime) but worth noting

### UI Testing Completely Blocked (Environment Issue)
- Playwright MCP configured to use system Chrome (`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`)
- Chrome's single-instance lock prevents Playwright from attaching when user's Chrome is running
- Fix needed: configure Playwright MCP to use bundled Chromium at `C:\Users\Brett Bono\AppData\Local\ms-playwright\chromium-1208\`
- **PRIMARY FOCUS (deployment wizard end-to-end) was NOT tested** due to this blocker

### Auth Token Issue
- Provided AUTH_TOKEN failed RSA signature verification against Auth0 JWKS
- Token `exp` was valid (2026-04-24T02:32:42Z), `kid` exists in JWKS, but sig invalid
- Likely caused by token truncation/corruption during prompt formatting
- API's auth enforcement is working correctly (proper 401 responses)
- All API routing and procedure registration verified via 401 responses (not 404/500)

## Healer Actions
None — no code bugs found. Both failures are environment issues.

## Environment Fixes Needed for Next Run
1. **CRITICAL**: Configure Playwright MCP to use bundled Chromium, not system Chrome
   - Edit `.claude/settings.json` Playwright MCP config to use Chromium path
   - OR: Close all Chrome windows before overnight QA run
2. **Moderate**: Ensure AUTH_TOKEN is properly formatted (not truncated) in prompt

## Next Run Priorities (Carried Forward)
1. **Fix Playwright Chrome config** — blocker for ALL UI testing
2. Once unblocked, test ALL of these (all untested due to Chrome issue):
   - Deployment wizard end-to-end (FOCUS area)
   - /orgs page (brand new, never tested)
   - Consent modal behavior
   - Dashboard with new org switcher
   - /admin/announcements and /admin/promo pages (new)
   - /d/[id] chat interface
3. Test org.create / org.list happy paths with valid auth token
4. Verify echo runtime seeding in catalog (or confirm it's intentionally dev-only)
