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

> **Source of truth**: `PRODUCT.md` in the repo root. If anything here contradicts PRODUCT.md, PRODUCT.md wins.

Jarble is an **infrastructure platform for AI agents**. The platform has two sides:

- **Builders** create, host, and monetize agents — pick a runtime (OpenClaw), write a system prompt, add MCP connections, install skills/components, publish to the marketplace, and earn on every deployment.
- **Businesses** discover, deploy, and run agents in the tools their teams already use — browse the marketplace, deploy in one click, agents run inside existing workflows.

The **marketplace** connects both sides. The **infrastructure** (K8s pods, config sync, LLM routing) makes everything run. The moat is the infrastructure layer, not any single agent.

Each deployment gets a **web chat interface** (`/d/[id]`) with rich UI components (charts, tables, 3D visualizations, live widgets) rendered via an MCP UI server as interactive canvas blocks inline in conversation. Agents can also be connected to messaging platforms (WhatsApp, Discord, Slack, Telegram).

## Monorepo Structure

```
├── Jarble-mvp/          # Next.js 15 frontend (App Router, React 19)
├── jarble-api-main/     # Express + tRPC API backend
├── shared/              # Shared packages
│   └── component-manifest/  # Single source of truth for component metadata
├── scripts/             # CI/build scripts + agent dev tooling
│   └── agent-dev/       # Agent development scripts (formerly jarble-dev/)
├── docs/                # Operational documentation
│   ├── API-ENDPOINTS.md # Full API reference
│   ├── DEVELOPER-GUIDE.md # Developer walkthrough
│   ├── PRODUCTION-SETUP.md # Infrastructure setup & onboarding
│   ├── RUNBOOK.md       # Operational runbook
│   ├── ORCHESTRATION-SPEC.md # Flow engine spec
│   └── audits/          # Security/code audit reports
├── infrastructure/      # Terraform IaC + Auth0 config
└── runtimes/            # Bot runtime implementations (openclaw, zeroclaw)
```

## Common Commands

### Frontend (Jarble-mvp/) — uses pnpm
```bash
pnpm run dev          # Start dev server on :3000
pnpm run build        # Production build
pnpm run check        # TypeScript type-check (tsc --noEmit)
pnpm run test         # Run Vitest unit tests (44 test files)
pnpm run check:manifest   # Verify manifest ↔ component sync
```

### API (jarble-api-main/) — uses npm
```bash
npm run dev          # Start with file watching (tsx watch)
npm run dev:test     # Start with SQLite (USE_SQLITE=true) for local dev
npm run typecheck    # TypeScript type-check
npm run test         # Run Vitest unit tests (87 test files)
npm run db:push      # Push schema to database
npm run db:studio    # Open Drizzle Studio
```

### Running Both Services
```bash
# Terminal 1 - API on :3001
cd jarble-api-main && npm run dev:test
# Terminal 2 - Frontend on :3000
cd Jarble-mvp && pnpm run dev
```

## Tech Stack
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, pnpm
- **API**: Express, tRPC, SuperJSON, Drizzle ORM, npm
- **MCP**: Custom stdio MCP server (`jarble-ui-server.js`) — `render_ui`, `define_component`, `list_components`, `component_reference`, `skill_reference`
- **Database**: PostgreSQL via Neon (prod), SQLite (dev with USE_SQLITE=true)
- **Auth**: Auth0 (JWT + JWKS), **Payments**: Stripe, **Infra**: Hetzner Cloud, Terraform, K3s, Longhorn

**Package managers**: Frontend uses **pnpm** (declared in package.json `packageManager` field). API uses **npm**. Do not mix them — use the correct lockfile for each.

## tRPC Router Structure
16 routers with 90+ procedures at `/trpc`:
`user`, `deployment`, `runtimeCatalog`, `openrouter`, `billing`, `platformCredentials`, `template`, `marketplace` (components), `services` (service marketplace + hosted dashboard), `flows` (flow CRUD + execution), `admin`, `apiKeys`, `skills`, `subagents`, `org` (organizations)

