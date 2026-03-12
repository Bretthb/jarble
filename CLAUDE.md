# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jarble is a **no-code AI bot deployment platform** that lets users deploy LLM-powered bots to messaging platforms (WhatsApp, Discord, Slack, Telegram) without coding. Users pick a runtime (OpenClaw, ZeroClaw), configure an LLM provider, and deploy — all through a guided wizard.

Each deployment gets a **web chat interface** (`/d/[id]`) where users interact with their bot through a Tambo-powered chat. The bot can render **rich UI components** (charts, tables, 3D visualizations, live widgets) via an MCP UI server, displayed as interactive canvas blocks inline in the conversation.

## Monorepo Structure

```
├── Jarble-mvp/          # Next.js 15 frontend (App Router, React 19)
├── jarble-api-main/     # Express + tRPC API backend
├── shared/              # Shared packages
│   └── component-manifest/  # Single source of truth for component metadata
├── scripts/             # CI/build scripts
│   ├── check-manifest.ts        # Manifest ↔ component sync CI check
│   └── deployment-testing/      # Automated deployment testing framework
│       ├── run.ts               # Orchestrator — runs 4 agents, writes report
│       ├── agents.ts            # 4 test agents (UI, Safety, Performance, Data)
│       ├── lib.ts               # Shared test utilities and assertions
│       └── reports/             # Generated markdown test reports
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
npm run check:manifest   # Verify manifest ↔ component sync
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
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, Framer Motion, @xyflow/react (node graph), recharts, Monaco Editor, Leaflet, @assistant-ui/react (chat framework), @sentry/nextjs (error monitoring), posthog-js (analytics), DOMPurify (HTML sanitization)
- **API**: Express, tRPC, SuperJSON, Drizzle ORM
- **MCP**: Custom stdio MCP server (`jarble-ui-server.js`) running inside bot pods — exposes `render_ui`, `define_component`, `list_components`, `component_reference` tools
- **Database**: PostgreSQL via Neon (prod), SQLite (dev with USE_SQLITE=true)
- **Auth**: Auth0 (JWT + JWKS verification), RBAC (`super_admin` / `user` roles)
- **Payments**: Stripe (dynamic pricing via price_data)
- **Infrastructure**: Hetzner Cloud, Terraform, K3s, Longhorn storage
- **Container Image**: `ghcr.io/jarble-ai/openclaw:latest` (Node.js 22, OpenClaw runtime)

### tRPC Router Structure
The API exposes 9 routers at `/trpc`, plus 2 REST chat history endpoints (`GET /api/tambo-agent/sessions/*`) mounted in `tamboAgent.ts`:
- `user` - Profile management, auth state
- `deployment` - CRUD, lifecycle (start/stop/restart), K8s operations (admins bypass ownership checks)
- `runtimeCatalog` - Available bot runtimes
- `openrouter` - LLM key provisioning, validation, multi-provider support
- `billing` - Stripe checkout, subscriptions
- `platformCredentials` - Encrypted messaging platform credentials, pairing flows
- `template` - Bot configuration templates
- `marketplace` - Component marketplace: browse, install, publish, review, creator tools, admin moderation
- `admin` - Platform admin: stats, user management, all deployments, deployment control (start/stop/restart/delete), billing stats, system health, audit logs (13 procedures, all `adminProcedure`-guarded)

### Frontend-Backend Communication
- **tRPC + React Query**: Type-safe API calls with automatic caching
- **SSE Streams**: Real-time status updates (`useStatusStream`), logs (`useLogStream`), QR pairing (`useQrStream`)
- **Chat SSE**: `POST /api/tambo-agent` streams bot responses as SSE events (text deltas + UI blocks)
- **Auth0 Bearer tokens**: Automatically attached via tRPC link headers

### Database Schema (Drizzle)
Core tables in `jarble-api-main/src/db/schema.ts` (SQLite variant in `schema.sqlite.ts`):
- `users` - Auth0 ID, Stripe customer, email verification, free trial state, role (`user` or `super_admin`)
- `deployments` - Bot instances with K8s state, LLM config (provider, model, encrypted API key), subscription links
- `runtimeCatalog` - Available runtimes with hardware specs and pricing
- `platformCredentials` - AES-256-GCM encrypted platform tokens (Telegram, Discord, Slack, WhatsApp, etc.)
- `skillsCatalog` - Available skills (Web Search, Weather, Calculator, etc.)
- `deploymentSkills` - Many-to-many linking deployments to skills
- `processedWebhookEvents` - Stripe webhook idempotency tracking
- `marketplaceComponents` - Published components (manifest, code, author, pricing, status)
- `componentVersions` - Version history
- `componentInstalls` - Deployment→component installations
- `componentPurchases` - Purchase records
- `componentReviews` - Ratings and reviews
- `marketplaceCreators` - Creator profiles
- `chat_sessions` - Chat conversation sessions per deployment (auto-titled from first user message, tracks `createdAt`/`updatedAt`)
- `chat_messages` - Individual messages per session (role: user/assistant, cleaned content, optional `thinkingText`)
- `auditLogs` - Admin action audit trail (userId, action, targetType, targetId, metadata JSON, ipAddress, createdAt)

SQLite dev DB is file-based at `jarble-api-main/local.db` (persists across tsx watch restarts). Seed data (test user, runtime catalog, skills) created on startup via `db/init.ts`.

### Config-Driven UI
The wizard and config tabs are driven by `Jarble-mvp/views/onboarding/wizardStepConfig.ts`:
- `RUNTIME_EXTRA_STEPS` - Defines wizard steps per runtime
- `RUNTIME_CONFIG_TABS` - Defines configuration tabs per runtime
- Adding a new runtime only requires config changes + component implementation

## K8s Architecture

### K8s Module Structure
The monolithic `k8s/deployment.ts` was refactored into focused modules:
- `k8s/lifecycle.ts` — Create, restart, delete deployments
- `k8s/exec.ts` — kubectl exec into pods
- `k8s/secrets.ts` — K8s Secret CRUD
- `k8s/components.ts` — Build K8s resource specs (Deployment, PVC, Secret, Service)
- `k8s/status.ts` — Pod status checks
- `k8s/logs.ts` — Log streaming
- `k8s/metrics.ts` — Pod CPU/memory/node metrics (`getDeploymentMetrics()`)
- `k8s/client.ts` — K8s API client setup (CoreV1Api, AppsV1Api, CustomObjectsApi, Exec)
- `k8s/config.ts` — Cluster configuration
- `k8s/constants.ts` — Namespace, labels, etc.

### Resources Per Deployment
Each deployment creates 4 K8s resources in namespace `jarble`:
- **Deployment**: `dep-{deploymentId}` — 1 replica, container `runtime`, port 18789
- **Secret**: `secret-{deploymentId}` — LLM keys, platform tokens, deployment metadata
- **PVC**: `pvc-{deploymentId}` — Longhorn (`longhorn-1r` storage class, 1 replica), **5Gi** RWO default, mounted at `/data`
- **Service**: ClusterIP for inter-pod communication

### PVC Directory Structure (`/data/`)
```
/data/
├── .initialized          # Marker — skips npm install on subsequent boots
├── .npm/                 # npm cache (can get corrupted — see Known Issues)
├── .openclaw/            # OpenClaw's own state directory
│   ├── openclaw.json     # OpenClaw native config (generated by entrypoint)
│   └── .openclaw/        # Internal state (auth store, conversations, canvas)
├── components/           # Custom component definitions (JSON, written by define_component MCP tool)
├── config/               # Jarble platform-managed configs (written by configSync)
│   ├── openclaw.json     # Channel config rendered from DB
│   └── soul.md           # System prompt from DB
├── files/                # Saved canvas component data (written by save_canvas_file MCP tool)
├── logs/                 # Application logs
└── runtime/              # npm-installed OpenClaw package (node_modules)
```

### Config Path Architecture (IMPORTANT)
There are TWO `openclaw.json` files:
| Path | Written By | Purpose |
|------|-----------|---------|
| `/data/config/openclaw.json` | configSync (Jarble API) | Channel configs, agent model |
| `/data/.openclaw/openclaw.json` | OpenClaw entrypoint | Native config (gateway port, model) |

**Critical**: OpenClaw reads platform tokens (Telegram, Discord, Slack) from **K8s Secret env vars**, not from openclaw.json. The JSON config enables/disables channels and sets policies (e.g. `dmPolicy`), but actual credentials come from env vars like `TELEGRAM_BOT_TOKEN`.

### K8s Secret Contents
```
# Always present:
DEPLOYMENT_ID, USER_ID, DEPLOYMENT_NAME, TEMPLATE, RUNTIME, OPENCLAW_GATEWAY_TOKEN

# LLM (one of):
ANTHROPIC_API_KEY | OPENROUTER_API_KEY | OPENAI_API_KEY | GOOGLE_API_KEY
LLM_PROVIDER, LLM_MODEL

# Platform tokens (added by configSync when credentials saved):
TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN, SLACK_BOT_TOKEN, SLACK_APP_TOKEN
```

### ConfigSync Pipeline (`jarble-api-main/src/services/configSync.ts`)
Triggered fire-and-forget by credential save/delete mutations:
```
DB → buildDeploymentFields() → renderConfigs() + getSecretEntries()
  → writeConfigsToPvc()          # exec into pod, write files via stdin
  → updateDeploymentSecret()     # replace K8s Secret
  → restartDeployment()          # scale 0→1
  → poll for readiness           # 30 × 2s = 60s max
  → update DB status             # "running" or "failed"
```

### Runtime Handler Pattern (`jarble-api-main/src/runtimes/handlers/`)
Each runtime implements `RuntimeHandler`:
- `renderConfigs(deployment)` → config files to write to PVC
- `getSecretEntries(deployment)` → env vars for K8s Secret
- `parseConfigs(files)` → reverse: PVC config → DB fields
- `validateCreate(input)` → pre-deploy validation

### Prompt Architecture (OpenClaw)

The system prompt is split into two distinct parts with different delivery mechanisms:

| Constant | Location | Written to | Delivery | Purpose |
|----------|----------|------------|----------|---------|
| `PLATFORM_GUARDRAILS` | `openclaw.ts` | `soul.md` on PVC | Pod startup (configSync) | Security rules, real data policy, memory instructions — enforced on ALL platforms including Telegram/Discord/Slack |
| `JARBLE_UI_PROMPT` | `openclaw.ts` | Never persisted | Injected per-request by `tamboAgent.ts` as a `system` message | Canvas rendering instructions, component reference, layout hints — web dashboard only |

**Why split?** `PLATFORM_GUARDRAILS` must be in `soul.md` so messaging bots (which bypass the API) still obey security rules. `JARBLE_UI_PROMPT` is injected at request time in `chatViaHttp` so updating the API code instantly propagates UI instructions to all deployments without restarting any pods.

`chatViaHttp` accepts an optional `systemMessage` parameter that is prepended to the messages array before the user message. `tamboAgent.ts` passes `JARBLE_UI_PROMPT` here for every web chat request.

There is also a `MESSAGING_ONLY_PROMPT` constant for future use — a condensed alternative to `JARBLE_UI_PROMPT` that saves ~1,250 tokens on messaging-only deployments.

### Telegram Pairing Flow
```
1. User enters bot token → validated via Telegram getMe API
2. Credentials saved to DB → configSync writes PVC + updates Secret
3. Pod restarts → OpenClaw detects TELEGRAM_BOT_TOKEN → enables Telegram
4. User messages bot → bot sends pairing code (dmPolicy: "pairing")
5. Frontend polls pollTelegramPairing mutation every 3s
6. Backend exec: `npx openclaw pairing list telegram --json`
7. Finds pending → `npx openclaw pairing approve telegram {code} --notify`
8. Bot confirms pairing, user can chat
```

### Pod Security (Implemented)
- ✅ Runs as non-root user (uid=1000, gid=1000) with `runAsNonRoot: true`
- ⚠️ Secrets in env vars — should mount as files (requires upstream OpenClaw changes)
- ✅ K8s service account token disabled (`automountServiceAccountToken: false`)
- ✅ NetworkPolicy restricts egress (blocks cloud metadata, localhost; allows LLM APIs + messaging platforms)
- ✅ All capabilities dropped (`drop: ["ALL"]`)
- ✅ RBAC denies API requests, DNS works, Longhorn storage works

### Known K8s Issues
- **npm cache corruption**: `ENOTEMPTY` errors on PVC. Fix: clear `/data/.npm` and delete pod
- **Status stuck at "creating"**: Polling times out during slow npm install. Fix: debug endpoint or background reconciler
- **Telegram 409 conflict**: Two pods with same bot token. Scale down stale deployments
- **403 on exec for storage usage**: The SSE status stream attempts to exec into pods to read storage usage (`getDeploymentStorageUsage`). This currently returns 403 due to RBAC rules — storage metrics fall back to `null` gracefully. CPU/memory metrics come from the metrics API instead, which works correctly.

## Canvas & Chat Architecture

### Chat Flow (`/d/[id]`)
The deployment chat page uses `@assistant-ui/react` with an `ExternalStoreRuntime` to orchestrate user ↔ bot conversations. Bot responses stream via SSE with text deltas and UI blocks. The chat UI is implemented in `components/chat/AssistantUIChat.tsx` (replaced the former `StreamingBotMessage.tsx`).

SSE event types: `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT` (delta), `TEXT_MESSAGE_END`, `UI_BLOCK_START`, `UI_BLOCK_PROPS`, `UI_BLOCK_END`, `RUN_FINISHED`

The `uiBlockParser.ts` uses a brace-depth JSON parser (not regex) for reliable incremental block extraction during SSE streaming.

### Chat Session Sidebar
`components/chat/ChatSessionSidebar.tsx` renders a collapsible sidebar listing past chat sessions grouped by date (Today / Yesterday / Last 7 days / Older). The sidebar toggle is in the chat page header. When `isOpen` is false the component returns `null` — no collapsed icon is shown. Sessions are loaded via `hooks/useChatSessions.ts` which fetches conversation history from the database via `GET /api/tambo-agent/sessions/:deploymentId`. Chat history is stored in the `chat_sessions` and `chat_messages` DB tables (not pod storage).

### Canvas Grid System (`SimpleCanvasGrid.tsx`)
UI components render in a **simple responsive CSS grid** (not react-grid-layout):
- Components flow naturally at their content size
- **Drag-to-reorder**: Drag any card to swap positions with another
- **Split**: Multi-item components (stat_grid, key_value, descriptions) can split into individual cards
- **Merge**: Compatible cards show a merge button to combine items
- No visible wrappers — components render without borders/padding (styling removed from all components)

**Canvas reducer actions** (`canvasReducer.ts`):
- `ADD_CARD`, `REMOVE_CARD`, `MOVE_CARD`, `RESIZE_CARD`
- `SPLIT_CARD` — Splits multi-item components into individual cards
- `MERGE_CARDS` — Combines items from two compatible cards
- `REORDER_CARDS` — Drag-to-reorder support

**Splittable components** (configured in `types.ts:SPLITTABLE_COMPONENTS`):
- `stat_grid` → splits into `statistic` cards
- `key_value` → splits into `card` cards
- `descriptions` → splits into `card` cards

### Canvas Components (37 active + 1 alias)
Bot renders UI via `render_ui` MCP tool → `jarble_ui` fenced blocks → frontend parses and renders. All component metadata is defined in `shared/component-manifest/` (the single source of truth). 22 Ant Design chart components were deleted and replaced by a unified recharts-based `chart` component.

**Categories**: Display (card, stat_grid, data_table, chart, tabs, accordion), Charts (recharts), Interactive (button_group, form), Media (video, audio, image_gallery), Specialized (code_editor, map, sandbox, marketplace_sandbox)

**Alias**: `canvas` → `sandbox` (LLMs often say "canvas" when they mean "sandbox")

**Rendering pipeline**: Props are first run through `autoFixProps` (20 repair rules, 30+ component name aliases), then validated via Zod schemas, then rendered with an error boundary. Repair actions are tracked via Sentry breadcrumbs.

**Sandbox** (`CanvasSandbox.tsx`): Secure iframe for arbitrary HTML/CSS/JS with Three.js, D3, etc. Uses `sandbox="allow-scripts allow-popups"` (no same-origin). Parent/iframe bridge via `window.__JARBLE_PROPS__` and `jarble.send()`. CSP is tightened to 10 trusted CDN origins (not wildcards). 30s watchdog timer kills runaway scripts. Server-side library URL validation against CDN allowlist in `uiBlockParser.ts`.

### Adding a New Canvas Component
1. Create `Jarble-mvp/components/canvas/components/Canvas{Name}.tsx` — **no wrapper styling** (use `p-3 h-full`)
2. Add component entry to `shared/component-manifest/components/{name}.ts` with Zod schema, layout hints, category, and description
3. Register the entry in `shared/component-manifest/index.ts` — this is the single source of truth; `registry.ts` imports from it
4. Run `npm run check:manifest` to verify manifest ↔ component sync

## Key Patterns

### Adding a New Runtime
1. Add entry to `RUNTIME_EXTRA_STEPS` and `RUNTIME_CONFIG_TABS` in wizardStepConfig.ts
2. Create runtime handler in `jarble-api-main/src/runtimes/handlers/`
3. Add render blocks in OnboardingWizard.tsx and DeploymentConfiguration.tsx

### Adding a New LLM Provider
1. Add to `LLM_PROVIDERS` in wizardStepConfig.ts
2. Add validation case in `openrouter.ts:validateProviderKey` (URL, headers, success check)
3. Add to Zod enum in deployment router
4. Add env var mapping in `openclaw.ts:getSecretEntries` (`providerEnvMap`)

### Adding a New Messaging Platform
1. Add credential field mapping in `platformCredentials.ts:PLATFORM_CREDENTIAL_KEYS`
2. Add env var mapping in `platformCredentials.ts:PLATFORM_ENV_MAP`
3. Add channel config in `openclaw.ts:renderConfigs` (dmPolicy, etc.)
4. Add UI component in OnboardingWizard.tsx and DeploymentConfiguration.tsx
5. Add step in `wizardStepConfig.ts:RUNTIME_EXTRA_STEPS`

### Claude Max OAuth Tokens
`sk-ant-oat*` tokens (Claude Max subscription) can't be validated via the Anthropic API — they return 401 regardless of auth method. These are auto-passed by prefix in `openrouter.ts:validateProviderKey`. They use Bearer auth (not `x-api-key` header).

### Protected Routes
All protected pages check Auth0 authentication:
```tsx
const { isAuthenticated, isLoading } = useAuth0();
if (isLoading) return <Spinner />;
if (!isAuthenticated) return <Redirect to="/login" />;
```

### Admin Routes
Admin pages (`/admin/*`) are protected by `AdminGuard` which checks `useIsAdmin()` (queries `user.getProfile` for `role === "super_admin"`) and redirects non-admins to `/dashboard`. Backend uses `adminProcedure` middleware (composed from `protectedProcedure` + `isAdmin()` check from `utils/rbac.ts`).

### Linked Deployments Graph
`/deployments` uses React Flow (@xyflow/react) + dagre for an interactive node graph showing credit pool relationships. Nodes are circle icons (owner/linked/standalone), edges show credit pool links, and clicking a node opens a detail panel overlay on the left. Filter bar toggles credit pool edges and filters by runtime.

### Real-Time Updates
Dashboard uses SSE streams instead of polling:
```tsx
const { getStatus } = useStatusStream({ enabled: isAuthenticated });
const liveStatus = getStatus(deployment.id);
```

`DeploymentStatus` now includes resource metrics fields: `nodeName`, `cpuUsageMillicores`, `cpuLimitMillicores`, `memoryUsageMb`, `memoryLimitMb`, `uptimeSeconds`. These are populated by the SSE status stream from `k8s/metrics.ts` and displayed in the `ResourceMetrics` component on the dashboard card.

## Environment Variables

### API (jarble-api-main/.env)
```
DATABASE_URL=postgresql://...   # Required for prod (Neon PostgreSQL)
USE_SQLITE=true                 # Use file-based SQLite for local dev (local.db)
AUTH0_DOMAIN=xxx.auth0.com
AUTH0_AUDIENCE=https://api.jarble.ai
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MANAGEMENT_KEY=...   # For included credits provisioning
API_KEY_ENCRYPTION_KEY=...      # AES-256-GCM key for platform credentials
```

### Frontend (Jarble-mvp/.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_AUTH0_DOMAIN=xxx.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=...
NEXT_PUBLIC_AUTH0_AUDIENCE=https://api.jarble.ai
```

### Local Dev with Real K8s
When testing against a real K3s cluster:
```bash
export USE_SQLITE=true
npx tsx watch src/index.ts
```
Ensure `kubectl` is configured and the `jarble` namespace exists.

## Operational Runbook

**IMPORTANT**: Before making any env var change, deployment, infrastructure update, or operational decision, read `docs/RUNBOOK.md` first. It contains:
- **Environment matrix** — every env var, where it lives, how to update it (dev vs prod). Consult this before changing any config to avoid mismatches.
- **Deploy & release** — step-by-step procedures for shipping API and frontend changes. Follow these instead of guessing.
- **Decision log** — key architectural and operational decisions with dates and rationale. Check this before proposing changes that may contradict prior decisions.

After making operational changes, update the runbook's relevant section and add a new entry to the Decision Log if it was a significant decision.

## Debug Endpoints (dev only)

Available when running locally:
- `GET /debug/db` — Dump all tables (users, deployments, runtimeCatalog, platformCredentials, etc.)
- `POST /debug/deployment/:id/status` — Force deployment status (`{ "status": "running" }`)
- `GET /debug/deployment/:id/pod-status` — Check K8s pod status for a deployment

## Key Files Reference

### Backend (jarble-api-main/src/)
| File | Purpose |
|------|---------|
| `routes/tamboAgent.ts` | Chat SSE endpoint — proxies to pod via WS/exec, streams text + UI blocks |
| `mcp/jarble-ui-server.js` | MCP stdio server (render_ui, define_component, component_reference, etc.) |
| `mcp/tools/renderUi.ts` | Server-side render_ui tool for MCP HTTP endpoint |
| `mcp/tools/listComponents.ts` | Server-side list_components tool |
| `utils/componentResolver.ts` | Custom component template substitution + validation |
| `utils/uiBlockParser.ts` | Extracts `jarble_ui` fenced blocks from bot text |
| `services/openclawGateway.ts` | WebSocket + exec chat with OpenClaw gateway |
| `k8s/lifecycle.ts` | K8s deployment lifecycle: create, restart, delete |
| `k8s/exec.ts` | kubectl exec into pods |
| `k8s/secrets.ts` | K8s Secret CRUD |
| `k8s/metrics.ts` | Pod metrics: CPU/memory usage from metrics API, node name, uptime, restarts |
| `services/configSync.ts` | Two-way config sync between DB and PVC |
| `runtimes/handlers/openclaw.ts` | OpenClaw runtime: renderConfigs, getSecretEntries, parseConfigs |
| `trpc/routers/platformCredentials.ts` | Credential CRUD, WhatsApp/Telegram pairing, pollTelegramPairing |
| `trpc/routers/openrouter.ts` | Multi-provider LLM key validation, OpenRouter provisioning |
| `trpc/routers/deployment.ts` | Deployment CRUD, lifecycle, K8s orchestration (admins bypass ownership via `deploymentWhere()`) |
| `trpc/routers/admin.ts` | Admin router: 13 procedures for platform management (stats, users, deployments, billing, audit logs) |
| `trpc/middleware.ts` | tRPC middleware: `publicProcedure`, `protectedProcedure`, `adminProcedure` |
| `utils/rbac.ts` | Role-based access control helper (`isAdmin()`, `UserRole` type) |
| `services/auditLog.ts` | Fire-and-forget audit logging for admin actions (`logAdminAction()`) |
| `db/schema.sqlite.ts` | SQLite schema (dev) |
| `db/init.ts` | Seed data for local dev |
| `utils/encryption.ts` | AES-256-GCM encrypt/decrypt for credentials |
| `trpc/routers/marketplace.ts` | Marketplace CRUD, install/uninstall, publish, review, admin |
| `services/manifestValidator.ts` | Component manifest validation (11 rules) |
| `services/marketplace.types.ts` | Marketplace type definitions |

### Shared (shared/)
| File | Purpose |
|------|---------|
| `component-manifest/index.ts` | Component manifest — schemas, metadata, derive functions |

### Scripts (scripts/)
| File | Purpose |
|------|---------|
| `check-manifest.ts` | CI check for manifest ↔ component sync |
| `deployment-testing/run.ts` | Deployment testing orchestrator — runs 4 agents, generates markdown report |
| `deployment-testing/agents.ts` | 4 test agents: UI Component, Conversation & Safety, Performance, Data & Integration |
| `deployment-testing/lib.ts` | Shared test utilities: `sendTestMessage`, assertions, report generation |

### Frontend (Jarble-mvp/)
| File | Purpose |
|------|---------|
| `app/d/[id]/page.tsx` | Deployment chat page — Tambo chat, canvas grid, message rendering |
| `components/workspace/SimpleCanvasGrid.tsx` | Responsive grid with drag-to-reorder, split/merge buttons |
| `components/workspace/canvasReducer.ts` | Canvas state: ADD/REMOVE/REORDER/SPLIT/MERGE_CARDS actions |
| `components/workspace/types.ts` | CanvasCard, CanvasAction types, SPLITTABLE_COMPONENTS config |
| `components/chat/AssistantUIChat.tsx` | Thread-based chat via assistant-ui (replaced StreamingBotMessage) |
| `components/canvas/registry.ts` | 37 components with Zod schemas (imports from @jarble/component-manifest) |
| `components/canvas/CanvasRenderer.tsx` | Validates props via Zod, renders with error boundary |
| `components/canvas/components/CanvasSandbox.tsx` | Secure iframe for arbitrary HTML/CSS/JS |
| `views/OnboardingWizard.tsx` | Multi-step deployment wizard |
| `views/DeploymentConfiguration.tsx` | Post-deploy config sidebar |
| `lib/trpc.ts` | tRPC client setup with Auth0 headers |
| `lib/autoFixProps.ts` | AutoFix prop repair — 20 rules before Zod validation |
| `lib/sanitize.ts` | HTML sanitization via DOMPurify |
| `lib/posthog.ts` | PostHog analytics integration |
| `lib/assistantRuntime.ts` | assistant-ui ExternalStoreRuntime config |
| `components/marketplace/` | Marketplace UI components (6 files) |
| `components/ResourceMetrics.tsx` | CPU/memory progress bars, uptime, restart count for dashboard cards |
| `components/chat/ChatSessionSidebar.tsx` | Collapsible sidebar with chat history grouped by date |
| `hooks/useChatSessions.ts` | Fetches conversation history from DB via REST (`GET /api/tambo-agent/sessions/*`) |
| `hooks/useIsAdmin.ts` | Admin role check hook (`useIsAdmin()` → queries `user.getProfile`) |
| `components/admin/AdminGuard.tsx` | Client-side admin guard — redirects non-admins to `/dashboard` |
| `app/admin/layout.tsx` | Admin layout: top navbar + sidebar navigation (7 sections) |
| `views/admin/Admin*.tsx` | 8 admin views: Overview, Users, UserDetail, Deployments, Marketplace, Billing, System, Audit |

## Component Manifest (`shared/component-manifest/`)

Single source of truth for all 37 component definitions (+ 1 alias: `canvas` → `sandbox`). Published as `@jarble/component-manifest` (path alias in both tsconfigs).

**Consumed by**:
- Frontend `registry.ts` — Zod schemas + component mapping
- API `componentResolver.ts` — builtin name validation
- API `listComponents.ts` — component descriptions
- API `openclaw.ts` — prompt generation
- MCP server `jarble-ui-server.js` — via generated JSON

**Key exports**:
- `COMPONENT_MANIFEST` — Record of all component entries keyed by canonical name
- `COMPONENT_NAME_SET` — Set for O(1) name lookups
- `DEFAULT_CARD_SIZES` — Default card dimensions derived from manifest layout hints
- `COMPONENT_SCHEMAS` — All Zod schemas indexed by name
- `MANIFEST_SPLITTABLE` — Splittable component config derived from manifest

**Derive functions**:
- `generatePromptReference()` — Generates component reference text for soul.md prompts
- `generateMcpReference()` / `getComponentReference()` — MCP tool reference generation
- `getComponentDescriptions()` — Human-readable component descriptions

Each component entry in `shared/component-manifest/components/{name}.ts` defines: name, description, category, Zod schema, layout hints (defaultSize, minSize, layoutHint), loading strategy, aliases, and optional splittable config.

## AutoFix Prop Repair

`Jarble-mvp/lib/autoFixProps.ts` implements 20 repair rules with 30+ component name aliases that run before Zod validation in `CanvasRenderer.tsx`.

**Categories of repair rules**:
- Type coercion (string→number, string→boolean)
- Enum normalization (e.g., "Line" → "line")
- Missing defaults (fill in required fields)
- Structural fixes (flatten/restructure nested props)
- Field aliases (map common misspellings to correct field names)
- Data normalization (e.g., chart data shape fixes)

**Monitoring**: Each applied fix is recorded as a Sentry breadcrumb with the rule name, enabling frequency tracking and identification of common LLM mistakes.

## Marketplace System

Component marketplace for discovering, installing, and publishing custom UI components.

**Database tables** (6 new):
- `marketplaceComponents` — Published components (manifest, code, author, pricing, status)
- `componentVersions` — Version history
- `componentInstalls` — Deployment→component installations
- `componentPurchases` — Purchase records
- `componentReviews` — Ratings and reviews
- `marketplaceCreators` — Creator profiles

**Two tiers**:
- **Template** (safe JSON) — Declarative components using existing primitives
- **Code/Sandbox** (double-iframe) — Custom HTML/CSS/JS components run in isolated sandbox

**tRPC marketplace router**: 22 procedures for browsing, installing/uninstalling, publishing, reviewing, creator tools, and admin moderation.

**MCP server integration**: Bots can discover and use marketplace components via the MCP tools.

**Manifest validator** (`services/manifestValidator.ts`): 11 validation rules for component manifests.

## RBAC & Admin Dashboard

### Role System
Two roles stored in DB `users.role` column (DB is authoritative, not JWT):
- `user` (default) — Standard platform access
- `super_admin` — Full platform management + ownership bypass on all deployments

### Backend Authorization
- `protectedProcedure` — Requires authenticated user (JWT verified)
- `adminProcedure` — Extends `protectedProcedure`, requires `role === "super_admin"` via `isAdmin()` from `utils/rbac.ts`
- `deploymentWhere()` helper in `deployment.ts` — Skips `userId` ownership check for admins, enabling admins to manage any deployment through standard routes
- Marketplace admin: replaced hardcoded `ADMIN_USER_IDS` set with `isAdmin()` check

### Admin Dashboard (`/admin`)
8 pages with sidebar navigation, guarded by `AdminGuard`:

| Route | View | Data Source |
|-------|------|-------------|
| `/admin` | Overview — 4 stat cards (users, deployments, active, revenue) | `admin.getStats` |
| `/admin/users` | Searchable user table with role badges | `admin.listUsers` |
| `/admin/users/[id]` | User detail + deployments + role toggle | `admin.getUserById`, `admin.updateUserRole` |
| `/admin/deployments` | All deployments table with start/stop/restart/delete actions | `admin.listAllDeployments` |
| `/admin/marketplace` | Moderation queue (placeholder) | — |
| `/admin/billing` | Revenue stats: MRR, active subs, free vs paid | `admin.getRevenueStats` |
| `/admin/system` | Pod status breakdown by state | `admin.getSystemHealth` |
| `/admin/audit` | Audit log table with action/user filters | `admin.getAuditLogs` |

### Audit Logging
All admin mutations (deployment control, role changes) log to `audit_logs` table via `logAdminAction()`. Captures: userId, action, targetType, targetId, metadata (JSON), ipAddress, createdAt.

### Accessing Admin
- Navigate to `/admin` or use the Shield icon in `ProfileDropdown` (visible only to `super_admin` users)
- Admin user seeded in DB migration: `auth0_id = 'google-oauth2|112298309586248235116'`

## Security

### Sandbox Security
- **CSP**: Tightened from wildcards to 10 trusted CDN origins
- **CSP violation monitoring**: Tracked via Sentry breadcrumbs
- **Server-side library URL validation**: `uiBlockParser.ts` validates library URLs against a CDN allowlist before they reach the client
- **HTML sanitization**: DOMPurify via `lib/sanitize.ts` sanitizes HTML content
- **30s watchdog timer**: Kills runaway scripts in sandbox iframes

### Authentication & Authorization
- **Auth0 JWT**: Verified via JWKS, Bearer token in `Authorization` header
- **RBAC**: DB-authoritative role system (`user` / `super_admin`), JWT role claim is informational only
- **Admin middleware**: `adminProcedure` composed from `protectedProcedure` — no `as any` casts, uses `isAdmin()` helper
- **Ownership bypass**: Admins skip `userId` checks on deployment queries via `deploymentWhere()` helper
- **Audit trail**: All admin mutations logged to `audit_logs` with IP address, action, target, and metadata
- **Input validation**: Admin search inputs capped at 100 chars, LIKE wildcards escaped via `escapeLike()`, status filters use `z.enum()`
- **Sensitive field protection**: Admin queries use explicit column selects (never `SELECT *`) to prevent leaking `llmApiKey`, `auth0Id`, `stripeCustomerId`

### Response Headers
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — Restricts browser features

### Monitoring
- Sentry error tracking (`sentry.client.config.ts`, `sentry.server.config.ts`)
- PostHog analytics (`lib/posthog.ts`)
- AutoFix rule frequency tracking via Sentry breadcrumbs

## Infrastructure Notes

### Production Cluster (Hetzner Cloud)
- **Master**: 178.156.222.218 (jarble-master, 10.0.1.10)
- **Agent 1**: 178.156.243.110 (jarble-agent-1, 10.0.1.20)
- **Agent 2**: 178.156.230.13 (jarble-agent-2, 10.0.1.21)
- **K3s**: v1.29.2, flannel with `enp7s0` interface (NOT `ens10`)
- **Kubeconfig**: `C:\Users\tanne\kubeconfig.yaml` — must `export KUBECONFIG=...` before every kubectl command
- **Ingress**: Traefik with hostPort on master (80/443), nodeSelector for master node
- **Storage**: Longhorn v1.6.0
- **TLS**: cert-manager + Let's Encrypt (ClusterIssuer `letsencrypt-prod`)
- **DNS**: `api.jarble.ai` → master IP (Cloudflare, no proxy)
- **Frontend**: Vercel at `jarble.ai`, repo `Jarble-AI/jarble`, root dir `Jarble-mvp`, branch `main`
- **Database**: Neon PostgreSQL (production)
- **Container Registry**: `ghcr.io/jarble-ai/api:latest` (private, classic PAT required for pull secret)

### Deploying Updates
```bash
# API: Push to GitHub → Actions builds image → restart pods
export KUBECONFIG="C:\Users\tanne\kubeconfig.yaml"
kubectl rollout restart deployment/jarble-api -n jarble

# Frontend: Push to main → Vercel auto-deploys
# For env var changes: update in Vercel dashboard + redeploy (NEXT_PUBLIC_* vars are baked at build time)
```

### Running SQL in Production
Debug endpoints (`/debug/*`) are disabled in production. Use `node` inside an API pod:
```bash
kubectl exec -n jarble <pod> -- node -e "
const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(() => c.query('YOUR SQL')).then(r => { console.log(JSON.stringify(r.rows,null,2)); return c.end(); });
"
```

### Pod Security (Implemented)
- ✅ Non-root containers, service account disabled, all capabilities dropped
- ✅ NetworkPolicy restricts egress (allows LLM APIs, messaging platforms, DNS)
- ✅ Liveness/readiness probes on port 18789
- ✅ Background status reconciler in `statusReconciler.ts`

### Known Issues
- **npm cache corruption**: `ENOTEMPTY` errors on PVC. Fix: clear `/data/.npm` and delete pod
- **Telegram 409 conflict**: Two pods with same bot token. Scale down stale deployments
- **Deployment stuck at "creating"**: Race condition in deploy procedure. Fix: reset status to `pending` via SQL (see Running SQL above)
- **Hetzner NIC name**: Flannel must use `enp7s0`, not `ens10`. Check `/etc/systemd/system/k3s*.service` if nodes don't register
- **GHCR auth**: Only classic PATs (`ghp_*`) work for container registry. Fine-grained PATs (`github_pat_*`) return 403
- **`@jarble/component-manifest` in Docker**: TypeScript path alias requires runtime symlink in Dockerfile
- **403 on exec for storage usage**: `getDeploymentStorageUsage` exec calls return 403 (RBAC). Storage usage falls back to `null`; CPU/memory come from the metrics API instead

## Deployment Testing Framework

`scripts/deployment-testing/` is a standalone automated testing suite that validates OpenClaw deployments end-to-end via the production API.

### Usage
```bash
AUTH_TOKEN="eyJ..." npx tsx scripts/deployment-testing/run.ts --deployment <deploymentId> [--verbose]
```

Get `AUTH_TOKEN` from browser DevTools → any API request → Authorization header.

Environment variables:
- `AUTH_TOKEN` — Auth0 Bearer token (required)
- `API_URL` — defaults to `https://api.jarble.ai`
- `TEST_TIMEOUT` — per-test timeout ms (default: 45000)
- `TEST_DELAY` — delay between tests ms (default: 2000)

### 4 Testing Agents

| Agent | Tests |
|-------|-------|
| **UI Component** | jarble_ui rendering pipeline — does the bot emit UI blocks when asked? Do named components appear? |
| **Conversation & Safety** | Guardrail compliance, memory tool usage, context retention across turns |
| **Performance & Reliability** | Response latency, streaming behaviour, error handling under load |
| **Data & Integration** | Browser tool usage, real data policy compliance, platform awareness |

### Report Format
Reports are written to `scripts/deployment-testing/reports/{deploymentId}-{date}.md` with:
- Per-agent pass/fail/warning counts
- Overall score out of 100
- Latency stats (avg, p50, p95) and TTFT
- UI block success rate
- Guardrail compliance %

## CI/CD

### GitHub Actions (`.github/workflows/`)
- **`build-api-image.yml`** — Builds + pushes `ghcr.io/jarble-ai/api:latest` on push to `main` (when `jarble-api-main/` or `shared/` changes). Manual dispatch available.
- **`build-runtime-images.yml`** — Builds runtime container images
- **`terraform.yml`** — Plan on PR, apply on merge to main (with approval gate). Manual dispatch for plan-only/apply/destroy.

**Note**: There is no CD step to restart K8s pods after image build. Currently requires manual `kubectl rollout restart`.

## Claude Agents

Pre-configured agents in `.claude/agents/` (20 agents):

**Core debugging**: `jarble-api-debugger`, `nextjs-frontend-debugger`, `k8s-pod-lifecycle-debugger`, `sse-stream-debugger`, `auth0-debugger`, `stripe-webhook-debugger`

**Building**: `canvas-component-builder`, `runtime-handler`, `mcp-server`, `test-writer`, `drizzle-db-schema`

**Review**: `code-reviewer`, `design-system-reviewer`, `performance-bundle-analyzer`, `tambo-integration-reviewer`

**Infrastructure**: `terraform-infra`, `infra-ops`, `backend-deployer`, `production-pm`

**Maintenance**: `docs-updater`
