---
name: Staging → Production Pipeline Plan
description: Architecture plan for safe staging-to-prod deploys without breaking existing users — Neon branching, K8s namespace separation, init container migrations, expand/contract pattern
type: project
---

## Goal
Test cluster + test DB + test API on Hetzner, then promote to production without breaking existing users.

**Why:** Current setup has no staging environment. Migrations run in-pod (race conditions possible), health check doesn't validate DB schema, org migration hasn't been generated for Postgres yet, and there's no promotion gate between test and prod.

**How to apply:** When building deploy infrastructure, follow this plan. When adding schema changes, use expand/contract pattern.

## Architecture

```
Local (SQLite) → Staging (jarble-staging ns + Neon branch) → Prod (jarble ns + Neon main)
```

- Same Hetzner K3s cluster, separate namespace (not a second cluster)
- Neon database branching: fork prod → test migrations → if green, run on main
- Image SHA pinning (no `:latest`), same image promoted staging → prod

## Implementation Pieces

1. **Fix init.ts ordering bug** — index on org_id created before ALTER TABLE migration adds the column
2. **Generate missing Postgres org migration** — organizations/org_members/org_invites tables + deployments.org_id not in drizzle-pg/ yet
3. **Upgrade `/health` endpoint** — validate DB connectivity + schema version, not just `{ status: "ok" }`
4. **K8s init container for migrations** — run migrations once before app starts, not per-pod in CMD
5. **Staging K8s manifests** — jarble-staging namespace, deployment.yaml pointed at Neon branch
6. **GitHub Actions staging → prod workflow** — build → deploy staging → smoke test → promote to prod
7. **Rolling update strategy** — `maxUnavailable: 0, maxSurge: 1` in deployment.yaml
8. **Expand/contract migration rule** — never add NOT NULL without default, never rename columns in single deploy

## Immediate Blockers Found

- SQLite local.db crashes on startup (index-before-column ordering in init.ts)
- Org feature has NO Postgres migration — would crash in prod if deployed
- Health check passes even when DB is unreachable or schema is wrong
- `:latest` image tag means broken images can't be rolled back

## Status
Planning only — user said to keep in mind for later. Delete local.db as workaround for now.