## Organizations
Individual-first model: users sign up as individuals, then create/join unlimited orgs. Deployments have an optional `orgId` — null means personal mode.

- **Tables**: `organizations`, `org_members`, `org_invites` (in all 3 DB schemas)
- **Roles**: owner > admin > member
- **Router**: `org` — create, list, getById, update, delete, invite, acceptInvite, listInvites, cancelInvite, removeMember, updateMemberRole, leave
- **Frontend**: `OrgContext` provider, `OrgSwitcher` in ProfileDropdown, org management in Settings
- **Invite flow**: Email via Resend, accept at `/invite/[token]`

## Frontend-Backend Communication
- **tRPC + React Query**: Type-safe API calls with automatic caching
- **SSE Streams**: Real-time status (`useStatusStream`), logs (`useLogStream`), QR pairing (`useQrStream`)
- **Chat SSE**: `POST /api/tambo-agent` streams bot responses (text deltas + UI blocks + reasoning events)
- **Flow SSE**: `POST /api/flows/:flowId/execute` starts execution and returns an `executionId`; client reconnects to `GET /api/flows/executions/:executionId/stream` for the live event stream
- **Auth0 Bearer tokens**: Automatically attached via tRPC link headers

## Chat UX Features
> Full details in `.claude/rules/chat-ux.md` (auto-loads when working in chat/canvas files)

Key features: stop generation, message edit + resend, multi-conversation sidebar (localStorage), streaming reasoning (`<think>` tags), typewriter text reveal (480 chars/sec), component edit sync (`content_edit` action), canvas card context menus.

## Orchestration System (Flow Engine)
> Full details in `.claude/rules/flows.md` (auto-loads when working in flow files)

DAG-based pipeline executor with 6 node types, cycle support, HITL (`waitForInput`), subflows, template variables. 8 tRPC procedures for CRUD, SSE streaming for execution, flow chat endpoint. Canvas UI via `@xyflow/react`.

## Path Aliases & Zod Version Split

**Critical**: Frontend uses **Zod v4**, API uses **Zod v3**. Each tsconfig pins the `zod` path to its own `node_modules/zod`. The shared `component-manifest` package must work with both — don't construct Zod schemas that cross the version boundary.

- `@/*` → `Jarble-mvp/*` (frontend only)
- `@jarble/component-manifest` → `shared/component-manifest/index.ts` (both)
- `@jarble/component-manifest` must be in `next.config.ts:transpilePackages` (raw TypeScript, no build step)

## Key Patterns

### Adding a New Runtime
1. Add entry to `RUNTIME_EXTRA_STEPS` and `RUNTIME_CONFIG_TABS` in `wizardStepConfig.ts`
2. Create runtime handler in `jarble-api-main/src/runtimes/handlers/`
3. Add render blocks in `OnboardingWizard.tsx` and deployment config views

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
> Full details in `.claude/rules/autoscaling.md` (auto-loads when working in nodeManager/cluster-autoscaler files)

Background watcher polls for Pending pods, provisions right-sized Hetzner servers (cpx11-cpx51), joins K3s via cloud-init. Empty workers deprovisioned after 5 min. Controlled by `AUTOSCALE_ENABLED=true`.

## Database Schema (3 Providers)
Schema is defined in 3 files that must stay in sync:
- `jarble-api-main/src/db/schema.ts` (MySQL)
- `jarble-api-main/src/db/schema.pg.ts` (PostgreSQL — production via Neon)
- `jarble-api-main/src/db/schema.sqlite.ts` (SQLite — local dev)

When adding tables or columns, update ALL THREE files plus `db/init.ts` (SQLite CREATE TABLE + migrations) and `db/index.ts` (ActiveTables type + getActiveTables()).

## Environment Variables
> Full details in `.claude/rules/env-config.md` (auto-loads when working in .env/infrastructure files)

