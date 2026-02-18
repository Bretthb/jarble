# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jarble is a **no-code AI bot deployment platform** that lets users deploy LLM-powered bots to messaging platforms (WhatsApp, Discord, Slack, Telegram) without coding. Users pick a runtime (OpenClaw, ZeroClaw), configure an LLM provider, and deploy — all through a guided wizard.

## Monorepo Structure

```
├── Jarble-mvp/          # Next.js 15 frontend (App Router, React 19)
├── jarble-api-main/     # Express + tRPC API backend
├── infrastructure/      # Terraform IaC + Auth0 config
└── runtimes/            # Bot runtime implementations (openclaw, zeroclaw)
```

## Common Commands

### Frontend (Jarble-mvp/)
```bash
npm run dev          # Start dev server on :3000
npm run build        # Production build
npm run check        # TypeScript type-check (tsc --noEmit)
npm run format       # Prettier format
npm run test         # Run Vitest tests
```

### API (jarble-api-main/)
```bash
npm run dev          # Start with file watching (tsx watch)
npm run dev:test     # Start with SQLite (USE_SQLITE=true) for local dev
npm run typecheck    # TypeScript type-check
npm run lint         # ESLint
npm run db:push      # Push schema to database
npm run db:studio    # Open Drizzle Studio
npm run db:generate  # Generate migrations
npm run db:migrate   # Run migrations
```

### Running Both Services
Start API and frontend in separate terminals:
```bash
# Terminal 1 - API on :3001
cd jarble-api-main && npm run dev

# Terminal 2 - Frontend on :3000
cd Jarble-mvp && npm run dev
```

## Architecture

### Tech Stack
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, Framer Motion, @xyflow/react (node graph)
- **API**: Express, tRPC, SuperJSON, Drizzle ORM
- **Database**: MySQL (prod), PostgreSQL (alt), SQLite (dev with USE_SQLITE=true)
- **Auth**: Auth0 (JWT + JWKS verification)
- **Payments**: Stripe (dynamic pricing via price_data)
- **Infrastructure**: Hetzner Cloud, Terraform, K3s, Longhorn storage

### tRPC Router Structure
The API exposes 7 routers with 45+ procedures at `/trpc`:
- `user` - Profile management, auth state
- `deployment` - CRUD, lifecycle (start/stop/restart), K8s operations
- `runtimeCatalog` - Available bot runtimes
- `openrouter` - LLM key provisioning and validation
- `billing` - Stripe checkout, subscriptions
- `platformCredentials` - Encrypted messaging platform credentials
- `template` - Bot configuration templates

### Frontend-Backend Communication
- **tRPC + React Query**: Type-safe API calls with automatic caching
- **SSE Streams**: Real-time status updates (`useStatusStream`), logs (`useLogStream`), QR pairing (`useQrStream`)
- **Auth0 Bearer tokens**: Automatically attached via tRPC link headers

### Database Schema (Drizzle)
Core tables in `jarble-api-main/src/db/schema.ts`:
- `users` - Auth0 ID, Stripe customer, email verification, free trial state
- `deployments` - Bot instances with K8s state, LLM config, subscription links
- `runtimeCatalog` - Available runtimes with hardware specs and pricing
- `platformCredentials` - AES-256-GCM encrypted platform tokens

### Config-Driven UI
The wizard and config tabs are driven by `Jarble-mvp/views/onboarding/wizardStepConfig.ts`:
- `RUNTIME_EXTRA_STEPS` - Defines wizard steps per runtime
- `RUNTIME_CONFIG_TABS` - Defines configuration tabs per runtime
- Adding a new runtime only requires config changes + component implementation

## Key Patterns

### Adding a New Runtime
1. Add entry to `RUNTIME_EXTRA_STEPS` and `RUNTIME_CONFIG_TABS` in wizardStepConfig.ts
2. Create runtime handler in `jarble-api-main/src/runtimes/handlers/`
3. Add render blocks in OnboardingWizard.tsx and DeploymentConfiguration.tsx

### Adding a New LLM Provider
1. Add to `LLM_PROVIDERS` in wizardStepConfig.ts
2. Add validation in `jarble-api-main/src/trpc/routers/openrouter.ts`
3. Add to Zod enum in deployment router

### Protected Routes
All protected pages check Auth0 authentication:
```tsx
const { isAuthenticated, isLoading } = useAuth0();
if (isLoading) return <Spinner />;
if (!isAuthenticated) return <Redirect to="/login" />;
```

### Linked Deployments Graph
`/deployments` uses React Flow (@xyflow/react) + dagre for an interactive node graph showing credit pool relationships. Nodes are circle icons (owner/linked/standalone), edges show credit pool links, and clicking a node opens a detail panel overlay on the left. Filter bar toggles credit pool edges and filters by runtime.

### Real-Time Updates
Dashboard uses SSE streams instead of polling:
```tsx
const { getStatus } = useStatusStream({ enabled: isAuthenticated });
const liveStatus = getStatus(deployment.id);
```

## Environment Variables

### API (jarble-api-main/.env)
```
DATABASE_URL=mysql://...     # Required for prod
USE_SQLITE=true              # Use SQLite for local dev
AUTH0_DOMAIN=xxx.auth0.com
AUTH0_AUDIENCE=https://api.jarble.ai
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
OPENROUTER_API_KEY=sk-or-...
```

### Frontend (Jarble-mvp/.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_AUTH0_DOMAIN=xxx.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=...
NEXT_PUBLIC_AUTH0_AUDIENCE=https://api.jarble.ai
```

## Specialized Debug Agents

This repo has pre-configured debug agents in `.claude/agents/` for common issues:
- `auth0-debugger` - JWT verification, JWKS cache, email sync
- `stripe-webhook-debugger` - Webhook handling, subscription lifecycle
- `k8s-pod-debugger` - Pod lifecycle, PVC mounts, storage issues
- `nextjs-frontend-debugger` - Hydration, React Query, SSE streams
- `sse-stream-debugger` - Stream disconnections, event ordering
- `jarble-api-debugger` - tRPC tracing, async race conditions
