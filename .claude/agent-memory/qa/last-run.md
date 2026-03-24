# Last QA Run

## Run Details
- **Timestamp**: 2026-03-24T13:35:24Z
- **Git SHA**: c761124
- **Duration**: ~5 minutes
- **Pass rate**: 86% (6 pass, 1 warn, 0 fail)

## Goals Tested

| # | Goal | Type | Status |
|---|------|------|--------|
| 1 | Homepage renders all major sections | UI | PASS |
| 2 | Pricing page loads with tier info | UI | PASS |
| 3 | About page loads with content | UI | PASS |
| 4 | Login page renders correctly | UI | PASS |
| 5 | API health endpoint returns OK | API | PASS |
| 6 | Public tRPC endpoints return valid data | API | WARN |
| 7 | Protected tRPC endpoints reject unauthed requests | API | PASS |

## Failures
(none)

## Warnings
- **Goal 6 (Public tRPC)**: `runtimeCatalog.getBySlug` requires `{"json":{"slug":"openclaw"}}` not bare string; `marketplace.browse` requires `{"json":{}}` even with all-default fields. These are tRPC SuperJSON input format requirements, not bugs. `marketplace.getFeatured` returns empty array (no featured items seeded in dev DB).

## Healer Actions
(none needed — no failures)

## Notes
- First ever QA run — baseline established
- No auth token available — all auth-required goals skipped (dashboard, billing, settings, onboarding, chat, flows)
- Focus area was homepage and API health
- Both frontend (:3000) and API (:3001) confirmed running and healthy
- All 6 protected endpoints correctly return 401 UNAUTHORIZED without auth
- Homepage has: beta banner, hero section, web chat preview, integrations grid (20+ platforms), features section, footer
- Pricing page shows 2 runtimes (OpenClaw, ZeroClaw) + BYOK/Credits pricing models
- About page has: problem/solution, market stats, team placeholders, vision
- Login page: Auth0 integration with email, Google, GitHub sign-in options
