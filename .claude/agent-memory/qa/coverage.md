# QA Coverage Map

## Frontend Routes

| Route | Last Tested | Result | Agent |
|-------|------------|--------|-------|
| / | 2026-03-24 | PASS | qa-explorer-ui |
| /pricing | 2026-03-24 | PASS | qa-explorer-ui |
| /about | 2026-03-24 | PASS | qa-explorer-ui |
| /login | 2026-03-24 | PASS | qa-explorer-ui |
| /register | 2026-03-24 | PASS (-> /login) | qa-explorer-ui |
| /marketplace | 2026-03-24 | STALE (marketplace removed in codebase — page may 404 now) | qa-explorer-ui |
| /explore | 2026-03-24 | STALE (explore page removed in codebase) | qa-explorer-ui |
| /docs | 2026-03-24 | STALE (docs pages removed in codebase) | qa-explorer-ui |
| /privacy | 2026-03-24 | PASS | qa-explorer-ui |
| /terms | 2026-03-24 | PASS | qa-explorer-ui |
| /dashboard | 2026-04-24 | PASS (org switcher present; workspace banner; deployment card with RAM/uptime/cost after creation) | qa-explorer-ui |
| /deployments | 2026-04-24 | PASS (3 tabs: Linked, Agent Teams, Resource Map; flow canvas renders; 7 Team 1 flows listed) | qa-explorer-ui |
| /settings | 2026-03-26 | PASS (profile, appearance, account, danger zone) | qa-explorer-ui |
| /billing | 2026-04-24 | PASS (stat cards, empty subscriptions, invoice history; minor: $27.40 spend shows but Active Subscriptions=0 lag) | qa-explorer-ui |
| /onboarding/new | 2026-04-24 | PASS (5-step wizard: name→runtime→system-prompt→LLM-BYOK→deploy; BYOK Anthropic validated + deployment created) | qa-explorer-ui |
| /d/[id] | 2026-04-24 | WARN (chat UI loads after ~3-4 min provisioning; BYOK Anthropic Opus 4.6 typing indicator appeared but response body was empty) | qa-explorer-ui |
| /docs/getting-started | 2026-03-26 | PASS (8 sections, ToC, code blocks) | qa-explorer-ui |
| /docs/api | 2026-03-26 | PASS (API Reference, auth, router docs) | qa-explorer-ui |
| /docs/architecture | 2026-03-26 | PASS (system overview, ASCII diagram, chat arch, config sync) | qa-explorer-ui |
| /d/[id] | never | - | - |
| /d/[id]/configure | never | - | - |
| /analytics | never | - | - |
| /beta | never | - | - |
| /admin | never | - | - |
| /admin/announcements | never | NEW (added 2026-04) | - |
| /admin/promo | never | NEW (added 2026-04) | - |
| /admin/* (other sub-pages) | never | - | - |
| /orgs | never | NEW (added 2026-04) | - |
| /orgs/[orgId] | never | NEW (added 2026-04) | - |
| /invite/[token] | never | NEW (added 2026-04) | - |
| /legal/terms | never | NEW (added 2026-04) | - |
| /legal/privacy | never | NEW (added 2026-04) | - |

## API Endpoints (tRPC)

### Public Procedures

| Router.Procedure | Last Tested | Result |
|-----------------|------------|--------|
| health (REST) | 2026-04-23 | PASS (0.22s) |
| runtimeCatalog.list | 2026-04-23 | WARN (only openclaw — echo runtime handler added but not seeded in DB) |
| runtimeCatalog.getBySlug | 2026-03-24 | PASS |
| runtimeCatalog.getById | 2026-03-24 | PASS (openclaw details) |
| runtimeCatalog.getCapabilities | 2026-03-24 | PASS (needsLlm, hasPlatforms, etc.) |
| deployment.getPublicProfile | 2026-03-26 | PASS (404 for unknown id; field name is `id` not `deploymentId`) |
| user.me (no auth) | 2026-03-24 | PASS (null) |
| REMOVED: template.* | 2026-04-23 | REMOVED — template router deleted from codebase |
| REMOVED: marketplace.* | 2026-04-23 | PASS — 404 NOT_FOUND (clean removal, not 500) |
| REMOVED: benchmarks.* | 2026-04-23 | PASS — 404 NOT_FOUND (clean removal, not 500) |
| REMOVED: services.* | 2026-04-23 | REMOVED — services router deleted from codebase |

### Protected Procedures (Auth Verified)

| Router.Procedure | Unauthed->401 | Authed Response | Last Tested |
|-----------------|-------------|-----------------|------------|
| user.me | null (not 401) | 200 — email, role, freeDeploymentUsed | 2026-03-24 |
| deployment.list | YES (401) | 200 — array (post-split: procedures1/procedures2 routing intact) | 2026-04-23 |
| deployment.create | YES (401) | not tested with valid input | 2026-03-24 |
| billing.getOverview | YES (401) | 200 — totalMonthlyCents:0, activeSubscriptionCount:0 | 2026-03-24 |
| flows.list | YES (401) | 200 — empty array (NOTE: includes archived flows by default) | 2026-03-26 |
| flows.create | YES (401) | 200 — returns {id} for valid input (needs label+position on nodes) | 2026-03-26 |
| flows.getById | not tested unauthed | 200 — full flow object | 2026-03-26 |
| flows.update | not tested unauthed | 200 — {success:true} | 2026-03-26 |
| flows.delete | not tested unauthed | 200 — soft delete by default (archived still in list); hard=true removes | 2026-03-26 |
| flows.listExecutions | not tested unauthed | 200 — empty array for flow with no executions | 2026-03-26 |
| flows.duplicate | never | - | - |
| flows.generateFromPrompt | 2026-04-24 | WARN — 412 PRECONDITION_FAILED when test user has no LLM key configured (correct behavior, not a bug) | 2026-04-24 |
| apiKeys.list | YES (401) | 200 — empty array | 2026-03-24 |
| skills.listCatalog | not tested unauthed | 200 — 23 skills | 2026-03-24 |
| platformCredentials.getByDeployment | not tested unauthed | 404 (no deployment) | 2026-03-24 |
| admin.getStats | not tested unauthed | 403 FORBIDDEN (non-admin) | 2026-03-26 |
| admin.listUsers | not tested unauthed | 403 FORBIDDEN (non-admin) | 2026-03-26 |
| admin.getRevenueStats | never | - | - |
| admin.getSystemHealth | never | - | - |
| admin.getClusterMetrics | never | - | - |
| admin.listAllDeployments | never | - | - |
| org.list | YES (401) | 200 — returns [] for test user with no orgs | 2026-04-24 |
| org.create | YES (401) | not tested authed | 2026-04-23 |
| org.getById | never | - | - |
| org.invite | never | - | - |
| org.acceptInvite | never | - | - |
| subagents.list | YES (401) | not tested authed | 2026-04-23 |
| deploymentSecrets.* | never | NEW router added 2026-04 | - |
| user.acceptTerms | YES (401) | not tested authed (but TOS consent gate triggered + accepted in UI on 2026-04-24) | 2026-04-24 |
| REMOVED: agentCredits.* | 2026-04-23 | REMOVED — agentCredits router deleted from codebase |

### REST Endpoints

| Endpoint | Last Tested | Result |
|----------|------------|--------|
| GET /api/deployments/:id/diagnose | 2026-04-24 | PASS — 401 no auth, 404 valid auth + fake ID; refactored to openclaw.diagnostics.ts, guards intact |
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
