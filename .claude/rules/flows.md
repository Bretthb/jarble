---
description: Flow engine, flow CRUD, flow execution, flow SSE events, flow canvas
globs:
  - "jarble-api-main/src/services/flowEngine*"
  - "jarble-api-main/src/trpc/routers/flows*"
  - "jarble-api-main/src/routes/flowExecution*"
  - "jarble-api-main/src/routes/flowChat*"
  - "Jarble-mvp/views/Deployments*"
  - "Jarble-mvp/hooks/useFlowExecution*"
  - "Jarble-mvp/components/workspace/FlowExecution*"
  - "Jarble-mvp/components/workspace/FlowNode*"
---

# Flow Orchestration System

## Flow Engine (`jarble-api-main/src/services/flowEngine.ts`)
- **Execution model**: State-machine DAG — finds entry nodes (no incoming edges), executes in topological order with parallel batches where possible
- **Cycle support**: Nodes in cycles run up to `maxIterations` times (default 10) — enables agent feedback loops
- **Human-in-the-loop (HITL)**: `waitForInput` nodes pause execution until `resume()` is called with user input; this triggers `jarble.flow.paused` SSE and a `/api/flows/executions/:id/resume` REST endpoint
- **Nested flows**: `subflow` nodes spin up a child `FlowEngine` and stream its events as `jarble.flow.substep.*` events
- **Template variables**: Node configs support `{{stepN_result.field}}` syntax resolved at runtime from prior step results
- **Node types**: `deployment` (call a Jarble agent), `transform` (JS expression), `condition` (branch on expression result), `output` (collect results), `waitForInput`, `subflow`
- **Credit billing**: Deployment nodes consume agent credits via `executeAgentCall()`

## Flow CRUD (`jarble-api-main/src/trpc/routers/flows.ts`)
8 tRPC procedures (all `protectedProcedure`):
- `list` — list all flows for the authed user (excludes archived by default)
- `getById` — fetch a single flow with its definition
- `create` — create a new flow (nodes need `label` and `position` fields)
- `update` — update name, description, or node/edge definition
- `delete` — soft delete by default (status=archived); pass `hard: true` for permanent
- `duplicate` — copy a flow with a new name (input key: `sourceFlowId`)
- `listExecutions` — paginated execution history for a flow
- `generateFromPrompt` — LLM-generated flow definition from a natural-language prompt

## Flow Execution Routes (`jarble-api-main/src/routes/flowExecution.ts`)
- `POST /api/flows/:flowId/execute` — authenticated, starts execution, returns `{ executionId }` as JSON
- `GET /api/flows/:flowId/executions/:execId/stream` — SSE stream; supports reconnect with buffered replay
- `POST /api/flows/executions/:executionId/resume` — unpauses a `waitForInput` node with user-provided input
- `POST /api/flows/:flowId/chat` — chat with a flow via LLM gateway (10K char message limit)
- Rate-limited to 5 concurrent SSE connections per user (`MAX_FLOW_SSE_PER_USER`)

## Flow SSE Events
9 event types emitted on the stream endpoint:

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

## Flow Canvas (`Jarble-mvp/views/Deployments.tsx`)
Flow graphs are visualized and edited using `@xyflow/react`. Custom node and edge types rendered inline. 3 tabs: Linked Deployments, Agent Teams (flow canvas), Resource Map.

## Adding a New Flow Node Type
1. Add the type literal to `FlowNode["type"]` union in `flowEngine.ts`
2. Add a handler branch in `FlowEngine.executeStep()`
3. Add the new node type to the `@xyflow/react` node-type registry in `Deployments.tsx`
4. Update the `generateFromPrompt` system prompt in `flows.ts`
