# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jarble is a **no-code AI bot deployment platform** that lets users deploy LLM-powered bots to messaging platforms (WhatsApp, Discord, Slack, Telegram) without coding. Users pick a runtime (OpenClaw, ZeroClaw), configure an LLM provider, and deploy — all through a guided wizard.

Each deployment gets a **web chat interface** (`/d/[id]`) where users interact with their bot through a Tambo-powered chat. The bot can render **rich UI components** (charts, tables, 3D visualizations, live widgets) via an MCP UI server, displayed as interactive canvas blocks inline in the conversation.

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
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, Framer Motion, @xyflow/react (node graph), @ant-design/plots, recharts, Monaco Editor, Leaflet
- **API**: Express, tRPC, SuperJSON, Drizzle ORM
- **MCP**: Custom stdio MCP server (`jarble-ui-server.js`) running inside bot pods — exposes `render_ui`, `define_component`, `list_components`, `component_reference` tools
- **Database**: MySQL (prod), PostgreSQL (alt), SQLite (dev with USE_SQLITE=true)
- **Auth**: Auth0 (JWT + JWKS verification)
- **Payments**: Stripe (dynamic pricing via price_data)
- **Infrastructure**: Hetzner Cloud, Terraform, K3s, Longhorn storage
- **Container Image**: `ghcr.io/jarble-ai/openclaw:latest` (Node.js 22, OpenClaw runtime)

### tRPC Router Structure
The API exposes 7 routers with 45+ procedures at `/trpc`:
- `user` - Profile management, auth state
- `deployment` - CRUD, lifecycle (start/stop/restart), K8s operations
- `runtimeCatalog` - Available bot runtimes
- `openrouter` - LLM key provisioning, validation, multi-provider support
- `billing` - Stripe checkout, subscriptions
- `platformCredentials` - Encrypted messaging platform credentials, pairing flows
- `template` - Bot configuration templates

### Frontend-Backend Communication
- **tRPC + React Query**: Type-safe API calls with automatic caching
- **SSE Streams**: Real-time status updates (`useStatusStream`), logs (`useLogStream`), QR pairing (`useQrStream`)
- **Chat SSE**: `POST /api/tambo-agent` streams bot responses as SSE events (text deltas + UI blocks)
- **Auth0 Bearer tokens**: Automatically attached via tRPC link headers

### Database Schema (Drizzle)
Core tables in `jarble-api-main/src/db/schema.ts` (SQLite variant in `schema.sqlite.ts`):
- `users` - Auth0 ID, Stripe customer, email verification, free trial state
- `deployments` - Bot instances with K8s state, LLM config (provider, model, encrypted API key), subscription links
- `runtimeCatalog` - Available runtimes with hardware specs and pricing
- `platformCredentials` - AES-256-GCM encrypted platform tokens (Telegram, Discord, Slack, WhatsApp, etc.)
- `skillsCatalog` - Available skills (Web Search, Weather, Calculator, etc.)
- `deploymentSkills` - Many-to-many linking deployments to skills
- `processedWebhookEvents` - Stripe webhook idempotency tracking

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
- `k8s/client.ts` — K8s API client setup
- `k8s/config.ts` — Cluster configuration
- `k8s/constants.ts` — Namespace, labels, etc.

### Resources Per Deployment
Each deployment creates 4 K8s resources in namespace `jarble`:
- **Deployment**: `dep-{deploymentId}` — 1 replica, container `runtime`, port 18789
- **Secret**: `secret-{deploymentId}` — LLM keys, platform tokens, deployment metadata
- **PVC**: `pvc-{deploymentId}` — Longhorn, 20Gi RWO, mounted at `/data`
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

## Canvas & Chat Architecture

### Chat Flow (`/d/[id]`)
The deployment chat page supports two modes:
- **Tambo ON** (default): User ↔ Tambo ↔ OpenClaw bot. Tambo orchestrates, bot has MCP tools.
- **Tambo OFF**: User ↔ bot directly via SSE streaming.

```
User types message
  → POST /api/tambo-agent (SSE stream)
  → Backend: JWT auth → deployment ownership check → pod connectivity
  → Pod: WS to OpenClaw gateway (or kubectl exec fallback)
  → Bot response streamed as SSE events back to frontend
  → StreamingBotMessage renders text + UI blocks progressively
```

SSE event types: `RUN_STARTED`, `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT` (delta), `TEXT_MESSAGE_END`, `UI_BLOCK_START`, `UI_BLOCK_PROPS`, `UI_BLOCK_END`, `RUN_FINISHED`

### Canvas Component System (56+ components)
Bot renders rich UI via `render_ui` MCP tool → emits ` ```jarble_ui ``` ` fenced blocks → frontend parses and renders.

