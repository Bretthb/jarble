# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Detailed documentation is split into `.claude/rules/` — path-specific files load automatically when you work in matching directories.

## Developer Portability

This repo includes a **portable memory system** so Claude Code context travels with git:

- **`.claude/memory/`** — Committed copy of Claude's auto-memory (MEMORY.md + topic files). Auto-synced by hooks.
- **`.claude/agent-memory/`** — Accumulated debugging knowledge from specialized agents.
- **`scripts/setup.sh`** — Run `bash scripts/setup.sh` after cloning on a new machine to restore memory, install deps.
- **Hooks** (`.claude/settings.json`): `SessionStart` restores committed memory → local; `Stop` copies local → committed and stages for git.

## Project Overview

Jarble is a **no-code AI bot deployment platform** that lets users deploy LLM-powered bots to messaging platforms (WhatsApp, Discord, Slack, Telegram) without coding. Users pick a runtime (OpenClaw, ZeroClaw), configure an LLM provider, and deploy — all through a guided wizard.

Each deployment gets a **web chat interface** (`/d/[id]`) where users interact with their bot through a chat UI. The bot can render **rich UI components** (charts, tables, 3D visualizations, live widgets) via an MCP UI server, displayed as interactive canvas blocks inline in the conversation.

## Monorepo Structure

```
├── Jarble-mvp/          # Next.js 15 frontend (App Router, React 19)
├── jarble-api-main/     # Express + tRPC API backend
├── shared/              # Shared packages
│   └── component-manifest/  # Single source of truth for component metadata
├── scripts/             # CI/build scripts
├── infrastructure/      # Terraform IaC + Auth0 config
└── runtimes/            # Bot runtime implementations (openclaw, zeroclaw)
```

## Common Commands

### Frontend (Jarble-mvp/)
```bash
npm run dev          # Start dev server on :3000
npm run build        # Production build
npm run check        # TypeScript type-check (tsc --noEmit)
npm run test         # Run Vitest unit tests
npm run check:manifest   # Verify manifest ↔ component sync
```

### API (jarble-api-main/)
```bash
npm run dev          # Start with file watching (tsx watch)
npm run dev:test     # Start with SQLite (USE_SQLITE=true) for local dev
npm run typecheck    # TypeScript type-check
npm run test         # Run Vitest unit tests
npm run db:push      # Push schema to database
npm run db:studio    # Open Drizzle Studio
```

### Running Both Services
```bash
# Terminal 1 - API on :3001
cd jarble-api-main && npm run dev
# Terminal 2 - Frontend on :3000
cd Jarble-mvp && npm run dev
```

## Tech Stack
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, @assistant-ui/react, recharts, @xyflow/react, Monaco Editor
- **API**: Express, tRPC, SuperJSON, Drizzle ORM
- **MCP**: Custom stdio MCP server (`jarble-ui-server.js`) — `render_ui`, `define_component`, `list_components`, `component_reference`, `skill_reference`
- **Database**: MySQL (prod), PostgreSQL (alt), SQLite (dev with USE_SQLITE=true)
- **Auth**: Auth0 (JWT + JWKS), **Payments**: Stripe, **Infra**: Hetzner Cloud, Terraform, K3s, Longhorn

## tRPC Router Structure
9 routers with 73+ procedures at `/trpc`:
`user`, `deployment`, `runtimeCatalog`, `openrouter`, `billing`, `platformCredentials`, `template`, `marketplace` (components), `services` (service marketplace + hosted dashboard)

## Frontend-Backend Communication
- **tRPC + React Query**: Type-safe API calls with automatic caching
- **SSE Streams**: Real-time status (`useStatusStream`), logs (`useLogStream`), QR pairing (`useQrStream`)
- **Chat SSE**: `POST /api/tambo-agent` streams bot responses (text deltas + UI blocks)
- **Auth0 Bearer tokens**: Automatically attached via tRPC link headers

## Path Aliases & Zod Version Split

**Critical**: Frontend uses **Zod v4**, API uses **Zod v3**. Each tsconfig pins the `zod` path to its own `node_modules/zod`. The shared `component-manifest` package must work with both — don't construct Zod schemas that cross the version boundary.

