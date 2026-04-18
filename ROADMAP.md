# Jarble Roadmap

_Last updated: 2026-04-18 — edit and run `/dispatch-roadmap` to sync to Linear._

This file is the forward-looking counterpart to `CLAUDE.md`. `CLAUDE.md` describes the system as it is today (source of truth for how the platform is built). `PRODUCT.md` describes what Jarble is and the design constraints that bound it. This roadmap describes what is coming next, who is doing it, and which phase it belongs to. The `/dispatch-roadmap` command parses every `### Feature:` block below and turns it into a Linear ticket with the teammate's Claude Code prompt embedded.

## Phases at a Glance

- **Phase 1 — Foundation** _(shipped)_: Hetzner + k3s infrastructure, one pod per agentic runtime, native agentic UI, everything currently running in production.
- **Phase 2 — Agentic Runtime Orchestration** _(in progress)_: Multi-agent canvas, delegation / collaboration / reporting between agents, workflow save + share, team workflow tooling. **Public launch happens at the end of Phase 2.**
- **Phase 3 — Agentic Runtime Marketplace** _(post-launch)_: Builders publish and fork runtime-agnostic assets (skills, sub-agents, workflow templates) and runtime-specific assets.
- **Phase 4 — Agentic Runtime Benchmarking** _(post-launch)_: Categorized scoring across reasoning / tool-use / speed / cost, competitive analysis across frameworks, continuous evaluation.

## How to edit this file

1. Find the phase the work belongs to. If the work does not belong in the active phase (Phase 2 right now), it is probably too early to dispatch.
2. Inside a phase, add an **Epic** (`## Epic:`) for each large body of work. An epic represents a milestone or shipped feature set. Epics can map to a Linear project — set the project id in the epic header or leave it as `auto` to let the dispatcher pick.
3. Under each epic, add one or more **Feature** (`### Feature:`) blocks. Each feature becomes one Linear ticket. If a feature will take more than ~4 hours, split it up front — the dispatcher will also warn you if it thinks something is too large.
4. Use the fields below exactly as shown. The dispatcher parses them case-sensitively.
5. When work ships, move the feature block to the **Shipped** section at the bottom, or change the epic's `Status:` to `shipped` and leave it in place as a record.

## Feature block schema

```md
## Epic: <name> {#epic-slug}
Status: planned | in-progress | shipped
Linear project: <linear project id or "auto">

### Feature: <name> {#feature-slug}
Assignee: @<crew-handle>
Collaborators: @<handle>, @<handle> (optional)
Priority: urgent | high | medium | low
Size: small | medium | large
Labels: feature | bug | improvement | infrastructure
Depends on: JAR-xx (optional)

**Scope:** one-paragraph what + where.

**Acceptance criteria:**
- [ ] testable item 1
- [ ] testable item 2

**Files likely touched:** `path/to/file.ts`, `path/to/other.tsx`
```

Notes:
- `Assignee` is a handle from `.claude/crew.json`. Unassigned features fall back to `defaultAssignee`. You can override per dispatch in the interactive preview.
- `Depends on: JAR-xx` links this ticket as blocked by that issue in Linear.
- `Files likely touched` is passed to the assignee's Claude Code prompt so their session starts with the right context.
- `Collaborators` are crew members who can pick up the ticket if the assignee is blocked. They are listed in the ticket description (with @-mentions) so Linear auto-subscribes them and anyone opening the ticket can see who is free to hand it off to. If omitted, the dispatcher auto-derives collaborators from `owns` overlap in `crew.json` -- e.g. a ticket in `organization-management` assigned to `@brett` will auto-add `@tanner` because both own that area.
- The `{#slug}` anchors are optional today. Keep them stable if you add them — they let the dispatcher recognise an existing feature instead of creating a duplicate.
- The dispatcher only recognizes `## Epic:` and `### Feature:`. Phase headers (`## Phase N —`) are narrative and are ignored.

---

## Phase 1 — Foundation _(shipped)_

What Phase 1 delivered and why it counts as done:

