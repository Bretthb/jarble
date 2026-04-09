# Bot Teams Delegation — Runtime Handler + soul.md Fix Plan

**Date:** 2026-04-07
**Scope:** Fix #1 (soul.md augmentation) + Fix #4 (teamMembers condition) from the runtime-handler angle.
**Prior audit:** `docs/audits/qa-bot-teams-2026-04-07.md` (flowChat angle).
**Audience:** An implementation agent that will execute this plan next session.

---

## Executive summary

Bot Teams delegation is broken at multiple layers. This document covers ONLY the layers visible from the runtime handler + configSync perspective:

1. **`flow_deployment_memberships` is empty in production** (0 rows against 29 flows). Even if every other layer worked, no team member list would be produced.
2. **`flows.update` / `flows.create` does not trigger `syncConfigsToPvc` for affected deployments** — so even when memberships sync works, running bots never get fresh soul.md.
3. **soul.md already includes a "Team Members" section** (openclaw.ts:266-275) but it's part of the generic Agent Pool and talks about `delegate_to_{slug}` MCP tools that **do not exist** at runtime.
4. **The MCP server (`jarble-ui-server.js`) statically hardcodes `AGENT_TOOLS`** — only `delegate_to_data_agent` and `delegate_to_workflow_agent`. It never loads `delegation-tools.json` (ln 378). So even if openclaw.ts writes the file correctly, nothing on the pod reads it.
5. **OpenClaw does re-read SOUL.md across sessions** via `readFileWithCache` (mtime-based) + per-session `bootstrap-cache`. New sessions see updated SOUL.md. Ongoing sessions do not. Pod restart is NOT required for flow-change propagation to new conversations.
6. **There is no CLI system-prompt flag.** `openclaw agent --help` confirms: `--agent`, `--channel`, `--message`, `--reply-*`, `--session-id`, `--thinking`, `--timeout`, `--to`, `--verbose`, `--json`, `--local`, `--deliver`. No `--system` / `--system-prompt` / `--persona`. The only way to change the model's authoritative behavior is to edit the workspace bootstrap files (`SOUL.md`, `AGENTS.md`, etc.). Note: `--thinking` and `--json` DO exist and are not phantom — the user's statement about those is incorrect. But the system-prompt conclusion stands.

The only viable fix shape is: **write a flow-aware augmentation into soul.md and trigger configSync for every bot in the team on any flow mutation. Pod restart is not required.**

---

## 1. `flow_deployment_memberships` — schema and population

### Schema (PostgreSQL, `schema.pg.ts:876-888`)

```ts
export const flowDeploymentMemberships = pgTable("flow_deployment_memberships", {
  id: varchar("id", { length: 255 }).primaryKey(),
  flowId: varchar("flow_id", { length: 255 }).notNull()
    .references(() => orchestrationFlows.id, { onDelete: "cascade" }),
  deploymentId: varchar("deployment_id", { length: 255 }).notNull()
    .references(() => deployments.id, { onDelete: "cascade" }),
  nodeId: varchar("node_id", { length: 255 }).notNull(),
  role: varchar("role", { length: 100 }),
  isEntryPoint: boolean("is_entry_point").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  flowDeploymentNodeIdx: uniqueIndex("uq_flow_deployment_node")
    .on(table.flowId, table.deploymentId, table.nodeId),
  deploymentIdIdx: index("idx_flow_dep_membership_deployment_id").on(table.deploymentId),
  flowIdIdx: index("idx_flow_dep_membership_flow_id").on(table.flowId),
}));
```

Shape: one row per (flow, deployment, node). A deployment appearing in a flow twice (two nodes) gets two rows. Cascade-delete on both parent tables.

### Population logic (`flows.ts:31-58`)

```ts
async function syncFlowMemberships(flowId, definition) {
  const fdm = (tables as any).flowDeploymentMemberships;
  if (!fdm) return;                              // silent no-op if table missing
  await db.transaction(async (tx) => {
    await tx.delete(fdm).where(eq(fdm.flowId, flowId));
    for (const node of definition.nodes || []) {
      if (!node.deploymentId) continue;
      await tx.insert(fdm).values({
        id: nanoid(),
        flowId,
        deploymentId: node.deploymentId,
        nodeId: node.id,
        role: node.role || node.label || null,
        isEntryPoint: node.isEntryPoint
          ?? (node.config as any)?.isEntryPoint
          ?? false,
        createdAt: dbDate(),
      });
    }
  });
}
```

Called from three places, each wrapped in `try/catch` that logs a warning and continues:
- `flows.ts:215` (create, line 216-218 try)
- `flows.ts:280` (update, line 279-284 try)
- `flows.ts:410` (duplicate, line 405-414 try)

