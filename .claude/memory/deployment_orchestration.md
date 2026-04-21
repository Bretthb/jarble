---
name: Deployment Orchestration & Infrastructure Canvas
description: Visual deployment orchestration (CrewAI/LangChain/Railway-style), multi-agent flows, infrastructure diagramming, and deployment rental marketplace
type: project
---

User's full vision for the /deployments page — a visual canvas that evolves through several phases:

**Why:** Turn Jarble from a single-bot platform into a full visual orchestration platform. Like Railway for AI agents — draw your infrastructure, connect services, deploy everything.

**How to apply:** Build incrementally:

### Phase 1: Deployment Graph (Key Sharing Visualization)
- @xyflow/react canvas showing deployments as nodes
- Edges show API key sharing relationships (llmApiKeySourceDeploymentId)
- Click a node → see deployment config, status, usage
- Drag to rearrange, auto-layout

### Phase 2: Multi-Agent Orchestration (CrewAI/LangChain-style)
- Draw connections between deployments to create agent pipelines
- Define agent roles (researcher, writer, reviewer, etc.)
- Configure message routing: sequential, parallel, conditional
- Output of Agent A → input of Agent B
- Visualize flow execution in real-time (animated edges, status indicators)
- Store flow definitions in DB
- Uses existing `chatWithBot` MCP tool for inter-deployment messaging
- Uses existing `agentCredits` router for per-call billing

### Phase 3: Deployment Rental Marketplace
- Publish deployments as rentable agents on the marketplace
- Other users add rented agents to their orchestration flows
- Per-call or per-minute billing via agent credits
- Builds on existing services/marketplace infrastructure

### Phase 4: Infrastructure Canvas (Railway-style)
- Beyond AI agents — visual diagramming for full infrastructure
- Database pods (PostgreSQL, Redis, etc.) as nodes on the canvas
- Storage volumes, network policies as visual elements
- Connect AI agents to databases, APIs, external services
- Deploy infrastructure from the diagram (K3s resources)
- Like Railway/Render but for the Jarble K3s cluster

### Key Architecture Decisions (to be resolved)
1. Server-side vs client-side orchestration (API orchestrates calls vs frontend manages flow)
2. Streaming from multiple agents simultaneously
3. Real-time flow execution visualization on @xyflow/react
4. Flow definition schema (nodes, edges, routing rules, state passing)
5. Agent failure handling and retries in flows

### Existing Infrastructure to Reuse
- `@xyflow/react` — already installed for node graphs
- `chatWithBot` MCP tool — inter-deployment messaging
- `agentRegistry.ts` / `serviceHandshake.ts` — agent discovery
- `agentCredits` router — billing ledger (balance, purchase, history, call tracking)
- `services` router — service marketplace (install, uninstall, publish, review)
- AG-UI SSE protocol — already used for streaming, has CUSTOM events for agent calls
- `jarble.agent.call.start` / `jarble.agent.call.end` SSE events already exist
