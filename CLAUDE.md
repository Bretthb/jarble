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
├── scripts/             # CI/build scripts + agent dev tooling
│   └── agent-dev/       # Agent development scripts (formerly jarble-dev/)
├── docs/                # Project documentation
│   ├── work-sessions/   # Work session logs (formerly Work-Sessions/)
│   ├── research/        # Research notes (formerly research/)
│   ├── OVERVIEW.md      # Platform overview and architecture
│   ├── API-ENDPOINTS.md # Full API reference
│   └── DEVELOPER-GUIDE.md # Developer walkthrough
├── infrastructure/      # Terraform IaC + Auth0 config
└── runtimes/            # Bot runtime implementations (openclaw, zeroclaw)
```

## Common Commands

### Frontend (Jarble-mvp/)
```bash
npm run dev          # Start dev server on :3000
npm run build        # Production build
npm run check        # TypeScript type-check (tsc --noEmit)
npm run test         # Run Vitest unit tests (37 test files in src/)
npm run check:manifest   # Verify manifest ↔ component sync
```

### API (jarble-api-main/)
```bash
npm run dev          # Start with file watching (tsx watch)
npm run dev:test     # Start with SQLite (USE_SQLITE=true) for local dev
npm run typecheck    # TypeScript type-check
npm run test         # Run Vitest unit tests (82 test files in src/)
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
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, @assistant-ui/react, recharts, @xyflow/react, Monaco Editor, shiki (syntax highlighting)
- **API**: Express, tRPC, SuperJSON, Drizzle ORM
- **MCP**: Custom stdio MCP server (`jarble-ui-server.js`) — `render_ui`, `define_component`, `list_components`, `component_reference`, `skill_reference`
- **Database**: MySQL (prod), PostgreSQL (alt), SQLite (dev with USE_SQLITE=true)
- **Auth**: Auth0 (JWT + JWKS), **Payments**: Stripe, **Infra**: Hetzner Cloud, Terraform, K3s, Longhorn

## tRPC Router Structure
15 routers with 80+ procedures at `/trpc`:
`user`, `deployment`, `runtimeCatalog`, `openrouter`, `billing`, `platformCredentials`, `template`, `marketplace` (components), `services` (service marketplace + hosted dashboard), `flows` (flow CRUD + execution), `admin`, `agentCredits`, `apiKeys`, `benchmarks`, `skills`

## Frontend-Backend Communication
- **tRPC + React Query**: Type-safe API calls with automatic caching
- **SSE Streams**: Real-time status (`useStatusStream`), logs (`useLogStream`), QR pairing (`useQrStream`)
- **Chat SSE**: `POST /api/tambo-agent` streams bot responses (text deltas + UI blocks + reasoning events)
- **Flow SSE**: `POST /api/flows/:flowId/execute` starts execution and returns an `executionId`; client reconnects to `GET /api/flows/executions/:executionId/stream` for the live event stream
- **Auth0 Bearer tokens**: Automatically attached via tRPC link headers

## Chat UX Features

### Stop Generation
Users can stop a running generation mid-stream. The send button transforms to a filled square stop button when streaming. Partial text is preserved as an assistant message. Users can also type and send a new message while the bot is responding — this auto-aborts the current generation and starts the new one.

