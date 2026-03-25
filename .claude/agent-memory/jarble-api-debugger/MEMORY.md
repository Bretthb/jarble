# Jarble API Debugger - Agent Memory

## Architecture
- Entry: `src/index.ts` (Express + tRPC adapter + REST/SSE endpoints)
- 7 tRPC routers in `src/trpc/routers/`: user, deployment, billing, runtimeCatalog, template, openrouter, platformCredentials
- DB: Drizzle ORM with 3 providers (MySQL, Postgres, SQLite in-memory for dev)
- K8s: `src/k8s/deployment.ts` with MOCK_K8S mode for local dev
- Schemas: `schema.ts` (MySQL), `schema.pg.ts`, `schema.sqlite.ts` - kept in sync manually
- Tables: users, deployments, runtimeCatalog, platformCredentials, processedWebhookEvents
- Runtime handlers: `src/runtimes/handlers/{openclaw,zeroclaw}.ts` (strategy pattern)
- Config sync: bidirectional DB<->PVC via `src/services/configSync.ts`
- Auth: Auth0 JWT via jose library, JWKS cached, namespaced custom claims
- Billing: Stripe checkout/portal/webhooks with idempotency tracking
- Enforcement: `subscriptionEnforcement.ts` (5min), `storageEnforcement.ts` (5min)

## Key Patterns
- `protectedProcedure` checks ctx.user in middleware, all routers use it correctly
- Ownership checks: `where: and(eq(id), eq(userId))` used consistently
- API keys encrypted with AES-256-GCM, "plain:" prefix in dev mode
- Fire-and-forget async: `void (async () => { ... })()` for K8s operations
- Config files written to `/data/config/` on PVC, not `/data/` root
- storageMb field is actually GB (historical naming, documented in code)
- Rate limiting: 3 tiers (global 300/min, auth 120/min, stripe 10/min)

## Critical Patterns Found (2026-03-25)
- `process.cwd()` file paths break in Docker: source uses `src/` but container has `dist/`. Always use `__dirname` + relative path (e.g. `resolve(__dirname, "../../mcp/jarble-ui-server.js")`)
- PostgreSQL timestamp columns require `Date` objects via `dbDate()`, not ISO strings. Drizzle calls `.toISOString()` internally on timestamp values, so passing a string causes "value.toISOString is not a function"
- MCP server (`jarble-ui-server.js`) must be deployed to `/data/config/mcp/` on pods. Without it, Library button 500s. The file is included by `renderConfigs()` in openclaw handler.

## Known Bug Areas (updated 2026-02-26)
See `audit-findings.md` for full details (5 critical, 6 high, 7 medium, 6 low).
Critical:
1. Race condition in free deployment creation (no transaction)
2. `updateKeyLimit` doesn't sync DB `llmCreditLimitDollars`
3. Missing ownership check on root deployment key fetch (linked deployments)
4. `stop` mutation leaves stuck "stopping" state on K8s failure
5. `revokeKey` DB write missing ownership in where clause (TOCTOU)
High:
6. Config webhook skips auth in dev mode by default
7. Fire-and-forget deploy can leave stuck "creating" state
8. SSE status stream N+1 K8s API pattern
9. Stripe webhook mark-before-process (crash = permanent skip)
10. User updateProfile allows unverified email change
