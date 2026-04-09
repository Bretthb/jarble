# Fractal Agent Teams — Vision Gap Audit

**Date**: 2026-04-08
**Auditor**: fractal-audit-retry agent (code-only, read-only review)
**Scope**: 6 vision pieces for the fractal agent teams feature

## Executive Summary

**Overall completeness: ~35%.** The 1-level delegation case (entry bot → flat specialists) works end-to-end in both `flowChat.ts` and `tamboAgent.ts`. Everything the vision adds on top of that — true N-level recursion, subagents as delegation-graph participants, per-deployment membership UI, tree visualization, canvas attribution, origin-tagged chat history — is missing or half-wired.

### Top 3 gaps

1. **No true N-level recursion.** `executeDelegation()` calls `chatViaExec` and returns the child's text verbatim — it never re-runs `parseDelegationCalls` on the child output. Both callsites hard-code `depth: 1`. `MAX_DELEGATION_DEPTH = 5` is unreachable. **Fractal depth is effectively capped at 1.**
2. **No `parent_call_id` anywhere.** `agent_calls` has no parent FK, no depth, no kind. SSE delegation events carry no parent pointer. Subagent calls (`executeSubagentTool` in `jarble-ui-server.js`) live on a separate rail with no link to the delegation chain they happen inside. **Tree reconstruction is impossible.**
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

### Current state
- `jarble-api-main/src/services/flowEngine.ts:172` — `MAX_NESTING_DEPTH = 3` (subflow DAG path only, not chat delegation)
- `jarble-api-main/src/services/flowDelegation.ts:50` — `MAX_DELEGATION_DEPTH = 5`, guarded at line 342
- `jarble-api-main/src/services/flowDelegation.ts:325-517` — `executeDelegation()` accepts `depth` but never passes it further. After `chatViaExec` returns, the child's text is wrapped in `DelegationResult` and returned. **No recursive `parseDelegationCalls` on the child output.**
- `jarble-api-main/src/routes/flowChat.ts:530` — entry → specialist hard-coded `depth: 1`
- `jarble-api-main/src/routes/tamboAgent.ts:1269` — chat-path team delegation hard-coded `depth: 1`
- `jarble-api-main/src/services/flowEngine.ts:890` — subflow depth check works correctly, but only for the `subflow`-type DAG path, not chat `jarble_delegate`

### Gap
Chat-driven delegation is strictly 1-level. A specialist emitting `jarble_delegate` in its response gets that block surfaced as raw text to the parent — the nested hop never fires.

### Files to modify
- `jarble-api-main/src/services/flowDelegation.ts:446-494` — after `chatViaExec`, call `parseDelegationCalls(result.text)`; if non-empty and `depth+1 < MAX_DELEGATION_DEPTH`, resolve child's flow via `flow_deployment_memberships`, rebuild its `DelegationTool[]`, and recurse
- `jarble-api-main/src/routes/tamboAgent.ts:1269` — thread depth from caller context
- `jarble-api-main/src/routes/flowChat.ts:530` — same

### Effort: M

---

## Piece 2: Subagents as delegation-graph participants

### Current state
- `jarble-api-main/src/mcp/jarble-ui-server.js:312, 315, 7199` — `executeSubagentTool()` POSTs to an API endpoint from inside the pod
- `jarble-api-main/src/db/schema.pg.ts:729-744` — `agent_calls` columns: `caller_deployment_id`, `callee_deployment_id`, `skill_name`, `credits_charged`, `status`, `request_body`, `response_body`, `latency_ms`, `error_message`, `created_at`. **No `parent_call_id`, no `depth`, no `kind`.**
- `jarble-api-main/src/utils/agentCallEvents.ts:34` — event payload has `agentType: "subagent" | "delegation" | "platform"` but no parent pointer

### Gap
When specialist B (delegated from A) invokes subagent S, the two rows in `agent_calls` (`A→B` and `B→S`) are unlinked. Frontend cannot know `B→S` happened inside `A→B`; both show as top-level siblings.