- **API**: `jarble-api-main/.env` — DATABASE_URL, AUTH0_*, STRIPE_*, ENCRYPTION_KEY, ALLOWED_ORIGINS
- **Frontend**: `Jarble-mvp/.env.local` — NEXT_PUBLIC_API_URL, NEXT_PUBLIC_AUTH0_*
- **Local dev**: `USE_SQLITE=true` for file-based SQLite at `local.db`
- **CORS**: `ALLOWED_ORIGINS` env var (comma-separated) for additional origins beyond FRONTEND_URL
- **Debug endpoints**: `/debug/db`, `/debug/deployment/:id/status`, `/debug/deployment/:id/pod-status` (dev only, gated by NODE_ENV)

## CI/CD Workflows (`.github/workflows/`)

| Workflow | Triggers | What it does |
|----------|----------|-------------|
| `ci.yml` | PRs + push to develop/main | 7 jobs: API/Frontend typecheck, tests, build, manifest sync, PR labels |
| `deploy-api.yml` | Push to main (API changes) | Build + push Docker image to GHCR |
| `deploy-frontend.yml` | Push to main (frontend changes) | Build + push frontend Docker image to GHCR |
| `deploy-runtimes.yml` | Push to main (runtime changes) | Build runtime images (openclaw, zeroclaw) |
| `terraform.yml` | Push to main (infra changes) | Plan + apply Hetzner/K3s infrastructure |
| `nightly-qa.yml` | Manual dispatch only | Agentic QA (Claude Code) |

**Frontend CI uses pnpm**, API CI uses npm. Vercel auto-deploys the frontend on every push. API Docker image must be manually redeployed to K3s after build.

## Rules Index (`.claude/rules/`)

| File | Loads When | Content |
|------|-----------|---------|
| `flows.md` | Working in `flowEngine*`, `flows.*`, `flowExecution*`, `flowChat*`, `Deployments*` | Flow engine, CRUD, execution, SSE events, canvas |
| `chat-ux.md` | Working in `useCanvasChat*`, `assistantRuntime*`, `conversationStorage*`, `chat/`, `canvas/` | Chat streaming, typewriter, reasoning, edit sync, canvas controls |
| `env-config.md` | Working in `.env*`, `docker*`, `db/init*`, `infrastructure/` | Environment variables, debug endpoints, SQLite dev DB |
| `autoscaling.md` | Working in `nodeManager*`, `cluster-autoscaler*` | Hetzner auto-scaling, server type mapping |

## Custom Skills

| Skill | Command | Purpose |
|-------|---------|---------|
| `/qa` | Run QA locally | Agentic QA cycle using Max subscription (no API cost) |
| `/deploy-check` | Pre-deploy verification | Both typechecks + both test suites |
| `/new-component` | Scaffold canvas component | 5-step pattern: file, manifest, register, resolve, verify |
| `/new-router` | Scaffold tRPC router | Zod v3 patterns, registration, typecheck |
| `/new-platform` | Add messaging platform | All 5 touchpoints: credentials, config, wizard, UI, steps |

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

**How to run**: `/qa` skill, or directly: `node scripts/nightly-qa/overnight-agent.mjs --cycles 1` (uses Max subscription, no API cost)

**GitHub Actions**: Cron disabled (runs locally instead). Manual dispatch still available via `workflow_dispatch` but requires an `ANTHROPIC_API_KEY` secret.

**Key design**: Tests are dynamic, not scripted. The orchestrator reads `git diff` and CLAUDE.md each cycle to discover what changed and decide what to test. When you add a new page, router, or component, it gets tested automatically — no script updates needed. Agent memory (`.claude/agent-memory/qa/`) tracks coverage, failure patterns, and regression watchlists across runs.
## Linear Integration & Development Workflow

### Connection

Linear API key is available as `LINEAR_API_KEY` env var. Team key: `JAR`. GraphQL endpoint: `https://api.linear.app/graphql`.

For Claude Code sessions with MCP: `claude mcp add --transport http linear-server https://mcp.linear.app/mcp`

### When to Create Tickets

Create a Linear ticket when:
- A bug is discovered during development (label: `bug`)
- A new feature requirement emerges from code review or testing (label: `feature`)
- Technical debt is identified that needs tracking (label: `improvement`)
- A TODO in code needs more than 30 minutes of work
- A dependency upgrade or security fix is needed (label: `infrastructure`)

