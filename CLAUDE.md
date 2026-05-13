# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Detailed documentation is split into `.claude/rules/` — path-specific files load automatically when you work in matching directories.

## Developer Portability

This repo includes a **portable memory system** so Claude Code context travels with git:

- **`.claude/memory/`** — Committed copy of Claude's auto-memory (MEMORY.md + topic files). Auto-synced by hooks.
- **`.claude/agent-memory/`** — Accumulated debugging knowledge from specialized agents.
- **`scripts/setup.sh`** — Run `bash scripts/setup.sh` after cloning on a new machine to restore memory, install deps.
- **Hooks** (`.claude/settings.json`): `SessionStart` restores committed memory → local; `Stop` copies local → committed and stages for git.

## Secret Handling

  - A pre-commit scan-secrets hook (`.claude/hooks/scan-secrets.js`) blocks commits that add strings matching well-known token prefixes (`sntryu_`, `vcp_`, `sk-ant-api03-`, `sk_live_`, `whsec_`, `ghp_`, `gho_`, `xoxb-`, `AKIA`, PEM private-key headers, etc.). Escape hatch: `SKIP_SECRET_SCAN=1` for a single commit.
- API secrets live in `jarble-api-main/.env` (dev) or Kubero/Coolify env config (prod) — never in source files. See `.claude/rules/env-config.md`.

## Project Overview

> **Source of truth**: `PRODUCT.md` in the repo root. If anything here contradicts PRODUCT.md, PRODUCT.md wins.

Jarble is an **Agent Infrastructure Platform**. It deploys, scales, runs, and orchestrates **Agent Harnesses** on managed K8s, abstracting the operational layer so builders can focus on agent behavior.

- **OpenClaw is the only Agent Harness currently shipping.** The platform is harness-agnostic by design — additional harnesses plug in via the `RuntimeHandler` interface in `jarble-api-main/src/runtimes/handlers/`.
- **Builders** configure a deployment (system prompt, model, MCP connections, messaging-platform credentials) and ship it.
- **Businesses / end users** reach the agent through the **harness's own webchat UI** at the per-deployment subdomain, or through messaging platforms (WhatsApp, Discord, Slack, Telegram) the deployment is wired to.

The moat is the infrastructure layer (K8s isolation, config sync, ingress + forward-auth, secret management, LLM routing, autoscaling), not any single agent or harness.

The marketplace (browse + publish + revenue share) is **planned, not shipped** — see PRODUCT.md → Future Roadmap.

### Naming and deprecations (read this)

