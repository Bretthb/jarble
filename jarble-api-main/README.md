# Jarble API

Express + tRPC backend service for Jarble. Runs in K3s cluster.

## Tech Stack

- **Express.js** - HTTP server
- **tRPC** - Type-safe API
- **Drizzle ORM** - Database (MySQL prod, PostgreSQL alt, SQLite dev)
- **@kubernetes/client-node** - K8s pod management
- **jose** - JWT verification (Auth0)

## Development

```bash
# Install dependencies
npm install

# Copy env file and configure
cp .env.example .env

# Run in development (SQLite, no external DB needed)
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build
```

## API Endpoints

### tRPC Routers (`/trpc/*`) — 16 routers

| Router | Procedures | Description |
|--------|-----------|-------------|
| `user` | 6 | Profile, email verification, account deletion |
| `deployment` | 37 | CRUD, lifecycle (stop/start/restart), billing, canvas components, platformFork |
| `runtimeCatalog` | 4 | List available runtimes |
| `template` | 4 | Persona templates |
| `openrouter` | 10 | LLM key provisioning, validation, usage, revocation |
| `platformCredentials` | 7 | Discord/Slack/Telegram tokens, WhatsApp QR, connection testing |
| `deploymentSecrets` | 3 | Encrypted secret CRUD per deployment |
| `billing` | 4 | Overview, invoices, subscriptions, managed key usage |
| `skills` | 4 | Skills catalog, install/uninstall |
| `marketplace` | 23 | Browse, install, review, creator profiles, admin review queue |
| `services` | 26 | Service marketplace lifecycle: draft, publish, install, admin, creator analytics |
| `apiKeys` | 4 | Developer API key CRUD |
| `admin` | 19 | User mgmt, deployment control, Prometheus metrics, audit logs, beta |
| `flows` | 8 | Orchestration flow CRUD, execution history, LLM-based generation |
| `subagents` | 9 | Child agents: CRUD, reorder, fork, public toggle |
| `org` | 12 | Organizations: CRUD, invites, members, roles |

### REST Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | None | K8s liveness/readiness probe |
| POST | /api/stripe/webhook | Stripe sig | Stripe event webhooks |
| POST | /api/stripe/checkout | JWT | Create checkout session |
| POST | /api/stripe/portal | JWT | Create billing portal |
| POST | /api/auth0/email-verified | M2M | Auth0 email verification sync |

## Deployment

### Docker

```bash
docker build -t jarble/api:latest .
docker push jarble/api:latest
```

### Kubernetes

```bash
# Create namespace (if not exists)
kubectl create namespace jarble

# Create secrets (copy and edit first!)
cp k8s/secrets.yaml.example k8s/secrets.yaml
# Edit k8s/secrets.yaml with real values
kubectl apply -f k8s/secrets.yaml

# Deploy
kubectl apply -f k8s/deployment.yaml

# Check status
kubectl get pods -n jarble -l app=jarble-api
kubectl logs -n jarble -l app=jarble-api
```

## Project Structure

```
src/
├── index.ts              # Express entry point + REST webhooks
├── trpc/
│   ├── index.ts          # Router exports
│   ├── context.ts        # Request context
│   ├── middleware.ts      # tRPC setup + JWT auth
│   └── routers/
│       ├── admin.ts           # User mgmt, deployment control, metrics, beta
│       ├── apiKeys.ts         # Developer API key CRUD
│       ├── billing.ts         # Stripe overview, invoices, subscriptions
│       ├── deployment.ts      # CRUD + K8s + lifecycle + billing + canvas
│       ├── deploymentSecrets.ts # Encrypted secret CRUD
│       ├── flows.ts           # Orchestration flow CRUD + LLM generation
│       ├── marketplace.ts     # Component marketplace full lifecycle
│       ├── openrouter.ts      # LLM key provisioning + validation + usage
│       ├── org.ts             # Organizations, invites, members, roles
│       ├── platformCredentials.ts # Platform tokens + WhatsApp QR
│       ├── runtimeCatalog.ts  # Runtime listing
│       ├── services.ts        # Service marketplace lifecycle
│       ├── skills.ts          # Skills catalog + install/uninstall
│       ├── subagents.ts       # Child agents: CRUD, fork, reorder
│       ├── template.ts        # Persona templates
│       └── user.ts            # Profile, email verify, account deletion
├── db/
│   ├── index.ts          # Drizzle client
│   ├── init.ts           # SQLite CREATE TABLE + seed
│   ├── schema.ts         # MySQL schema (prod)
│   ├── schema.pg.ts      # PostgreSQL schema (alt)
│   └── schema.sqlite.ts  # SQLite schema (dev)
├── k8s/
│   └── deployment.ts     # K8s orchestration (create/delete/stop/start/restart/exec)
├── runtimes/
│   ├── index.ts          # Handler resolution
│   ├── types.ts          # DeploymentFields interface
│   └── handlers/
│       ├── openclaw.ts    # OpenClaw K8s config + env vars
│       └── zeroclaw.ts    # ZeroClaw K8s config + env vars
├── services/
│   └── auth.ts           # JWT verification (Auth0 JWKS)
└── utils/
    ├── encryption.ts     # AES-256-GCM encrypt/decrypt
    ├── openrouter.ts     # OpenRouter Management API
    ├── env.ts            # Environment variable validation
    └── logger.ts         # Pino logger
```

## Environment Variables

See `.env.example` for all required variables.