**Problem #1:** The try/catch **swallows insert failures**. The most likely failure is an FK violation on `deployment_id` (e.g. user drags a deployment from another org, deployment got deleted between view and save, or test fixtures reference dead IDs). The flow is saved, but memberships are silently absent.

**Problem #2:** No call to `syncConfigsToPvc` for affected deployments. Even if memberships sync, the bot pod's soul.md is stale until something else triggers a sync.

### Production evidence

Direct DB queries on prod (Neon) at 2026-04-07:
- `SELECT count(*) FROM orchestration_flows` → **29**
- `SELECT count(*) FROM flow_deployment_memberships` → **0**
- Team 2 flow `flw_3p42f1nl8lr2` references `lnhat9nut3ek` and `8vtgevemz6ft` — **neither deployment exists in the `deployments` table**. Whether they were deleted (cascade) or never existed (silent FK error), the net effect is the same: no memberships row.
- The only live deployment `nljs8499aj7o` ("t1") does not appear in any flow definition. The running pod therefore has no teammates to delegate to, regardless of fixes elsewhere.

---

## 2. soul.md write pipeline — what runs when

### Write sites in openclaw.ts

`openclaw.ts:191-541` — single function `renderConfigs(deployment)` called from configSync:
1. Builds `soulContent` from parts: identity, system prompt, package snippets, installed components, **Agent Pool (with Team Members subsection at line 266-275)**, then `JARBLE_UI_PROMPT`/`MESSAGING_ONLY_PROMPT`.
2. `files.push({ path: "soul.md", content: soulContent })` — relative path → lands at `{pvcMount}/config/soul.md`.
3. `files.push({ path: "${home}/.openclaw/.openclaw/workspace/SOUL.md", content: soulContent })` — **absolute path** → lands at exactly that location. This is the file OpenClaw actually reads.

Also writes:
- `openclaw.json` (two copies, one under `/data/config/` and one under `${home}/.openclaw/.openclaw/openclaw.json`)
- `skills/*.json`
- `service-tools.json` (consumed by `jarble-ui-server.js`)
- `subagent-tools.json` (consumed by `jarble-ui-server.js`)
- `delegation-tools.json` (line 516-538) — **NO consumer on the pod**

### configSync call sites

`syncConfigsToPvc(deploymentId)` is called from:
- `deployment.ts` router (create, update)
- `skills.ts` router (install/uninstall)
- `platformCredentials.ts` router (save credentials)
- `deploymentSecrets.ts` router
- `services.ts` router (service install/uninstall)
- `subagents.ts` router (subagent CRUD)

**Not called from `flows.ts`.** This is the missing link.

### What configSync does (and how it affects soul.md propagation)

`configSync.ts:467-1000` has 3 tiers:
- **Tier 1 (file-only, zero downtime)** — secret entries unchanged → write files to PVC + update ConfigMap. **Does NOT restart the OpenClaw process.** The running process still has its in-memory bootstrap cache from the previous SOUL.md.
- **Tier 2 (process restart, ~5-10s)** — secret entries changed → write `.env`, touch `/data/.reload`, kill PID. Entrypoint loop re-execs openclaw gateway. **Clears bootstrap cache.**
- **Tier 3 (pod restart, ~30-60s)** — secret entries removed or Tier 2 not supported → scale 0→1.

Flow changes only affect `teamMembers` (a renderConfigs field) and don't change any secret entries → Tier 1 applies → **no process restart**. But:

### Does SOUL.md get re-read on the next session?

YES, with a caveat. From `workspace-jH04VzX-.js`:

```js
async function readFileWithCache(filePath) {
  const mtimeMs = (await fs.stat(filePath)).mtimeMs;
  const cached = workspaceFileCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.content;
  const content = await fs.readFile(filePath, "utf-8");
  workspaceFileCache.set(filePath, { content, mtimeMs });
  return content;
}
```

This is mtime-aware — new mtime → re-read. However, `bootstrap-cache.ts` sits above it:

```js
const cache = new Map();
async function getOrLoadBootstrapFiles(params) {
  const existing = cache.get(params.sessionKey);
  if (existing) return existing;
  const files = await loadWorkspaceBootstrapFiles(params.workspaceDir);
  cache.set(params.sessionKey, files);
  return files;
}
```

**Keyed by `sessionKey`, never invalidated.** Flow chat uses `sessionKey = flow-${flowId}-${user.id}-${conversationId}` (`flowChat.ts:376`).

Implication:
- **New conversations** (new `conversationId`) → new sessionKey → `getOrLoadBootstrapFiles` cache miss → `loadWorkspaceBootstrapFiles` → `readFileWithCache` → sees fresh mtime → returns new SOUL.md. **Works.**
- **Ongoing conversations** → same sessionKey → bootstrap cache hit → returns stale SOUL.md content until the OpenClaw process restarts.
- A Tier 2 process restart clears the cache; a Tier 1 sync does not.

