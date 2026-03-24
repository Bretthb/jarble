---
name: flow_engine
description: Orchestration system: flow DAG engine, flow SSE events, flows tRPC router, flow execution REST endpoints
type: reference
---

## Flow Engine (src/services/flowEngine.ts)

Executes directed acyclic graphs (DAGs) of agent nodes with topological sort.

### Node Types

| Type | Description |
|------|-------------|
| `deployment` | Calls a Jarble bot deployment |
| `transform` | Runs a JS/Python transformation script |
| `condition` | Conditional branching |
| `output` | Final result node |

### Key Behaviors

- Pause/resume (human-in-the-loop): flows can pause mid-execution awaiting human input
- Nested flows: a node can invoke another flow as a sub-graph
- 10-minute execution timeout
- In-memory `runningExecutions` Map for SSE reconnection
- Per-user SSE connection limit: `MAX_FLOW_SSE_PER_USER = 5`

### SSE Events (9 types)

- `jarble.flow.snapshot` — initial state on connect
- `jarble.flow.step.started`
- `jarble.flow.step.finished`
- `jarble.flow.step.iteration`
- `jarble.flow.state`
- `jarble.flow.paused`
- `jarble.flow.error`
- `jarble.flow.substep.started`
- `jarble.flow.substep.finished`

## Flows tRPC Router (flows.ts) — 8 procedures

| Procedure | Type | Description |
|-----------|------|-------------|
| `list` | query | List user's flows |
| `getById` | query | Get flow by ID |
| `listExecutions` | query | List execution history for a flow |
| `create` | mutation | Create new flow |
| `update` | mutation | Update flow definition |
| `delete` | mutation | Soft or hard delete |
| `duplicate` | mutation | Fork a flow (new `flw_` ID) |
| `generateFromPrompt` | mutation | AI flow builder — calls `AGENT_LLM_MODEL` with `WORKFLOW_AGENT_SYSTEM_PROMPT` |

IDs use `customAlphabet` nanoid with `flw_` prefix for flows, `fex_` for executions.

## Flow Execution REST Routes (routes/flowExecution.ts)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/flows/:flowId/execute` | Start flow execution |
| POST | `/api/flows/:flowId/executions/:execId/resume` | Resume paused flow |
| GET | `/api/flows/:flowId/executions/:execId/stream` | SSE stream of execution events |

## DB Tables

- `orchestration_flows` — id (flw_xxx), userId FK, name, description, definition (JSON), status (draft/published/archived), isPublic, forkCount, forkedFromId FK, createdAt, updatedAt
- `flow_executions` — id (fex_xxx), flowId FK (cascade delete), userId FK, status, stepResults (JSON), totalCreditsCharged, error, startedAt, completedAt, createdAt