**Component categories:**
- **Display**: card, data_table, stat_grid, key_value, code_block, alert, progress, image, layout, chart, tabs, accordion, badge, list, timeline, divider, avatar, blockquote, metric_card, header
- **Charts** (Ant Design Plots + Recharts): gauge, radar, treemap, funnel, waterfall, scatter, stock, sankey, sunburst, heatmap, wordcloud, histogram, box, liquid, rose, dual_axes, bullet, radial_bar, venn, circle_packing
- **Advanced UI**: steps, result, tree, calendar_heatmap, descriptions, carousel
- **Specialized**: code_editor (Monaco), map (Leaflet), statistic, tag_cloud
- **Media**: video, image_gallery, audio
- **Interactive**: button_group (dispatches UI_ACTION callbacks), form (dispatches on submit)
- **Data**: spreadsheet (editable grid)
- **Sandbox**: `sandbox` — **iframe for arbitrary HTML/CSS/JS** (3D with Three.js, live charts, animations, custom widgets). CDN libraries loaded dynamically. Parent/iframe bridge for props and callbacks.

### Component Pipeline
```
Registry (registry.ts)         → 56 components with Zod prop schemas
CanvasRenderer                 → Validates props, renders component with error boundary
EditableCanvas                 → Wraps renderer with edit/save controls
StreamingBotMessage            → SSE consumer, assembles UI blocks, renders inline
CustomComponentRenderer        → Resolves bot-defined components from PVC
```

### Sandbox Component (`CanvasSandbox.tsx`)
The most powerful component — renders arbitrary code in a secure iframe:
- `sandbox="allow-scripts allow-popups"` (no `allow-same-origin` — fully isolated)
- `html` prop: body HTML only (sanitizer extracts `<script>` tags automatically)
- `js` prop: JavaScript executed after libraries load
- `libraries` prop: CDN URLs loaded dynamically before JS runs
- Parent/iframe bridge: `window.__JARBLE_PROPS__` for data, `jarble.send(action, payload)` for callbacks
- Stop/Restart controls to kill runaway JS
- Error overlay shows errors visually inside the iframe

### MCP UI Server (`jarble-api-main/src/mcp/jarble-ui-server.js`)
Runs inside bot pods as a stdio MCP server (JSON-RPC 2.0). Tools:
- `render_ui` — Render any built-in or custom component
- `define_component` — Save reusable component templates to `/data/components/`
- `list_components` — List all available components (built-in + custom)
- `component_reference` — Detailed prop schemas for all 56 components
- `save_canvas_file` / `load_canvas_file` / `list_canvas_files` — Canvas data persistence

### Adding a New Canvas Component
1. Create `Jarble-mvp/components/canvas/components/Canvas{Name}.tsx`
2. Add Zod schema to `registry.ts`
3. Add component + schema to `CANVAS_COMPONENTS` registry object
4. Add to `BUILTIN_COMPONENTS` arrays in both `jarble-ui-server.js` and `componentResolver.ts`
5. Add description to `BUILTIN_DESCRIPTIONS` and `COMPONENT_REFERENCE` in `jarble-ui-server.js`

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
DATABASE_URL=mysql://...        # Required for prod
USE_SQLITE=true                 # Use file-based SQLite for local dev (local.db)
AUTH0_DOMAIN=xxx.auth0.com
AUTH0_AUDIENCE=https://api.jarble.ai
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MANAGEMENT_KEY=...   # For included credits provisioning
ENCRYPTION_KEY=...              # AES-256-GCM key for platform credentials
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
| `services/configSync.ts` | Two-way config sync between DB and PVC |
| `runtimes/handlers/openclaw.ts` | OpenClaw runtime: renderConfigs, getSecretEntries, parseConfigs |
| `trpc/routers/platformCredentials.ts` | Credential CRUD, WhatsApp/Telegram pairing, pollTelegramPairing |
| `trpc/routers/openrouter.ts` | Multi-provider LLM key validation, OpenRouter provisioning |
| `trpc/routers/deployment.ts` | Deployment CRUD, lifecycle, K8s orchestration |
| `db/schema.sqlite.ts` | SQLite schema (dev) |
| `db/init.ts` | Seed data for local dev |
| `utils/encryption.ts` | AES-256-GCM encrypt/decrypt for credentials |

### Frontend (Jarble-mvp/)
| File | Purpose |
|------|---------|
| `app/d/[id]/page.tsx` | Deployment chat page — Tambo/direct chat modes, message rendering |
| `components/tambo/StreamingBotMessage.tsx` | SSE consumer — streams bot text + assembles UI blocks progressively |
| `components/canvas/registry.ts` | 56+ components with Zod schemas, the central component map |
| `components/canvas/CanvasRenderer.tsx` | Validates props via Zod, renders component with error boundary |
| `components/canvas/EditableCanvas.tsx` | Wraps renderer with edit mode, save via MCP/chat/write_file |
| `components/canvas/CustomComponentRenderer.tsx` | Renders bot-defined custom components from catalog |
| `components/canvas/CanvasActionContext.tsx` | React context for interactive callbacks (button clicks, form submits) |
| `components/canvas/components/CanvasSandbox.tsx` | Secure iframe for arbitrary HTML/CSS/JS — the most powerful component |
| `components/canvas/editors/registry.ts` | Component-specific editors for edit mode |
| `views/OnboardingWizard.tsx` | Multi-step deployment wizard (runtime, LLM, deploy, platform connect) |
| `views/DeploymentConfiguration.tsx` | Post-deploy config sidebar (LLM, platforms, skills, system prompt) |
| `views/onboarding/wizardStepConfig.ts` | Config-driven wizard steps and config tabs per runtime |
| `hooks/useQrStream.ts` | SSE hook for WhatsApp QR pairing |
| `hooks/useDirectChat.ts` | Direct chat hook (bypasses Tambo, streams via SSE) |
| `lib/trpc.ts` | tRPC client setup with Auth0 headers |

