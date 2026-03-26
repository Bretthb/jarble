# QA Orchestrator Memory

## Quick Reference
- [Coverage Map](coverage.md) — what was tested, when, pass/fail
- [Failure Patterns](failure-patterns.md) — recurring issues and root causes
- [Flaky Areas](flaky-areas.md) — areas with intermittent failures
- [Regression Watchlist](regression-watchlist.md) — fixed bugs to monitor
- [Last Run](last-run.md) — most recent run state and results

## Statistics
- Total runs: 4
- Last run: 2026-03-26T13:12:11Z (SHA 15a3e26)
- Last run pass rate: 83% (15 pass, 3 warn, 0 fail out of 18 goals)
- Cumulative real bugs found: 0
- Auto-fixed: 0
- Total endpoints tested (cumulative): 34 tRPC + 2 REST
- Total pages tested (cumulative): 14 public + 6 authenticated (dashboard, deployments, settings, billing, onboarding, docs sub-pages)

## Key Findings
- **Auth0 real login confirmed working** (2026-03-26): Auth0Provider.tsx changes (SSR fix, window.location.origin redirectUri) work. Real Auth0 UI login via Playwright now enables full authenticated session testing. Token injection approach is obsolete.
- All public pages render correctly (/, /pricing, /about, /login, /marketplace, /explore, /docs, /privacy, /terms)
- All authenticated pages confirmed working: /dashboard, /deployments, /settings, /billing
- Deployments.tsx 1418-line rewrite loaded cleanly — 3 tabs (Linked, Bot Teams, Resource Map), no JS errors
- New flow chat endpoint (POST /api/flows/:flowId/chat) is live and properly secured
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
