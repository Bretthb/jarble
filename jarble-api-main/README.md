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

### tRPC Routers (`/trpc/*`)

**Deployment Router:**
- `deployment.list` - List user's deployments
- `deployment.create` - Create new deployment + K8s resources
- `deployment.deploy` - Deploy a pending deployment
- `deployment.getById` - Get deployment details
- `deployment.getStatus` - Get K8s pod status
- `deployment.getStorageUsage` - Get PVC storage usage
- `deployment.update` - Update deployment config
- `deployment.delete` - Delete deployment + K8s resources
- `deployment.stop` - Scale replicas to 0 (PVC persists)
- `deployment.start` - Scale replicas to 1
- `deployment.restart` - Stop then start
- `deployment.listLinkableDeployments` - List credit pool owners for linking

**User Router:**
- `user.me` - Get current user (public)
- `user.getProfile` - Get user profile
- `user.updateProfile` - Update profile
- `user.completeProfile` - Complete profile setup

**OpenRouter Router:**
- `openrouter.healthCheck` - Check OpenRouter API status
- `openrouter.models` - List available LLM models
- `openrouter.validateApiKey` - Validate an API key
- `openrouter.provisionKey` - Provision tenant API key
- `openrouter.getKeyUsage` - Get usage for deployment's key
- `openrouter.updateKeyLimit` - Update spending limit
- `openrouter.revokeKey` - Revoke a provisioned key

**Runtime Catalog Router:**
- `runtimeCatalog.list` - List available runtimes
- `runtimeCatalog.getById` - Get runtime by ID
- `runtimeCatalog.getBySlug` - Get runtime by slug

**Template Router:**
- `template.list` - List bot templates

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
│       ├── deployment.ts  # CRUD + K8s + linking + stop/start
│       ├── openrouter.ts  # Key provisioning + usage
│       ├── user.ts        # Profile management
│       ├── runtimeCatalog.ts # Runtime listing
│       └── template.ts    # Static templates
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