### Files to modify
- `jarble-api-main/src/db/schema.pg.ts:729`, `schema.ts`, `schema.sqlite.ts`, `db/init.ts` — add `parent_call_id` (nullable self-ref), `depth` (int default 0), `kind` (`delegation`|`subagent`|`skill`)
- `jarble-api-main/src/utils/agentCallEvents.ts:34` — add `parentStepId?: string`, `depth: number` to payload
- `jarble-api-main/src/services/flowDelegation.ts:421-434` — include `parentStepId` in `emitOrchestrationStart`
- `jarble-api-main/src/mcp/jarble-ui-server.js:315` — pass current step id through a header so the API can chain. Pod needs its "current step id" from env/request context set by `executeDelegation`

### Effort: M

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

### Current state
- `Jarble-mvp/components/workspace/FlowExecutionTimeline.tsx` (470 lines) — flat timeline over `flowExecutions.stepResults` Record, not a tree
- `Jarble-mvp/components/chat/OrchestrationSteps.tsx` (166 lines) — `OrchestrationStep[]` flat array, no `parentId`, icons differ by `agentType` but all siblings
- `jarble-api-main/src/services/flowEngine.ts:132-140, 950-964` — `substep:started`/`substep:finished` DO carry `parentNodeId`, but only in the subflow DAG path. **Chat delegation events** `jarble.flow.delegation.start/end` in `flowChat.ts:490, 549` and `tamboAgent.ts:1249, 1278` carry **no parent field**
- `delegationTrace` in `flowChat.ts:453` is a flat array

### Gap
Nothing renders a tree; nothing carries the parent pointers the tree would need (outside the unused subflow path).

### Files to modify
- `jarble-api-main/src/routes/flowChat.ts:490, 549` — add `parentStepId` to `jarble.flow.delegation.start/end`
- `jarble-api-main/src/routes/tamboAgent.ts:1249, 1278` — same
- `Jarble-mvp/components/chat/OrchestrationSteps.tsx` — add `parentId?: string`, build tree in `useMemo`, render recursively with indentation
- `Jarble-mvp/components/workspace/FlowExecutionTimeline.tsx` — same tree pattern off `parent_call_id`

### Effort: M

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

- **1-level `jarble_delegate`** in both `flowChat.ts` and `tamboAgent.ts`: parse, legacy `json` fallback, dedupe, IDOR ownership filter, timeout, SSE heartbeat — all solid
- **Flow-engine DAG subflow nesting:** `MAX_NESTING_DEPTH=3` enforced, bubbled `substep:*` events carry `parentNodeId`. The **only** place in the codebase where delegation-graph parent pointers currently exist
- **`flow_deployment_memberships` writer side** (populated by flow CRUD + configSync)
- **Delegated UI block forwarding** via `jarble.flow.delegation.uiblock` with `sourceDeploymentId` — wire format already ships the provenance; only the frontend storage is missing
- **`agent_calls` table** is written to — just needs new columns for parent/depth/kind

---

## Key insight for the founder

**Piece 5 (canvas attribution) is almost free.** The SSE event `jarble.flow.delegation.uiblock` already carries `sourceDeploymentId` — the server is doing the hard work. All that's missing is the frontend to (1) store it on the card and (2) render an attribution footer. This is probably the highest-ROI task: biggest visible impact for smallest code change. **If you ship only one thing from this audit, ship this.**

**Piece 1 (N-level recursion) is the architectural blocker.** Nothing else can be demoed as "fractal" until `executeDelegation` re-parses child output and recurses. Build order: do Piece 1 before Pieces 4 and 5, because without recursion there's nothing interesting to visualize.

**Pieces 2-3-4 should ship together** as one coherent database migration + UI change. Adding `parent_call_id` to `agent_calls` unlocks both the delegation tree visualization and the per-deployment team membership panel. One migration, multiple wins.