### Message Edit + Resend
Users can hover over their messages to see a pencil icon. Clicking it opens an inline editor (powered by assistant-ui's `ActionBarPrimitive.Edit`). Editing truncates the conversation after that message and resends with the new text. Wired via `onEdit` callback in `useExternalStoreRuntime`.

### Conversation History Sidebar
Multi-conversation system backed by localStorage (`Jarble-mvp/lib/conversationStorage.ts`). Each conversation maps to a separate OpenClaw session via `conversationId` in the API request body → `sessionKey` in `tamboAgent.ts`. Toggle via `MessageSquareText` icon in header. Features:
- **Storage**: Index at `jarble-conversations-{deploymentId}`, messages at `jarble-conv-{deploymentId}-{convId}`. 20 conv max, 100 msg each, 7-day expiry.
- **Legacy migration**: `migrateFromLegacy()` transparently converts old `jarble-chat-{deploymentId}` keys on first load.
- **Auto-title**: First user message (truncated to 50 chars) becomes the conversation title.
- **Session isolation**: Each conversation gets its own OpenClaw session (`jarble-web-{userId}-{convId}`), so "New Chat" starts fresh.
- **KeyedChatPanel**: The chat panel (`AssistantUIChat` + `useJarbleRuntime`) is wrapped in `KeyedChatPanel` keyed by `activeConversationId` to force full remount on switch, preventing assistant-ui index errors.

### Streaming Reasoning (Think Tags)
Bot reasoning streams live via `<think>` tags. The API (`tamboAgent.ts`) has a `createReasoningTracker()` that parses `<think>`/`<reasoning>` tags from the LLM response and emits `REASONING_START`/`REASONING_CONTENT`/`REASONING_END` SSE events. Frontend streams reasoning via rAF-based typewriter reveal. The system prompt in `openclaw.ts` instructs the bot to ALWAYS emit `<think>` tags before responding.

### Typewriter Text Reveal
Bot text streams character-by-character via a typewriter animation (`CHARS_PER_FRAME = 8` at 60fps ≈ 480 chars/sec). Target text accumulates instantly from SSE deltas; displayed text catches up progressively per animation frame. Prevents the "wall of text appearing at once" effect.

### Component Edit Sync
User edits to canvas components (code blocks, sandboxes, forms) are tracked and communicated to the bot:
- **`content_edit` action**: Components emit `dispatch({ action: "content_edit", payload: { code: newCode } })` via `useCanvasAction()`. The `handleAction` callback in `page.tsx` catches this and dispatches `UPDATE_CARD_PROPS` silently (no chat message).
- **Card content snapshot**: When the user selects a card and sends a message, `getCardContentSnapshot()` extracts the card's current content (code, HTML/CSS/JS, form values) and includes it in the `[EDITING cardId]` reference block sent to the bot.
- **Editable code blocks**: `CanvasCodeBlock` has a pencil toggle for inline editing with Tab indent, Ctrl+S save, Escape cancel.

### Canvas Card Controls
Card actions (Ask, Select, Split, Save, Publish, Close) are accessed via:
- **Right-click context menu** on any card — renders at cursor position
- **Small `...` button** in top-right corner on hover — opens same menu
- Context menu renders at the canvas root level (not inside cards) to avoid CSS transform positioning issues

## Orchestration System (Flow Engine)

The platform includes a multi-agent flow orchestration system that lets users build and execute DAG-based pipelines of deployments, transforms, and decisions.

### Flow Engine (`jarble-api-main/src/services/flowEngine.ts`)
- **Execution model**: State-machine DAG — finds entry nodes (no incoming edges), executes in topological order with parallel batches where possible
- **Cycle support**: Nodes in cycles run up to `maxIterations` times (default 10) — enables agent feedback loops
- **Human-in-the-loop (HITL)**: `waitForInput` nodes pause execution until `resume()` is called with user input; this triggers `jarble.flow.paused` SSE and a `/api/flows/executions/:id/resume` REST endpoint
- **Nested flows**: `subflow` nodes spin up a child `FlowEngine` and stream its events as `jarble.flow.substep.*` events
- **Template variables**: Node configs support `{{stepN_result.field}}` syntax resolved at runtime from prior step results
- **Node types**: `deployment` (call a Jarble bot), `transform` (JS expression), `condition` (branch on expression result), `output` (collect results), `waitForInput`, `subflow`
- **Credit billing**: Deployment nodes consume agent credits via `executeAgentCall()`

### Flow CRUD (`jarble-api-main/src/trpc/routers/flows.ts`)
8 tRPC procedures (all `protectedProcedure`):
- `list` — list all flows for the authed user
- `getById` — fetch a single flow with its definition
- `create` — create a new flow
- `update` — update name, description, or node/edge definition
- `delete` — delete a flow and its execution history
- `duplicate` — copy a flow with a new name
- `listExecutions` — paginated execution history for a flow
- `generateFromPrompt` — LLM-generated flow definition from a natural-language prompt

### Flow Execution Routes (`jarble-api-main/src/routes/flowExecution.ts`)
- `POST /api/flows/:flowId/execute` — authenticated, starts execution, returns `{ executionId }` as JSON; execution runs in background
- `GET /api/flows/executions/:executionId/stream` — SSE stream; client connects after receiving `executionId`; supports reconnect with buffered replay
- `POST /api/flows/executions/:executionId/resume` — unpauses a `waitForInput` node with user-provided input
- Rate-limited to 5 concurrent SSE connections per user (`MAX_FLOW_SSE_PER_USER`)

### Flow SSE Events
9 event types emitted on the `GET .../stream` endpoint:

| Event | When |
|-------|------|
| `jarble.flow.snapshot` | On reconnect — full current state |
| `jarble.flow.step.started` | A node begins executing |
| `jarble.flow.step.finished` | A node completes (with result) |
| `jarble.flow.step.iteration` | A cyclic node iterates again |
| `jarble.flow.state` | Overall execution state changes |
| `jarble.flow.paused` | Execution paused at `waitForInput` node |
| `jarble.flow.error` | An execution error occurred |
| `jarble.flow.substep.started` | A subflow child node started |
| `jarble.flow.substep.finished` | A subflow child node finished |

### Flow Canvas (`Jarble-mvp/views/Deployments.tsx`)
Flow graphs are visualized and edited using `@xyflow/react` (`ReactFlow`, `useNodesState`, `useEdgesState`, `ReactFlowProvider`). Custom node and edge types are rendered inline on the canvas. The view also uses the `flows` tRPC router for CRUD operations.

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
2. Wrap content in `<FadeIn>` from `components/canvas/FadeIn.tsx` for consistent mount animation (framer-motion is not used — 22+ components use this lightweight wrapper instead)
3. Add entry to `shared/component-manifest/components/{name}.ts`
4. Register in `shared/component-manifest/index.ts`
5. Run `npm run check:manifest`

### Adding a New Flow Node Type
1. Add the type literal to `FlowNode["type"]` union in `jarble-api-main/src/services/flowEngine.ts`
2. Add a handler branch in `FlowEngine.executeStep()` — call the appropriate private method (follow the pattern of `executeTransformNode`, `executeConditionNode`, etc.)
3. Add the new node type to the `@xyflow/react` node-type registry in `Jarble-mvp/views/Deployments.tsx` with a matching custom node component
4. Update the `generateFromPrompt` system prompt in `flows.ts` so the LLM knows the new type exists

### Claude Max OAuth Tokens
`sk-ant-oat*` tokens can't be validated via Anthropic API — auto-passed by prefix in `openrouter.ts:validateProviderKey`. Use Bearer auth (not `x-api-key`).

### Config-Driven UI
Wizard steps and config tabs driven by `Jarble-mvp/views/onboarding/wizardStepConfig.ts`. Adding a new runtime only requires config changes + component implementation.

### Key Chat/Canvas Files
| File | Purpose |
|------|---------|
| `hooks/useCanvasChat.ts` | Chat hook — streaming, conversation management, stop/edit, typewriter reveal |
| `lib/assistantRuntime.ts` | assistant-ui ExternalStoreRuntime — onNew, onCancel, onEdit, streaming message |
| `lib/conversationStorage.ts` | localStorage multi-conversation CRUD, legacy migration |
| `components/chat/AssistantUIChat.tsx` | Thread UI — user/assistant bubbles, reasoning renderer, edit button |
| `components/workspace/ConversationHistoryPanel.tsx` | Conversation sidebar — list, new chat, delete, switch |
| `components/workspace/SimpleCanvasGrid.tsx` | Freeform canvas — card rendering, context menu, drag/resize |
| `components/canvas/CanvasActionContext.tsx` | Action dispatch context — `content_edit`, UI actions |
| `components/canvas/components/CanvasCodeBlock.tsx` | Code block — shiki highlighting, inline edit, copy |
| `components/canvas/FadeIn.tsx` | Lightweight mount-animation wrapper used by 22+ canvas components |

### Key Flow / Orchestration Files
| File | Purpose |
|------|---------|
| `jarble-api-main/src/services/flowEngine.ts` | DAG state-machine executor — cycles, HITL, subflows, parallel batches |
| `jarble-api-main/src/trpc/routers/flows.ts` | Flow CRUD tRPC router — 8 procedures |
| `jarble-api-main/src/routes/flowExecution.ts` | SSE streaming + resume REST endpoints for flow execution |
| `Jarble-mvp/views/Deployments.tsx` | Flow canvas UI — @xyflow/react with custom nodes/edges |

## Auto-Scaling (Hetzner K3s Workers)

The platform auto-scales K3s worker nodes on Hetzner Cloud based on bot deployment demand. Each deployment gets a right-sized server matched to its resource requirements.

### How It Works
- Background watcher (`nodeManager.ts`) polls every 15s for Pending (Unschedulable) bot pods
- When detected, provisions a Hetzner server sized to the pod's CPU/RAM + block storage for Longhorn
- Server joins K3s via cloud-init (installs K3s agent with cluster token)
- When a bot is deleted and the worker is empty for 5 minutes, the server is deprovisioned
- Controlled by `AUTOSCALE_ENABLED=true` feature flag

### Server Type Mapping
| Pod CPU | Pod RAM | Hetzner Type | Server Specs |
|---------|---------|--------------|-------------|
| ≤1.5 vCPU | ≤1.5 GB | cpx11 | 2 vCPU, 2 GB |
| ≤2.5 vCPU | ≤3.5 GB | cpx21 | 3 vCPU, 4 GB |
| ≤3.5 vCPU | ≤7.5 GB | cpx31 | 4 vCPU, 8 GB |
| ≤7.5 vCPU | ≤15.5 GB | cpx41 | 8 vCPU, 16 GB |
| >7.5 vCPU | >15.5 GB | cpx51 | 16 vCPU, 32 GB |

### Key Files
| File | Purpose |
|------|---------|
| `jarble-api-main/src/k8s/nodeManager.ts` | Background watcher, Hetzner provisioning/deprovisioning |
| `jarble-api-main/src/db/schema*.ts` | `managed_nodes` table (tracks auto-provisioned servers) |
| `jarble-api-main/k8s/cluster-autoscaler.yaml` | K8s Cluster Autoscaler manifest (not currently used — custom watcher preferred) |

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
RESEND_API_KEY=re_...           # Optional — transactional email via Resend
ADMIN_USER_IDS=auth0|...,auth0|... # Optional — comma-separated Auth0 IDs for admin router access
AUTOSCALE_ENABLED=true          # Enable auto-scaling of Hetzner workers
HETZNER_API_TOKEN=...           # Hetzner Cloud API token
HETZNER_NETWORK_ID=...          # Private network ID for worker nodes
HETZNER_FIREWALL_ID=...         # Firewall ID applied to new workers
HETZNER_SSH_KEY_ID=...          # SSH key ID for server access
K3S_JOIN_TOKEN=...              # K3s cluster join token for new agents
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

### Agentic Overnight QA System

6 QA-specific agents that run overnight to autonomously test, debug, and fix the platform:
- `qa-orchestrator` — Brain: reads git diffs, generates dynamic test goals, coordinates specialists
- `qa-explorer-ui` — Browser testing via Playwright MCP accessibility tree (no CSS selectors)
- `qa-api-tester` — Tests tRPC endpoints directly via curl
- `qa-chaos` — Adversarial testing: XSS, injection, race conditions
- `qa-healer` — Investigates failures, applies fixes in git worktree, creates draft PRs
- `qa-reporter` — HTML reports, GitHub issues for unfixed bugs

**How to run**: `node scripts/nightly-qa/overnight-agent.mjs` (see `scripts/nightly-qa/README.md` for full docs)

**Cloud deployment**: QA runs against production cloud by default (`dev.jarble.ai` + `api.jarble.ai`). The GitHub Actions workflow (`nightly-qa.yml`) triggers at 5 AM UTC daily. Uses Vercel Deployment Protection bypass cookie for browser tests. Supports `--target local` for localhost testing.

**Key design**: Tests are dynamic, not scripted. The orchestrator reads `git diff` and CLAUDE.md each cycle to discover what changed and decide what to test. When you add a new page, router, or component, it gets tested automatically — no script updates needed. Agent memory (`.claude/agent-memory/qa/`) tracks coverage, failure patterns, and regression watchlists across runs.
