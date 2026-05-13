# Jarble API

Express + tRPC backend for **Jarble — an Agent Infrastructure Platform**. Runs in K3s on Hetzner.

The API is the control plane: it owns the deployment lifecycle, config sync into harness pods, K8s orchestration, billing, organizations, and the per-deployment ingress that surfaces each Agent Harness's webchat UI to the end user.

## Tech Stack

- **Express.js** — HTTP server
- **tRPC** — Type-safe API
- **Drizzle ORM** — Postgres only (Neon)
- **@kubernetes/client-node** — K8s pod management
- **jose** — JWT verification (Auth0)

## Development

```bash
# Install dependencies
npm install

# Copy env file and configure (point DATABASE_URL at a Neon dev branch)
cp .env.example .env

# Run in development
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build
```

There is no SQLite or MySQL provider at runtime — those were removed in commit `388018b`. The only Postgres-less code path is the in-memory SQLite mirror in `src/__tests__/helpers/`, used by Vitest.

## API Endpoints

### tRPC Routers (`/trpc/*`)

The API exposes a number of tRPC routers under `src/trpc/routers/`. The current canonical list is in the repo-root `CLAUDE.md` — keeping a procedure-level table here in sync was a maintenance trap, so this README only links to the source of truth.

Routers cover: `user`, `deployment`, `runtimeCatalog` (the harness catalog — the directory and table names retain the older "runtime" identifier), `openrouter`, `billing`, `platformCredentials`, `deploymentSecrets`, `flows`, `admin`, `apiKeys`, `skills`, `subagents`, `org`.

For an exhaustive procedure list, run the `docs-updater` agent or read the routers directly.

### REST Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | None | K8s liveness/readiness probe |
| POST | /api/stripe/webhook | Stripe sig | Stripe event webhooks |
| POST | /api/stripe/checkout | JWT | Create checkout session |
| POST | /api/stripe/portal | JWT | Create billing portal |
| POST | /api/auth0/email-verified | M2M | Auth0 email verification sync |

Plus the per-deployment proxy / forward-auth routes that surface the Agent Harness's own webchat UI to authenticated users (see `src/routes/adminProxy.ts`, `agentAuth.ts`, `openWebUiProxy.ts`).

## Deployment

Production deploys via **Kubero** on the existing K3s cluster, not raw `kubectl apply`. The `k8s/` directory in this package is reference / dev material — production uses Kubero's CRD.

```bash
# Build + push the image (CI does this on push to main/develop)
docker build -t ghcr.io/jarble-ai/api:latest .
docker push ghcr.io/jarble-ai/api:latest
```

Verify a running pod:

```bash
kubectl -n jarble-production get pods
kubectl -n jarble-production logs deployment/jarble-api-kuberoapp-web
kubectl -n jarble-production exec deployment/jarble-api-kuberoapp-web -- env
```

## Project Structure

```
src/
├── index.ts                  # Express entry + REST webhooks + per-deployment proxies
├── trpc/
│   ├── index.ts              # Router exports
│   ├── context.ts            # Request context
│   ├── middleware.ts         # tRPC setup + JWT auth
│   └── routers/              # see CLAUDE.md for the canonical router list
├── db/
│   ├── index.ts              # Drizzle client
│   ├── init.ts               # No-op stub (kept for backward compat with startup)
│   ├── schema.pg.ts          # Single source of truth for all tables
│   ├── migrate.pg.ts         # Custom migrator — runs on pod start
│   └── seed.pg.ts            # Seed data (run separately, not on startup)
├── k8s/
│   ├── deployment.ts         # K8s orchestration (create/delete/lifecycle)
│   ├── lifecycle.ts          # Durable lifecycle jobs
│   ├── nodeManager.ts        # Hetzner auto-scaler
│   └── secrets.ts            # K8s Secret CRUD
├── runtimes/                 # Agent Harness handlers
│   ├── handlers/index.ts     # Handler registry: harness name → handler
│   └── handlers/openclaw.ts  # OpenClaw harness handler (only shipping today)
├── services/
│   ├── configSync.ts         # Two-way sync: DB ↔ PVC configs
│   └── auth.ts               # JWT verification (Auth0 JWKS)
└── utils/
    ├── encryption.ts         # AES-256-GCM encrypt/decrypt
    ├── openrouter.ts         # OpenRouter Management API
    ├── env.ts                # Environment variable validation
    └── logger.ts             # Pino logger
```

The `runtimes/` directory keeps its existing name even though the user-facing term for the abstraction is **Agent Harness**. Code identifiers (`RuntimeHandler`, `runtimeCatalog`, `RUNTIME_EXTRA_STEPS`) are intentionally preserved.

## Environment Variables

See `.env.example` for the full list. The hot-path variables are documented in the repo-root `CLAUDE.md` and `.claude/rules/env-config.md`.
