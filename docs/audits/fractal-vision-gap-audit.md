# Fractal Agent Teams — Vision Gap Audit

**Date**: 2026-04-08
**Auditor**: fractal-audit-retry agent (code-only, read-only review)
**Scope**: 6 vision pieces for the fractal agent teams feature
**Last updated**: 2026-04-10 (post-implementation review)

## Executive Summary

**Overall completeness: ~65%.** Pieces 1 and 2 (N-level recursion + parent_call_id topology) are fully implemented and tested as of PR #92 and follow-up PRs. Both `tamboAgent.ts` and `flowChat.ts` call sites now thread `parentCallId`, `traceId`, `ancestorDeploymentIds`, and `flowId` into `executeDelegation()`. 16 unit tests cover 1-level, 2-level, 3-level recursion, cycle detection, depth-limit enforcement, ownership/IDOR, and root-span stitching. Remaining gaps: per-deployment team membership UI (Piece 3), canvas attribution storage (Piece 5), and origin-tagged chat history (Piece 6).

### Top 3 gaps (updated)

1. ~~**No true N-level recursion.**~~ **RESOLVED.** `executeDelegation()` re-parses child output via `parseDelegationCalls()`, resolves the child's flow context via `loadFlowContextForDeployment()`, and recurses with `depth+1`. Both callsites pass `depth: 1` for the first hop; recursive hops increment automatically. `MAX_DELEGATION_DEPTH` defaults to 4 (env-overridable). Cycle detection via `ancestorDeploymentIds`.
2. ~~**No `parent_call_id` anywhere.**~~ **RESOLVED.** `agent_calls` has `parent_call_id`, `depth`, `kind` columns (+ OTel span columns). Both `tamboAgent.ts` (via `rootAgentCall`) and `flowChat.ts` (via `rootFlowCall`) create root spans and thread `parentCallId` into delegation calls. SSE orchestration events carry `parentStepId` and `depth`. Tree reconstruction is possible via `parent_call_id` self-join.
3. **No per-deployment team membership UI.** `flow_deployment_memberships` table exists and is populated, but there is zero read path (no `listMembershipsForDeployment` tRPC) and no sidebar panel on `/d/[id]`.

### Recommended build order

1. (S) Add `parent_call_id` + `depth` + `kind` to `agent_calls` + SSE events
2. (M) Make `executeDelegation()` recursive — re-parse child output, recurse with `depth+1`
3. (M) Route subagent calls through the same event rail with `parent_call_id`
4. (S) Add `flows.listMembershipsForDeployment` + `TeamMembershipPanel` on `/d/[id]`
5. (M) Rewrite `OrchestrationSteps.tsx` as a tree keyed on `parentId`
6. (M) Add `sourceDeploymentId` to canvas card props; attribution footer; library view
7. (S) Add `originType` + `originCallId` to `chat_sessions`, filter `ConversationHistoryPanel`

---

## Piece 1: N-level fractal delegation support

### Status: COMPLETE

### Implementation (merged to develop)
- `jarble-api-main/src/services/flowDelegation.ts` — `executeDelegation()` re-parses child output with `parseDelegationCalls()` after `chatViaExec` returns (line ~932). Resolves child's flow context via `loadFlowContextForDeployment()`, builds child's `DelegationTool[]`, pre-checks cycle + depth, and recurses with `depth+1`, `parentCallId: callId`, extended `ancestorDeploymentIds`.
- `MAX_DELEGATION_DEPTH` defaults to 4 (env-overridable via `JARBLE_MAX_DELEGATION_DEPTH`), guarded at function entry AND inline before each recursive sub-call.
- `DelegationCycleError` — thrown when target is in `ancestorDeploymentIds` chain.
- `DelegationDepthExceededError` — thrown when `depth > MAX_DELEGATION_DEPTH`.
- `loadFlowContextForDeployment()` — resolves a deployment's flow membership with owner-scoped IDOR protection.
- `tamboAgent.ts` — threads `parentCallId: rootAgentCall.callId`, `traceId`, `ancestorDeploymentIds`, `flowId` from the root chat_turn span.
- `flowChat.ts` — creates a root `rootFlowCall` span, threads `parentCallId` and `traceId` into delegation calls.
- 16 unit tests in `flowDelegation.recursion.test.ts` covering 1-level, 2-level, 3-level recursion, cycle detection, depth limit, ownership/IDOR, root-span stitching.

---

## Piece 2: Subagents as delegation-graph participants

### Status: MOSTLY COMPLETE (schema + events done; MCP subagent linking is a follow-up)