- Hetzner Cloud cluster with master + autoscaling worker pool.
- k3s + Longhorn storage + Traefik ingress + cert-manager.
- One pod per agentic runtime, isolated with its own PVC and config.
- Native agentic UI — chat + infinite canvas, rich components (charts, tables, code, 3D) rendered via the MCP UI server.
- Auth0-backed identity and per-organization RBAC.
- Stripe billing + subscription lifecycle.
- tRPC API + Next.js 15 frontend with SSE streaming (chat, status, logs).
- Organizations, memberships, invites, per-org deployments.

Phase 1 has no active features on this roadmap. Retained here as a historical marker. If something shipped in Phase 1 needs follow-up work, it belongs in Phase 2 under the relevant epic.

---

## Phase 2 — Agentic Runtime Orchestration _(in progress)_

**Goal:** Jarble can orchestrate teams of agentic runtimes through visual workflows. When this phase is done, the platform launches publicly.

**What "done" looks like:** the [Launch Milestone](#launch-milestone) checklist below.

## Epic: Linear-driven team workflow {#epic-linear-workflow}
Status: in-progress
Linear project: auto

### Feature: Roadmap dispatcher end-to-end smoke test {#feature-dispatcher-smoke}
Assignee: @brett
Priority: medium
Size: small
Labels: infrastructure

**Scope:** After merging the Linear-driven workflow scaffolding, run the end-to-end smoke test described in `.claude/rules/linear-workflow.md` — dispatch this placeholder feature, work it on a branch, confirm the Stop hook posts a rich Linear comment with mermaid + token-cost footer, and confirm a nightly dry run writes `docs/daily-standup.md`.

**Acceptance criteria:**
- [ ] `/dispatch-roadmap` creates a Linear ticket for this feature with the Claude Code prompt block present.
- [ ] Running Claude Code on the branch posts a session-end comment on the ticket with mermaid diagram and per-session token/cost footer.
- [ ] `node scripts/linear/nightly-sync.mjs --dry-run --cycles 0` writes `docs/daily-standup.md` with at least one ticket referenced.
- [ ] Delete this feature after the smoke test passes (or move it to the Shipped section).

**Files likely touched:** `ROADMAP.md`, `docs/daily-standup.md`

## Epic: Multi-agent orchestration {#epic-multi-agent-orchestration}
Status: planned
Linear project: auto

The visual workflow builder already exists. Flow Engine supports 6 node types, cycles, HITL, and subflows; edges already carry `delegates | reports | collaborates` semantics; `@xyflow/react` powers the Agent Teams canvas tab in `Deployments.tsx`. This epic is about **reconstructing and polishing** what is there so multi-agent flows feel like a product, not a prototype.

### Feature: Canvas edge-semantics pass {#feature-canvas-edge-semantics}
Assignee: @brett
Priority: medium
Size: small
Labels: improvement

**Scope:** The three edge types (`delegates`, `reports`, `collaborates`) already exist in `flowEngine.ts` but are visually indistinguishable on the canvas and the execution differences are undocumented in-UI. Give each type a distinct visual affordance (color / arrow style / label), add a hover tooltip explaining what the edge does at runtime, and confirm `executeStep` actually honors each type end-to-end.

**Acceptance criteria:**
- [ ] Each edge type renders with a visually distinct style on the canvas.
- [ ] Hover tooltip on any edge explains runtime behavior in one sentence.
- [ ] A small integration test covers all three edge-type paths through `FlowEngine.executeStep`.
- [ ] If any edge type is a no-op in execution today, it is either wired up or removed from the type union.

**Files likely touched:** `jarble-api-main/src/services/flowEngine.ts`, `Jarble-mvp/views/Deployments.tsx`, edge component files under `Jarble-mvp/components/flow/` (if present)

### Feature: Agent Teams canvas UX polish {#feature-agent-teams-canvas-polish}
Assignee: @brett
Priority: medium
Size: medium
Labels: improvement

**Scope:** The Agent Teams tab in `Deployments.tsx` is functional but rough. Upgrade the node visuals to show per-node runtime + model + delegation capability at a glance, add inline per-node test-run, and render the last execution's step status as an overlay on each node.

**Acceptance criteria:**
- [ ] Each deployment node shows runtime icon, model name, and whether `canDelegate` is on.
- [ ] A "test this node" action runs the node in isolation and shows the result inline.
- [ ] After a flow run, each node carries a status badge (ok / error / skipped) until the next run.
- [ ] No regressions in the existing `generateFromPrompt` LLM-to-flow feature.

**Files likely touched:** `Jarble-mvp/views/Deployments.tsx`, custom node components under `Jarble-mvp/components/flow/`, `jarble-api-main/src/trpc/routers/flows.ts`

### Feature: Workflow save + share within an organization {#feature-workflow-org-sharing}
Assignee: @brett
Priority: medium
Size: medium
Labels: feature

**Scope:** Flows today are scoped per-user. To ship the org-collaboration story, flows need org ownership, per-org listing, permission checks aligned with the `org` router (owner / admin / member), and an in-UI share action that adds a flow to an org so teammates can open, fork, and run it.

**Acceptance criteria:**
- [ ] `flows` table has an optional `orgId` (mirrors the `deployments.orgId` pattern).
- [ ] `flows.list` returns flows the caller can see through personal OR org membership.
- [ ] `flows.create` / `flows.update` accept `orgId` and enforce membership.
- [ ] Canvas UI shows a share action that moves a personal flow into the active org.
- [ ] Forking a shared flow creates a new owned copy without mutating the original.

**Files likely touched:** `jarble-api-main/src/trpc/routers/flows.ts`, `jarble-api-main/src/db/schema.pg.ts` (+ new SQL migration in `drizzle-pg/`), `Jarble-mvp/views/Deployments.tsx`, `Jarble-mvp/context/OrgContext.tsx`

## Epic: Runtime-agnostic core {#epic-runtime-agnostic-core}
Status: planned
Linear project: auto

OpenClaw is the only runtime shipping at launch. `zeroclaw.ts` lives in the repo as a post-launch target and gives a limited check of the current handler boundary, but the contract between it and OpenClaw is informal (duck-typed), and the API + frontend still hard-code OpenClaw assumptions in several places (SSE event shape, config schema, wizard steps). This epic formalizes the handler contract and routes every runtime-specific code path through it so that when zeroclaw (or any other runtime) is eventually brought online, onboarding is config + handler, not a surgery tour.

### Feature: Formalize the RuntimeHandler interface {#feature-runtime-handler-interface}
Assignee: @brett
Priority: high
Size: medium
Labels: infrastructure

**Scope:** Extract a typed `RuntimeHandler` interface from what `openclaw.ts` and `zeroclaw.ts` already do: `renderConfigs`, `getSecretEntries`, `parseConfig`, `handleChat`, `syncToPod`, plus whatever other methods both currently expose. Make both handlers explicitly conform. Then pick one API call site (e.g. config sync) and route it through the interface instead of branching by runtime name.

**Acceptance criteria:**
- [ ] `jarble-api-main/src/runtimes/types.ts` defines a typed `RuntimeHandler` interface.
- [ ] `openclaw.ts` and `zeroclaw.ts` both export instances that satisfy the interface at compile time (no `any`).
- [ ] At least one API call site (e.g. the config sync path) looks up the handler by runtime slug and calls it through the interface.
- [ ] Existing tests still pass; a small new test confirms both handlers conform.

**Files likely touched:** `jarble-api-main/src/runtimes/handlers/openclaw.ts`, `jarble-api-main/src/runtimes/handlers/zeroclaw.ts`, new `jarble-api-main/src/runtimes/types.ts`, `jarble-api-main/src/runtimes/registry.ts` (if present, else create)

### Feature: Audit OpenClaw leaks in the API layer {#feature-audit-openclaw-leaks}
Assignee: @brett
Priority: high
Size: medium
Labels: improvement

**Scope:** Grep the API for anywhere `openclaw` or OpenClaw-shaped assumptions appear outside the handler itself (examples: `tamboAgent.ts` SSE event naming, `openrouter.ts` provider-env-map specific to OpenClaw, `platformCredentials.ts` credential-key expectations, `wizardStepConfig.ts` step list). For each leak, either route through the `RuntimeHandler` interface, move the logic into the handler, or document why it is legitimately OpenClaw-specific and cannot be generalized.

**Acceptance criteria:**
- [ ] A list of every `openclaw`-referencing line in `jarble-api-main/src/` outside `runtimes/handlers/` is produced as the PR description.
- [ ] Each leak is one of: routed via the handler interface, moved into the handler, or annotated with a TODO(runtime-core) comment explaining why it is OpenClaw-specific.
- [ ] Typecheck and test suites pass.
- [ ] A minimal in-repo test validates that the runtime-handler lookup routes a representative config path correctly through the interface (no OpenClaw short-circuit).

**Files likely touched:** `jarble-api-main/src/routes/tamboAgent.ts`, `jarble-api-main/src/trpc/routers/openrouter.ts`, `jarble-api-main/src/trpc/routers/platformCredentials.ts`, `jarble-api-main/src/runtimes/handlers/*`, plus whatever the grep surfaces

### Feature: Frontend runtime-awareness pass {#feature-frontend-runtime-awareness}
Assignee: @brett
Priority: medium
Size: medium
Labels: improvement

**Scope:** The onboarding wizard, deployment configuration sidebar, and chat UI all assume OpenClaw-shape config and events today. Read each runtime's declared capabilities (from a tRPC `runtimeCatalog` response that reflects the new handler interface) and render the UI accordingly. Example: if a runtime does not declare support for `messagingPlatforms`, the wizard skips platform steps instead of showing an empty Discord tab.

**Acceptance criteria:**
- [ ] `runtimeCatalog.list` returns a capability descriptor per runtime (messaging platforms supported, LLM providers supported, config schema).
- [ ] `OnboardingWizard.tsx` reads the descriptor and omits or adjusts steps that the selected runtime does not support.
- [ ] `DeploymentConfiguration.tsx` does the same for the config sidebar tabs.
- [ ] Chat UI tolerates runtimes whose SSE event set does not include OpenClaw-specific events (e.g. `REASONING_START` / `REASONING_END`) without visual glitches.

**Files likely touched:** `jarble-api-main/src/trpc/routers/runtimeCatalog.ts`, `Jarble-mvp/views/onboarding/OnboardingWizard.tsx`, `Jarble-mvp/views/onboarding/wizardStepConfig.ts`, `Jarble-mvp/components/deployment/DeploymentConfiguration.tsx`, `Jarble-mvp/hooks/useCanvasChat.ts`

---

## Launch Milestone

Public launch happens when Phase 2 is shipped. The gate:

- [ ] Multi-agent workflows run end-to-end on the canvas with delegation, collaboration, and reporting semantics.
- [ ] Workflows can be saved and shared within an organization.
- [ ] Observability is live (pod health, API error budget, per-deployment metrics).
- [ ] Public docs site, pricing page, and marketing site are up.
- [ ] Onboarding flow has been run end-to-end by someone outside the core team without intervention.

---

## Phase 3 — Agentic Runtime Marketplace _(post-launch)_

**Goal:** Builders publish, discover, and fork agent-layer assets. Both sides of the marketplace start transacting.

No active epics yet. Candidate epics to scope after launch:

- **Runtime-agnostic asset publishing** — skills, sub-agents, workflow templates that work across runtimes.
- **Runtime-specific asset publishing** — cloned versions of agentic runtimes (sensitive or personal data stripped).
- **Marketplace browse + install flow** — category navigation, one-click install, deployment-scoped vs account-scoped installs.
- **Builder earnings** — payout rails, revenue share on deployments, Stripe Connect integration.
- **Trust and safety** — review + reputation, takedown flow, provenance on forks.

---

## Phase 4 — Agentic Runtime Benchmarking _(post-launch)_

**Goal:** Every runtime on the platform is continuously scored and comparable, regardless of underlying framework.

No active epics yet. Candidate epics to scope after launch:

- **Benchmark task authoring** — categorized workloads for reasoning, tool-use, speed, cost-efficiency.
- **Continuous scoring pipeline** — ingestion, isolation, reproducibility, storage of run history.
- **Competitive analysis UI** — side-by-side runtime comparison, cost/perf curves, regression detection.
- **Workflow-level benchmarks** — agent communication efficiency, task coverage, end-to-end latency across multi-agent flows.

---

## Shipped

_Move finished features here to keep the active phases tidy._

<!-- JAR-95 smoke test touch 2026-04-18 -->
