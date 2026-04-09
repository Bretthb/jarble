---
name: QA Deep Flow Run Apr 8 2026 (overnight)
description: Deep QA of flow CRUD, execution, waitForInput, subflows, race conditions, ownership — 5 bugs found
type: project
---

## Run: Apr 8 2026 — Overnight Deep QA (Flows Focus)

**Why:** Deep QA cycle focused on flow CRUD robustness, execution pipeline, HITL, subflows, delegation, race conditions, ownership enforcement.

**How to apply:** All bugs confirmed reproducible against api.jarble.ai production. Bug IDs BUG-D01 through BUG-D05 need fixes.

---

## Confirmed Passing (Green)

- T0: Auth enforcement — unauthenticated flows.list returns 401 [pass]
- T1: flows.create minimal (empty nodes+edges) → 200 with id [pass]
- T1b: flows.getById shape — all fields present (id, userId, definition, executions array) [pass]
- T2: flows.list returns created flow [pass]
- T3: flows.create with 50 nodes → 200 [pass]
- T5: flows.create with circular edges A→B→A → accepted (cycles are supported by design) [pass]
- T6: flows.create with self-loop A→A → accepted (allowed; engine handles cycles) [pass]
- T8: flows.create missing name → 400 BAD_REQUEST [pass]
- T9: flows.update name only → 200, nodes preserved [pass]
- T10: flows.update replace all nodes → 200, new nodes persisted [pass]
- T11a/b: flows.duplicate with and without name → 200, correct id [pass]
- T11c: Duplicate ownership — userId matches caller, forkedFromId set correctly [pass]
- T11d: forkCount increments on source flow after each duplicate [pass]
- T12a: flows.delete (soft) → 200, archived status [pass]
- T12b: Soft-deleted flow absent from default list [pass]
- T12c: Soft-deleted flow visible with includeArchived:true [pass]
- T14: Execute nonexistent flow → 400 "Missing flow definition" (correct; falls through to body check) [pass]
- T14b: Execute without auth → 401 [pass]
- T15: Execute valid flow → 200 with executionId, flowId, totalSteps [pass]
- T16: GET SSE stream → connected, snapshot event with status=completed [pass]
- T16b: listExecutions shows execution with status=completed [pass]
- T18a: Create waitForInput flow → 200 [pass]
- T18b: Execute waitForInput flow → 200 with executionId [pass]
- T18c: SSE snapshot shows status=paused, pausedAtNodeId set correctly [pass]
- T18d: Resume with nodeId+input → 200 {status: "resumed"} [pass]
- T18e: Post-resume SSE shows status=completed [pass]
- T18f: Resume without nodeId → 400 "Missing or invalid nodeId" [pass]
- T19: Create parent+child subflow → 200 [pass]
- T19b: Execute parent with subflow node → 200, completes [pass]
- T21: flowChat on flow without deployment → 400 "entry bot has no deployment" [pass]
- T26: subagents.list with deploymentId → 200, returns platform subagents [pass]
- T26b: subagents.create → 200 with id + slug [pass]
- T27: Created subagent visible in list [pass]
- T29: subagents.delete → 200 [pass]
- T29b: Deleted subagent returns 404 [pass]
- T30: Concurrent flows.create same name → all 200, names not unique (design intent) [pass]
- T31: Concurrent flows.update same flow → all 200, last-write-wins [pass]
- T32: Concurrent flows.delete → both 200, flow gone [pass]
- T33: Concurrent execute+update same flow → both succeed [pass]
- T34: flows.getById other user's flow → 404 (no enumeration) [pass]
- T35: flows.update other user's flow → 404 [pass]
- T36: flows.delete other user's flow → 404 [pass]
- T37: flows.create referencing unowned deployment → 400 BAD_REQUEST [pass]
- T38: Duplicate public flow → duplicate owned by caller, not original author [pass]
- T39-T42: Execution persistence — status=completed, stepResults populated, totalCreditsCharged=0 [pass]