Do NOT create tickets for:
- Quick fixes under 15 minutes (just do them)
- Style/formatting changes
- Typo fixes
- Anything already covered by an existing ticket

### Ticket Quality Standards

Every ticket must include:

```
Title: [Clear, actionable summary]

## Scope
What needs to change and where. Be specific about files/modules.

## Context
Why this work matters. Link to parent issue if applicable.

## Acceptance Criteria
- [ ] Criterion 1 (testable)
- [ ] Criterion 2 (testable)
- [ ] Criterion 3 (testable)

## References
- Relevant files: `path/to/file.ts`
- Docs: link to spec or doc
- Related issues: JAR-XX

## Dependencies
- Blocked by: JAR-XX (if any)
- Blocks: JAR-XX (if any)
```

Bad ticket: "Fix auth" - Good ticket: "Login form returns 500 when email contains '+' character - validate and encode email in auth.ts before Auth0 handoff"

### Branch Naming

Format: `<type>/<issue-id-lowercase>-<slug>`

| Type | Use |
|------|-----|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `cleanup/` | Tech debt, refactoring |
| `infra/` | Infrastructure, CI/CD, config |

Examples:
- `feature/jar-12-add-supabase-sync`
- `fix/jar-15-login-plus-encoding`
- `cleanup/jar-18-remove-dead-imports`

Always branch from `develop`.

### Commit Format

```
<summary> (JAR-XX)
```

- Keep the summary under 72 characters
- Use imperative mood: "Add", "Fix", "Remove", not "Added", "Fixed", "Removed"
- Never commit code that does not build. Run the appropriate check first:
  - Frontend: `cd Jarble-mvp && npm run check`
  - API: `cd jarble-api-main && npm run typecheck`

Examples:
- `Add email validation to auth flow (JAR-12)`
- `Fix plus-sign encoding in login (JAR-15)`

### Development Workflow

When working on a Linear ticket, follow this sequence:

#### 1. Fetch and Understand
- Read the ticket fully, including parent issue if one exists
- If the description references spec files or docs, read them before writing code
- Update ticket status to **In Progress**

#### 2. Plan Before Coding
- For any task with 3+ steps, write a plan first
- For complex tasks, use a subagent to review the plan "as a staff engineer"
- Get human approval on the plan before proceeding (unless the task is straightforward)

#### 3. Implement
- Create branch from `develop` using the naming convention above
- Follow project coding standards (see `.claude/rules/`)
- Write code that builds and passes tests
- Commit incrementally with descriptive messages

#### 4. Self-Review (Required)
Before pushing, launch a subagent to review your diff:
- Check for bugs, dead code, security issues, over-engineering
- Verify all acceptance criteria are met
- Run builds and tests:
  ```bash
  cd Jarble-mvp && npm run check && npm run test
  cd jarble-api-main && npm run typecheck && npm run test
  ```

#### 5. Open PR
Create PR with `gh pr create`. PR body must include:
- Summary of changes
- Link to the Linear issue: `Resolves JAR-XX`
- Build verification: paste typecheck/test results
- Files changed and why

#### 6. Update Linear
- Set ticket status to **In Review**
- Add a comment with the PR link

### Task Sizing

Keep tasks sized to fit within a single context window. If a ticket feels too large:
- Break it into subtasks in Linear
- Each subtask should be independently shippable
- Link subtasks to the parent issue

### Lessons Tracking

When a mistake happens:
1. Fix it
2. Add a rule to prevent recurrence - either in this CLAUDE.md or in the relevant `.claude/rules/` file
3. If the mistake reveals a gap in a ticket template, update the template

### Priority Mapping

| Linear Priority | Meaning |
|----------------|---------|
| Urgent | Drop everything. Production is broken. |
| High | Do this sprint. Blocks other work. |
| Medium | Planned work. Normal priority. |
| Low | Nice to have. Do when bandwidth allows. |
| No priority | Backlog. Will be triaged later. |
