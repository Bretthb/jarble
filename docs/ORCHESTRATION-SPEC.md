# Orchestration Spec: Bot Team Builder

## What This Is

Orchestration turns a collection of individual deployed bots into coordinated teams. Users wire their bots together visually — defining roles, communication channels, and delegation rules — creating custom AI systems from composable building blocks.

The diagram IS the configuration. Draw it, and your bots work together.

## The Core Concept

You have 10 deployments on Jarble. Right now they're isolated — each one does its own thing. Orchestration lets you say:

- "This bot is the CEO. It delegates to these three."
- "This bot handles charts. Connect it to my main chat bot so it generates better components."
- "When my support bot can't handle something, hand off to my technical bot."

Each wiring diagram is called a **Flow**. A flow is a reusable team configuration — the same bots can be organized differently for different use cases.

## Why This Matters

**Without orchestration:** You have 10 separate bots. Each operates alone. If you want them to work together, you're manually copying outputs between chat windows.

**With orchestration:** You draw a diagram connecting 5 of your bots. Now when you talk to the entry bot, it automatically delegates tasks to the right specialist, gets results back, and presents a unified response. Your collection of bots becomes an AI team.

**The plugin angle:** Jarble has default platform services (component generation, code execution, etc.). With orchestration, you can replace those defaults with your own specialized bots. Deploy a bot fine-tuned for chart generation, wire it to your main bot, and now your deployment generates better charts than the platform default — without changing any code.

## User Mental Models

Research across CrewAI, LangGraph, AutoGen, OpenAI AgentKit, Botpress, and n8n shows three patterns users understand intuitively:

### 1. The Org Chart (Primary)
Hierarchical. A main bot at the top, specialists below. Clear delegation paths.

```
          [CEO Bot]
         /    |    \
    [CTO]  [COO]  [CFO]
     / \      |
 [Dev] [QA] [Ops]
```

Users already think this way about organizations. The CEO bot receives a request, decides which specialist handles it, delegates, gets results back, and responds.

**Use cases:** Company simulation, customer service escalation, management workflows

### 2. The Assembly Line
Sequential. One bot's output feeds the next.

```
[Research Bot] → [Analysis Bot] → [Report Bot] → [Output]
```

Users understand this from factory/pipeline metaphors. Each bot adds value to the work in progress.

**Use cases:** Content pipelines, data processing, multi-step analysis

### 3. The Team Meeting
Collaborative. Multiple bots discuss a problem, with a moderator deciding who speaks.

```
[Moderator]
    ↕
[Expert A] ↔ [Expert B] ↔ [Expert C]
```

Users understand this from Slack channels and meetings. Multiple perspectives on one problem.

**Use cases:** Code review panels, brainstorming, committee decisions, quality review

## Core Concepts

### Flows
A **flow** is a saved team configuration — a diagram that defines how a set of bots work together.

