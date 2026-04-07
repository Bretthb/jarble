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
