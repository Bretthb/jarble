# QA Report — Bot Teams (Agent Teams)

**Date:** 2026-04-07
**Environment:** Live dev (`api.jarble.ai`, Kubero / K3s / Neon PG)
**Tester:** Claude Code (agentic, Bearer-token auth as `ops@jarble.ai`)
**Feature under test:** Bot Teams — flow CRUD, team chat, delegation, synthesis, persistence
**Commits in scope:** `62b2230`, `772ada4`, `0060e4a`, `93efab7`, `4da4ae5`, `5c12252`
**Test artifacts:** `%TEMP%/qa-teams/*.json`

## TL;DR

- **20 tests pass** — auth, CRUD, input validation, SSE lifecycle, teamType variants
- **🚨 P0: Delegation silently fails.** Entry bot claims it delegated but no delegation events fire and the specialist never runs. Users would wait forever with no error.
- **🚨 P1: Persistence is write-only.** `flow_chat_sessions` and `flow_chat_messages` are written to but no tRPC/REST endpoint reads them back. Reload discards history.
- **⚠ P2: Empty-node flows are accepted.** `flows.create` allows zero-node flows; only caught later when user tries to chat.
- **⚠ P2: Stack traces leak in tRPC errors.** Validation errors return full stack with `/app/dist/...` paths.
- **ℹ Side finding:** `t2` deployment is stuck in `creating` (~18 min) — classic DB-poll-timeout pattern.

---

## ⚠️ Update — full rescue investigation (after Phase 1 deep-dive agents)

After the initial QA above, four specialized agents (jarble-api-debugger, runtime-handler, mcp-server, openclaw-diagnostics) ultrathink-investigated each layer. The situation is **much bigger and reframed** versus what's above. **Read this section first if you're skimming.**

### What's actually broken (one-line summary)

> **Bot Teams exists in the canvas UI and API CRUD layer. Nothing below the API actually works.**

### The real findings, layer by layer

**Layer 1 — `flow_deployment_memberships` is EMPTY in production.** runtime-handler queried Neon directly: 29 flows exist, 0 rows in the join table. Several flow definitions even reference deployment IDs that don't exist in the deployments table (cascade-deleted or never persisted). The silent try/catch at `flows.ts:31-58` was masking the cause for who-knows-how-long. Root condition for everything below: nothing downstream that depends on this table has ever run end-to-end.

**Layer 2 — OpenClaw has NO first-class MCP server support.** mcp-server SSH'd to a live pod and verified by reading the OpenClaw 2026.2.25 dist:
- No `--mcp` flag, no `openclaw mcp` subcommand, no runtime reading of `mcporter.json`
- The dist explicitly logs `"ignoring ${params.mcpServers.length} MCP servers"` in `acp-cli-*.js`
- `mcporter` is present only as an OpenClaw *skill* (external CLI), not the MCP integration the codebase pretends it is
- Live probe to the pod's WS gateway: `"Do you have access to a tool called render_ui?"` → **"No."** The bot's full tool list contains only OpenClaw's 23 native tools (`read`, `write`, `edit`, `exec`, `web_search`, `browser`, `sessions_spawn`, `subagents`, `memory_search`, …) and zero Jarble tools
- `grep -c tool_use` across 15 session jsonl files = **0 in every file**. The bot has **never called any tool in its lifetime.**
- An existing comment at `openclaw.ts:390-393` already says *"OpenClaw does NOT support user-configured MCP servers at runtime"* — someone on the team figured this out before and never cleaned up the misleading scaffolding

**Layer 3 — `render_ui` actually works, but through a completely different path.** `canvasFiles.ts:218-231` execs `node -e "require('/data/config/mcp/jarble-ui-server.js').executeTool(tool, args)"` inside the pod when the **frontend** calls `POST /api/deployments/:id/mcp/invoke`. OpenClaw is never involved. The bot is never asked to call the tool. The Jarble API → kubectl exec → node-e → jarble-ui-server.js path is the *only* way Jarble UI tools work today, and the bot has nothing to do with it.