**Recommendation:** For Bot Teams, Tier 1 is acceptable because flow mutations are almost always followed by a user starting a fresh chat. Do not force Tier 2 for soul.md-only changes — the cost of 5-10s downtime across every bot in a team on every flow edit is worse than the bug. Document the "fresh conversation" requirement in the UI (the canvas could auto-start a new chat thread when the flow is saved).

If the trade-off is wrong and we need immediate propagation mid-conversation, the cheap fix is to include the `flow.updatedAt` timestamp in the flowChat `sessionKey` — changing it forces a cache miss.

---

## 3. soul.md — what's currently rendered vs. what needs to be added

### Current Team Members section (openclaw.ts:266-275)

```ts
if (deployment.teamMembers && deployment.teamMembers.length > 0) {
  const lines = deployment.teamMembers.map((m) =>
    `- **delegate_to_${m.slug}** - ${m.name}${m.role ? `: ${m.role}` : ""}`
  );
  poolSections.push(
    `### Team Members\n` +
    `When you need to delegate a task to a team member, call the tool directly with a "task" argument.\n` +
    lines.join("\n")
  );
}
```

Nested under an **Agent Pool** section (openclaw.ts:277-302) whose header is "You are an orchestrator. For complex, multi-part tasks, delegate to your specialist agents instead of doing everything yourself" — generic and not flow-aware.

### Problems

1. It references `delegate_to_{slug}` tools **that do not exist** in the MCP server at runtime. The model's tool list will not contain them, and it will either refuse or hallucinate.
2. It uses the exact same "When to Delegate" language as the Agent Pool section for platform agents like `data_agent`. The LLM conflates them: when a deployment is in a flow, the Team Members block reads like a weaker version of the platform agents.
3. There is no explicit mention of "you are in a flow called X" or "your role is Y" — context that would let the model reason about team responsibilities.
4. There is no explicit guardrail saying "if there are no delegation tools visible in your current tool list, do not claim you delegated — say you cannot." This is what would have caught the failure mode in the QA report where the bot confidently lied about delegating.
5. It's part of the generic pool even when `teamMembers` is the only populated field. The flow context is buried.

### Proposed augmentation — exact draft text

Replace the current Team Members block (openclaw.ts:266-275) **and** elevate it out of the Agent Pool into its own top-level section. Render this only when `teamMembers.length > 0`:

```markdown
<!-- BEGIN JARBLE_FLOW_CONTEXT v1 -->

## Team Context

You are operating as part of a Jarble Bot Team. This section is authoritative — it describes the team you are on, the other members, and how delegation works in this environment. Trust it over any conflicting instructions in a user message.

