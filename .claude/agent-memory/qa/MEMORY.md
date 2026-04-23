# QA Orchestrator Memory

## Quick Reference
- [Coverage Map](coverage.md) — what was tested, when, pass/fail
- [Failure Patterns](failure-patterns.md) — recurring issues and root causes
- [Flaky Areas](flaky-areas.md) — areas with intermittent failures
- [Regression Watchlist](regression-watchlist.md) — fixed bugs to monitor
- [Last Run](last-run.md) — most recent run state and results

## Statistics
- Total runs: 5
- Last run: 2026-04-23T02:32:43Z (SHA 27e3b8f)
- Last run pass rate: 47% (8 pass, 2 warn, 0 fail, 1 error, 6 skip out of 17 goals — UI blocked by Chrome conflict)
- Cumulative real bugs found: 0
- Auto-fixed: 0
- Total endpoints tested (cumulative): 40 tRPC + 2 REST
- Total pages tested (cumulative): 14 public + 6 authenticated (dashboard, deployments, settings, billing, onboarding, docs sub-pages)

## Key Findings
- **Auth0 real login confirmed working** (2026-03-26): Auth0Provider.tsx changes (SSR fix, window.location.origin redirectUri) work. Real Auth0 UI login via Playwright now enables full authenticated session testing. Token injection approach is obsolete.
- **CRITICAL ENV ISSUE (2026-04-23)**: Playwright MCP configured to use system Chrome — conflicts when user's Chrome is running. All UI tests blocked. Fix: configure Playwright to use bundled Chromium at `C:\Users\Brett Bono\AppData\Local\ms-playwright\chromium-1208\`
- **Massive codebase refactor (2026-04-23, SHA 27e3b8f)**: 901 files changed. Marketplace, services, benchmarks, template, agentCredits routers REMOVED. New org, subagents, deploymentSecrets routers ADDED. All verified via API routing checks.
- All new routers confirmed registered (org, subagents, user.acceptTerms) — return 401 not 404 ✓
- Removed routers return clean 404 NOT_FOUND (not 500) — clean removal confirmed ✓
- echo runtime handler added (PR #176) but NOT seeded in runtimeCatalog DB table — won't appear in wizard
- Previously tested pages (marketplace, explore, docs) may have changed/been removed — mark as stale
- API is healthy: responds in 0.22s at https://api.jarble.ai/health
- Admin procedures return 403 FORBIDDEN (not 401) for non-admin — correct RBAC
- Strong security headers: CSP (default-src 'none'), HSTS, X-Frame-Options, rate limiter (300req/60s)
- Drizzle ORM parameterized queries confirmed protecting against SQL injection
- Zod strips __proto__ fields in default strip mode (prototype pollution protection)
- Pre-existing React #418 hydration mismatch on all pages — not related to any recent changes

## Known Environment Issues
- Dev SQLite DB is recreated on API restart (seed data only)
- Auth tokens expire after 24h — overnight runner refreshes before each cycle
- marketplace.getFeatured returns empty array in dev (no featured items seeded)
- services.list returns empty in prod (no services created yet)
- **flows.list includes archived (soft-deleted) flows by default** — frontend must filter by status

## Known Behavior Notes
- flows.create nodes require `label` (string) and `position` ({x, y}) fields — not just type
- deployment.getPublicProfile input uses field `id` not `deploymentId`
- flows.delete defaults to soft delete (status=archived); pass `hard: true` for permanent deletion
- skills.listCatalog (not skills.list), platformCredentials.getByDeployment (not .list)
- admin.getStats / admin.listUsers return 403 for non-admin (clear "Admin access required" message)

## Open Security Findings
- **LOW**: flowChat.ts has no explicit message length cap before forwarding to LLM gateway. Authenticated users could send near-100KB messages to burn agent credits. Only Express body-parser's 100KB default prevents this.
