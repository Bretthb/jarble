# QA Coverage Map

## Frontend Routes

| Route | Last Tested | Result | Agent |
|-------|------------|--------|-------|
| / | 2026-03-24 | PASS | qa-explorer-ui |
| /pricing | 2026-03-24 | PASS | qa-explorer-ui |
| /about | 2026-03-24 | PASS | qa-explorer-ui |
| /login | 2026-03-24 | PASS | qa-explorer-ui |
| /register | never | - | - |
| /dashboard | never | - | - |
| /billing | never | - | - |
| /settings | never | - | - |
| /onboarding/[id] | never | - | - |
| /d/[id] | never | - | - |
| /d/[id]/configure | never | - | - |
| /marketplace | never | - | - |
| /marketplace/[id] | never | - | - |
| /explore | never | - | - |
| /deployments | never | - | - |
| /analytics | never | - | - |
| /beta | never | - | - |
| /docs | never | - | - |
| /docs/api | never | - | - |
| /docs/architecture | never | - | - |
| /docs/components | never | - | - |
| /docs/getting-started | never | - | - |
| /docs/marketplace | never | - | - |
| /docs/platform | never | - | - |
| /docs/security | never | - | - |
| /privacy | never | - | - |
| /terms | never | - | - |
| /admin | never | - | - |
| /admin/* (7 sub-pages) | never | - | - |

## API Endpoints (tRPC)

### Public Procedures

| Router.Procedure | Last Tested | Result |
|-----------------|------------|--------|
| health (REST) | 2026-03-24 | PASS |
| runtimeCatalog.list | 2026-03-24 | PASS |
| runtimeCatalog.getBySlug | 2026-03-24 | PASS |
| template.list | 2026-03-24 | PASS |
| template.getCategories | 2026-03-24 | PASS |
| marketplace.browse | 2026-03-24 | PASS |
| marketplace.getCategories | 2026-03-24 | PASS |
| marketplace.getFeatured | 2026-03-24 | PASS (empty) |
| benchmarks.listDomains | 2026-03-24 | PASS |
| services.list | 2026-03-24 | PASS |
| user.me (no auth) | 2026-03-24 | PASS (null) |
| marketplace.getById | never | - |
| marketplace.builtinSchemas | never | - |
| marketplace.getReviews | never | - |
| marketplace.getCreatorProfile | never | - |
| benchmarks.leaderboard | never | - |
| benchmarks.getDeploymentRatings | never | - |
| benchmarks.getPublicProfile | never | - |
| benchmarks.getServiceMetrics | never | - |
| benchmarks.serviceLeaderboard | never | - |
| benchmarks.getServiceReviews | never | - |
| deployment.getPublicProfile | never | - |
| services.get | never | - |
| services.listByCreator | never | - |
| template.getById | never | - |
| template.listByCategory | never | - |
| runtimeCatalog.getById | never | - |
| runtimeCatalog.getCapabilities | never | - |

### Protected Procedures (Auth Enforcement Verified)

| Router.Procedure | Auth Enforced | Last Tested |
|-----------------|--------------|------------|
| deployment.list | YES (401) | 2026-03-24 |
| billing.getOverview | YES (401) | 2026-03-24 |
| flows.list | YES (401) | 2026-03-24 |
| apiKeys.list | YES (401) | 2026-03-24 |
| agentCredits.getBalance | YES (401) | 2026-03-24 |
| deployment.create | YES (401) | 2026-03-24 |

## Security Tests

| Test | Last Run | Result |
|------|----------|--------|
| XSS in chat input | never | - |
| SQL injection via API | never | - |
| Auth bypass attempts | never | - |
| Prototype pollution | never | - |
| CSRF protection | never | - |