- The user-facing / architectural term is **Agent Harness**. The earlier name "Agent Runtime" is retired in product / docs / agent prompts. **Code identifiers stay**: `RuntimeHandler` interface, `runtimes/handlers/` directory, `runtimeCatalog` table, `RUNTIME_EXTRA_STEPS` / `RUNTIME_CONFIG_TABS` config objects.
- **Jarble does not ship its own chat UI or canvas component library going forward.** The per-deployment chat surface is the harness's webchat. The repo still contains legacy canvas + chat code (`Jarble-mvp/components/canvas/`, `hooks/useCanvasChat.ts`, `components/chat/AssistantUIChat.tsx`, `components/workspace/SimpleCanvasGrid.tsx`, `lib/assistantRuntime.ts`, the `render_ui` / `define_component` tools in `jarble-api-main/src/mcp/jarble-ui-server.js`); that code is in **deprecation**, not active development. Do not add to it. The `canvas-component-builder` agent is marked deprecated.
- The **orchestration canvas** in `Jarble-mvp/views/Deployments.tsx` (built on `@xyflow/react`, used to wire deployments into multi-agent workflows) is **not** the deprecated canvas — it is a Jarble-owned surface and stays.

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
└── runtimes/            # Agent runtime implementations (openclaw, zeroclaw)
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
npm run dev          # Start with file watching (tsx watch src/index.ts)
npm run typecheck    # TypeScript type-check
npm run test         # Run Vitest unit tests (87 test files)
npm run db:push      # Push schema to Neon Postgres (requires DATABASE_URL)
npm run db:studio    # Open Drizzle Studio
npm run db:migrate   # Run Drizzle migrations against Neon Postgres
```

### Running Both Services
```bash
# Terminal 1 - API on :3001 (requires DATABASE_URL pointing at a Neon branch)
cd jarble-api-main && npm run dev
# Terminal 2 - Frontend on :3000
cd Jarble-mvp && pnpm run dev
```

## Tech Stack
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, pnpm
- **API**: Express, tRPC, SuperJSON, Drizzle ORM, npm
- **MCP**: Legacy stdio MCP server (`jarble-ui-server.js`) exposing `render_ui` / `define_component` / `list_components` / `component_reference` / `skill_reference` is **deprecated** (the harness owns chat rendering now). Do not extend it.
- **Database**: PostgreSQL via Neon (prod and local dev via a Neon branch)
- **Auth**: Auth0 (JWT + JWKS), **Payments**: Stripe, **Email**: Resend (transactional, from `noreply@noreply.jarble.ai`)
- **Infra**: Hetzner Cloud, Terraform, K3s, Longhorn

**Package managers**: Frontend uses **pnpm** (declared in package.json `packageManager` field). API uses **npm**. Do not mix them — use the correct lockfile for each.

## tRPC Router Structure
Routers at `/trpc`:
`user`, `deployment`, `runtimeCatalog` (the harness catalog — the table + router keep the legacy `runtime` code identifier), `openrouter`, `billing`, `platformCredentials`, `deploymentSecrets`, `flows` (flow CRUD + execution), `admin`, `apiKeys`, `skills`, `subagents`, `org` (organizations)

## Organizations
Individual-first model: users sign up as individuals, then create/join unlimited orgs. Deployments have an optional `orgId` — null means personal mode.

- **Tables**: `organizations`, `org_members`, `org_invites` (in `schema.pg.ts` plus the Vitest SQLite mirror)
- **Roles**: owner > admin > member
- **Router**: `org` — create, list, getById, update, delete, invite, acceptInvite, listInvites, cancelInvite, removeMember, updateMemberRole, leave
- **Frontend**: `OrgContext` provider, `OrgSwitcher` in ProfileDropdown, dedicated `/orgs` list + `/orgs/[orgId]` detail pages, workspace banner on dashboard
- **Invite flow**: Email via Resend, accept at `/invite/[token]` (handles expired, already-used, wrong-email, already-member states)
- **Deployment scoping**: `OnboardingWizard` passes `activeOrgId` on creation; `Dashboard` filters by active org

## Frontend-Backend Communication
- **tRPC + React Query**: Type-safe API calls with automatic caching
- **SSE Streams**: Real-time status (`useStatusStream`), logs (`useLogStream`), QR pairing (`useQrStream`)
- **Chat SSE**: `POST /api/tambo-agent` streams agent responses (text deltas + UI blocks + reasoning events)
- **Flow SSE**: `POST /api/flows/:flowId/execute` starts execution and returns an `executionId`; client reconnects to `GET /api/flows/:flowId/executions/:executionId/stream` for the live event stream
- **Auth0 Bearer tokens**: Automatically attached via tRPC link headers

## Chat UX — **legacy, not the supported product surface**

The supported per-deployment chat surface is the **harness's own webchat UI** (OpenClaw's webchat today), served via the per-deployment subdomain + forward-auth + proxy routes (`routes/openWebUiProxy.ts`, `routes/adminProxy.ts`, `routes/agentAuth.ts`).

The legacy Jarble-built chat (stop generation, message edit + resend, multi-conversation sidebar, streaming reasoning, typewriter reveal, component edit sync, canvas card context menus) still ships in `app/d/[id]/page.tsx` as the default `chatMode="workspace"` toggle, with details in `.claude/rules/chat-ux.md`. **This is on a path to removal.** Do not add features to it.

## Orchestration System (Flow Engine)
> Full details in `.claude/rules/flows.md` (auto-loads when working in flow files)

DAG-based pipeline executor with 6 node types, cycle support, HITL (`waitForInput`), subflows, template variables. 8 tRPC procedures for CRUD, SSE streaming for execution, flow chat endpoint. Canvas UI via `@xyflow/react`.

## Path Aliases & Zod Version Split

**Critical**: Frontend uses **Zod v4**, API uses **Zod v3**. Each tsconfig pins the `zod` path to its own `node_modules/zod`. The shared `component-manifest` package must work with both — don't construct Zod schemas that cross the version boundary.

- `@/*` → `Jarble-mvp/*` (frontend only)
- `@jarble/component-manifest` → `shared/component-manifest/index.ts` (both)
- `@jarble/component-manifest` must be in `next.config.ts:transpilePackages` (raw TypeScript, no build step)

## Writing Rules

- **Never use em dashes (—) in user-facing frontend text.** Use commas, periods, or rewrite the sentence instead.

### Terminology

The platform uses "agent" in all user-facing copy and documentation (renamed from "bot" in PR #123). Internal code identifiers that still contain `bot` are intentional and kept for backwards compatibility — renaming them requires coordinated cross-file migrations tracked as follow-up work. Specifically these stay as-is:

- File names: `botAsk.ts`, `botResponseErrorShape.ts`, `chatWithBot.ts`
- Identifiers: `BotResponseError`, `botText`, `botResponse`, `botteams` DashboardTab union key
- URL paths: `/api/bot/*`
- SSE event types: `jarble.bot.*`
- DB columns: `bot_*`
- MCP tool names: `chatWithBot`
- Env vars: `BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`
- Historical audit filenames: `docs/audits/bot-teams-*.md`
- Lucide `Bot` icon (no `Agent` icon exists in `lucide-react`)

When writing new user-facing strings, use "agent". When writing new internal code, prefer "agent" for new symbols but do not rename existing ones ad-hoc.

## Key Patterns

### Adding a New Agent Harness
1. Add entry to `RUNTIME_EXTRA_STEPS` and `RUNTIME_CONFIG_TABS` in `wizardStepConfig.ts` (code identifiers keep the "RUNTIME_" prefix on purpose)
2. Create the harness handler in `jarble-api-main/src/runtimes/handlers/` implementing the `RuntimeHandler` interface
3. Add render blocks in `OnboardingWizard.tsx` and deployment config views
4. Wire the per-deployment ingress so the new harness's webchat UI is what serves at the deployment subdomain — Jarble does not provide a generic chat fallback

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

### Adding a New Canvas Component — **DEPRECATED**
Canvas components are no longer a Jarble product surface — the harness owns the chat/render layer. Do not scaffold new canvas components. If a fix to existing canvas code is unavoidable, leave a comment linking back to this section and prefer a path that removes the code rather than extending it.

### Adding a New Flow Node Type
1. Add the type literal to `FlowNode["type"]` union in `jarble-api-main/src/services/flowEngine.ts`
2. Add a handler branch in `FlowEngine.executeStep()` — call the appropriate private method (follow the pattern of `executeTransformNode`, `executeConditionNode`, etc.)
3. Add the new node type to the `@xyflow/react` node-type registry in `Jarble-mvp/views/Deployments.tsx` with a matching custom node component
4. Update the `generateFromPrompt` system prompt in `flows.ts` so the LLM knows the new type exists

### Recent Architecture (April 2026)

Changes that aren't obvious from a cold read of the code:

- **Per-deployment ingress**: Each deployment gets a direct subdomain `{id}.agents.jarble.ai`. Auth is enforced by a Traefik forward-auth middleware + signed cookie (not in-app). A per-deployment auth middleware is auto-created on deploy (`50b5dbf`, `8e23c3c`, `6905639`).
- **Control UI proxy**: Fast-path proxy for the in-app Control Panel. Pod address is cached; DB lookups are skipped on the hot path (`187c95a`). Gateway token is passed in the URL hash for WS auto-connect (`ba3e04f`).
- **OpenClaw-native canvas / no Jarble chat UI**: The legacy `jarble_ui` MCP bridge was dropped (`6006e3b`); canvas renders are produced natively by the harness. As of 2026-05, Jarble has formally retired its own chat / canvas UI as a product surface — the per-deployment subdomain serves the harness's webchat. Do not re-introduce `jarble_ui`-style bridging, and do not add to the legacy `components/canvas/` / `useCanvasChat.ts` / `AssistantUIChat.tsx` / `SimpleCanvasGrid.tsx` code.
- **configSync advisory locks + durable lifecycle jobs** (JAR-86, `18bed02`): Deployment mutations (create/update/restart) acquire Postgres advisory locks so concurrent requests serialize instead of racing. Long-running lifecycle work (restart, redeploy) is durable — jobs survive API pod restarts.
- **`findDeploymentWithAccess`** (JAR-83, `7c9e310`): The canonical authz entry point in the deployment router. When adding a new deployment procedure, call this helper — don't hand-roll ownership/org checks.

### TOS Consent Gate (JAR-64)

The `users` table has three nullable consent fields: `tosAcceptedAt`, `tosVersion`, `privacyAcceptedAt`. A null `tosAcceptedAt` is the signal that the user has not accepted the current version — this is deliberate, existing users are NOT backfilled.

- **Backend**: `trpc.user.acceptTerms({ tosVersion })` writes all three fields. The `tosVersion` is a Zod enum locked to a short allow-list so a stale client cannot claim acceptance of a version that never existed. Uses `dbDate()` so it works under both Postgres and the SQLite test mirror.
- **Frontend version source of truth**: `Jarble-mvp/lib/consent.ts:CURRENT_TOS_VERSION`. Must stay in sync with the backend zod enum. Bumping this forces every existing user to re-accept on their next login.
- **Global modal**: `<ConsentModal />` mounted in `Jarble-mvp/app/providers.tsx` renders on every authenticated page when `needsConsent(profile)` is true. Blocks Escape, outside click, and close button. Self-hides on `/login`, `/register`, `/legal/*`, `/terms`, `/privacy`, `/about`, `/pricing`, and `/` so users can read the pages they are agreeing to.
- **Inline gate**: `<ConsentGate />` renders inside the first onboarding wizard step (`StepName.tsx`) when the profile has a null `tosAcceptedAt`. `OnboardingWizard.tsx:canProceed` blocks the Continue button; `handleNext` awaits the `acceptTerms` mutation before advancing.
- **Canonical legal URLs**: `/legal/terms` and `/legal/privacy` re-export the existing `Terms` and `Privacy` views and are the URLs linked from both gates. `/terms` and `/privacy` still work as aliases.

To bump the TOS version: change `CURRENT_TOS_VERSION` in `lib/consent.ts` AND the `z.enum([...])` in `jarble-api-main/src/trpc/routers/user.ts::acceptTerms` in the same commit, deploy API + frontend together.

### Claude Max OAuth Tokens
`sk-ant-oat*` tokens can't be validated via Anthropic API — auto-passed by prefix in `openrouter.ts:validateProviderKey`. Use Bearer auth (not `x-api-key`).

### Config-Driven UI
Wizard steps and config tabs driven by `Jarble-mvp/views/onboarding/wizardStepConfig.ts`. Adding a new runtime only requires config changes + component implementation.

### Legacy Chat / Canvas files (deprecated — phasing out)

These files still exist in the repo but are **on a path to deletion**. They power the legacy "workspace mode" toggle on `app/d/[id]/page.tsx`. The supported per-deployment UX is the harness's own webchat (the "webui" mode in that same page). Do not add to these files.

| File | Purpose | Status |
|------|---------|--------|
| `hooks/useCanvasChat.ts` | Chat hook — streaming, conversation mgmt | Deprecated |
| `lib/assistantRuntime.ts` | assistant-ui ExternalStoreRuntime adapter | Deprecated |
| `lib/conversationStorage.ts` | localStorage multi-conversation CRUD | Deprecated |
| `components/chat/AssistantUIChat.tsx` | Thread UI | Deprecated |
| `components/workspace/ConversationHistoryPanel.tsx` | Conversation sidebar | Deprecated |
| `components/workspace/SimpleCanvasGrid.tsx` | Freeform canvas | Deprecated |
| `components/canvas/*` | All Jarble-built canvas component library | Deprecated |
| `jarble-api-main/src/mcp/jarble-ui-server.js` | `render_ui` / `define_component` MCP tools | Deprecated |

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

## Database Schema (Postgres only)

MySQL and SQLite providers were removed in commit `388018b "Remove MySQL, SQLite, and GH Actions — consolidate to Postgres/Neon only"`. The only production schema file is:

- `jarble-api-main/src/db/schema.pg.ts` — the single source of truth for all tables

The `src/db/` directory now contains: `index.ts`, `init.ts`, `migrate.pg.ts`, `schema.pg.ts`, `seed.pg.ts`.

`db/init.ts` is a no-op stub kept for backward compatibility with the startup sequence.

### Applying schema changes — the custom migrator

Production does NOT use `drizzle-kit migrate`. It uses a **custom migrator** at `jarble-api-main/src/db/migrate.pg.ts`, invoked by `entrypoint.sh` on every pod start. The custom migrator:

1. Reads every `.sql` file in `drizzle-pg/` sorted by filename
2. Tracks applied migrations in a `_jarble_applied_migrations` table (separate from drizzle's `__drizzle_migrations`)
3. On first run with a legacy `schema-pushed-directly` marker, backfills the tracker so existing schema is marked applied
4. Tolerates `already exists` / `duplicate column` errors so partially-applied migrations retry safely

**The packaged `npm run db:migrate:pg` script runs `drizzle-kit migrate`, which short-circuits on the legacy marker and does NOT apply new migrations in production.** Running it locally will silently do nothing. The **only correct local apply** is the custom migrator directly:

```bash
cd jarble-api-main && npx tsx src/db/migrate.pg.ts
```

When adding tables or columns:
1. Edit `schema.pg.ts`
2. Hand-write the `.sql` file in `drizzle-pg/` with the next sequential number. The committed `_journal.json` is drifted and is not maintained by this repo — production ignores it, so do not waste time running `db:generate:pg` unless you need the snapshot locally
3. Apply via the custom migrator above to verify on your Neon dev branch
4. Update `db/index.ts` `tables` export if the new table needs to be accessible via the `tables` helper
5. Mirror the column in `src/__tests__/helpers/testSchema.sqlite.ts` AND the raw `CREATE TABLE` block in `src/__tests__/helpers/testDb.ts` so Vitest coverage works

On merge to main/develop, the next API pod restart runs `migrate.pg.ts` automatically and picks up the new `.sql` file.

### Unit test mirror (NOT a production provider)
`jarble-api-main/src/__tests__/helpers/testSchema.sqlite.ts` is an in-memory SQLite mirror of the Postgres schema used exclusively by Vitest tests via `better-sqlite3`. It does not need to stay in sync automatically, but it should mirror any new tables added to `schema.pg.ts` so tests can cover the new paths.

## Environment Variables
> Full details in `.claude/rules/env-config.md` (auto-loads when working in .env/infrastructure files)

- **API**: `jarble-api-main/.env` — DATABASE_URL, AUTH0_*, STRIPE_*, ENCRYPTION_KEY, ALLOWED_ORIGINS
- **Frontend**: `Jarble-mvp/.env.local` — NEXT_PUBLIC_API_URL, NEXT_PUBLIC_AUTH0_*
- **Local dev**: Set `DATABASE_URL` to a Neon dev-branch connection string. No SQLite provider exists in the API at runtime.
- **CORS**: `ALLOWED_ORIGINS` env var (comma-separated) for additional origins beyond FRONTEND_URL
- **Debug endpoints**: `/debug/db`, `/debug/deployment/:id/status`, `/debug/deployment/:id/pod-status` (dev only, gated by NODE_ENV)

## Production Infrastructure

| Layer | Tool | Domain | Notes |
|-------|------|--------|-------|
| **Frontend** | Coolify | `dev.jarble.ai` (dev), `jarble.ai` (prod) | Next.js deployed via Coolify on K3s |
| **API** | Kubero | `api.jarble.ai` | Express + tRPC, namespace `jarble-production` |
| **Database** | Neon Postgres | — | Production DB and local dev (via a Neon branch) |
| **Cluster** | K3s on Hetzner | master: `178.156.230.13` | Traefik ingress, Longhorn storage, cert-manager |
| **Email** | Resend | — | Transactional email (org invites, beta welcome) |

**SSH to master**: `ssh -i ~/.ssh/id_ed25519_hetzner root@178.156.230.13`

**Dashboards**:
- Coolify (frontend deploys): `coolify.jarble.ai`
- Kubero (API deploys): `kubero.jarble.ai`

**API env vars** are managed through Kubero dashboard or KuberoApp CRD. Frontend env vars are managed through Coolify.

**Key K8s commands**:
```bash
kubectl -n jarble-production get pods                    # List API pods
kubectl -n jarble-production logs deployment/jarble-api-kuberoapp-web  # API logs
kubectl -n jarble-production exec deployment/jarble-api-kuberoapp-web -- env  # Check env vars
```

## CI/CD Workflows (`.github/workflows/`)

| Workflow | Triggers | What it does |
|----------|----------|-------------|
| `deploy-api.yml` | Push to main or develop (API/shared changes), manual dispatch | Build + push Docker image to `ghcr.io/jarble-ai/api` with `latest` and `sha-{commit}` tags |
| `deploy-runtimes.yml` | Push to main when `runtimes/**` or `jarble-api-main/src/mcp/jarble-ui-server.js` changes; manual dispatch | Matrix build + push of runtime images (openclaw, zeroclaw) to GHCR. Tags `:latest` and `:sha-XXXXXXX`. Copies the canonical `jarble-ui-server.js` from `jarble-api-main/src/mcp/` into the openclaw build context fresh on each build so the image always bundles the latest MCP server. |

**Note**: CI checks (typecheck, tests, build), frontend deploys, and Terraform apply are not yet automated via GitHub Actions. See JAR-34 for the planned CI/CD pipeline expansion. Frontend deploys via Coolify. API deploys via Kubero on K3s. Runtime images now auto-build via `deploy-runtimes.yml` on changes to `runtimes/**` or the canonical MCP server.

## Rules Index (`.claude/rules/`)

| File | Loads When | Content |
|------|-----------|---------|
| `flows.md` | Working in `flowEngine*`, `flows.*`, `flowExecution*`, `flowChat*`, `Deployments*` | Flow engine, CRUD, execution, SSE events, canvas |
| `chat-ux.md` | Working in `useCanvasChat*`, `assistantRuntime*`, `conversationStorage*`, `chat/`, `canvas/` | Chat streaming, typewriter, reasoning, edit sync, canvas controls |
| `env-config.md` | Working in `.env*`, `docker*`, `db/init*`, `infrastructure/` | Environment variables, debug endpoints, Neon Postgres dev setup |
| `autoscaling.md` | Working in `nodeManager*`, `cluster-autoscaler*` | Hetzner auto-scaling, server type mapping |
| `linear-workflow.md` | Working in `ROADMAP.md`, `scripts/linear/**`, `.claude/commands/dispatch-roadmap.md`, `.claude/hooks/ticket-*`, `.claude/agents/{ticket-*,linear-orchestrator}*` | Roadmap → Linear dispatch, session hooks, nightly sync |
| `overnight-qa-policy.md` | Working in QA agent prompts or overnight orchestrator configs | Prod-mutation authorization boundaries for overnight QA agents |

## Slash Commands (`.claude/commands/`)

Linear-driven workflow commands — see `.claude/rules/linear-workflow.md` for the full loop.

| Command | Purpose |
|---------|---------|
| `/dispatch-roadmap` | Parse `ROADMAP.md` → create Linear tickets per assignee with Claude Code prompts embedded |
| `/create-ticket` | Create a single ad-hoc Linear ticket (auto-assigns via `.claude/crew.json`) |
| `/work-ticket JAR-XX` | Fetch a ticket, plan, implement, open PR |
| `/triage` | Review & triage the Linear backlog |

## Claude Agents

Pre-configured agents in `.claude/agents/`:

| Agent | Purpose |
|-------|---------|
| `code-reviewer` | Review diffs for correctness, security, consistency |
| `jarble-api-debugger` | Trace errors through tRPC, services, K8s, Stripe |
| `nextjs-frontend-debugger` | Hydration, React Query cache, Auth0 redirects, SSE |
| `drizzle-db-schema` | Schema changes (Postgres-only + the Vitest SQLite mirror), migrations |
| `test-writer` | Unit/integration/E2E tests, test infra |
| `k8s-pod-lifecycle-debugger` | PVC mounts, image pulls, crash loops, storage |
| `stripe-webhook-debugger` | Webhook signatures, subscription lifecycle |
| `terraform-infra` | Hetzner Cloud, K3s, Auth0 Terraform |
| `docs-updater` | Update API-ENDPOINTS.md, DEVELOPER-GUIDE.md, OVERVIEW.md |
| `runtime-handler` | Agent Harness configs, secret mapping, platform env vars |
| `openclaw-diagnostics` | Gateway timeouts, chat failures, config sync |
| `canvas-component-builder` | **Deprecated.** Tombstone agent — Jarble no longer ships canvas components. |
| `ticket-dispatcher` | Parse ROADMAP.md into per-assignee Linear ticket drafts with embedded Claude Code prompts |
| `ticket-updater` | Post session-end Linear comment (mermaid + AC delta + token/cost footer) from Stop hook |
| `linear-orchestrator` | Nightly cross-ticket planner: writes focus-plan.json + docs/daily-standup.md |

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
## Team Workflow (Linear-Driven)

Jarble uses a Linear-driven workflow: `CLAUDE.md` is the source of truth for what the system **is**, `ROADMAP.md` is the source of truth for what is **coming next** and who is doing it, and Linear is the timeline of what is happening **right now**. Hooks keep Linear fresh automatically — no one has to remember to comment.

**How it works end-to-end:**
1. Brett edits `ROADMAP.md`, adding `### Feature:` blocks under `## Epic:` headers with assignee, priority, size, labels, acceptance criteria, and files likely touched.
2. Brett runs `/dispatch-roadmap`. The command launches the `ticket-dispatcher` agent, which splits oversized features, resolves assignees from `.claude/crew.json`, checks load + duplicates, and shows a preview table. On `approve all`, tickets are created in Linear with a `## Claude Code Prompt` block embedded in each description.
3. A teammate branches `<type>/jar-XX-<slug>` from `develop` and runs `/work-ticket JAR-XX`. The `SessionStart` hook (`.claude/hooks/ticket-context-start.mjs`) detects the branch, fetches the ticket, and injects scope + acceptance criteria into the session.
4. As the teammate works, the `PostToolUse` hook (`ticket-track-changes.mjs`) buffers their Edit/Write/Bash events to `.claude/sessions/JAR-XX-<ts>.jsonl` (debounced, no file contents).
5. On `/quit`, the `Stop` hook (`ticket-session-end.mjs`) spawns the `ticket-updater` subagent headless on **the teammate's own Claude subscription**. The agent composes a rich Linear comment — summary, file list, mermaid of the change shape, AC delta, token/cost footer — and posts it via the Linear MCP. If a PR exists and typechecks passed, it also transitions the ticket to In Review.
6. Every night at 04:00 (local cron on Brett's machine), `scripts/linear/nightly-sync.mjs` pulls all open tickets, builds a cross-ticket collision map **plus pairwise merge-conflict probe**, calls the `linear-orchestrator` agent to produce a per-ticket QA focus plan + `docs/daily-standup.md`, runs per-branch **static QA in a disposable git worktree** (typecheck + test against the branch, not develop), runs runtime QA focused per ticket against `dev.jarble.ai`, and posts a condensed result to each ticket. If a branch is ≥ 20 commits behind develop or would conflict on merge, the comment includes an explicit rebase nudge so merges stay clean.

**Why this shape:** the development sessions run on each teammate's own Max subscription, so Claude token cost distributes by construction. Dispatch and nightly sync live on Brett's machine because those are organizer-side tasks. Every session comment includes a `Tokens: X in / Y out • Cost: $Z • Run by: @handle` footer so the team can see per-ticket spend and discuss rebalancing if needed.

**Files:**
- `ROADMAP.md` — forward-looking plan, one `### Feature:` per ticket.
- `.claude/crew.json` — crew handle → Linear user id mapping (fill via `node scripts/linear/list-crew.mjs`).
- `scripts/linear/graphql-client.mjs` — shared Linear GraphQL client (never throws).
- `scripts/linear/token-cost.mjs` — transcript → cost footer util.
- `scripts/linear/branch-status.mjs` — ahead/behind + `git merge-tree` conflict probes + disposable worktrees.
- `scripts/linear/nightly-sync.mjs` — cron entry point. Flags: `--dry-run`, `--cycles <n>`, `--no-static-qa`, `--max-tickets <n>`, `--states "a,b"`, `--base <branch>`, `--verbose`.
- `.claude/commands/dispatch-roadmap.md` — slash command.
- `.claude/agents/ticket-dispatcher.md`, `ticket-updater.md`, `linear-orchestrator.md` — the three agents.
- `.claude/hooks/ticket-context-start.mjs`, `ticket-track-changes.mjs`, `ticket-session-end.mjs` — the three hooks.
- `.claude/rules/linear-workflow.md` — full walkthrough including **new-teammate onboarding**, the cron stanza, and the smoke test.

**Environment:** set `LINEAR_API_KEY` on the machine that runs dispatches or the nightly cron. Hooks silently no-op without it. Override the team key via `LINEAR_TEAM_KEY` (default `JAR`). Override the base branch via `JARBLE_BASE_BRANCH` (default `develop`). Set `SKIP_JAR_TAG=1` in a Bash command to bypass the pre-commit JAR-tag enforcement for a single commit.

**Cron stanza (runs on the organizer's machine):**
```cron
0 4 * * *  cd /absolute/path/to/jarble && LINEAR_API_KEY=lin_api_... node scripts/linear/nightly-sync.mjs >> scripts/linear/.nightly.log 2>&1
```

## Linear Integration & Development Workflow

### Connection

Linear API key is expected as `LINEAR_API_KEY` env var (per-teammate, `lin_api_...` from https://linear.app/settings/api). Team key: `JAR`. GraphQL endpoint: `https://api.linear.app/graphql`.

The `linear-server` MCP is declared in `.claude/settings.json` and auto-connects on first tool use (OAuth). The MCP handles in-session tool calls (`/dispatch-roadmap`, `/create-ticket`). The raw `LINEAR_API_KEY` is needed separately because the `SessionStart` / `Stop` hooks and the nightly cron run outside Claude Code sessions and cannot use the MCP.

**New teammates:** see `.claude/rules/linear-workflow.md#new-teammate-onboarding` for the one-time per-person setup (clone → MCP auth → API key → env var → crew.json entry).

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
