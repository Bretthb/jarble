---
name: project_structure
description: Current monorepo layout and docs file locations as of Session 20 (2026-03-23)
type: reference
---

## Documentation Files

| File | Purpose |
|------|---------|
| `docs/OVERVIEW.md` | Complete platform overview, architecture diagrams, DB schema, roadmap, file structure, progress tracking |
| `docs/API-ENDPOINTS.md` | Exhaustive API reference: all tRPC procedures, REST endpoints, auth, rate limiting, SSE streams |
| `docs/DEVELOPER-GUIDE.md` | Plain-English developer walkthrough with metaphors, code examples, glossary, local dev setup |
| `docs/ROADMAP.md` | Platform roadmap organized by 6 pillars |

## Session Convention

Docs use "Session N" numbering in headers. Current session as of last update: **Session 20 (March 23, 2026)**.

## New Files Added in Session 20

### Backend
- `jarble-api-main/src/routes/flowExecution.ts` — Flow execution REST routes
- `jarble-api-main/src/routes/beta.ts` — Beta signup REST route
- `jarble-api-main/src/trpc/routers/flows.ts` — Flows tRPC router (8 procedures)
- `jarble-api-main/src/trpc/routers/admin.ts` — Admin tRPC router (19 procedures, requires `adminProcedure`)
- `jarble-api-main/src/services/flowEngine.ts` — Flow DAG execution engine
- `jarble-api-main/src/services/auditLog.ts` — Admin action audit logging
- `jarble-api-main/src/services/email.ts` — Email service via Resend
- `jarble-api-main/src/services/prometheus.ts` — Prometheus query client

### Previously Undocumented Routers (now in docs)
- `agentCredits.ts` — 4 procedures
- `apiKeys.ts` — 4 procedures
- `benchmarks.ts` — 14 procedures

## Key Quirks to Remember

- `storageMb` column in deployments is actually measured in GB in the UI (despite the column name)
- `adminProcedure` gates admin router — requires `role: "super_admin"` in DB; seeded by `ADMIN_USER_IDS` env var on login
- `sk-ant-oat*` tokens (Claude Max OAuth) are auto-passed without API validation in `validateProviderKey`