- `@/*` → `Jarble-mvp/*` (frontend only)
- `@jarble/component-manifest` → `shared/component-manifest/index.ts` (both)
- `@jarble/component-manifest` must be in `next.config.ts:transpilePackages` (raw TypeScript, no build step)

## Key Patterns

### Adding a New Runtime
1. Add entry to `RUNTIME_EXTRA_STEPS` and `RUNTIME_CONFIG_TABS` in `wizardStepConfig.ts`
2. Create runtime handler in `jarble-api-main/src/runtimes/handlers/`
3. Add render blocks in `OnboardingWizard.tsx` and `DeploymentConfiguration.tsx`

### Adding a New LLM Provider
1. Add to `LLM_PROVIDERS` in `wizardStepConfig.ts`
2. Add validation case in `openrouter.ts:validateProviderKey`
3. Add to Zod enum in deployment router
4. Add env var mapping in `openclaw.ts:getSecretEntries` (`providerEnvMap`)

### Adding a New Messaging Platform
1. Add credential field mapping in `platformCredentials.ts:PLATFORM_CREDENTIAL_KEYS`
2. Add env var mapping in `platformCredentials.ts:PLATFORM_ENV_MAP`
3. Add channel config in `openclaw.ts:renderConfigs`
4. Add UI in `OnboardingWizard.tsx` and `DeploymentConfiguration.tsx`
5. Add step in `wizardStepConfig.ts:RUNTIME_EXTRA_STEPS`

### Adding a New Canvas Component
1. Create `Jarble-mvp/components/canvas/components/Canvas{Name}.tsx` — **no wrapper styling** (use `p-3 h-full`)
2. Add entry to `shared/component-manifest/components/{name}.ts`
3. Register in `shared/component-manifest/index.ts`
4. Run `npm run check:manifest`

### Claude Max OAuth Tokens
`sk-ant-oat*` tokens can't be validated via Anthropic API — auto-passed by prefix in `openrouter.ts:validateProviderKey`. Use Bearer auth (not `x-api-key`).

### Config-Driven UI
Wizard steps and config tabs driven by `Jarble-mvp/views/onboarding/wizardStepConfig.ts`. Adding a new runtime only requires config changes + component implementation.

## Environment Variables

### API (jarble-api-main/.env)
```
DATABASE_URL=mysql://...        # Required for prod
USE_SQLITE=true                 # Use file-based SQLite for local dev (local.db)
AUTH0_DOMAIN=xxx.auth0.com
AUTH0_AUDIENCE=https://api.jarble.ai
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
OPENROUTER_API_KEY=sk-or-...
ENCRYPTION_KEY=...              # AES-256-GCM key for platform credentials
```

### Frontend (Jarble-mvp/.env.local)
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

## Rules Index (`.claude/rules/`)

| File | Loads When | Content |
|------|-----------|---------|
| `kubernetes.md` | Working in `k8s/`, `runtimes/`, `configSync`, `infrastructure/` | K8s architecture, pod lifecycle, ConfigSync, runtime handlers |
| `canvas-chat.md` | Working in `canvas/`, `workspace/`, `chat/`, `hooks/`, `component-manifest/` | Chat flow, canvas grid, sandbox, components, accessibility |
| `testing.md` | Working in `*.test.*`, `__tests__/`, `e2e/` | Test structure, harness, mocking patterns, E2E |
| `marketplace.md` | Working in `marketplace/`, `services.*`, `HostedService*` | Component/service marketplace, hosted services dashboard |
| `security.md` | Working in `sandbox*`, `security*`, `sanitize*`, `encryption*` | Sandbox CSP, SSE resilience, response headers |
| `database.md` | Working in `db/`, `schema*`, `migration*` | Drizzle schema, tables, dev database |
| `key-files.md` | Always loaded | Key file reference tables (backend, shared, frontend) |

## Claude Agents

Pre-configured agents in `.claude/agents/`:
`accessibility-auditor`, `code-reviewer`, `docs-updater`, `auth0-debugger`, `canvas-component-builder`, `design-system-reviewer`, `drizzle-db-schema`, `jarble-api-debugger`, `k8s-pod-lifecycle-debugger`, `mcp-server`, `nextjs-frontend-debugger`, `performance-bundle-analyzer`, `runtime-handler`, `sse-stream-debugger`, `stripe-webhook-debugger`, `tambo-integration-reviewer`, `terraform-infra`, `test-writer`
