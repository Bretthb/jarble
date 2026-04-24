# QA Orchestrator Memory

## Quick Reference
- [Coverage Map](coverage.md) — what was tested, when, pass/fail
- [Failure Patterns](failure-patterns.md) — recurring issues and root causes
- [Flaky Areas](flaky-areas.md) — areas with intermittent failures
- [Regression Watchlist](regression-watchlist.md) — fixed bugs to monitor
- [Last Run](last-run.md) — most recent run state and results

## Statistics
- Total runs: 6
- Last run: 2026-04-24T22:23:13Z (SHA b76ef3f)
- Last run pass rate: 82% (9 pass, 2 warn, 0 fail, 0 error, 0 skip out of 11 goals)
- Cumulative real bugs found: 1 potential (FP-009: empty BYOK chat response)
- Auto-fixed: 0
- Total endpoints tested (cumulative): 47 tRPC + 3 REST
- Total pages tested (cumulative): 14 public + 8 authenticated (dashboard, deployments, settings, billing, onboarding/new, d/[id], docs sub-pages)

## Key Findings
- **Auth0 real login confirmed working** (2026-03-26): Auth0Provider.tsx changes (SSR fix, window.location.origin redirectUri) work. Real Auth0 UI login via Playwright now enables full authenticated session testing. Token injection approach is obsolete.
- **Chrome conflict RESOLVED** (2026-04-24): PR #190 added --headless flag to Playwright MCP. UI testing now works even when user's Chrome is running. All UI goals passed in latest run.
- **Massive codebase refactor (2026-04-23, SHA 27e3b8f)**: 901 files changed. Marketplace, services, benchmarks, template, agentCredits routers REMOVED. New org, subagents, deploymentSecrets routers ADDED. All verified via API routing checks.
- **OpenClaw diagnostics refactor confirmed clean (2026-04-24, SHA b76ef3f)**: `runOpenClawDiagnostics()` extracted to `openclaw.diagnostics.ts`; diagnose route auth guards intact (401/404 correct).
- **Deployment wizard BYOK fully tested (2026-04-24)**: 5-step wizard creates OpenClaw + Anthropic BYOK deployment end-to-end. Autoscaler provisions Hetzner worker. Pod reaches Running in ~3-4 min.
- **FP-009 POTENTIAL BUG**: BYOK Anthropic Opus 4.6 chat response renders empty body after 75s typing indicator. Needs Langfuse trace investigation. Deployment cleaned up — needs fresh repro.
- **FP-008 UX GAP**: 2-3 min "pod not reachable" after status=Running — misleading green badge while gateway isn't ready yet.
- **TOS Consent Gate works** (2026-04-24): First-login modal appeared and blocked dashboard; accepted and dismissed correctly.
- All new routers confirmed registered (org, subagents, user.acceptTerms) — return 401 not 404 ✓
- echo runtime handler added (PR #176) but NOT seeded in runtimeCatalog DB table — won't appear in wizard
- API is healthy: responds in 0.22s at https://api.jarble.ai/health
- Admin procedures return 403 FORBIDDEN (not 401) for non-admin — correct RBAC
- Strong security headers: CSP (default-src 'none'), HSTS, X-Frame-Options, rate limiter (300req/60s)
- Drizzle ORM parameterized queries confirmed protecting against SQL injection
- Zod strips __proto__ fields in default strip mode (prototype pollution protection)
- Pre-existing React #418 hydration mismatch on all pages — not related to any recent changes
- **Billing counter lag (LOW)**: Monthly Spend shows $27.40 but Active Subscriptions=0 immediately after creating a $25/mo deployment — Stripe webhook timing

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
