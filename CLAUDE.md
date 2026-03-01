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
- **Database**: MySQL (prod), PostgreSQL (alt), SQLite (dev with USE_SQLITE=true)
- **Auth**: Auth0 (JWT + JWKS verification)
- **Payments**: Stripe (dynamic pricing via price_data)
- **Infrastructure**: Hetzner Cloud, Terraform, K3s, Longhorn storage
- **Container Image**: `ghcr.io/jarble-ai/openclaw:latest` (Node.js 22, OpenClaw runtime)

### tRPC Router Structure
The API exposes 8 routers with 67+ procedures at `/trpc`:
- `user` - Profile management, auth state
- `deployment` - CRUD, lifecycle (start/stop/restart), K8s operations
- `runtimeCatalog` - Available bot runtimes
- `openrouter` - LLM key provisioning, validation, multi-provider support
- `billing` - Stripe checkout, subscriptions
- `platformCredentials` - Encrypted messaging platform credentials, pairing flows
- `template` - Bot configuration templates
- `marketplace` - Component marketplace: browse, install, publish, review, creator tools, admin moderation

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
- `marketplaceComponents` - Published components (manifest, code, author, pricing, status)
- `componentVersions` - Version history
- `componentInstalls` - Deployment→component installations
- `componentPurchases` - Purchase records
- `componentReviews` - Ratings and reviews
- `marketplaceCreators` - Creator profiles

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
The deployment chat page uses `@assistant-ui/react` with an `ExternalStoreRuntime` to orchestrate user ↔ bot conversations. Bot responses stream via SSE with text deltas and UI blocks. The chat UI is implemented in `components/chat/AssistantUIChat.tsx` (replaced the former `StreamingBotMessage.tsx`).

SSE event types: `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT` (delta), `TEXT_MESSAGE_END`, `UI_BLOCK_START`, `UI_BLOCK_PROPS`, `UI_BLOCK_END`, `RUN_FINISHED`

The `uiBlockParser.ts` uses a brace-depth JSON parser (not regex) for reliable incremental block extraction during SSE streaming.

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

## Security

### Sandbox Security
- **CSP**: Tightened from wildcards to 10 trusted CDN origins
- **CSP violation monitoring**: Tracked via Sentry breadcrumbs
- **Server-side library URL validation**: `uiBlockParser.ts` validates library URLs against a CDN allowlist before they reach the client
- **HTML sanitization**: DOMPurify via `lib/sanitize.ts` sanitizes HTML content
- **30s watchdog timer**: Kills runaway scripts in sandbox iframes

### Response Headers
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — Restricts browser features

### Monitoring
- Sentry error tracking (`sentry.client.config.ts`, `sentry.server.config.ts`)
- PostHog analytics (`lib/posthog.ts`)
- AutoFix rule frequency tracking via Sentry breadcrumbs

## Infrastructure Notes

### Pod Security (Implemented)
- ✅ Non-root containers, service account disabled, all capabilities dropped
- ✅ NetworkPolicy restricts egress (allows LLM APIs, messaging platforms, DNS)
- ✅ Liveness/readiness probes on port 18789
- ✅ Background status reconciler in `statusReconciler.ts`

### Known Issues
- **npm cache corruption**: `ENOTEMPTY` errors on PVC. Fix: clear `/data/.npm` and delete pod
- **Telegram 409 conflict**: Two pods with same bot token. Scale down stale deployments

## Claude Agents

Pre-configured agents in `.claude/agents/`:
- `code-reviewer` - General code review
- `docs-updater` - Documentation maintenance
