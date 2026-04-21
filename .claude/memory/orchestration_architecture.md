---
name: Orchestration Architecture Research
description: Full architecture for Jarble deployment orchestration based on CrewAI/LangGraph/AG-UI research and existing codebase analysis
type: reference
---

# Orchestration Architecture — Research Summary

## Concept Mapping

| CrewAI/LangGraph | Jarble | Status |
|---|---|---|
| Agent (role, goal, backstory, LLM, tools) | Deployment (system prompt, LLM config, MCP tools) | EXISTS |
| Task (description, expected_output, agent) | Message to deployment with instructions | EXISTS |
| Crew/Graph (agents + execution order) | Orchestration Flow (graph of deployments) | TO BUILD |
| Flow (state machine above crews) | Flow with conditional routing | TO BUILD |
| Tool (callable function) | Skill (MCP tool / ServiceCard skill) | EXISTS |
| State (shared context between nodes) | Flow execution state (JSON accumulator) | TO BUILD |
| Supervisor (delegates to agents) | Orchestrator deployment | CAN BUILD on agentHub |
| Swarm (peer handoff) | Dynamic agent handoff | CAN BUILD on meshGateway |
| Checkpoint (state snapshot for resume) | Flow execution snapshot | TO BUILD |
| Memory (semantic recall) | Chat sessions + conversation storage | EXISTS (partial) |

## Existing Infrastructure (80% built)

### Agent Communication
- `routes/agentHub.ts` — POST /api/agent-hub/call (agent-to-agent with auth + credits)
- `services/marketplaceHub.ts` — executeAgentCall() with atomic credit debit, 70/30 revenue split
- `mcp/tools/chatWithBot.ts` — Direct bot-to-bot messaging via pod exec
- `routes/meshGateway.ts` — External agent access via API key
- `routes/meshDiscovery.ts` — Service catalog + .well-known/jarble-mesh.json A2A card

### Service Execution
- `routes/serviceProxy.ts` — HMAC-signed proxy to creator APIs, circuit breaker, rate limits
- `routes/serviceExecution.ts` — Execute handler code in pod via kubectl exec
- `services/serviceCard.ts` — Skill definitions with input/output schemas
- `services/serviceHandshake.ts` — Install webhook with HMAC verification
- `services/serviceHealthCheck.ts` — Push-based heartbeats, 3-tier health status

### Billing & Credits
- `trpc/routers/agentCredits.ts` — getBalance, getHistory, purchaseCredits (500/$5, 2500/$20, 10000/$100)
- `agentCredits` table — append-only ledger (purchase, agent_call, earnings, refund)
- `agentCalls` table — caller/callee deployment, skill, credits charged, latency, status
- Flat rate: 1 credit/call, 70% to callee owner

### Agent Registry & Planning
- `services/agentRegistry.ts` — 3 specialist agents (Component, Data, Workflow)
- `prompts/workflowAgent.ts` — Plans multi-step workflows as JSON DAG
  - Output format: steps with action, service, skill, args, dependsOn, outputKey
  - Supports parallel execution: "parallelizable" arrays
  - Template syntax: {{stepN_result.field}} for data flow

### Visual Graph
- `@xyflow/react` v12.10.0 + `dagre` v0.8.5 installed
- `views/Deployments.tsx` (698 lines) — Working graph with 3 custom node types, dagre layout
- Custom nodes: OwnerNode (gold crown), LinkedNode (dashed), StandaloneNode
- Detail panel sidebar, status indicators, filter bar

### SSE Events
- AG-UI protocol already implemented (10+ event types)
- `jarble.agent.call.start/end` custom events exist
- `utils/agentCallEvents.ts` — EventEmitter for real-time notifications

## What To Build

### Phase 1: Foundation (no new tables)
1. Add `STEP_STARTED`/`STEP_FINISHED` to eventTypes.ts
2. Extend agentHub to support chained calls (A→B→C)
3. Simple sequential flow: frontend sends ordered deployment IDs + prompt
4. Real-time step progress via SSE

### Phase 2: Flow Definitions (2 new tables)
```sql
flows (id, userId, name, description, graphDefinition JSON, stateSchema JSON, createdAt, updatedAt)
flowExecutions (id, flowId, userId, status, currentState JSON, stepHistory JSON, currentNodeId, threadId, startedAt, completedAt)
```
- Flow CRUD tRPC router
- FlowExecutionEngine service (sequential + parallel)
- Checkpoint/resume support
- Visual flow builder on @xyflow/react canvas

### Phase 3: Advanced Orchestration
- Conditional routing (LangGraph-style conditional edges)
- Supervisor pattern (one deployment orchestrates others)
- Human-in-the-loop pause/approve gates
- Shared memory across flow executions
- Flow templates in marketplace

### Phase 4: Infrastructure Canvas (Railway-style)
- Database pods, storage volumes as nodes
- K3s resource provisioning from the diagram
- Network policy visualization
- Full infrastructure-as-diagram

## Key Design Decisions

1. **Server-side orchestration** — API orchestrates calls between pods; frontend receives SSE events
2. **Nested run model** — One top-level RUN, each agent gets STEP events; parallel agents interleave with distinct stepIds
3. **Node-level retry** — maxRetries (default 2) + timeoutMs (default 60s) per node; fail_fast/skip/fallback strategies
4. **State as JSON accumulator** — Each step result merged into flow state; template syntax for data references
5. **graphDefinition stores @xyflow/react format** — nodes[]/edges[] serialize/deserialize natively

## New SSE Events Needed
```
STEP_STARTED = "STEP_STARTED"           // { stepId, agentName, deploymentId }
STEP_FINISHED = "STEP_FINISHED"         // { stepId, result, status }
FLOW_STATE_DELTA = "jarble.flow.state"  // { patch }
AGENT_HANDOFF = "jarble.agent.handoff"  // { from, to, reason }
```

## File Structure for Implementation
```
components/orchestration/
├── OrchestrationCanvas.tsx    (ReactFlowProvider wrapper)
├── nodes/
│   ├── DeploymentNode.tsx     (bot name, status, role)
│   ├── PlatformNode.tsx       (Discord/Slack/Telegram)
│   └── RouterNode.tsx         (conditional routing logic)
├── edges/
│   ├── FlowEdge.tsx           (animated message flow)
│   └── KeySharingEdge.tsx     (dotted credit pool link)
├── panels/
│   ├── NodePalette.tsx        (drag to add nodes)
│   ├── StepConfigPanel.tsx    (selected node config)
│   └── ExecutionLog.tsx       (real-time step trace)
└── hooks/
    ├── useFlowExecution.ts    (SSE event handling)
    └── useLayoutPersistence.ts (save/restore positions)
```
