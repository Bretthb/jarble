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
| /dashboard | 2026-03-26 | PASS (real Auth0 login — shows empty deployments state + user email) | qa-explorer-ui |
| /deployments | 2026-03-26 | PASS (3 tabs: Linked, Bot Teams, Resource Map — no JS errors from 1418-line rewrite) | qa-explorer-ui |
| /settings | 2026-03-26 | PASS (profile, appearance, account, danger zone) | qa-explorer-ui |
| /billing | 2026-03-26 | PASS ($0 spend, no subscriptions, Stripe portal link) | qa-explorer-ui |
| /onboarding/[id] | 2026-03-26 | PASS (2/3 steps verified: name + 13-card persona selection) | qa-explorer-ui |
| /docs/getting-started | 2026-03-26 | PASS (8 sections, ToC, code blocks) | qa-explorer-ui |
| /docs/api | 2026-03-26 | PASS (API Reference, auth, router docs) | qa-explorer-ui |
| /docs/architecture | 2026-03-26 | PASS (system overview, ASCII diagram, chat arch, config sync) | qa-explorer-ui |
| /d/[id] | never | - | - |
| /d/[id]/configure | never | - | - |
| /marketplace/[id] | never | - | - |
| /marketplace/services/[id] | never | - | - |
| /analytics | never | - | - |
| /beta | never | - | - |
| /docs/components | never | - | - |
| /docs/marketplace | never | - | - |
| /docs/platform | never | - | - |
| /docs/security | never | - | - |
| /admin | never | - | - |
| /admin/* (7 sub-pages) | never | - | - |

## API Endpoints (tRPC)

### Public Procedures

| Router.Procedure | Last Tested | Result |
|-----------------|------------|--------|
| health (REST) | 2026-03-26 | PASS (<110ms) |
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
| marketplace.getReviews | 2026-03-26 | PASS (empty paginated result for unknown componentId) |
| benchmarks.listDomains | 2026-03-24 | PASS |
| benchmarks.leaderboard | 2026-03-24 | PASS (empty for "general") |
| benchmarks.getPublicProfile | 2026-03-26 | PASS (404 for unknown deploymentId) |
| benchmarks.serviceLeaderboard | 2026-03-26 | PASS (empty entries for unknown serviceId) |
| benchmarks.getServiceReviews | never | - |
| benchmarks.getDeploymentRatings | never | - |
| benchmarks.getServiceMetrics | never | - |
| deployment.getPublicProfile | 2026-03-26 | PASS (404 for unknown id; field name is `id` not `deploymentId`) |
| services.list | 2026-03-26 | PASS (empty items) |
| services.get | 2026-03-26 | PASS (404 for unknown serviceId) |
| services.listByCreator | 2026-03-26 | PASS (empty for unknown creatorId) |
| user.me (no auth) | 2026-03-24 | PASS (null) |
| marketplace.getCreatorProfile | never | - |

### Protected Procedures (Auth Verified)

| Router.Procedure | Unauthed->401 | Authed Response | Last Tested |
|-----------------|-------------|-----------------|------------|
| user.me | null (not 401) | 200 — email, role, freeDeploymentUsed | 2026-03-24 |
| deployment.list | YES (401) | 200 — empty array | 2026-03-26 |
| deployment.create | YES (401) | not tested with valid input | 2026-03-24 |
| billing.getOverview | YES (401) | 200 — totalMonthlyCents:0, activeSubscriptionCount:0 | 2026-03-24 |
| flows.list | YES (401) | 200 — empty array (NOTE: includes archived flows by default) | 2026-03-26 |
| flows.create | YES (401) | 200 — returns {id} for valid input (needs label+position on nodes) | 2026-03-26 |
| flows.getById | not tested unauthed | 200 — full flow object | 2026-03-26 |
| flows.update | not tested unauthed | 200 — {success:true} | 2026-03-26 |
| flows.delete | not tested unauthed | 200 — soft delete by default (archived still in list); hard=true removes | 2026-03-26 |
| flows.listExecutions | not tested unauthed | 200 — empty array for flow with no executions | 2026-03-26 |
| flows.duplicate | never | - | - |
| flows.generateFromPrompt | never | - | - |
| agentCredits.getBalance | YES (401) | 200 — balance:0, 3 tiers | 2026-03-24 |
| apiKeys.list | YES (401) | 200 — empty array | 2026-03-24 |
| skills.listCatalog | not tested unauthed | 200 — 23 skills | 2026-03-24 |
| platformCredentials.getByDeployment | not tested unauthed | 404 (no deployment) | 2026-03-24 |
| admin.getStats | not tested unauthed | 403 FORBIDDEN (non-admin) | 2026-03-26 |
| admin.listUsers | not tested unauthed | 403 FORBIDDEN (non-admin) | 2026-03-26 |
| admin.getRevenueStats | never | - | - |
| admin.getSystemHealth | never | - | - |
| admin.getClusterMetrics | never | - | - |
| admin.listAllDeployments | never | - | - |

### REST Endpoints

| Endpoint | Last Tested | Result |
|----------|------------|--------|
| POST /api/tambo-agent | never | - |
| POST /api/flows/:flowId/chat | 2026-03-26 | PASS (401 no auth, 404 bad flowId, all injection attempts blocked) |
| POST /api/flows/:flowId/execute | never | - |
| GET /api/flows/executions/:id/stream | never | - |
| POST /api/flows/executions/:id/resume | never | - |
| GET /api/deployments/status/stream | never | - |
| GET /api/deployments/:id/logs | never | - |
| GET /api/deployments/:id/whatsapp/qr | never | - |

## Security Tests

| Test | Last Run | Result |
|------|----------|--------|
| Auth bypass on flow chat endpoint | 2026-03-26 | PASS (401/403 correct) |
| Path traversal in flow ID | 2026-03-26 | PASS (blocked by Express routing) |
| SQL injection in path params | 2026-03-26 | PASS (parameterized queries) |
| XSS in message body | 2026-03-26 | PASS (404 before render) |
| Prototype pollution in tRPC input | 2026-03-26 | PASS (Zod strips __proto__ in strip mode) |
| SQL injection in tRPC input | 2026-03-26 | PASS (Drizzle ORM parameterized queries) |
| Rate limiting / DoS | 2026-03-26 | PASS (300req/60s global limit confirmed) |
| Dev debug endpoints in prod | 2026-03-26 | PASS (not exposed) |
| Message length cap in flowChat.ts | 2026-03-26 | WARN — no explicit cap (100KB body-parser only) |
| XSS in chat input (browser) | never | - |
| Auth bypass attempts (browser) | never | - |
| CSRF protection | never | - |
