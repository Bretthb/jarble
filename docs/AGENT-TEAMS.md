# Agent Teams and Orchestration

**Jarble Platform — Technical Reference**
Last updated: April 9, 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Core Mental Model](#core-mental-model)
3. [Architecture](#architecture)
4. [Feature Inventory](#feature-inventory)
5. [How Delegation Works — Step by Step](#how-delegation-works--step-by-step)
6. [How to Create an Agent Team](#how-to-create-an-agent-team)
7. [Component Rendering During Delegation](#component-rendering-during-delegation)
8. [Cost Controls](#cost-controls)
9. [Memory in Teams](#memory-in-teams)
10. [Frontend: Canvas, Chat, and Debug Views](#frontend-canvas-chat-and-debug-views)
11. [Security Model](#security-model)
12. [A2A Protocol Reference](#a2a-protocol-reference)
13. [SSE Event Reference](#sse-event-reference)
14. [Known Limitations](#known-limitations)
15. [Key Files](#key-files)

---

## Overview

Agent Teams let you connect multiple Jarble agents into a collaborative network. A user sends one message to a coordinator agent; the coordinator silently fans out work to specialist agents; each specialist replies with text and rich visual components; the coordinator synthesizes a unified response and sends it back to the user.

The user sees a single conversation. Behind the scenes, N agents ran in parallel.

This is different from Jarble's other execution model, the DAG-based Flow Engine, which requires pre-defined step sequences and explicit triggers. Agent Teams are conversational and dynamic: the coordinator LLM decides at runtime which specialists to invoke, based on the user's message and the team structure you defined.

Both modes are built into the same platform and share the same infrastructure.

---

## Core Mental Model

**Deployments as logic gates.**

Each agent in a team is an independent, always-running K8s pod with its own LLM, system prompt, and memory. The team topology — which agent can delegate to which — is encoded as a directed graph of `"delegates"` edges stored in the flow definition. When the coordinator agent calls a specialist, it is literally exec-ing into that pod's OpenClaw process and injecting a structured task message.

The key insight is that every agent in a team is simultaneously:

1. A standalone chat interface (accessible at `/d/[id]`)
2. A first-class citizen in zero or more agent teams (connected via flow edges)
3. An A2A-compatible agent (callable by any external system via `POST /api/a2a/:id/tasks/send`)

This means a "CTO agent" you built for your own use can be plugged into a larger orchestrated team without any code changes. Its capabilities, model, and system prompt remain exactly as configured. The team structure is an overlay, not a replacement.

```
User message
    │
    ▼
┌────────────────────────┐
│   Coordinator Bot       │   ← entry node, talks to user
│   (any Jarble deploy)  │
└────────┬───────────────┘
         │ jarble_delegate block
         │ (one per specialist)
    ┌────┴─────┐
    ▼          ▼
┌────────┐ ┌────────┐    parallel fan-out (Promise.allSettled)
│  Bot A │ │  Bot B │    each bot runs in its own pod
└────────┘ └────────┘
         │
         ▼
   Coordinator receives
   full replies, synthesizes,
   streams to user
```

---

## Architecture

### Components and Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (Next.js)                           │
│                                                                     │
│  Deployments.tsx (canvas + chat)                                    │
│    - FlowCanvas: ReactFlow graph with live edge animations          │
│    - TeamChatPanel: SSE consumer, renders OrchestrationSteps tree   │
│    - TeamSessionsPanel: delegation history from agent_calls         │
│    - DebugTracePanel: full OTel-ready span tree per trace           │
└────────────────────────────┬────────────────────────────────────────┘
                             │ SSE  (POST /api/flows/:id/chat)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Express API (Node.js)                          │
│                                                                     │
│  flowChat.ts          ← orchestration entry point                   │
│    1. Auth + flow ownership check                                   │
│    2. Load flow definition, find entry node                         │
│    3. Build DelegationTools from edges                              │
│    4. Augment entry bot system prompt (buildFlowSystemPrompt)       │
│    5. chatViaExec → entry bot pod                                   │
│    6. Parse jarble_delegate blocks (parseDelegationCalls)           │
│    7. executeDelegation() for each — parallel via Promise.allSettled│
│    8. Compose step (if ≥2 specialists produced UI blocks)           │
│    9. Synthesis turn (entry bot weaves results)                     │
│   10. Emit jarble.flow.chat.trace with cost summary                 │
│                                                                     │
│  flowDelegation.ts    ← delegation engine                           │
│    - buildDelegationTools()    build tools from graph edges         │
│    - buildFlowSystemPrompt()   augment coordinator prompt           │
│    - parseDelegationCalls()    parse jarble_delegate fence blocks   │
│    - executeDelegation()       recursive N-level hop execution      │
│      - cycle detection (DelegationCycleError)                       │
│      - depth guard (DelegationDepthExceededError, default max=4)    │
│      - budget check (maxBudgetCents per trace)                      │
│      - agentCallsWriter.startAgentCall() → insert agent_calls row  │
│      - chatViaExec → specialist pod                                 │
│      - re-parse response for sub-delegations (fractal)              │
│                                                                     │
│  agentCallsWriter.ts  ← OTel-ready audit writer                     │
│    - insert-then-update pattern (pending → completed/failed)        │
│    - W3C trace_id/span_id generation (OTel bridge)                  │
│    - runaway circuit breaker (MAX_SPANS + MAX_CREDITS per trace)    │
│                                                                     │
│  a2aGateway.ts        ← external A2A endpoints                      │
│    GET  /api/a2a/:id/agent.json   → agent capability card           │
│    POST /api/a2a/:id/tasks/send   → synchronous task execution      │
└────────────────────────┬────────────────────────────────────────────┘
                         │ kubectl exec (chatViaExec)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       K8s Cluster (K3s)                             │
│                                                                     │
│  Coordinator Pod           Specialist Pod A    Specialist Pod B     │
│  ┌─────────────────┐      ┌───────────────┐   ┌───────────────┐    │
│  │  openclaw agent  │      │ openclaw agent│   │ openclaw agent│    │
│  │  soul.md:        │      │ soul.md       │   │ soul.md       │    │
│  │  + role/goal     │      │ (unchanged)   │   │ (unchanged)   │    │
│  │  + delegate inst │      │               │   │               │    │
│  │  MCP server      │      │ MCP server    │   │ MCP server    │    │
│  │  (jarble-ui.js)  │      │ (jarble-ui.js)│   │ (jarble-ui.js)│    │
│  └─────────────────┘      └───────────────┘   └───────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `orchestration_flows` | Flow definitions (nodes + edges as JSONB), owned per-user |
| `agent_calls` | Every delegation hop: trace_id, span_id, parent_call_id, credits, duration |
| `flow_deployment_memberships` | Denormalized index: deploymentId → flowId + nodeId (for recursive lookup) |

The `agent_calls` table is the source of truth for all cost attribution, audit trails, and debug traces. Every delegation hop — including sub-delegations nested N levels deep — writes a row here chained via `parent_call_id`.

---

## Feature Inventory

### Shipped

| Feature | Status | Source |
|---------|--------|--------|
| Fractal delegation (N-level recursive) | Shipped | `flowDelegation.ts:executeDelegation()` |
| Parallel fan-out (Promise.allSettled) | Shipped | `tamboAgent.ts:MAX_CONCURRENT_DELEGATIONS` |
| `jarble_delegate` fenced block protocol | Shipped | `flowDelegation.ts:parseDelegationCalls()` |
| Cycle detection (DelegationCycleError) | Shipped | `flowDelegation.ts:L98-110, L597-600` |
| Max depth guard (default 4, env override) | Shipped | `JARBLE_MAX_DELEGATION_DEPTH` env var |
| Compose step (merge multi-specialist UI) | Shipped | `flowChat.ts:L684-795` |
| Live edge animations on canvas | Shipped | `Deployments.tsx:activeDelegationTargets` |
| Per-hop cost tracking (`agent_calls`) | Shipped | `agentCallsWriter.ts` |
| Budget cap per coordinator (`maxBudgetCents`) | Shipped | `flowDelegation.ts:L602-623` |
| Runaway circuit breaker (spans + credits) | Shipped | `agentCallsWriter.ts:RunawayTraceError` |
| Three-tier memory (core/archival/session) | Shipped | `openclaw.ts:JARBLE_UI_PROMPT` |
| Team Sessions panel | Shipped | `TeamSessionsPanel.tsx` + `deployment.listTeamSessions` |
| Debug Traces panel | Shipped | `DebugTracePanel.tsx` + `deployment.listRecentTraces` |
| Canvas card attribution ("from Agent A") | Shipped | `Deployments.tsx:producerRole, producerDeploymentId` |
| DELEGATION_CONTEXT injection | Shipped | `flowDelegation.ts:L683` |
| CANVAS_STATE injection for delegates | Shipped | `flowDelegation.ts:L683` |
| Delegation rendering hints | Shipped | `flowDelegation.ts:L673-683` |
| Resource Map with env var panel | Shipped | `ResourceMapView.tsx` |
| Dashboard tabs (My Agents / Agent Teams / Resources) | Shipped | `Dashboard.tsx:DashboardTab` |
| A2A agent card endpoint | Shipped | `a2aGateway.ts:GET /api/a2a/:id/agent.json` |
| A2A task send endpoint | Shipped | `a2aGateway.ts:POST /api/a2a/:id/tasks/send` |
| A2A MCP tool (`a2a_delegate`) in pod | Shipped | `jarble-ui-server.js:DELEGATION_TOOLS` |
| OTel W3C trace/span IDs on all rows | Shipped | `agentCallsWriter.ts:getOtelIds()` |
| Langfuse integration (via exporter) | Shipped | Langfuse exporter + `agentCallsWriter` bridge |
| Skip diagnostic (why delegation didn't fire) | Shipped | `flowChat.ts:jarble.flow.delegation.skipped` |
| Synthesis heartbeat (5s keepalive) | Shipped | `flowChat.ts:heartbeat setInterval` |
| Session isolation per conversation | Shipped | `sessionKey` includes `conversationId` |
| Per-user SSE connection limit (3) | Shipped | `flowChat.ts:MAX_FLOW_CHAT_SSE_PER_USER` |

### Planned / In Progress

| Feature | Notes |
|---------|-------|
| Streaming delegation (real-time specialist output) | Current: delegation is non-streaming; specialist reply arrives when complete |
| Configurable parallel concurrency per flow | `MAX_CONCURRENT_DELEGATIONS` is currently a global env var |
| Org-scoped flow ownership | Flows are currently per-user; org-level scoping is reserved in schema |
| Streaming A2A responses | Current A2A is synchronous (full response in one HTTP response) |
| chatViaExec system-prompt channel | Currently injects augmented prompt into user turn via header tag |

---

## How Delegation Works — Step by Step

### 1. User sends a message

The browser POSTs to `POST /api/flows/:flowId/chat` with a Bearer JWT. The API verifies the JWT, confirms the user owns the flow, and confirms the entry agent is running.

### 2. API builds delegation tools

```
buildDelegationTools(entryNode, definition.nodes, definition.edges)
```

Scans all outgoing `"delegates"` edges from the entry node. For each edge, it looks up the target node's `role`, `goal`, and deployment capabilities. It constructs a `DelegationTool` object per edge:

```
{
  name: "delegate_to_chart_specialist",
  description: "Delegate to Chart Specialist. Goal: Render all data visualizations.",
  targetNodeId: "...",
  targetDeploymentId: "...",
  contextScope: "task" | "summary" | "full"
}
```

### 3. API augments the coordinator's system prompt

```
buildFlowSystemPrompt(entryNode, delegationTools, basePrompt)
```

The coordinator's existing system prompt (`soul.md`) is extended with:

- A `## Your Role in This Team` section (role, goal)
- A `## Team Members You Can Delegate To` section (one line per specialist, with bare slug)
- A `## How to Delegate` section with the canonical `jarble_delegate` fenced block format
- Hard rules about when to delegate vs. answer directly

The augmented prompt is injected into the user message wrapped in `[FLOW SYSTEM INSTRUCTIONS — AUTHORITATIVE]` markers, because the current chat pathway does not support a separate system prompt channel.

### 4. Entry agent responds (possibly with delegation blocks)

The coordinator LLM sees the augmented prompt and decides whether to delegate. If it delegates, it emits one or more fenced code blocks:

````
```jarble_delegate
{ "to": "chart_specialist", "task": "Render a bar chart of Q1 revenue by region", "context": "User asked for regional breakdown" }
```
````

Multiple blocks in the same response trigger parallel fan-out.

### 5. API parses and executes delegations

`parseDelegationCalls()` extracts all `jarble_delegate` blocks. The API then calls `executeDelegation()` for each — currently sequentially in `flowChat.ts`, but `tamboAgent.ts` runs them in parallel via `Promise.allSettled` with `MAX_CONCURRENT_DELEGATIONS`.

For each delegation:

1. Cycle check: if `targetDeploymentId` is already in `ancestorDeploymentIds`, throw `DelegationCycleError`
2. Depth check: if `depth > MAX_DELEGATION_DEPTH`, throw `DelegationDepthExceededError`
3. Budget check: sum `credits_charged` for this `traceId`; if over `maxBudgetCents`, throw
4. Ownership check: confirm the target deployment belongs to the same user (or their org)
5. `startAgentCall()`: insert a pending `agent_calls` row (OTel span_id, trace_id, depth)
6. Inject `[CANVAS_STATE]` and `[DELEGATION_CONTEXT]` tags into the task message
7. `chatViaExec()`: kubectl exec into the specialist pod with the task
8. Parse the specialist's response for nested `jarble_delegate` blocks (fractal recursion)
9. `finishAgentCall()`: update the row with duration, credits, status

### 6. Compose step (optional)

If two or more specialists produced `jarble_ui` components (UI blocks), the API emits `jarble.flow.compose.available` and passes a compose instruction to the coordinator's synthesis turn, allowing the coordinator to produce a unified dashboard that combines all specialist outputs.

### 7. Synthesis turn

The coordinator is called again with the full (untruncated) text replies from every specialist, wrapped in `[BEGIN slug FULL REPLY] ... [END slug FULL REPLY]` markers. The coordinator synthesizes a brief summary. Both the raw specialist replies and the summary are streamed to the user.

### 8. Trace event

`jarble.flow.chat.trace` is emitted with the full delegation trace, including per-hop duration and cost.

---

## How to Create an Agent Team

### Prerequisites

- At least two running deployments (agents)
- Both agents must be deployed and have `status: "running"`

### Steps

1. **Open the Agent Teams tab** — on the dashboard, switch to the "Agent Teams" tab. This loads `Deployments.tsx` with the `@xyflow/react` canvas.

2. **Create a new flow** — click "New Flow" to create an `orchestration_flows` record.

3. **Add agents as nodes** — drag deployments from the sidebar onto the canvas. Each node represents one agent in the team.

4. **Mark the entry point** — right-click the coordinator node and set `isEntryPoint: true`. This is the agent the user will talk to. If no node is marked, the first node in the array is used as a fallback.

5. **Set roles and goals** — in the node config panel (`FlowNodeConfigPanel`), set:
   - `role`: short label for the coordinator's delegation prompt (e.g. "CTO", "Research Specialist")
   - `goal`: one sentence describing what this agent does in the team
   - `canDelegate`: whether this node is allowed to delegate outward (defaults to true)

6. **Draw delegation edges** — connect nodes with edges of type `"delegates"`. The source agent can call the target agent. Draw edges FROM the coordinator TO each specialist.

7. **Configure context scope** — on each edge, choose how much conversation history to pass:
   - `task`: pass only the delegated task string (default, lowest latency)
   - `summary`: pass task + optional context field
   - `full`: pass the last 20 messages of conversation history

8. **Save the flow** — click Save. The flow definition (nodes + edges) is persisted to `orchestration_flows.definition`.

9. **Start chatting** — click the "Chat" tab within Agent Teams. Messages go to `POST /api/flows/:id/chat`.

### Node configuration reference

```typescript
// FlowNode fields relevant to bot teams
interface FlowNode {
  id: string;
  deploymentId?: string;      // Which running deployment this node represents
  label: string;              // Display name on canvas
  role?: string;              // Injected into coordinator prompt ("CTO", "Analyst")
  goal?: string;              // Injected into coordinator prompt (one sentence)
  canDelegate?: boolean;      // Set false to prevent this node from delegating
  contextScope?: "task" | "summary" | "full";
  isEntryPoint?: boolean;     // Mark exactly one node per flow
}

// FlowEdge fields relevant to bot teams
interface FlowEdge {
  type?: "delegates" | "reports" | "collaborates"; // "delegates" enables delegation
  contextScope?: "task" | "summary" | "full";      // Overrides node-level scope
}
```

---

## Component Rendering During Delegation

Each agent pod runs the full OpenClaw stack with the Jarble UI MCP server (`jarble-ui-server.js`). Agents can render `jarble_ui` components (charts, tables, stat grids, sandboxes, etc.) in any context, including when being called as a specialist.

The challenge: by default, `JARBLE_UI_PROMPT` instructs agents to render UI only when they detect a `[CANVAS_STATE]` tag in the conversation — which is only present on the Jarble web dashboard, not in delegation calls.

The fix: `executeDelegation()` prepends the task message with two synthetic tags before sending it to the specialist pod:

```
[CANVAS_STATE]
No cards on canvas.
[/CANVAS_STATE]
[DELEGATION_CONTEXT]
You are being delegated a task by a coordinator bot. Render your response as jarble_ui components.
IMPORTANT RENDERING RULES FOR DELEGATION:
- Prefer SIMPLE built-in components (stat_grid, data_table, chart, metric_card) over sandbox
- Use sandbox ONLY when explicitly asked for a full dashboard or interactive widget
- For tables: use data_table (NOT sandbox with HTML tables)
- For charts: use the built-in chart component with recharts format (NOT sandbox with Chart.js)
- For metrics: use stat_grid or metric_card
- Keep responses focused — render ONE component per delegated task
- Use realistic data, never placeholders
- Include layout_hint: "full-width" for tables/charts, "half" for metrics
[/DELEGATION_CONTEXT]
```

This ensures the specialist behaves as if it is on the dashboard and renders rich components instead of plain text.

### Canvas card attribution

When a specialist produces a `jarble_ui` block, the API emits a `jarble.flow.delegation.uiblock` SSE event with:

```json
{
  "delegationToolName": "delegate_to_chart_specialist",
  "sourceDeploymentId": "<specialist-deployment-id>",
  "sourceRole": "Chart Specialist",
  "block": { ... }
}
```

The frontend (`Deployments.tsx`) renders these as canvas cards below the chat bubble, each tagged with `producerRole` and `producerDeploymentId` so the user can see which agent produced which component.

---

## Cost Controls

### Per-trace budget cap

Set `maxBudgetCents` on the coordinator deployment. Before each delegation hop, `executeDelegation()` queries `agent_calls` for the running total of `credits_charged` across all rows sharing the current `traceId`. If the total is at or above the cap, the delegation is rejected:

```
Delegation budget exceeded for this bot. Spent 320 cents (limit: 200 cents).
Increase the budget in deployment settings to allow more delegations.
```

This is a TOCTOU-racy check (parallel hops can both pass the check before either finishes), described further in [Known Limitations](#known-limitations).

### Runaway circuit breaker

`agentCallsWriter.ts` enforces two hard limits per `traceId` (a single root chat turn):

| Limit | Default | Override |
|-------|---------|---------|
| Max spans per trace | 50 | `JARBLE_MAX_SPANS_PER_TRACE` |
| Max credits per trace | 500 cents ($5.00) | `JARBLE_MAX_CREDITS_PER_TRACE_CENTS` |

When either limit is exceeded, `startAgentCall()` throws `RunawayTraceError`. This propagates up through `executeDelegation()` and terminates the delegation chain immediately.

The check is fail-open: if the database query itself fails, the call is allowed through and a warning is logged. Observability must not break the application.

The span-count check only fires for `depth >= 1` (delegation hops). Root-level chat turns (`depth 0`) always succeed.

### Max delegation depth

Default: 4 levels deep. Override with `JARBLE_MAX_DELEGATION_DEPTH` (must be a positive integer less than 20).

Depth semantics:
- Depth 0: user to entry agent (no `agent_calls` row)
- Depth 1: entry agent to first specialist
- Depth 2: specialist to sub-specialist
- Depth N: N-th hop

A call at `depth > MAX_DELEGATION_DEPTH` throws `DelegationDepthExceededError` before any pod is contacted.

---

## Memory in Teams

Each agent in a team has independent, scoped memory via the three-tier system described in `JARBLE_UI_PROMPT`:

| Tier | MCP tools | Scope |
|------|-----------|-------|
| Core (identity) | `core_memory_read`, `core_memory_write` | Persistent persona + user preferences |
| Archival (long-term) | `archival_insert`, `archival_search` | Cross-platform facts |
| Session (short-term) | `store_memory` / `recall_memory` via mcporter | Per-conversation or global (configurable) |

Memory scope is configured per deployment (`memoryScope: "global" | "session" | "off"`). Agents are instructed to prefer Jarble's scope-aware MCP tools (`jarble-ui.store_memory`, `jarble-ui.recall_memory`) over OpenClaw's native memory tools, because the native tools bypass the scope enforcement.

During a delegation, the specialist's memory operates independently of the coordinator's. A specialist can remember facts from past tasks (global scope) or keep memory isolated per call (session scope). There is currently no shared team memory across agents.

---

## Frontend: Canvas, Chat, and Debug Views

### Agent Teams Canvas (`Deployments.tsx`)

The main canvas uses `@xyflow/react` with three tabs:

- **Linked Deployments** — list view of agents in the flow
- **Agent Teams** — visual graph editor with custom nodes and edges
- **Resource Map** — auto-layout diagram of all resource relationships

**Live edge animations**: when the coordinator is actively delegating, the canvas renders specialist nodes and their connecting edges in a "running" state (pulsing animation). This is driven by `activeDelegationTargets: Set<string>` — a set of deployment IDs currently receiving a delegation — updated from `jarble.flow.delegation.start` and `jarble.flow.delegation.end` SSE events.

**Node types** registered with ReactFlow:
- `flowNode` — deployment node with status badge, model display, credit meter
- `flowEdge` — animated directional edge with delegation status overlay

### OrchestrationSteps (`OrchestrationSteps.tsx`)

Real-time step tree rendered in the chat panel during delegation. Builds a parent-child tree from `parentId` pointers (sourced from `parentStepId` on SSE events, which maps to `agent_calls.parent_call_id`).

Step types with icons:
- `delegation` — ArrowRightLeft icon, indicates an agent-to-agent delegation hop
- `subagent` — Bot icon, indicates a subagent tool call
- `platform` — Cpu icon, indicates a platform tool call

Steps can be `pending | running | complete | error`. Duration is shown on completion.

### TeamSessionsPanel (`TeamSessionsPanel.tsx`)

Shows delegation history for a specific deployment from both sides of the relationship:
- "Coordinator" view: tasks this agent delegated outward
- "Specialist" view: tasks this agent received from a coordinator

Data comes from `trpc.deployment.listTeamSessions`, which queries `agent_calls` for rows where this deployment is either `caller_deployment_id` or `callee_deployment_id`. Refreshes every 30 seconds.

Each session entry shows: task preview, direction (sent/received), other agent name, status, duration, and cost.

### DebugTracePanel (`DebugTracePanel.tsx`)

Shows the full OTel span tree for recent traces involving this deployment. Two tRPC procedures power it:

- `deployment.listRecentTraces` — last N distinct `trace_id` values where this deployment appears in `agent_calls`, with summary stats per trace (span count, max depth)
- `deployment.getAgentCallsByTrace` — all `agent_calls` rows for a given `trace_id`, ordered by depth, for reconstructing the tree client-side

Each row displays: span name, skill name, status badge, duration, caller and callee short IDs, and an optional Langfuse trace link (shown when `LANGFUSE_HOST` is exposed).

Authorization: `getAgentCallsByTrace` only returns rows for traces where the authed user owns at least one of the participating deployments.

### Resource Map (`ResourceMapView.tsx`)

Auto-layout diagram (dagre) showing relationships between all user deployments. Edge types:

| Edge type | Color | Meaning |
|-----------|-------|---------|
| `api_key_share` | Green (solid) | Agent B uses an API key owned by Agent A |
| `agent_call` | Purple (dashed) | Agent A has delegated to Agent B at least once |
| `flow_connection` | Blue (solid) | Agent A and Agent B are in the same flow |
| `shared_platform` | Orange (dashed) | Agents share a messaging platform credential |

Clicking a node opens an env var panel showing the agent's current environment configuration. Useful for debugging misconfigured credentials or shared-key relationships.

---

## Security Model

### Ownership verification on every delegation hop

`executeDelegation()` verifies that the `targetDeploymentId` belongs to the requesting user before calling the pod. The check includes both personal ownership and org membership:

```typescript
whereConditions = and(
  eq(tables.deployments.id, params.targetDeploymentId),
  or(
    eq(tables.deployments.userId, params.userId),
    inArray(tables.deployments.orgId, orgIds),   // org membership
    eq(tables.deployments.isPublic, true),        // public deployments
  )
);
```

This prevents IDOR: a coordinator agent cannot be used to reach a deployment owned by a different user, even if that deployment's ID is somehow obtained.

### Flow topology ownership scoping

When loading flow context for recursive sub-delegation (`loadFlowContextForDeployment`), the flow is filtered by `userId` ownership:

```typescript
flowWhere = and(
  eq(tables.orchestrationFlows.id, membership.flowId),
  eq(tables.orchestrationFlows.userId, userId),
);
```

This prevents a deployment in a recursive delegation chain from exposing the topology of a flow owned by a different user.

### Cycle detection

`executeDelegation()` maintains an `ancestorDeploymentIds` array threaded through all recursive hops. Before contacting any pod, the target's ID is checked against this array. If it appears (A delegated to B, B tries to delegate back to A), `DelegationCycleError` is thrown immediately — no pod is contacted, no credits are charged.

### Authentication

All endpoints require Auth0 Bearer JWT. The A2A endpoints additionally accept API keys with an `a2a:invoke` scope. The agent card (`GET /api/a2a/:id/agent.json`) is publicly accessible for public deployments; private deployments require ownership verification.

### Input validation

- Message length capped at 10,000 characters (`flowChat.ts`, `a2aGateway.ts`)
- Session IDs validated against `/^[\w\-]{1,128}$/` before use as CLI arguments (defense against command injection)
- A2A context object capped at 5,000 characters when serialized
- Per-user concurrent SSE connection limit: 3 for flow chat

---

## A2A Protocol Reference

The A2A (Agent-to-Agent) gateway exposes each Jarble agent as a standalone callable agent following the Google A2A protocol schema.

### Agent Card

```
GET /api/a2a/:deploymentId/agent.json
```

Returns a capability descriptor for the agent. Public deployments: no auth required. Private deployments: requires Bearer JWT or org membership.

**Response:**
```json
{
  "name": "Chart Specialist",
  "description": "First 200 chars of system prompt",
  "url": "https://api.jarble.ai/api/a2a/<id>",
  "version": "1.0.0",
  "protocol": "a2a/v1",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "skills": [
    {
      "id": "chat",
      "name": "Chat",
      "description": "Send a message and receive a response",
      "inputModes": ["text"],
      "outputModes": ["text"]
    }
  ],
  "authentication": { "schemes": ["bearer"] },
  "status": "available"
}
```

### Send Task

```
POST /api/a2a/:deploymentId/tasks/send
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Request body:**
```json
{
  "message": "Generate a monthly revenue chart",
  "sessionId": "optional-session-id",
  "context": { "optional": "object up to 5000 chars" }
}
```

**Response (A2A Task schema):**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "<taskId>",
    "sessionId": "<session>",
    "status": {
      "state": "completed",
      "timestamp": "2026-04-09T12:00:00.000Z"
    },
    "artifacts": [
      {
        "parts": [
          { "type": "text", "text": "Here is your chart..." },
          {
            "type": "data",
            "data": { "component": "chart", "props": { ... } },
            "metadata": { "mimeType": "application/vnd.jarble.ui-block+json" }
          }
        ]
      }
    ],
    "metadata": {
      "durationMs": 1820,
      "deploymentId": "...",
      "deploymentName": "Chart Specialist",
      "tokenUsage": null
    }
  }
}
```

UI blocks are included as `"data"` parts with MIME type `application/vnd.jarble.ui-block+json`. The `component` and `props` fields match the standard `jarble_ui` block schema.

**Error responses** use JSON-RPC error codes:
- `-32001`: Authentication required
- `-32004`: Deployment not found or access denied
- `-32005`: Agent is not running
- `-32006`: No running pod found
- `-32602`: Invalid parameters (message too long, invalid sessionId, context too large)

### A2A MCP Tool (inside pods)

Pods that are members of an agent team have a `delegation-tools.json` loaded by `jarble-ui-server.js`. This file contains an `a2a_delegate` MCP tool definition:

```json
{
  "name": "a2a_delegate",
  "description": "Delegate a task to a team member via the A2A protocol",
  "inputSchema": {
    "type": "object",
    "properties": {
      "to":      { "type": "string", "description": "Target bot slug" },
      "task":    { "type": "string", "description": "Task to delegate" },
      "context": { "type": "string", "description": "Optional context" }
    },
    "required": ["to", "task"]
  }
}
```

When a pod calls this tool, `jarble-ui-server.js` returns a structured JSON result. The API-side gateway (`flowDelegation.ts`) receives this result via the chat response and routes the delegation accordingly.

The preferred delegation mechanism is the `jarble_delegate` fenced block format (taught via the augmented system prompt), not the MCP tool. The MCP tool is Phase 1 of the A2A integration and provides a more structured alternative for agents that prefer tool-call semantics.

---

## SSE Event Reference

All events follow the AG-UI protocol used by the rest of the platform. Flow-specific events use the `CUSTOM` type with a `name` field.

### Standard AG-UI Events

| Event type | When |
|-----------|------|
| `RUN_STARTED` | Chat turn begins |
| `TEXT_MESSAGE_START` | Assistant message begins |
| `TEXT_MESSAGE_CONTENT` | Text delta (incremental) |
| `TEXT_MESSAGE_END` | Assistant message ends |
| `RUN_FINISHED` | Chat turn complete |

### Flow Chat Events

| Event name | When | Key fields |
|-----------|------|-----------|
| `jarble.flow.delegation.start` | A delegation begins | `toolName`, `targetNodeId`, `targetDeploymentId`, `targetRole`, `task` |
| `jarble.flow.delegation.end` | A delegation completes | `toolName`, `success`, `durationMs`, `creditsUsed`, `responsePreview`, `uiBlockCount` |
| `jarble.flow.delegation.heartbeat` | Every 5s during long delegations | `toolName`, `targetDeploymentId`, `elapsedMs` |
| `jarble.flow.delegation.uiblock` | Specialist produced a UI component | `delegationToolName`, `sourceDeploymentId`, `sourceRole`, `block` |
| `jarble.flow.delegation.skipped` | Delegation did not fire | `reason` (no_tools_available / tool_call_not_emitted / mentioned_but_not_emitted), `availableTools` |
| `jarble.flow.synthesis.start` | Coordinator synthesis turn begins | `delegationCount` |
| `jarble.flow.synthesis.end` | Coordinator synthesis turn ends | `delegationCount` |
| `jarble.flow.compose.available` | 2+ specialists produced UI blocks | `delegationCount`, `sources` |
| `jarble.flow.chat.trace` | End of turn cost summary | `flowId`, `delegations[]`, `totalCreditsUsed` |

### Orchestration Step Events (from agentCallEvents emitter)

| Event name | When | Key fields |
|-----------|------|-----------|
| `jarble.orchestration.step.start` | Any delegation hop starts | `stepId`, `agentType`, `agentName`, `toolName`, `task`, `targetDeploymentId`, `parentStepId`, `depth` |
| `jarble.orchestration.step.end` | Any delegation hop ends | `stepId`, `success`, `durationMs`, `error`, `resultPreview` |

These events are emitted by `agentCallEvents` (an EventEmitter) and forwarded to the SSE stream. They power the `OrchestrationSteps` tree component.

### Flow Execution Events (formal execution mode)

See `docs/ORCHESTRATION-SPEC.md` for the full event list used by the DAG-based flow executor.

---

## Known Limitations

### TOCTOU budget race

The `maxBudgetCents` budget check reads the running credit total with a SELECT before starting a new delegation hop. In a parallel fan-out (multiple delegations firing at the same time), two hops can both pass the check before either completes and writes its cost. This means a coordinator with a $2 budget could briefly exceed the cap if it fans out to 3 specialists simultaneously and each costs $1.

Mitigation: the runaway circuit breaker (`MAX_CREDITS_PER_TRACE_CENTS`) is a harder stop that fires on the next hop after the credit total is written. The budget cap is a soft limit; the circuit breaker is the hard backstop.

### Think tag edge cases in synthesis

The synthesis turn strips `<think>` and `<reasoning>` tags from specialist replies before presenting them to the coordinator. If a specialist uses a non-standard tag variant (e.g. `<THINKING>`), the tags will pass through to the synthesis context. The coordinator may interpret them as part of the reply content.

### Sandbox timeout in delegation

The default sandbox execution timeout applies to delegated tasks the same as regular chat. A specialist asked to build a complex interactive widget may time out. Prefer simple built-in components (`stat_grid`, `data_table`, `chart`) over sandboxes when delegating.

### System prompt injection via user turn

The coordinator's augmented flow prompt is injected into the user turn wrapped in `[FLOW SYSTEM INSTRUCTIONS]` markers, not into a true system prompt channel. Some models treat this as lower priority than their base system prompt. The header tag helps, but is a workaround until `chatViaExec` gains a dedicated system prompt argument.

### Delegation mentioned but not emitted

If the coordinator LLM describes a delegation in natural language ("I've asked the Chart Specialist to...") without emitting the `jarble_delegate` fenced block, the delegation silently does not execute. The API detects this pattern and emits `jarble.flow.delegation.skipped` with `reason: "mentioned_but_not_emitted"`, which surfaces in logs and the frontend diagnostic. The user sees the coordinator's natural-language text but no actual delegation result.

### Memory isolation between specialists

Specialists do not share memory with each other or with the coordinator. Each agent accesses only its own mcporter memory store. There is no team-scoped shared memory namespace.

---

## Key Files

| File | Purpose |
|------|---------|
| `jarble-api-main/src/services/flowDelegation.ts` | Delegation engine: tool building, prompt augmentation, parsing, execution, cycle detection |
| `jarble-api-main/src/routes/flowChat.ts` | Flow chat SSE endpoint: orchestration entry, parallel fan-out, compose, synthesis |
| `jarble-api-main/src/routes/tamboAgent.ts` | Individual agent chat: delegation support, parallel concurrency, orchestration events |
| `jarble-api-main/src/services/agentCallsWriter.ts` | Audit writer: insert-then-update, OTel bridge, runaway circuit breaker |
| `jarble-api-main/src/services/flowEngine.ts` | DAG executor for formal flow execution (separate from conversational delegation) |
| `jarble-api-main/src/routes/a2aGateway.ts` | A2A endpoints: agent card + synchronous task send |
| `jarble-api-main/src/mcp/jarble-ui-server.js` | MCP server in agent pods: `a2a_delegate` tool, `delegation-tools.json` loader |
| `jarble-api-main/src/runtimes/handlers/openclaw.ts` | Runtime config: `soul.md` rendering, `JARBLE_UI_PROMPT`, memory scope guidance |
| `jarble-api-main/src/trpc/routers/deployment.ts` | `listTeamSessions`, `listRecentTraces`, `getAgentCallsByTrace` procedures |
| `Jarble-mvp/views/Deployments.tsx` | Canvas + chat UI: `FlowCanvas`, `activeDelegationTargets`, team chat message handling |
| `Jarble-mvp/components/chat/OrchestrationSteps.tsx` | Real-time orchestration step tree |
| `Jarble-mvp/components/workspace/TeamSessionsPanel.tsx` | Delegation history panel |
| `Jarble-mvp/components/workspace/DebugTracePanel.tsx` | OTel span tree debug panel |
| `Jarble-mvp/views/ResourceMapView.tsx` | Resource relationship diagram |
| `Jarble-mvp/views/Dashboard.tsx` | Top-level dashboard with My Agents / Agent Teams / Resources tabs |