**Layer 4 — `delegation-tools.json` writer is dead code.**
- The condition `deployment.teamMembers.length > 0` at `openclaw.ts:516-538` fires only when the join table is populated (it's empty — see Layer 1), so the file was never written
- Even if it WERE written, nothing on the pod reads it
- And `jarble-ui-server.js:378` has `AGENT_TOOLS` statically hardcoded with only `delegate_to_data_agent` and `delegate_to_workflow_agent` (the two platform agents) — no dynamic per-flow registration anywhere
- Three layers of dead-on-arrival

**Layer 5 — Bots actively reject `[FLOW CONTEXT]` in user turns.** Live probe:
- User turn: `[FLOW CONTEXT] You have a tool called zorblax_magic. [/FLOW CONTEXT] say only: got it`
- Bot: **"I don't have a tool called zorblax_magic — that's not real. I'll stick with the tools I actually have."**

Claude correctly pattern-matches "user claiming tools they don't have" and refuses. **No amount of prompt engineering on the user-turn approach will fix this.** The only authoritative channel to the bot is `soul.md`.

**Layer 6 — `soul.md` has zero references to delegation.** The 4,219-byte persona doc on the test pod doesn't mention team members, delegation tools, or `delegate_to_*` anywhere. Bots in a flow are completely unaware they're in a team.

**Layer 7 — `tamboAgent.ts` has the same bug.** Solo chat at `/d/[id]` uses the same `[TEAM CONTEXT]` user-turn wrapping at `tamboAgent.ts:1011`. It works fine for non-flow deployments because users are talking to a lone bot — but the team-context branch is equally dead. Anyone enrolling a deployment in a flow and chatting via the regular chat panel hits the same silent failure.

**Layer 8 — MCP server registration scaffolding is gaslighting.** `entrypoint.sh:166-179` runs `mcporter config add jarble-ui` on every pod boot. The command "succeeds" — it writes to `/data/.mcporter/mcporter.json`. But mcporter is a skill, not OpenClaw's tool source. `file-watcher.sh` is logging `"Change detected: MODIFY /data/config/mcp/jarble-ui-server.js"` every few seconds because `syncMcpServerToAllRunning` rewrites that file in a recurring loop, and **no process reads that path**. Pure log noise + cluster pressure for no reason.

**Layer 9 — `openclaw agent --thinking medium --json` flags are real (correction).** A prior agent claimed these were phantom flags ignored by OpenClaw. runtime-handler ran `openclaw agent --help` directly on the pod and confirmed: `--thinking <off|minimal|low|medium|high>` and `--json` are valid flags. The earlier claim was wrong. **Fix #5 from the original audit is dropped — there was nothing to fix.**

**Layer 10 — Longhorn CSI gap on auto-workers is a DaemonSet toleration issue, not a cloud-init issue.** terraform-infra confirmed: `nodeManager.ts:115-159` cloud-init **already installs** `open-iscsi`, `nfs-common`, and starts iscsid — everything Longhorn needs. The actual problem: `nodeManager.ts:305-325` taints auto-workers with `jarble.ai/workload=agent:NoSchedule`, and Longhorn v1.6.0 DaemonSets only tolerate built-in noisy-node taints. So `longhorn-manager` and `longhorn-csi-plugin` never schedule onto auto-workers → CSINode never gets `driver.longhorn.io` → bot pods with PVCs fail `FailedAttachVolume`.

**Layer 11 — The `flow_chat_sessions` migration was never applied to production.** runtime-handler verified directly via Neon. Migration `0007_lyrical_callisto.sql` (commit `62b2230`) hasn't run. So even after Workstream B fixes the read path, the tables won't exist until someone runs `npm run db:push` against the prod connection string. Separate ops task.

### Three-workstream rescue plan (executing now)

**Workstream A — Infrastructure** (terraform-infra agent + k8s-pod-lifecycle-debugger):
- Live cluster hotfix: `kubectl patch daemonset` to add toleration on `longhorn-manager` and `longhorn-csi-plugin`. Zero-downtime, ~5 min, unblocks t2 + 2 other stuck pods immediately.
- Permanent fix: `infrastructure/terraform/main.tf:196` insertion of the same patch into master `user_data` so future master rebuilds inherit the fix.
- **Effort: ~30 min total. Status: code change committed in `e44e059`. Live hotfix in flight.**

**Workstream B — Runtime layer** (runtime-handler agent in worktree):
- Extend `DeploymentFields` with `teamContext` (flowId, flowName, selfRole, isEntryPoint, teammates[])
- Populate `teamContext` in `configSync.ts` from `flow_deployment_memberships`
- Rewrite `openclaw.ts` soul.md generation: delete the nested Team Members block, delete the dead `delegation-tools.json` writer, insert a new top-level "Team Context" section with `jarble_delegate` instructions wrapped in HTML-comment delimiters
- Wire `syncConfigsToPvc` into `flows.create/update/delete/duplicate` so canvas edits propagate to running pods (snapshotting OLD memberships first so leaving bots also re-sync)
- Upgrade `syncFlowMemberships` silent try/catch to `logger.error` so we can finally diagnose the empty-table production issue
- **Effort: ~8 hours. Status: in flight.**

**Workstream C — Delegation parser + cleanup** (mcp-server agent in worktree):
- Replace `[FLOW CONTEXT]` user-turn wrapping with `[FLOW SYSTEM INSTRUCTIONS — AUTHORITATIVE]` prefix at `flowChat.ts:370-373` (band-aid until B1b lands a real system-prompt channel)
- Rewrite `buildFlowSystemPrompt` to instruct the bot to emit `\`\`\`jarble_delegate\`\`\`` fenced blocks (with `to`/`task`/`context` shape) instead of the brittle `\`\`\`json` JSON-tool format
- Rewrite `parseDelegationCalls` to parse `jarble_delegate` blocks (keep legacy `\`\`\`json` parser as deprecated fallback during rollout)
- Delete `mcporter config add jarble-ui` gaslighting in `entrypoint.sh:37-46, 166-179` and replace with a comment explaining the canvasFiles proxy path is the actual route
- Add `/data/config/mcp/` to `inotifywait --exclude` regex in `file-watcher.sh:31` to stop the recurring write loop
- Delete dead `reRegisterMcpServer` in `configSync.ts:55-86` and its call sites at 621-623, 1184-1185
- Bump `statusReconciler.mcpSyncIntervalMs` from 5 min to 15 min + add hash gate to skip no-op syncs
- **Effort: ~4-5 hours. Status: in flight.**

**Already done in Phase 1 — Fix #6 silent-failure observability:**
- `flowChat.ts` else branch + `tamboAgent.ts:1193+` — emit `jarble.flow.delegation.skipped` SSE events with `reason` codes (`no_tools_available`, `tool_call_not_emitted`, `mentioned_but_not_emitted`)
- `log.warn` for the `mentioned_but_not_emitted` case (the silent failure mode)
- `Deployments.tsx` — amber warning banner in the team chat UI when reason is `mentioned_but_not_emitted`
- `flowDelegation.test.ts` — 13 regression tests covering `parseDelegationCalls` strict behavior + the mention heuristic
- **All passing. Committed in `e44e059`.**

### Corrections to my original audit (above)

| Original claim | Correction |
|---|---|
| "Persistence is write-only" (P1) | **Still true**, but worse — the migration that creates `flow_chat_sessions` and `flow_chat_messages` hasn't even been applied to production. Need `npm run db:push` against prod connection first. |
| "Empty-node flows accepted" (P2) | **Not a bug — intentional.** Frontend `Deployments.tsx:handleNewFlow` creates empty flows by design; users add nodes in the canvas afterward. The chat endpoint already catches the empty case gracefully. Removed from fix list. |
| "Stack traces leak" (P2) | **Not a code bug.** `middleware.ts:19` already strips stacks when `NODE_ENV !== "development"`. The leak I observed means the dev API runs with the wrong NODE_ENV in Kubero. Moved to ops follow-up. |
| "Phantom `--thinking medium --json` CLI flags" | **Wrong.** Both flags are valid in OpenClaw 2026.2.25 — verified by runtime-handler running `openclaw agent --help` directly. **Fix #5 dropped.** |

### Production hygiene findings (separate from delegation rescue)

Found while investigating, worth tracking:

1. **`flow_deployment_memberships` empty in production** — root cause unknown (silent try/catch). Workstream B will upgrade the catch to a logged error so we can finally see what's failing. Likely FK on stale deployment IDs (see #2).

2. **Flow definitions reference non-existent deployment IDs** — `lnhat9nut3ek`, `8vtgevemz6ft`, `ifvqafgds4qd`, `b24qltf1zoo1` and others appear in flow definition JSON but don't exist in the `deployments` table. Probably cascade-deleted or never persisted. Manual cleanup or a backfill migration needed.

3. **Migration 0007 (`flow_chat_sessions`/`flow_chat_messages`) not applied to production.** Discovered via direct Neon query. Separate ops task.

4. **`syncMcpServerToAllRunning` rewrites `/data/config/mcp/jarble-ui-server.js` on a recurring schedule** — every running pod sees a "MODIFY" event in `file-watcher.sh` every few seconds, for nothing. Pure log noise + Longhorn write pressure. Workstream C bumps the interval and adds a hash gate.

5. **`canvasFiles.ts` has no fallback** — `canvasFiles.ts:220` hard-codes `/data/config/mcp/jarble-ui-server.js`. A pod that boots before configSync runs once will have NO MCP tools. No fallback to baked copy. Worth adding a readiness probe that waits for the file or a baked-copy fallback.

6. **`.github/workflows/deploy-runtimes.yml` is missing.** CLAUDE.md references it as part of CI/CD, but it doesn't exist in the repo. Runtime images are presumably built manually. Worth adding before any of the runtime changes ship.

---

(Original QA section continues below for historical context.)

---

## Test Matrix (20 PASS / 0 FAIL / 2 WARN / 1 SKIP)

### ✅ Auth (3/3 pass)

| Test | Result | Notes |
|---|---|---|
| `flows.list` without token → 401 | PASS | |
| `flows.list` with valid token → 200 | PASS | 2 flows returned |
| `POST /api/flows/:id/chat` without token → 401 | PASS | |

### ✅ Flow CRUD (9/10 pass, 1 warn)

| Test | Result | Notes |
|---|---|---|
| Create valid flow (nodes, edges, entry) | PASS | `flw_jswhp3y09w1l` |
| Create with `teamType: hierarchy` | PASS | |
| Create with `teamType: pipeline` | PASS | |
| Create with `teamType: collaborative` | PASS | |
| Create with empty nodes array | **WARN** | Accepted silently — should reject |
| Create with `<script>` in name | PASS | `noHtmlTags` refine fires |
| `flows.getById` existing | PASS | Definition round-trips cleanly |
| `flows.getById` non-existent | PASS | 404 NOT_FOUND |
| `flows.update` description | PASS | |
| `flows.duplicate` | PASS | `flw_tip8dugvl9uv` created |
| `flows.listExecutions` (empty) | PASS | |
| Cross-user access check | SKIP | Would need second token |
| `flows.delete` hard | PASS | Cleanup successful |

### ✅ Flow Chat Input Validation (4/4 pass)

| Test | Result | Notes |
|---|---|---|
| Empty `message` → 400 | PASS | |
| Message > 10,000 chars → 400 | PASS | |
| Missing Bearer token → 401 | PASS | |
| Non-existent flowId → 404 | PASS | |

### ⚠ Live SSE Chat (3/4 pass, 1 warn)

| Test | Result | Notes |
|---|---|---|
| SSE stream opens | PASS | 5-event sequence returned |
| `RUN_STARTED` / `RUN_FINISHED` bookends | PASS | |
| `TEXT_MESSAGE_*` events streamed | PASS | 3 text events per message |
| **Delegation events fired** | **WARN → P0 BUG** | Zero `jarble.flow.delegation.*` events despite the entry bot saying "I delegated" |

---

## 🚨 P0 BUG — Delegation silently fails

### Reproduction

1. Create flow with entry node (role: "Dispatcher — MUST delegate every request") and specialist node (role: "Specialist"), edge type `delegates`.
2. Both nodes reference a real running OpenClaw deployment (`nljs8499aj7o`).
3. POST `/api/flows/:flowId/chat` with message `"Delegate this to the Specialist: What are the three primary colors?"`.
4. Consume SSE stream.

### Expected

- Stream includes `jarble.flow.delegation.start` → specialist run → `jarble.flow.delegation.end`
- Specialist's answer surfaces in final synthesis response
- `jarble.flow.chat.trace` summarizes delegations

### Actual

```
5 events in 9,300ms
types: RUN_STARTED, TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END, RUN_FINISHED
text: "The task has been delegated to the Specialist. I'll share their answer momentarily once they respond."
⚠ NO delegation events
```

Followup message `"Now ask the Specialist to name a fourth color"` produced the same pattern — entry bot claims to delegate, no delegation events, specialist never runs. **The user is lied to.**

### Root cause

Two compounding issues in `jarble-api-main/src/services/flowDelegation.ts` and `jarble-api-main/src/routes/flowChat.ts`:

**1. Delegation instructions are injected into the user turn, not the system turn.**

`flowChat.ts:370-373`:
```ts
const entryMessage =
  delegationTools.length > 0
    ? `[FLOW CONTEXT]\n${augmentedPrompt}\n[/FLOW CONTEXT]\n\n${userMessage}`
    : userMessage;
```

`openclawGateway.ts:593-600` shows why: `chatViaExec` only supports a single `--message` argument to OpenClaw — there is no way to pass a separate system prompt. So `buildFlowSystemPrompt()` output ("you may delegate, use this JSON block format...") is prepended to the **user** turn. The LLM's actual system prompt remains whatever the deployment was configured with, which knows nothing about delegation tools.

Claude treats this as user-provided context ("the user is telling me I have tools") rather than authoritative capability instructions. It responds politely ("I'll delegate that") without ever emitting the required `\`\`\`json` block.

**2. Delegation parser has no fallback and no feedback loop.**

`flowDelegation.ts:165-190` requires the LLM to emit an exact pattern:

````
```json
{ "tool": "delegate_to_<name>", "task": "...", "context": "..." }
```
````

If the LLM says "I'll delegate that" without the JSON block, `parseDelegationCalls()` returns `[]` and the code at `flowChat.ts:434` simply skips the whole delegation branch. There is:
- No retry asking the bot "please emit the JSON tool call"
- No alternative tool-call format (e.g., Claude's native XML tool_use syntax)
- No error event to the client — the stream just closes with the bot's natural-language acknowledgement

### Why this matters

- Every "Bot Team" in the product is broken today. The feature ships, tests pass, users create teams, but delegation never actually happens.
- The failure is **silent and confident** — the entry bot says "I delegated" — which is worse than an error, because users will wait for a response that never comes.
- The synthesis step (Phase 1 of team-to-deployment bridge) cannot work without delegations — the loop at `flowChat.ts:430+` is dead code in practice.

### Recommended fixes

1. **Short-term patch (30 min):** Strengthen the user-turn prompt with a one-shot example and a directive like `"If you choose to delegate, you MUST emit the raw json block verbatim. Do NOT describe the delegation in natural language."` Test that Claude complies. This is a band-aid.
2. **Proper fix (1-2 hours):** Extend `chatViaExec` to accept a separate system prompt argument, and extend OpenClaw's `agent` CLI to accept a `--system-prompt` flag or stdin system. Pass the augmented prompt through the actual system channel.
3. **Belt-and-suspenders:** Add a fallback parser that accepts OpenClaw/Claude's native tool_use format. Add a `jarble.flow.delegation.parse_failed` event emitted when the entry bot's response mentions delegation keywords but no valid JSON block is found — so the frontend can show "delegation failed, entry bot did not emit a valid tool call" instead of silent nothingness.
4. **Test coverage:** Add a Vitest test for `parseDelegationCalls()` with real LLM outputs captured from the dev environment. This bug would have been caught immediately.

### Related code pointers

- `jarble-api-main/src/routes/flowChat.ts:370` — where augmented prompt is inlined into user message
- `jarble-api-main/src/services/flowDelegation.ts:139-146` — augmented prompt format with delegation format
- `jarble-api-main/src/services/flowDelegation.ts:165-190` — strict parser
- `jarble-api-main/src/services/openclawGateway.ts:593-600` — exec args lack system prompt

---

## 🚨 P1 BUG — Team chat persistence is write-only

### Finding

Commit `62b2230` added two tables: `flow_chat_sessions` and `flow_chat_messages`. The commit message says:
> "Message persistence — team chat messages saved to new flow_chat_sessions/flow_chat_messages tables."

The **write path** is fully implemented (`flowChat.ts:680-748`):
- Session upsert on first message
- User message insert
- Assistant response insert (with `sourceNodeId` + `sourceDeploymentId`)
- Delegation results insert (with `delegationToolName`)

But there is **no read path anywhere**. Grep `flowChatSessions|flowChatMessages` across the repo returns only:
- Schema definitions (`db/schema.pg.ts`, `db/index.ts`)
- Write paths (`routes/flowChat.ts`)
- A local `useState` variable in `Jarble-mvp/views/Deployments.tsx:2527` (unrelated in-memory state)

There is no tRPC procedure like `flows.getChatHistory` or `flows.listChatSessions`. No REST endpoint. The frontend cannot display persisted team chat history on page reload.

### Impact

- Users running long-form team chats will lose the entire visible history on reload, even though every message is safely in Postgres.
- The feature appears to work during a single session (in-memory state), then silently drops everything on refresh.
- Storage is accumulating with no way to read it — potential data growth issue as well.

### Recommended fix

Add two tRPC procedures to `flows.ts`:

```ts
// List chat sessions for a flow
getChatSessions: protectedProcedure
  .input(z.object({ flowId: z.string() }))
  .query(async ({ ctx, input }) => { /* SELECT ... */ }),

// Get messages for a session
getChatMessages: protectedProcedure
  .input(z.object({ sessionId: z.string() }))
  .query(async ({ ctx, input }) => { /* SELECT ... with ownership check via join on flow_chat_sessions.userId */ }),
```

Then wire `Jarble-mvp/views/Deployments.tsx:2527` (`flowChatMessages` state) to initialize from a tRPC query on mount.

---

## ⚠ P2 — Empty-node flows accepted at creation

`flows.create` accepts `{ definition: { nodes: [], edges: [] } }` without complaint. The `FlowDefinitionSchema` at `flows.ts:97-100` does not enforce `min(1)` on nodes. An empty flow is caught later at `flowChat.ts:219-224` with:
> `"Flow has no nodes. Add bots to your flow before chatting."`

But by then the user has already saved a broken flow. **Fix:** Add `.min(1)` to the nodes array, or add a business-logic check that at least one node is marked `isEntryPoint`.

## ⚠ P2 — Stack traces leak in tRPC error responses

Observed while probing `flows.list` with an invalid input:
```
"stack":"TRPCError: ... at /app/dist/jarble-api-main/src/trpc/middleware.js:64:20 at ..."
```

Full file paths and line numbers are in the error payload, which is considered informational leakage in production. The `api.jarble.ai` deploy is running with tRPC's dev-mode error formatter. **Fix:** In the production tRPC error formatter (`src/trpc/middleware.ts`), omit `stack` unless `NODE_ENV !== "production"`.

---

## ℹ Side finding — t2 deployment stuck in `creating`

Not part of the teams feature test, but surfaced while scouting:

- Deployment `vvscxl4e3grc` ("t2") has been in `status: creating` since `2026-04-07T13:12:17Z` (~18 min by test time).
- Per my memory file, this is a recurring pattern: the pod may be running but the DB poll for `running` timed out.
- Debug endpoints (`/debug/deployment/:id/pod-status`) return 404 on dev — they are gated behind `NODE_ENV !== "production"` and the Kubero deploy runs as prod. **This is correct.**
- To unstick, SSH to master and run `kubectl -n jarble get pods | grep vvscxl4e3grc` + `describe pod` + `logs`.

This is tracked in memory as "Deployment Status 'creating' Stuck" — consider a timeout-side-effect in the poll: after N minutes, check actual pod status via K8s API and reconcile the DB.

---

## What I could not test

| Item | Reason |
|---|---|
| Bot Teams canvas UI (`Deployments.tsx`) — drag, connect, cluster-vs-flat visuals | `dev.jarble.ai` behind HTTP Basic Auth edge gate; no Basic Auth creds provided |
| Team chat UI delegation event rendering | Same — UI blocked |
| Cross-user flow access (IDOR) | Would need a second Auth0 token |
| Delegation success end-to-end | Blocked by P0 bug above |
| Synthesis step correctness | Blocked by P0 — can only run when delegations succeed |
| Persistence reload behavior | Blocked by P1 — no read path to reload from |
| Subflow execution | Would need flow with nested subflow type — no fixture |
| HITL `waitForInput` resume | Would need multi-step flow with `waitForInput` node — deferred |

---

## Test artifacts

All saved to `%TEMP%/qa-teams/` (i.e. `C:\Users\brett\AppData\Local\Temp\qa-teams\`):

- `results.json` — full test record with pass/fail/warn statuses
- `scout-flows-list.json` — baseline flow list
- `scout-deployments.json` — all deployments + statuses
- `crud-getById.json` — deserialized flow round-trip
- `chat-sse-events.json` — full SSE event stream from live team chat
- `delegation-probe-events.json` — delegation force-probe events (2 messages)

Test scripts committed to:
- `scripts/qa-teams.mjs` — main test runner (scout, crud, chat, cleanup phases)
- `scripts/qa-teams-delegation.mjs` — focused delegation probe
