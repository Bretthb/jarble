# QA Coverage Map

## Frontend Routes

| Route | Last Tested | Result | Agent |
|-------|------------|--------|-------|
| / | 2026-03-24 | PASS | qa-explorer-ui |
| /pricing | 2026-03-24 | PASS | qa-explorer-ui |
| /about | 2026-03-24 | PASS | qa-explorer-ui |
| /login | 2026-03-24 | PASS | qa-explorer-ui |
| /register | 2026-03-24 | PASS (-> /login) | qa-explorer-ui |
| /marketplace | 2026-03-24 | PASS | qa-explorer-ui |
| /explore | 2026-03-24 | PASS | qa-explorer-ui |
| /docs | 2026-03-24 | PASS | qa-explorer-ui |
| /privacy | 2026-03-24 | PASS | qa-explorer-ui |
| /terms | 2026-03-24 | PASS | qa-explorer-ui |
| /dashboard | 2026-03-24 | WARN (first-load PASS, refresh_token rotation clears session) | qa-explorer-ui |
| /billing | 2026-03-24 | ENV_SKIP (auth refresh_token rotation) | qa-explorer-ui |
| /settings | 2026-03-24 | ENV_SKIP (auth refresh_token rotation) | qa-explorer-ui |
| /deployments | 2026-03-24 | ENV_SKIP (auth refresh_token rotation) | qa-explorer-ui |
| /onboarding/[id] | never | - | - |
| /d/[id] | never | - | - |
| /d/[id]/configure | never | - | - |
| /marketplace/[id] | never | - | - |
| /marketplace/services/[id] | never | - | - |
| /analytics | never | - | - |
| /beta | never | - | - |
| /docs/api | never | - | - |
| /docs/architecture | never | - | - |
| /docs/components | never | - | - |
| /docs/getting-started | never | - | - |
| /docs/marketplace | never | - | - |
| /docs/platform | never | - | - |
| /docs/security | never | - | - |
| /admin | never | - | - |
| /admin/* (7 sub-pages) | never | - | - |

## API Endpoints (tRPC)

### Public Procedures

| Router.Procedure | Last Tested | Result |
|-----------------|------------|--------|
| health (REST) | 2026-03-24 | PASS (<5ms) |
| runtimeCatalog.list | 2026-03-24 | PASS (2 runtimes) |
| runtimeCatalog.getBySlug | 2026-03-24 | PASS |
| runtimeCatalog.getById | 2026-03-24 | PASS (openclaw details) |
| runtimeCatalog.getCapabilities | 2026-03-24 | PASS (needsLlm, hasPlatforms, etc.) |
| template.list | 2026-03-24 | PASS (13 templates) |
| template.getCategories | 2026-03-24 | PASS |
| template.getById | 2026-03-24 | PASS (null for "1") |
| template.listByCategory | 2026-03-24 | PASS (2 in "general") |
| marketplace.browse | 2026-03-24 | PASS |
| marketplace.getCategories | 2026-03-24 | PASS |
| marketplace.getFeatured | 2026-03-24 | PASS (empty) |
| marketplace.getById | 2026-03-24 | PASS (404 correct) |
| marketplace.builtinSchemas | 2026-03-24 | PASS (card, data_table schemas) |
| benchmarks.listDomains | 2026-03-24 | PASS |
| benchmarks.leaderboard | 2026-03-24 | PASS (empty for "general") |
| deployment.getPublicProfile | 2026-03-24 | PASS (404 correct) |
| services.list | 2026-03-24 | PASS |
| user.me (no auth) | 2026-03-24 | PASS (null) |
| marketplace.getReviews | never | - |
| marketplace.getCreatorProfile | never | - |
| benchmarks.getDeploymentRatings | never | - |
| benchmarks.getPublicProfile | never | - |
| benchmarks.getServiceMetrics | never | - |
| benchmarks.serviceLeaderboard | never | - |
| benchmarks.getServiceReviews | never | - |
| services.get | never | - |
| services.listByCreator | never | - |

### Protected Procedures (Auth Verified)

| Router.Procedure | Unauthed->401 | Authed Response | Last Tested |
|-----------------|-------------|-----------------|------------|
| user.me | null (not 401) | 200 — email, role, freeDeploymentUsed | 2026-03-24 |
| deployment.list | YES (401) | 200 — empty array | 2026-03-24 |
| deployment.create | YES (401) | not tested with valid input | 2026-03-24 |
| billing.getOverview | YES (401) | 200 — totalMonthlyCents:0, activeSubscriptionCount:0 | 2026-03-24 |
| flows.list | YES (401) | 200 — empty array | 2026-03-24 |
| agentCredits.getBalance | YES (401) | 200 — balance:0, 3 tiers | 2026-03-24 |
| apiKeys.list | YES (401) | 200 — empty array | 2026-03-24 |
| skills.listCatalog | not tested unauthed | 200 — 23 skills | 2026-03-24 |
| platformCredentials.getByDeployment | not tested unauthed | 404 (no deployment) | 2026-03-24 |

## Security Tests

| Test | Last Run | Result |
|------|----------|--------|
| XSS in chat input | never | - |
| SQL injection via API | never | - |
| Auth bypass attempts | never | - |
| Prototype pollution | never | - |
| CSRF protection | never | - |