---

## Bugs Found

### BUG-D01 — MEDIUM: No server-side max-node limit in flows.create/update CRUD
- **Test:** T4 — flows.create with 51 nodes returns 200, flow stored in DB
- **Expected:** 400 "Flow too large: maximum 50 nodes"
- **Actual:** 200, flow created with 51 nodes
- **Where the limit exists:** Only in the execution endpoint (`/api/flows/:id/execute`). The CRUD layer has no validation.
- **Risk:** Users can store arbitrarily large flows in DB, creating storage bloat and eventual execution failures with a confusing error ("too large") at execute time rather than create time
- **Fix:** Add `z.array(FlowNodeSchema).max(50)` to FlowDefinitionSchema in flows.ts create + update input schemas

### BUG-D02 — MEDIUM: No server-side validation that edge source/target reference existing nodes
- **Test:** T7 — flows.create with edge referencing nonexistent nodeId → 200
- **Expected:** 400 "Edge references unknown node: NONEXISTENT_NODE"
- **Actual:** 200, flow stored with dangling edge
- **Risk:** Silent data corruption; flow engine may panic at runtime when traversing edges with no valid target
- **Fix:** Before DB insert in create/update, validate all edge source+target values are in the nodes array

### BUG-D03 — HIGH (regression from cycle 3): flows.generateFromPrompt returns 500 + stack trace when LLM key is misconfigured
- **Test:** T13 — generates 500 INTERNAL_SERVER_ERROR "Flow generation failed: LLM API error 401"
- **Expected:** 503 or 424 PRECONDITION_FAILED "Flow generation requires an LLM API key"
- **Actual:** 500 with internal error message and full stack trace in response
- **Root cause:** The code correctly checks `if (!apiKey)` and throws PRECONDITION_FAILED, but the production environment apparently HAS `OPENROUTER_API_KEY` set to an invalid/unauthenticated value, so the guard passes and the LLM 401 is re-thrown as INTERNAL_SERVER_ERROR instead of being wrapped in a user-friendly error
- **Stack trace leak:** Error responses include full Node.js stack traces (visible in response body under `data.stack`) — HIGH severity security issue still present from cycle 3
- **Fix:** Wrap LLM call errors in explicit TRPCError with `code: "SERVICE_UNAVAILABLE"` and strip stack traces from non-dev error responses

### BUG-D04 — LOW: flowExecution.startedAt is always null in persisted execution rows
- **Test:** T39-T42 regression — listExecutions returns `startedAt: null` for all completed executions
- **Expected:** startedAt should be set when execution begins
- **Actual:** null; only completedAt is set
- **Root cause:** DB insert in flowExecution.ts uses `createdAt: new Date()` but does not set `startedAt`. The engine never updates it either.
- **Impact:** Execution duration cannot be computed from DB records; monitoring/reporting broken
- **Fix:** Set `startedAt: new Date()` in the DB insert, or add an explicit DB UPDATE when execution transitions from "running" to a terminal state

### BUG-D05 — INFO: Resume path in spec doc differs from actual route
- **Test:** T18d (first attempt) — POST /api/flows/executions/:execId/resume → 404
- **Correct path:** POST /api/flows/:flowId/executions/:execId/resume
- **Impact:** Developer/QA documentation issue; not a code bug. The test goal specification listed the wrong URL format.
- **Confirmed working:** The correct path works as expected

---

## Performance
- All flows CRUD operations: 0.09–0.15s (excellent)
- Flow execution (output-only): <0.1s
- Subagent operations: ~0.11s
- generateFromPrompt: ~0.16s (fails before LLM call completes)

## Stack Trace Leak (Regression from Cycle 3)
Still present in all error responses: `data.stack` field contains full Node.js call stack in every TRPCError. This is HIGH severity in production and affects flows.getById, flows.create (validation), flows.update, flows.delete, flows.generateFromPrompt, and all other tRPC procedures.