## Infrastructure Roadmap

### Security (Priority: High)
- ✅ **Pod Security Standards**: Enforced via `securityContext` in deployment template — prevents privilege escalation
- ✅ **Non-root containers**: `runAsNonRoot: true`, `runAsUser: 1000`, `runAsGroup: 1000` in pod securityContext
- ✅ **Disable service account mount**: `automountServiceAccountToken: false` on all deployment pods
- ✅ **Drop all capabilities**: `securityContext.capabilities.drop: ["ALL"]`
- **Secrets as files**: Mount K8s Secrets as volumes at `/run/secrets/` instead of env vars. Requires OpenClaw wrapper or upstream support
- **Secrets rotation**: Mechanism to rotate a user's LLM API key without redeploying (update Secret + restart pod)
- ✅ **NetworkPolicy**: Restricts egress to cloud metadata and localhost; allows LLM APIs, messaging platforms, DNS
- **Audit logging**: Enable K3s audit policies to track who exec'd into which pod

### Ops (Priority: High)
- ✅ **Liveness/readiness probes**: Health check on port 18789 — if OpenClaw hangs, K8s restarts the pod
  ```yaml
  livenessProbe:
    httpGet:
      path: /__openclaw__/health
      port: 18789
    initialDelaySeconds: 120  # slow first boot
    periodSeconds: 30
  readinessProbe:
    httpGet:
      path: /__openclaw__/health
      port: 18789
    initialDelaySeconds: 60
    periodSeconds: 10
  ```
- **Pod Disruption Budgets**: For rolling node upgrades without dropping active bot sessions
- **PVC backups**: Longhorn snapshots or Velero. If a user's volume dies, they lose conversation history
- ✅ **Monitoring**: Prometheus + Grafana stack deployed in `jarble-api-main/k8s/monitoring/`
- ✅ **Background status reconciler**: Runs in `statusReconciler.ts` with pagination (100 deployments per cycle)

### Cost & Scale (Priority: Medium)
- **Idle pod shutdown**: If no messages in 24h, scale pod to 0. Spin back up on next inbound message (webhook-triggered cold start)
- **LLM spend limits**: Per-user rate limiting on Anthropic/OpenRouter keys. Claude Opus is expensive — enforce `llmCreditLimitDollars`
- **Resource quotas per user**: Limit total CPU/memory/storage a single user can consume
- **Resource limits in pod spec**: Apply `cpuLimit`, `memoryMb` from DB to actual K8s pod resources
  ```yaml
  resources:
    limits:
      cpu: "2"
      memory: "2Gi"
      ephemeral-storage: "1Gi"   # Prevent /tmp, logs, npm cache from filling node disk
    requests:
      cpu: "250m"
      memory: "256Mi"
      ephemeral-storage: "100Mi"
  ```
- **Ephemeral storage limits**: Without this, a runaway pod can fill the node's disk with temp files and cause node-level evictions affecting all pods
- **Pre-built image**: Bake `openclaw@latest` into the container image to eliminate the 2-3 min npm install on first boot. Fixes npm cache corruption issue too.

### Reliability (Priority: Medium)
- **ConfigSync atomicity**: Either all steps succeed (write files + update secret + restart) or rollback. Currently partial failures leave inconsistent state
- **Telegram token uniqueness**: Prevent two deployments from using the same bot token (causes 409 conflict)
- **Graceful pod shutdown**: Handle SIGTERM in OpenClaw to close active WebSocket/Telegram connections cleanly
- **PVC permissions**: Tighten `/data/` from 777 to 750, owned by non-root runtime user

## Specialized Debug Agents

This repo has pre-configured debug agents in `.claude/agents/` for common issues:
- `auth0-debugger` - JWT verification, JWKS cache, email sync
- `stripe-webhook-debugger` - Webhook handling, subscription lifecycle
- `k8s-pod-lifecycle-debugger` - Pod lifecycle, PVC mounts, storage issues
- `nextjs-frontend-debugger` - Hydration, React Query, SSE streams
- `sse-stream-debugger` - Stream disconnections, event ordering
- `jarble-api-debugger` - tRPC tracing, async race conditions
- `canvas-component-builder` - Canvas component development
- `tambo-integration-reviewer` - Tambo/MCP integration review
- `code-reviewer` - General code review
- `docs-updater` - Documentation maintenance
- `design-system-reviewer` - UI/design consistency