### Implementation (merged to develop)
- `jarble-api-main/src/db/schema.pg.ts` — `agent_calls` now has `parent_call_id`, `depth`, `kind`, plus full OTel span columns (`trace_id`, `span_id`, `parent_span_id`, `span_name`, etc.). `parentCall` self-reference relation defined.
- `jarble-api-main/src/__tests__/helpers/testSchema.sqlite.ts` — mirrors all new columns.
- `jarble-api-main/src/utils/agentCallEvents.ts` — `OrchestrationStepEvent` carries `parentStepId?: string` and `depth?: number`.
- `jarble-api-main/src/services/flowDelegation.ts` — `emitOrchestrationStart` passes `parentStepId` and `depth` from the delegation params.
- `jarble-api-main/src/services/agentCallsWriter.ts` — centralized writer populates all topology + OTel columns on every agent_calls row.

### Remaining gap
- MCP subagent calls (`executeSubagentTool` in `jarble-ui-server.js`) still don't pass the current step's `callId` through a header, so in-pod subagent invocations land as top-level siblings instead of children in the delegation tree. This requires passing the pod's "current call id" via env or request context.

---

## Piece 3: Per-deployment team membership visibility

### Current state
- Table exists: `jarble-api-main/src/db/schema.pg.ts:881` `flow_deployment_memberships` with `flow_id`, `deployment_id`, `node_id`, `role`, `is_entry_point`, indexed by deployment
- Populated by `trpc/routers/flows.ts` and `services/configSync.ts`
- **No read path:** grep for `listMembershipsForDeployment` / `TeamMembership*` / `ActiveTasks*` → zero files
- No sidebar panel on `Jarble-mvp/app/d/[id]/page.tsx` for team membership
- `ConversationHistoryPanel` doesn't show current delegated task

### Gap
Three sub-pieces missing:
1. "Team X" — trivial once tRPC query added
2. "Task Y" — not tracked anywhere. Needs either new `active_delegations` table or live query against `agent_calls` where `callee_deployment_id = me AND status = 'pending'`
3. "From bot Z" — derivable from `agent_calls.caller_deployment_id` once status flow works

### Files to modify
- `jarble-api-main/src/trpc/routers/flows.ts` — add `listMembershipsForDeployment({ deploymentId })`
- `jarble-api-main/src/trpc/routers/deployment.ts` — add `getActiveDelegations({ deploymentId })`
- New `Jarble-mvp/components/workspace/TeamMembershipPanel.tsx` and `ActiveDelegationsPanel.tsx`
- `Jarble-mvp/app/d/[id]/page.tsx` — mount panels

### Effort: S (membership list) / M (active task tracking, depends on Piece 2)

---

## Piece 4: Delegation tree visualization

### Status: PARTIALLY COMPLETE (backend events carry parent pointers; frontend tree rendering is a follow-up)

### Implementation (merged to develop)
- `jarble-api-main/src/utils/agentCallEvents.ts` — `OrchestrationStepEvent` now carries `parentStepId` and `depth`.
- `jarble-api-main/src/services/flowDelegation.ts` — `emitOrchestrationStart` passes `parentStepId: params.parentCallId` and `depth` on every delegation hop.
- `jarble-api-main/src/routes/flowChat.ts` — `jarble.flow.delegation.start` and `.end` SSE events now include `parentStepId` and `depth`.
- `jarble-api-main/src/routes/tamboAgent.ts` — orchestration events already forwarded with `parentStepId` and `depth` from the in-process event bridge.

### Remaining gap
- `OrchestrationSteps.tsx` — still renders a flat array. Needs `parentId?: string` on the step type, tree-building in `useMemo`, and recursive indented rendering.
- `FlowExecutionTimeline.tsx` — same: flat timeline, not a tree.

### Effort: S (backend data is ready; frontend-only change)

### Code sketch
```tsx
function buildTree(steps) {
  const byId = new Map(steps.map(s => [s.id, { ...s, children: [] }]));
  const roots = [];
  for (const s of byId.values()) {
    if (s.parentId && byId.has(s.parentId)) byId.get(s.parentId).children.push(s);
    else roots.push(s);
  }
  return roots;
}
```

---

## Piece 5: Aggregated results "library" view

### Current state
- Canvas card types (`Jarble-mvp/components/workspace/types.ts`, `shared/component-manifest/`) — **no `sourceBotId`/`sourceDeploymentId`/`attribution` field**. Grep hits for `sourceDeploymentId` in `CanvasMap.tsx` / `CanvasBlockquote.tsx` are coincidental (map tile sources, blockquote citations) — not delegation provenance
- `jarble-api-main/src/routes/flowChat.ts:591+` — delegated UI blocks **are forwarded** via `jarble.flow.delegation.uiblock` events carrying `sourceDeploymentId` and `sourceRole`. **Wire format is ready.**
- No library view. `ComponentGallery.tsx` is a palette, not a source-grouped list