- Each user can create multiple flows
- A flow references existing deployments (doesn't create new ones)
- Flows can be published to the marketplace for others to fork
- Each flow has a status: `draft`, `published`, `archived`

### Nodes
Every node on the canvas represents a **deployed bot with a role**.

A node has:
- **Deployment**: Which bot (references an existing deployment)
- **Role**: What this bot does in the team (e.g., "Research Lead", "Chart Generator", "Quality Reviewer")
- **Goal**: What this bot is trying to achieve (e.g., "Find accurate data from multiple sources")
- **Delegation permissions**: Can this bot delegate to its connected bots?
- **Model override** (optional): Use a different LLM for this role than the deployment default

The role and goal are injected into the bot's system prompt when it operates within this flow, layered on top of the deployment's base system prompt.

### Edges (Connections)
Edges define **communication channels** between bots. An edge means "this bot can talk to that bot."

Three edge types:

| Type | Symbol | Meaning | Example |
|------|--------|---------|---------|
| **Delegates to** | → | Source can send tasks to target and receive results | CEO → CTO |
| **Reports to** | ← | Target receives results/updates from source automatically | QA → CTO |
| **Collaborates with** | ↔ | Both can initiate communication with each other | Dev ↔ QA |

### Entry Point
Every flow has one **entry node** — the bot that receives the initial user input. This is usually the "manager" or "router" bot. The user talks to this bot, and it orchestrates the team.

### Execution Model
When a user sends a message to a bot that's part of a flow:

1. Message arrives at the **entry bot**
2. Entry bot sees its connections (which bots it can delegate to)
3. Entry bot decides to handle it alone OR delegate to a specialist
4. Specialist bot processes the task and returns a result
5. Entry bot integrates the result and responds to the user
6. This can cascade — specialists can further delegate to their own connections

**Delegation is implemented as tool calls.** Each connected bot appears as a tool the entry bot can call: `delegate_to_cto(task: "Review the architecture proposal")`. This makes delegation explicit, auditable, and visible in the conversation.

### Communication Patterns

#### Hub-and-Spoke (Default)
One central bot routes to specialists. Most common and most predictable.
- Research shows: hub-and-spoke beats peer-to-peer for reliability
- The central bot maintains context and coherence
- Specialists only see the task they're given, not the full conversation (scoped context)

#### Chain
Each bot passes its output to the next. Good for pipelines.
- Bot A's response becomes Bot B's input
- No decision-making about routing — it's linear

#### Broadcast
One bot sends the same task to multiple bots in parallel.
- Results are collected and aggregated
- Good for "get multiple opinions" patterns

#### Feedback Loop
A bot's output goes to a reviewer, who can send it back for revision.
- Configurable max iterations (default 3, max 10)
- Reviewer uses a condition to decide: approve or revise

### Context Scoping
When Bot A delegates to Bot B, what context does Bot B see?

Options (configurable per edge):
- **Task only**: Bot B only sees the specific task delegated (default, recommended)
- **Task + summary**: Bot B sees the task plus a summary of the conversation so far
- **Full context**: Bot B sees the entire conversation history (expensive, use sparingly)

Research consistently shows that scoped context (task only) produces better results and uses fewer tokens.

## UX Design

### The Canvas
The flow canvas uses React Flow (@xyflow/react) — the same library already in the codebase.

- **Left sidebar**: List of your deployments, drag onto canvas to add
- **Canvas**: Drag, connect, arrange nodes
- **Right sidebar** (on node click): Configure role, goal, delegation settings
- **Top toolbar**: Flow name, Save, Run Test, Auto-layout, Delete

### Node Appearance
Each node shows:
```
┌──────────────────────────┐
│  [icon] Bot Name         │
│  Role: CTO               │
│  ● Running  │  OpenClaw  │
│                          │
│  [delegation badge]      │
└──────────────────────────┘
```

- Color-coded border by role type (leader=blue, specialist=green, reviewer=amber)
- Status indicator (running/stopped/failed)
- Runtime badge
- Delegation indicator (can delegate / cannot delegate)

### Edge Appearance
- **Delegates to** (→): Solid arrow, labeled "delegates"
- **Reports to** (←): Dashed arrow, labeled "reports"
- **Collaborates** (↔): Double-headed arrow, labeled "collaborates"
- During execution: edges animate to show active communication

### Node Configuration Panel
When you click a node, a right sidebar opens:

```
╔══════════════════════════════╗
║  Configure: CTO Bot          ║
╠══════════════════════════════╣
║  Deployment: [My CTO Bot ▾]  ║
║                              ║
║  Role                        ║
║  [CTO / Technical Lead    ]  ║
║                              ║
║  Goal                        ║
║  [Make architecture decisions║
║   and oversee technical      ║
║   quality                 ]  ║
║                              ║
║  ☑ Can delegate to connected ║
║    bots                      ║
║  ☐ Auto-respond (no human    ║
║    approval needed)          ║
║                              ║
║  Context passing: [Task only]║
║                              ║
║  Model override: [Default ▾] ║
╚══════════════════════════════╝
```

### Flow Execution View
When testing a flow, the canvas becomes a live visualization:

- Active node has a pulsing border
- Edges animate to show data flow direction
- A timeline panel at the bottom shows:
  - Which bot is currently working
  - What task was delegated
  - How long each step took
  - Credit cost per step
- Chat interface on the right for interacting with the entry bot

### Flow Templates (Marketplace)
Pre-built flow configurations users can fork:

| Template | Description | Bots Needed |
|----------|-------------|-------------|
| Customer Escalation | Triage → Specialist → Human handoff | 3 |
| Content Pipeline | Research → Write → Edit → Publish | 4 |
| Code Review Panel | Router → Security → Performance → Style | 4 |
| Company Simulation | CEO → CTO/COO/CFO → Specialists | 6+ |
| Component Generator | Router → Chart Bot → Form Bot → Code Bot | 4 |
| Research Team | Lead → Web Search → Analysis → Summary | 4 |

## Technical Architecture

### What We Reuse

The current FlowEngine (`jarble-api-main/src/services/flowEngine.ts`) has solid foundations:
- DAG execution with parallel batches
- State machine with cycle support (feedback loops)
- Human-in-the-loop (waitForInput nodes)
- Template variable resolution
- Credit billing per step
- SSE streaming of execution progress
- Subflow nesting (teams of teams)

### What Changes

| Current | New |
|---------|-----|
| Nodes are "pipeline steps" | Nodes are "bots with roles" |
| Edges are "data flows" | Edges are "communication channels" with types |
| One-shot execution | Persistent team config + on-demand execution |
| `deployment` node calls a service | `deployment` node delegates a task to a bot via its chat API |
| Transform/condition/output nodes | Kept but secondary — the primary UX is about connecting bots |
| Flow definition = pipeline graph | Flow definition = team topology + role config |

### Node Schema (Updated)

```typescript
interface FlowNode {
  id: string;
  deploymentId: string;
  role: string;              // NEW: "CTO", "Chart Generator", etc.
  goal: string;              // NEW: "Oversee technical architecture"
  canDelegate: boolean;      // NEW: Can this bot call connected bots?
  contextScope: "task" | "summary" | "full"; // NEW: What context to pass
  modelOverride?: string;    // NEW: Override deployment's default model
  isEntryPoint: boolean;     // NEW: Is this the bot users talk to?
  position: { x: number; y: number };
}
```

### Edge Schema (Updated)

```typescript
interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: "delegates" | "reports" | "collaborates"; // NEW
  contextScope?: "task" | "summary" | "full";     // NEW: Override per-edge
  label?: string;
  maxIterations?: number;    // For feedback loops
}
```

### Delegation as Tool Calls

When a bot operates within a flow, its available tools are augmented with delegation tools based on its connections:

```typescript
// Auto-generated tool for each "delegates to" edge
{
  name: "delegate_to_cto",
  description: "Delegate a task to the CTO bot (Role: Technical Lead. Goal: Make architecture decisions).",
  parameters: {
    task: { type: "string", description: "The task to delegate" },
    context: { type: "string", description: "Additional context", optional: true }
  }
}
```

When the bot calls this tool:
1. The task is sent to the target deployment's chat API
2. The target bot processes it (potentially delegating further)
3. The result is returned as the tool call response
4. The original bot integrates the result into its response

### API Changes

**New/Modified tRPC procedures:**

```
flows.create    — Add role, goal, entryPoint fields to node schema
flows.update    — Same schema changes
flows.execute   — Trigger flow execution (entry bot receives user message)
flows.test      — Dry-run with a test message to see delegation path
```

**New REST endpoints:**

```
POST /api/flows/:flowId/chat    — Send a message to the flow's entry bot
                                  Streams response via SSE (reuses tamboAgent pattern)
                                  Delegation happens transparently
```

### Execution Flow (Detailed)

```
User sends message to flow entry point
    │
    ├── 1. Load flow definition (nodes, edges, roles)
    │
    ├── 2. Build delegation tools for entry bot
    │      Based on "delegates to" edges from entry node
    │
    ├── 3. Send message to entry bot's deployment
    │      System prompt augmented with: role, goal, delegation tools
    │
    ├── 4. Entry bot responds
    │      ├── Direct response (no delegation) → return to user
    │      └── Tool call: delegate_to_X(task) →
    │              │
    │              ├── 5. Build delegation tools for target bot
    │              ├── 6. Send task to target deployment
    │              ├── 7. Target bot responds (may further delegate)
    │              └── 8. Return result as tool call response
    │                     Entry bot integrates and continues
    │
    └── 9. Final response streamed to user via SSE
          Includes: which bots were involved, delegation trace
```

### Credit Billing

- Each delegation step consumes credits (one API call to the target deployment)
- Total cost = sum of all delegation calls in the chain
- Displayed in the execution view and flow history
- Users can set per-flow credit limits to prevent runaway costs

## Database Schema Changes

```sql
-- Updated orchestrationFlows table
ALTER TABLE orchestration_flows
  ADD COLUMN entry_node_id VARCHAR(255),
  ADD COLUMN team_type ENUM('hierarchy', 'pipeline', 'collaborative') DEFAULT 'hierarchy';

-- Flow node roles (new table or embedded in definition JSON)
-- Stored in definition JSON alongside position, keeping it simple
```

The `definition` JSON field expands from:
```json
{
  "nodes": [{ "id": "...", "type": "deployment", "deploymentId": "...", "position": {...} }],
  "edges": [{ "id": "...", "source": "...", "target": "..." }]
}
```

To:
```json
{
  "nodes": [{
    "id": "...",
    "deploymentId": "...",
    "role": "CTO",
    "goal": "Oversee technical architecture and code quality",
    "canDelegate": true,
    "contextScope": "task",
    "isEntryPoint": false,
    "position": { "x": 300, "y": 100 }
  }],
  "edges": [{
    "id": "...",
    "source": "ceo-node",
    "target": "cto-node",
    "type": "delegates",
    "label": "Technical decisions"
  }]
}
```

## Implementation Phases

### Phase 1: Foundation (Current Sprint)
- Fix existing flow bugs (done: save, delete, node rendering)
- Update node schema to include role, goal, canDelegate, isEntryPoint
- Update edge schema to include type (delegates/reports/collaborates)
- Update canvas UI to show roles and edge types
- Node configuration sidebar (role, goal, delegation settings)

### Phase 2: Execution Engine
- Implement delegation as tool calls (modify FlowEngine)
- Entry bot system prompt augmentation (role + goal + delegation tools)
- Delegation tool execution (call target deployment's chat API)
- Chain delegation (bot A delegates to bot B who delegates to bot C)
- SSE streaming with delegation trace events

### Phase 3: Live Visualization
- Execution view on canvas (active node, animating edges)
- Timeline panel showing delegation steps
- Credit tracking per step
- Chat panel for interacting with the flow's entry bot

### Phase 4: Polish & Marketplace
- Flow templates (pre-built team configurations)
- Publish flows to marketplace
- Fork public flows
- AI-powered flow generation ("Create a customer service team from my 5 bots")
- Context scoping controls (task only / summary / full)

## Examples

### Example 1: Custom Component Generator

**Problem:** Jarble's default component generation is generic. You want better charts.

**Solution:**
1. Deploy "Chart Specialist" bot — system prompt tuned for Recharts/D3 visualizations
2. Deploy "Form Specialist" bot — system prompt tuned for interactive forms
3. Deploy "Main Chat Bot" — your primary bot users talk to

**Flow:**
```
[Main Chat Bot] ──delegates──→ [Chart Specialist]
       │
       └──────delegates──→ [Form Specialist]
```

**Config:**
- Main Chat Bot: role="Assistant", goal="Help users with tasks, delegate chart/form generation to specialists"
- Chart Specialist: role="Chart Generator", goal="Create beautiful, interactive data visualizations"
- Form Specialist: role="Form Builder", goal="Create functional, accessible forms"

**Result:** When a user asks "Show me a bar chart of monthly sales", the Main Chat Bot delegates to Chart Specialist, which generates a superior chart component.

### Example 2: Company Simulation

**Flow:**
```
         [CEO Bot]
        /    |    \
  [CTO]   [COO]   [CFO]
   / \       |
[Dev] [QA] [Ops]
```

**Config:**
- CEO: role="CEO", goal="Set strategic direction, delegate operational decisions"
- CTO: role="CTO", goal="Technical architecture and engineering decisions", canDelegate=true
- Dev: role="Senior Developer", goal="Write and review code", canDelegate=false
- QA: role="QA Lead", goal="Test quality, report bugs", canDelegate=false

**Result:** User says "We need to launch a new feature for user analytics." CEO delegates technical planning to CTO, who delegates implementation spec to Dev and test plan to QA. Results flow back up.

### Example 3: Content Pipeline

**Flow:**
```
[Research Bot] → [Writer Bot] → [Editor Bot] → [Publisher Bot]
```

All edges are "delegates" type, chain topology.

**Result:** User says "Write a blog post about AI trends." Research Bot gathers data, passes to Writer, who drafts, passes to Editor, who refines, passes to Publisher, who formats for publication.

## Success Metrics

- Users create flows with 3+ bots connected
- Flows execute successfully end-to-end (delegation works)
- Users replace platform defaults with custom bot pipelines
- Flow templates get forked from marketplace
- Average flow has 4-6 nodes

## Open Questions

1. **Session persistence:** When a bot delegates, does the target bot maintain a separate conversation session or start fresh each time?
2. **Streaming delegation:** Should delegation results stream back in real-time (user sees both bots' thinking) or wait for complete response?
3. **Error handling:** If a specialist bot fails, should the manager auto-retry, fall back to another specialist, or surface the error to the user?
4. **Concurrent delegation:** Can a manager delegate to multiple specialists in parallel?
5. **Cost limits:** Should flows have per-execution credit limits to prevent runaway delegation chains?
