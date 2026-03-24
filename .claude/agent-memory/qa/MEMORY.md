# QA Orchestrator Memory

## Quick Reference
- [Coverage Map](coverage.md) — what was tested, when, pass/fail
- [Failure Patterns](failure-patterns.md) — recurring issues and root causes
- [Flaky Areas](flaky-areas.md) — areas with intermittent failures
- [Regression Watchlist](regression-watchlist.md) — fixed bugs to monitor
- [Last Run](last-run.md) — most recent run state and results

## Statistics
- Total runs: 1
- Last run: 2026-03-24T13:35:24Z (SHA c761124)
- Last run pass rate: 86% (6 pass, 1 warn, 0 fail)
- Cumulative issues found: 0 real bugs
- Auto-fixed: 0

## Key Findings
- All public pages render correctly (/, /pricing, /about, /login)
- API health endpoint responds in 5ms
- All 10 tested public tRPC endpoints return valid data
- All 6 tested protected endpoints correctly enforce auth (401)
- tRPC input format requires `{"json":{...}}` wrapping (FP-001)
- Dev DB has: 2 runtimes, 13 templates, 3 marketplace components, 1 service, 1 benchmark domain

## Known Environment Issues
- Dev SQLite DB is recreated on API restart (seed data only)
- Auth tokens expire after 24h — overnight runner refreshes before each cycle
- No auth token = skip dashboard, billing, settings, onboarding, chat, flows, deployments
- marketplace.getFeatured returns empty array in dev (no featured items seeded)