### Gap
Components from delegated specialists land on the entry canvas, but attribution is dropped at render time. Cannot filter/group by source.

### Files to modify
- `Jarble-mvp/components/workspace/types.ts` — add `sourceDeploymentId?: string; sourceRole?: string;` to canvas card type
- `Jarble-mvp/hooks/useCanvasChat.ts` — propagate these fields from the `delegation.uiblock` event into the created card
- `Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx` — attribution footer
- New `Jarble-mvp/components/workspace/CanvasLibraryView.tsx` — group-by-source view

### Effort: M

---

## Piece 6: Individual chat vs team-delegated message distinction

### Current state
- `jarble-api-main/src/db/schema.pg.ts:389, 397` — `chat_sessions` and `chat_messages` have no origin fields. `chat_messages` columns: `id, session_id, role, content, thinking_text, created_at`
- `Jarble-mvp/components/workspace/ConversationHistoryPanel.tsx` (137 lines) reads from localStorage, no origin field
- Delegations use synthetic session IDs with prefixes (`flow-delegation-*`, `team-delegation-*`, `flow-*`) — the only current signal for origin, purely by string convention

### Gap
No way to distinguish user 1:1 chats from inbound delegations on bot B's page.

### Files to modify
- `jarble-api-main/src/db/schema.pg.ts:389` (+ mysql + sqlite + `db/init.ts`) — add `originType varchar default 'user'` (`user`|`delegation`|`subagent`) and `originCallId` (nullable FK → `agent_calls.id`) on `chat_sessions`
- `jarble-api-main/src/services/flowDelegation.ts:408` — set origin on session creation in `executeDelegation`
- `Jarble-mvp/lib/conversationStorage.ts` — mirror origin field locally
- `Jarble-mvp/components/workspace/ConversationHistoryPanel.tsx` — collapsible "Incoming delegations" section

### Effort: S

---

## Confirmed working (leave alone)

- **N-level `jarble_delegate`** in both `flowChat.ts` and `tamboAgent.ts`: recursive parsing, sub-delegation, cycle detection, depth limits, IDOR ownership filter, timeout, SSE heartbeat, auto-retry, root span stitching — all solid
- **`parent_call_id` / `depth` / `kind` on `agent_calls`** — populated by `agentCallsWriter` on every delegation hop, root chat turn, and flow step. Self-join relation for tree reconstruction.
- **16 unit tests** in `flowDelegation.recursion.test.ts` — 1-level, 2-level, 3-level, cycle, depth limit, ownership/IDOR, root-span stitching
- **Flow-engine DAG subflow nesting:** `MAX_NESTING_DEPTH=3` enforced, bubbled `substep:*` events carry `parentNodeId`
- **`flow_deployment_memberships` writer side** (populated by flow CRUD + configSync)
- **Delegated UI block forwarding** via `jarble.flow.delegation.uiblock` with `sourceDeploymentId` — wire format already ships the provenance; only the frontend storage is missing
- **OTel-compatible span store** — `trace_id`, `span_id`, `parent_span_id`, `span_name`, `service_name`, `pod_name`, `start_ms`, `end_ms`, `duration_ms`, `status_code`, `attributes` on `agent_calls`
- **Runaway trace circuit breaker** (JAR-51 Phase 6) — `MAX_SPANS_PER_TRACE` and `MAX_CREDITS_PER_TRACE_CENTS` enforced by `agentCallsWriter`

---

## Key insight for the founder

**Piece 5 (canvas attribution) is almost free.** The SSE event `jarble.flow.delegation.uiblock` already carries `sourceDeploymentId` — the server is doing the hard work. All that's missing is the frontend to (1) store it on the card and (2) render an attribution footer. This is probably the highest-ROI task: biggest visible impact for smallest code change. **If you ship only one thing from this audit, ship this.**

**Piece 1 (N-level recursion) is the architectural blocker.** Nothing else can be demoed as "fractal" until `executeDelegation` re-parses child output and recurses. Build order: do Piece 1 before Pieces 4 and 5, because without recursion there's nothing interesting to visualize.

**Pieces 2-3-4 should ship together** as one coherent database migration + UI change. Adding `parent_call_id` to `agent_calls` unlocks both the delegation tree visualization and the per-deployment team membership panel. One migration, multiple wins.
