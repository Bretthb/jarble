# QA Orchestrator Memory

## Quick Reference
- [Coverage Map](coverage.md) — what was tested, when, pass/fail
- [Failure Patterns](failure-patterns.md) — recurring issues and root causes
- [Flaky Areas](flaky-areas.md) — areas with intermittent failures
- [Regression Watchlist](regression-watchlist.md) — fixed bugs to monitor
- [Last Run](last-run.md) — most recent run state and results

## Statistics
- Total runs: 2
- Last run: 2026-03-24T14:58:37Z (SHA 5da8a9e)
- Last run pass rate: 67% (8 pass, 1 warn, 4 env-skip out of 12 goals)
- Cumulative real bugs found: 0
- Auto-fixed: 0
- Total endpoints tested (cumulative): 28 tRPC + 1 REST
- Total pages tested (cumulative): 8 public + 4 auth-attempted

## Key Findings
- All public pages render correctly (/, /pricing, /about, /login, /marketplace, /explore, /docs, /register)
- API health endpoint responds in <15ms on all endpoints
- All 19 tested public tRPC endpoints return valid data
- All 9 tested protected endpoints correctly enforce auth
- Authenticated API calls work perfectly with Bearer token (user.me, deployment.list, billing, flows, credits, apiKeys, skills, platformCredentials)
- Auth0 SPA SDK session injection blocked by useRefreshTokens (FP-002) — needs refresh_token in injection
- tRPC input format requires `{"json":{...}}` wrapping (FP-001)
- Dev DB has: 2 runtimes, 13+ templates, 3 marketplace components, 1 service, 1 benchmark domain, 22 skills

## Known Environment Issues
- Dev SQLite DB is recreated on API restart (seed data only)
- Auth tokens expire after 24h — overnight runner refreshes before each cycle
- Auth0 SPA SDK injection requires refresh_token field (FP-002) — fix scripts/nightly-qa/lib/auth.mjs
- marketplace.getFeatured returns empty array in dev (no featured items seeded)
- Correct procedure names: skills.listCatalog (not skills.list), platformCredentials.getByDeployment (not .list)