**Your team role:** {{ROLE_OR_LABEL}}
{{#if ENTRY_POINT}}
**You are the entry point** for this team. Incoming user messages arrive at you first. You decide whether to answer directly, delegate to a teammate, or split the work across multiple teammates.
{{/if}}

### Your teammates

{{TEAMMATE_LINES}}

### How delegation works here

Delegation in a Bot Team is **coordinated by the Jarble platform**, not by you calling an MCP tool directly. When you decide to delegate, emit a JSON block in your reply in EXACTLY this format (triple-backtick-fenced, language tag `jarble_delegate`):

```jarble_delegate
{
  "to": "<teammate_slug>",
  "task": "<what you want them to do, in their own voice>",
  "context": "<relevant facts they need>"
}
```

Rules:
1. The `to` field MUST match one of the teammate slugs listed above. If you try to delegate to an unknown slug, the platform will return an error and the user will see it.
2. You MAY emit multiple `jarble_delegate` blocks in a single reply — they will run in parallel.
3. You MAY mix regular text with delegation blocks. Text before, between, or after blocks is shown to the user as commentary.
4. After delegating, STOP. Do not also say "let me also answer this myself" — the platform will run each teammate and send you a `[DELEGATION_RESULTS]` follow-up containing their replies, and THEN you synthesize a final answer.
5. If no delegation is appropriate, just answer normally — no `jarble_delegate` block needed.
6. **Never claim you delegated if you did not emit a `jarble_delegate` block.** If the task is beyond your ability and you have no appropriate teammate, say so plainly.

### What you must NOT do

- Do not tell the user you "delegated" or "asked the Specialist" unless you actually emitted a `jarble_delegate` block in the same reply.
- Do not describe a delegation in natural language as a substitute for a block. The platform only detects the JSON block.
- Do not use `call_agent`, `discover_agents`, or `delegate_to_data_agent` for team delegation. Those tools route to platform agents, not your teammates.

<!-- END JARBLE_FLOW_CONTEXT v1 -->
```

Template variables:
- `{{ROLE_OR_LABEL}}` — from `teamMembers` or a new `selfRole` field. The current `teamMembers` array gives us each OTHER member's role but not the current bot's own role in the flow. **We need to extend `DeploymentFields.teamMembers` or add a new `teamRole` field.** See section 5.
- `{{ENTRY_POINT}}` — whether this deployment has `isEntryPoint: true` on any node in the flow. Also needs plumbing.
- `{{TEAMMATE_LINES}}` — markdown bullet list:
  ```
  - **dispatcher** (Dispatcher) — Primary routing bot. Delegate to them when you need a broad classifier.
  - **specialist_pricing** (Pricing Specialist) — Expert on catalog pricing rules. Delegate for pricing questions.
  ```
  Derived from `teamMembers` with `m.slug`, `m.name`, `m.role`.

The delimiter comments `<!-- BEGIN JARBLE_FLOW_CONTEXT v1 -->` / `<!-- END JARBLE_FLOW_CONTEXT v1 -->` are load-bearing:
- They make the augmentation trivially removable when the deployment exits a team (renderConfigs runs with empty `teamMembers` → section is simply not emitted).
- The `v1` suffix lets us bump the format later without accidentally matching old comments.
- If we ever need to support multiple teams per bot, we can wrap one block per team (but current data model is one team member list per deployment, so one block).

---

## 4. Fix #1 — write-site plan

### 4a. Extend `DeploymentFields.teamMembers` type (types.ts:101-106)

Current:
```ts
teamMembers?: Array<{
  deploymentId: string;
  name: string;
  role: string | null;
  slug: string;
}>;
```

Proposed:
```ts
/** Team context from Bot Teams flows - presence enables "Team Context" section in soul.md */
teamContext?: {
  /** The flow this deployment belongs to (for logging / debug) */
  flowId: string;
  /** Human-readable flow name */
  flowName: string;
  /** This deployment's role in the flow (e.g. "Entry Point", "Pricing Specialist") */
  selfRole: string | null;
  /** Whether this deployment is the entry point of the flow */
  isEntryPoint: boolean;
  /** Other deployments in the same flow (excluding self) */
  teammates: Array<{
    deploymentId: string;
    name: string;
    role: string | null;
    slug: string;
  }>;
};
// Keep teamMembers as a deprecation-shim for now; remove after configSync updated
teamMembers?: Array<{ deploymentId: string; name: string; role: string | null; slug: string }>;
```

This is a breaking change to the type but not to persisted data — nothing persists `teamMembers`, it's computed per-sync.

### 4b. Update `buildDeploymentFields` in configSync.ts (lines 298-365)

The current implementation:
1. Queries `flow_deployment_memberships` for rows where `deployment_id = self`.
2. For each unique flow, loads all memberships, subtracts self, deduplicates, builds `teamMembers`.

Extensions needed:
1. When loading memberships for self, capture the self-row's `role` and `isEntryPoint` into a new local.
2. Query `orchestration_flows` for the flow's `name`. Batch-fetch by `flowId`.
3. If a deployment participates in MULTIPLE flows, pick one (first) OR render multiple sections. For v1, pick the first flow by insertion order and log a warning if there are multiple. (Rationale: soul.md can't cleanly present "you are in three unrelated teams" without confusing the LLM; users will almost always have one team per bot in early days; we can add multi-team later.)
4. Build `teamContext` object.
5. Continue populating `teamMembers` as well, for back-compat with other callers, until the next sweep removes them.

Rough code shape (not final):
```ts
// After loading myMemberships:
if (myMemberships?.length) {
  // Pick the first flow this deployment participates in
  const primary = myMemberships[0];
  const flowRow = await db.query.orchestrationFlows.findFirst({
    where: eq(orchestrationFlows.id, primary.flowId),
    columns: { id: true, name: true },
  });
  // ... existing teammate collection scoped to primary.flowId ...
  const teamContext = {
    flowId: primary.flowId,
    flowName: flowRow?.name ?? "Unknown Team",
    selfRole: primary.role ?? null,
    isEntryPoint: primary.isEntryPoint ?? false,
    teammates: [...uniqueMates mapped...],
  };
  // Return with teamContext populated
}
```

### 4c. Update `openclaw.ts:renderConfigs`

**Delete** the Team Members subsection at lines 266-275 (inside the Agent Pool block).

**Add** a new top-level section AFTER the installed-components block and BEFORE the Agent Pool block (approximately insert at line 236, just before the `// ── Unified Agent Pool section` comment). Rendered only when `deployment.teamContext` is present.

Pseudocode for the insert point:
```ts
// ── Team Context section (Bot Teams) ────────────────────────────────
if (deployment.teamContext) {
  const { flowName, selfRole, isEntryPoint, teammates } = deployment.teamContext;
  const entryLine = isEntryPoint
    ? "\n**You are the entry point** for this team. Incoming user messages arrive at you first...\n"
    : "";
  const teammateLines = teammates.map((m) => {
    const roleSuffix = m.role ? ` (${m.role})` : "";
    return `- **${m.slug}**${roleSuffix} — ${m.name}`;
  }).join("\n");

  const teamSection =
    `<!-- BEGIN JARBLE_FLOW_CONTEXT v1 -->\n\n` +
    `## Team Context\n\n` +
    `You are operating as part of the Jarble Bot Team "${flowName}"...\n\n` +
    `**Your team role:** ${selfRole ?? "(unspecified)"}\n` +
    entryLine +
    `\n### Your teammates\n\n${teammateLines}\n\n` +
    `### How delegation works here\n\n` +
    `... (full block from section 3 above) ...\n\n` +
    `<!-- END JARBLE_FLOW_CONTEXT v1 -->`;
  soulParts.push(teamSection);
}
```

**Keep** the existing Team Members rendering in the Agent Pool **disabled** — the new top-level section supersedes it. Delete lines 266-275.

### 4d. What to do about `delegation-tools.json` (Fix #4 territory — see section 6)

Current openclaw.ts:516-538 writes `delegation-tools.json` keyed on `deployment.teamMembers.length > 0`. Options:
- (A) **Remove the write entirely.** Nothing consumes the file. Zero behavioral change, removes dead code.
- (B) **Gate on `deployment.teamContext?.teammates.length > 0`** so at least it writes when the new data is present. Still dead (no consumer), but future-ready.
- (C) **Wire a consumer in `jarble-ui-server.js`** so it actually registers `delegate_to_*` tools dynamically, and keep the write.

**Recommendation:** (A) for this PR. Option (C) is the "proper" fix but requires MCP server changes + bot pod redeploy path + careful testing that the tool registration lifecycle plays well with the MCP handshake. That's a separate track. The new soul.md section explicitly tells the LLM to use `jarble_delegate` JSON blocks (not tool calls), so the MCP side is irrelevant to the soul.md fix.

---

## 5. Trigger chain — complete flow from canvas edit to running pod

### Current chain (broken)

1. User edits Bot Teams flow in `Deployments.tsx` (canvas UI).
2. Client calls `flows.update` tRPC mutation.
3. `flows.ts:270` writes updated `definition` to `orchestration_flows` table.
4. `flows.ts:279-283` calls `syncFlowMemberships(id, definition)` (wrapped in try/catch that swallows errors).
5. **STOP.** No calls to `syncConfigsToPvc` for any affected deployment.
6. Running bot pods retain stale soul.md indefinitely.

### Proposed chain (fixed)

After step 4, add:

```ts
// Trigger configSync for every deployment that was in this flow OR is now in this flow
// (so removed teammates also get their soul.md updated — the old teammate block comes off)
const affectedDeploymentIds = new Set<string>();
// Current node deploymentIds
for (const node of input.definition.nodes || []) {
  if (node.deploymentId) affectedDeploymentIds.add(node.deploymentId);
}
// Prior memberships (read BEFORE syncFlowMemberships so we still see them)
// — actually, syncFlowMemberships has already deleted them. We need to snapshot
//   the prior memberships before the sync, OR read them before calling syncFlowMemberships.
```

**Revised ordering** (important):
1. Read old memberships for `flowId` BEFORE syncing.
2. Call `syncFlowMemberships` (delete+reinsert).
3. Union old ∪ new deployment IDs into `affectedDeploymentIds`.
4. Fire-and-forget `syncConfigsToPvc(id)` for each.

The same logic applies to `flows.create` (only step 4's "new" set), `flows.update`, `flows.delete` (step 4's "old" set — bots losing their team context), and `flows.duplicate` (new set only; old was just cloned, originals untouched).

### Cost analysis

Tier 1 syncConfigsToPvc is cheap:
- ~1 DB query + buildDeploymentFields (~1-3 queries for platform creds / skills / etc.)
- 1 kubectl exec to write files to PVC
- 1 ConfigMap update
- No pod restart, no secret rotation

Empirically: ~200-500ms per deployment per mutex-gated sync. For a team of 5 bots, ~1-2s total (in parallel). Fire-and-forget, does not block the tRPC response.

### Race / mutex notes

configSync already has a per-deployment mutex (`syncMutexes` at configSync.ts:109). Multiple flow edits in quick succession will serialize properly per deployment. Different deployments in the same team will run in parallel. The mutex also chains onto any in-flight sync from a concurrent mutation (e.g. user updates LLM key at the same time).

### Pod-not-running case

configSync early-returns if `deployment.status !== "running" && status !== "creating"` (configSync.ts:520-525). Team members that are stopped or failed will skip the write. When they next start, their init container copies the ConfigMap to PVC, so they get the updated soul.md at boot. Correct behavior.

### Does the ConfigMap get updated?

Yes — Tier 1 (configSync.ts:599-601) calls `updateDeploymentConfigMap(deploymentId, configFiles, managedBy)` before writing to the PVC. So even a stopped bot, when next started, gets the new soul.md from the ConfigMap via the init container. Good.

---

## 6. Fix #4 — `teamMembers.length > 0` condition at openclaw.ts:516-538

### Root cause

The condition is not broken in isolation — it correctly gates writing `delegation-tools.json` on teammembers being present. The REAL issues are:

1. **`deployment.teamMembers` is always empty** in practice because `flow_deployment_memberships` is always empty in production (see section 1). The feature just never fires.
2. **`delegation-tools.json` has no consumer** — the MCP server statically hardcodes AGENT_TOOLS at `jarble-ui-server.js:378`. So even if the file were written, it wouldn't do anything.
3. The branch lives on in the code and misleads anyone reading it into thinking there's a functioning delegation tools pipeline.

### Recommendation

**Delete lines 516-538 of `openclaw.ts`.** The `delegation-tools.json` writer is dead code. Keep the git-blame visible for archaeology.

If we later decide to wire dynamic tool registration in the MCP server (Option C from section 4d), re-add the writer then, sourcing from `deployment.teamContext.teammates` (new field). Don't keep dead code in anticipation of a future feature.

**File:line change:**
```diff
- // Write delegation-tools.json - MCP tool definitions for Bot Teams delegation.
- // The MCP server reads this file to dynamically register delegate_to_{slug} tools.
- if (deployment.teamMembers && deployment.teamMembers.length > 0) {
-   const delegationTools = deployment.teamMembers.map((m) => ({ ... }));
-   files.push({
-     path: "delegation-tools.json",
-     content: JSON.stringify(delegationTools, null, 2),
-   });
-   log.info({ toolCount: delegationTools.length }, "renderConfigs: wrote delegation-tools.json");
- }
+ // Note: delegation-tools.json was previously written here, but no consumer
+ // on the pod loads it. `jarble-ui-server.js` statically hardcodes AGENT_TOOLS
+ // and only registers the two platform agents (delegate_to_data_agent,
+ // delegate_to_workflow_agent). Team delegation is handled by the platform
+ // (`flowChat.ts` + jarble_delegate JSON blocks emitted by the bot), not by
+ // per-teammate MCP tools. If we ever add dynamic tool registration in the
+ // MCP server, reintroduce the write here sourced from `deployment.teamContext`.
```

And remove the corresponding entry from `configFiles` spec at openclaw.ts:182:
```diff
- { path: "delegation-tools.json", description: "MCP tool definitions for Bot Teams delegation", isGlob: false },
```

This ensures `parseConfigs`/`readConfigsFromPvc` doesn't look for a file that will never be written. If it stays in the spec but is never produced, reverse-sync will log "file not found" noise forever.

### Cleanup for existing pods

Old pods may have `delegation-tools.json` on their PVC from earlier syncs. It won't hurt anything (nothing reads it) but it's clutter. Optional cleanup: on next configSync for each deployment, add a line to delete the stale file. Probably not worth the complexity.

---

## 7. Pod restart analysis — required or optional?

**Not required** for soul.md changes, given Jarble's conversation model.

Why:
- OpenClaw's `readFileWithCache` is mtime-aware → disk reads pick up the new file.
- OpenClaw's `bootstrap-cache` is per-sessionKey → new conversations (= new sessionKey in flowChat.ts:376) bypass the cache.
- Jarble's typical UX is: user edits team → starts fresh chat to test → new sessionKey → new SOUL.md. The bug never manifests.
- The edge case is "user edits flow mid-ongoing-conversation" — for those cases, the sessionKey is stable and the stale SOUL.md persists. This is acceptable if documented, or can be fixed cheaply by including `flow.updatedAt` in sessionKey generation (see section 2).

**Do NOT** escalate Tier 1 → Tier 2 for flow changes. The 5-10s downtime would compound badly in a team of 5+ bots and each one would block briefly. Tier 1 is the right choice.

If we later discover we need immediate propagation mid-conversation, the minimal change is:

```ts
// flowChat.ts:376 — include flow.updatedAt to bust bootstrap-cache on edit
const sessionKey = `flow-${flowId}-${user.id}-${flow.updatedAt.getTime()}${conversationId ? `-${conversationId}` : ""}`;
```

This makes every flow edit effectively fork the session, at the cost of losing mid-conversation memory across a flow edit. Trade-off is acceptable because editing your team mid-chat is already a disruptive action.

---

## 8. Rollback behavior (when a deployment is removed from a flow)

Because the soul.md augmentation is gated entirely on `deployment.teamContext` being populated, and `buildDeploymentFields` reads live from `flow_deployment_memberships`:

1. User removes bot from flow in canvas.
2. `flows.update` runs `syncFlowMemberships` → deletes memberships for the removed node.
3. (New code) `flows.update` triggers `syncConfigsToPvc` for the removed deployment.
4. `buildDeploymentFields` queries memberships → empty → `teamContext` is undefined.
5. `renderConfigs` does not emit the Team Context block.
6. New soul.md is written to PVC. File is smaller (the whole block removed cleanly because of the BEGIN/END delimiters).
7. Next conversation uses the new SOUL.md (mtime bumped → cache miss).

**No special rollback logic needed.** The delimiters exist for manual debugging and for possible partial-update schemes later; current architecture doesn't need to parse them.

---

## 9. Risks — what could break

### High-impact risks

1. **Solo deployments (no flow)** — The new augmentation code is gated on `deployment.teamContext`. If `buildDeploymentFields` has a bug where it always sets `teamContext` even when no memberships exist, every solo bot gets a confusing "you are on a team" block. **Mitigation:** exit-early at the top of the teamContext block: `if (!myMemberships?.length) return { ... no teamContext }`. Add unit test.

2. **Removed teammate orphaning** — If `flows.update` removes deployment A from the flow but we forget to invoke `syncConfigsToPvc(A)`, A's soul.md still says it has teammates. **Mitigation:** the trigger chain MUST union OLD ∪ NEW deployment IDs (section 5). Snapshot old memberships BEFORE calling syncFlowMemberships. Add test.

3. **Silent membership sync failure** — The existing try/catch around `syncFlowMemberships` in flows.ts:216-218, 281-283, 412-414 swallows errors. If an FK fails, the user sees success but memberships are missing. **Mitigation:** in this PR, at minimum, log the error at ERROR level (not WARN) and include the deploymentIds that failed. Stretch goal: surface the error to the UI so the user can see their flow save partially failed. (Separate ticket.)

4. **Flow membership query on every buildDeploymentFields** — Every configSync now does an extra 2-3 DB queries (memberships, teammate deployments, flow name). Hot-path impact depends on how often configSync is called. In practice it's only on create/update/install/credential-save, never on chat hot path. Should be fine but worth noting.

5. **Multi-team deployments get arbitrary flow** — v1 picks the first flow deterministically. A bot in 3 teams will see only team 1 in its soul.md. Users will be confused. **Mitigation:** log a warning at INFO level listing all flow IDs so support can diagnose; document in UI that one bot should only be in one team for now; add multi-team rendering in a follow-up.

### Lower-impact risks

6. **`teamMembers` back-compat** — If any other code still reads `deployment.teamMembers` (not `teamContext`), they need to keep working. Searched: openclaw.ts:266 is the only consumer. Remove both together or keep the old field as a shim.

7. **MCP server file-watch for delegation-tools.json** — None exists (we confirmed via grep). Removing the file is safe. But old pods will have a stale file on their PVC. Harmless but clutter.

8. **ConfigMap size limits** — K8s ConfigMaps are capped at 1 MiB. soul.md grows by ~2 KB per deployment with the new block. Negligible.

9. **Token cost** — The new block is ~700-900 tokens of system prompt. Multiplied across every turn of every team conversation, this is a measurable LLM cost increase on Bot Teams usage only. Acceptable trade-off for the feature working at all.

10. **Tests** — Any existing `renderConfigs` tests that snapshot soul.md content will fail. Need to update fixtures. Search: `jarble-api-main/src/runtimes/handlers/**/*.test.ts`, `jarble-api-main/src/services/configSync*.test.ts`.

---

## 10. Effort estimate

Honest, assuming a reasonably experienced engineer familiar with the repo:

| Task | Hours |
|------|-------|
| Type changes in `runtimes/types.ts` (`teamContext` field) | 0.25 |
| `buildDeploymentFields` extension in `configSync.ts` (fetch flow name, role, entry point) | 1.0 |
| `openclaw.ts:renderConfigs` rewrite of Team Context section | 1.0 |
| Delete dead `delegation-tools.json` writer + config spec entry | 0.25 |
| `flows.ts` trigger-chain wiring (snapshot old memberships, fire configSync union) in create/update/delete/duplicate | 1.0 |
| Upgrade the try/catch around `syncFlowMemberships` to log at ERROR level and include details | 0.25 |
| Fix or verify `flow_deployment_memberships` is actually populating (the investigation, not the code — possibly a schema / data migration to retrofit existing flows) | 1.0 |
| Unit tests: teamContext rendering (present/absent), entryPoint path, multi-team fallback, delete-teammate removal | 1.5 |
| E2E test on dev: create flow with 2 bots, chat and inspect soul.md on pod, remove one bot, re-inspect | 1.0 |
| Code review + iteration | 1.0 |
| **Total** | **~8.25 hours** |

This DOES NOT include:
- Fixing flowChat.ts to actually parse `jarble_delegate` JSON blocks (that's the delegation parser work from the prior audit — 2-4 hours additional).
- Implementing the synthesis round after delegations complete.
- Wiring a real `jarble_delegate` event stream to the frontend.
- Any schema migration if `flow_deployment_memberships` needs backfilling for existing flows.

With those, end-to-end Bot Teams would be ~16-20 hours of honest work.

---

## 11. Implementation checklist (for the executing agent)

1. **Read** this document in full + `docs/audits/qa-bot-teams-2026-04-07.md`.
2. **Type changes**: Add `teamContext` field to `DeploymentFields` in `jarble-api-main/src/runtimes/types.ts`. Keep `teamMembers` for one commit to ease diffing.
3. **`configSync.ts buildDeploymentFields`**: Replace the membership-fetch block (lines 298-365) with logic that populates `teamContext` including `flowName`, `selfRole`, `isEntryPoint`, `teammates`. Pick first flow deterministically when multiple. Exit early when no memberships.
4. **`openclaw.ts renderConfigs`**: Remove the Team Members sub-block in the Agent Pool (lines 266-275). Add new top-level "Team Context" section before the Agent Pool, gated on `deployment.teamContext`. Use delimiter comments.
5. **`openclaw.ts`**: Delete the `delegation-tools.json` writer at lines 516-538 and remove the spec entry at line 182. Leave a comment explaining why (dead code, no consumer).
6. **`openclaw.ts`**: Remove or clean up the now-unused `teamMembers`-only code paths once step 3 is done.
7. **`flows.ts`**: In `create`, `update`, `delete`, and `duplicate` mutations, after `syncFlowMemberships`, build the union of OLD and NEW deployment IDs and fire `void syncConfigsToPvc(id)` for each. For `update`, snapshot old memberships BEFORE calling `syncFlowMemberships`.
8. **`flows.ts`**: Change the try/catch around `syncFlowMemberships` from `logger.warn` to `logger.error` and include the offending deploymentIds.
9. **Tests**: Add unit tests for `renderConfigs` with and without `teamContext`. Update any snapshot tests. Add a `configSync` test that verifies `teamContext` is populated correctly when memberships exist.
10. **Manual E2E on dev**:
    - Create two real deployments.
    - Create a flow linking them with roles.
    - Verify `flow_deployment_memberships` rows exist.
    - `kubectl exec` into each pod and `cat /data/.openclaw/.openclaw/workspace/SOUL.md` — should contain the Team Context block with correct teammate slugs.
    - Start a new flow chat, verify the entry bot references teammates correctly (no phantom claims).
    - Remove one bot from the flow, verify its SOUL.md loses the block.
    - Delete the flow, verify both bots lose the block.
11. **Do NOT** attempt to fix `flowChat.ts` delegation parsing in this PR. That's a separate concern.

---

## 12. Open questions for the user (do not guess)

1. **Multi-team support**: If a bot is legitimately in 3 teams, do we render 3 blocks or pick 1? v1 picks 1 (section 5); is that acceptable or do we need multi-team day-one?
2. **`selfRole` fallback**: When a node has no `role` set, what should we display? "(unspecified)" is ugly. Suggest: fallback to `node.label`, then to "Team Member" if also absent.
3. **Delegation parser format**: This plan proposes `jarble_delegate` fenced JSON blocks. The current `flowDelegation.ts` parser expects `json` blocks with `{"tool": "delegate_to_X", ...}`. Does the user want to:
   - (a) Change the parser to look for `jarble_delegate` blocks (new format), or
   - (b) Keep `json { "tool": "delegate_to_slug" }` and have soul.md teach that format?
   Option (a) is cleaner (doesn't collide with user's own JSON output) but changes the contract.
4. **Pod restart for mid-conversation edits**: Should we add `flow.updatedAt` to the sessionKey? Costs: loses mid-chat memory on edits. Benefit: immediate propagation.
5. **Should we also fix the underlying `flow_deployment_memberships` silent-failure issue in this PR, or punt it to a separate ticket?** It's a precondition for everything else to work; punting means the fix ships but still doesn't work in prod until the memberships bug is fixed too.
