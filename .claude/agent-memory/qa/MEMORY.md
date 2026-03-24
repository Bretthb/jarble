# QA Orchestrator Memory

## Quick Reference
- [Coverage Map](coverage.md) — what was tested, when, pass/fail
- [Failure Patterns](failure-patterns.md) — recurring issues and root causes
- [Flaky Areas](flaky-areas.md) — areas with intermittent failures
- [Regression Watchlist](regression-watchlist.md) — fixed bugs to monitor
- [Last Run](last-run.md) — most recent run state and results

## Statistics
- Total runs: 3
- Last run: 2026-03-24T15:23:29Z (SHA 01eab8e)
- Last run pass rate: 43% (3 pass, 1 warn, 3 env-skip out of 7 goals)
- Cumulative real bugs found: 0
- Auto-fixed: 0
- Total endpoints tested (cumulative): 28 tRPC + 1 REST
- Total pages tested (cumulative): 10 public + 1 auth-verified (first-load) + 3 auth-attempted

## Key Findings
- All public pages render correctly (/, /pricing, /about, /login, /marketplace, /explore, /docs, /register, /privacy, /terms)
- Dashboard page CONFIRMED working with auth (first-load renders user content correctly)
- API health endpoint responds in <15ms on all endpoints
- All 19 tested public tRPC endpoints return valid data
- All 9 tested protected endpoints correctly enforce auth
- Authenticated API calls work perfectly with Bearer token
- Auth0 refresh token rotation (FP-002) limits UI auth testing to first-load only
- tRPC input format requires `{"json":{...}}` wrapping (FP-001)
- Dev DB has: 2 runtimes, 13 templates, 3 marketplace components, 1 service, 1 benchmark domain, 23 skills
- Privacy + Terms pages have comprehensive, platform-specific legal content (14 sections each)

## Known Environment Issues
- Dev SQLite DB is recreated on API restart (seed data only)
- Auth tokens expire after 24h — overnight runner refreshes before each cycle
- Auth0 refresh token rotation invalidates injected tokens after first SDK use (FP-002)
- marketplace.getFeatured returns empty array in dev (no featured items seeded)
- Correct procedure names: skills.listCatalog (not skills.list), platformCredentials.getByDeployment (not .list)
