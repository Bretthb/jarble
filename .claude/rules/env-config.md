---
description: Environment variables, database config, debug endpoints
globs:
  - "**/.env*"
  - "**/docker*"
  - "jarble-api-main/src/db/init*"
  - "jarble-api-main/src/index*"
  - "infrastructure/**"
---

# Environment & Configuration

## API (jarble-api-main/.env)
```
DATABASE_URL=postgresql://...   # Required — Neon Postgres connection string (prod or a Neon branch for local dev)
# USE_SQLITE and DB_PROVIDER were removed in commit 388018b (MySQL/SQLite removal)
AUTH0_DOMAIN=xxx.auth0.com
AUTH0_AUDIENCE=https://api.jarble.ai
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
OPENROUTER_API_KEY=sk-or-...
ENCRYPTION_KEY=...              # AES-256-GCM key for platform credentials
RESEND_API_KEY=re_...           # Optional — transactional email via Resend
ADMIN_USER_IDS=auth0|...,auth0|... # Optional — comma-separated Auth0 IDs for admin router access
AUTOSCALE_ENABLED=true          # Enable auto-scaling of Hetzner workers
HETZNER_API_TOKEN=...           # Hetzner Cloud API token
HETZNER_NETWORK_ID=...          # Private network ID for worker nodes
HETZNER_FIREWALL_ID=...         # Firewall ID applied to new workers
HETZNER_SSH_KEY_ID=...          # SSH key ID for server access
K3S_JOIN_TOKEN=...              # K3s cluster join token for new agents
```

## Frontend (Jarble-mvp/.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_AUTH0_DOMAIN=xxx.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=...
NEXT_PUBLIC_AUTH0_AUDIENCE=https://api.jarble.ai
```

## Debug Endpoints (dev only)
- `GET /debug/db` — Dump all tables
- `POST /debug/deployment/:id/status` — Force deployment status
- `GET /debug/deployment/:id/pod-status` — K8s pod status
- `GET /debug/platform-skills` — Platform skills for pods

## Local Dev DB
Use a Neon branch as your local dev database. Create a branch in the Neon console, copy the connection string, and set it as `DATABASE_URL` in `jarble-api-main/.env`.

`db/init.ts` is a no-op stub. Seed data is in `seed.pg.ts` (run separately, not on startup). Schema changes use `npm run db:migrate:pg`.

Note: `jarble-api-main/local.db` may still exist on disk from before the MySQL/SQLite removal. It is no longer used by the API at runtime. Safe to delete.
