# Agent Orchestration Competitive Analysis

**Date**: 2026-04-08
**Scope**: Multi-agent delegation, observability, marketplace, and orchestration patterns across 10+ platforms
**Purpose**: Identify best practices and improvement opportunities for Jarble's fractal agent team system

---

## 1. Executive Summary -- Top 5 Takeaways for Jarble

1. **Parallel delegation is table stakes.** Every serious orchestration platform (LangGraph, CrewAI Flows, Microsoft Agent Framework) supports parallel fan-out where a coordinator dispatches to N specialists simultaneously. Jarble's current serial delegation is a competitive gap -- LangGraph benchmarks show 137x speedup for parallel vs sequential tool execution. This should be the highest-priority architectural change.

2. **A2A protocol has reached production maturity and Jarble should adopt it.** With 150+ organizations, Linux Foundation governance, and production deployments at Tyson Foods and Gordon Food Service, A2A v1.0 is no longer speculative. Adopting A2A as the wire format for delegation (replacing the fenced `jarble_delegate` markdown block) would make Jarble's bot teams interoperable with the broader agent ecosystem and position the marketplace for third-party agent integration.

3. **Structured state machines beat freeform prompt engineering for orchestration at scale.** LangGraph's explicit graph model with checkpointed state has proven more reliable than CrewAI's prompt-driven delegation, which suffers from well-documented schema validation failures in hierarchical processes. Jarble's current approach (prompt-engineered `jarble_delegate` blocks) is closer to CrewAI's fragile path. The flow engine already has DAG execution -- extending it to handle delegation as first-class graph edges would be more reliable.

4. **Three-tier memory (Letta/MemGPT pattern) is the emerging standard.** Letta's core memory (in-context) / recall memory (conversation history) / archival memory (long-term search) maps cleanly to Jarble's existing per-deployment memory scoping. The key insight: agents should manage their own memory via tools, not have it injected by the platform. Jarble's memory system should adopt self-editing memory tools.

5. **Credit-based billing with per-hop transparency is the winning marketplace model.** Salesforce Agentforce's "burn table" approach (different action types consume credits at different rates) is the closest analog to Jarble's multi-agent billing challenge. Per-hop cost attribution (already partially implemented via `agent_calls.creditsCharged`) is the right foundation -- the gap is surfacing this to users in real-time.

---

## 2. Platform-by-Platform Analysis

### CrewAI

CrewAI organizes agents into "crews" with role-based metaphors (role, goal, backstory per agent). Three process types: sequential, hierarchical (manager delegates to workers), and consensual (agents vote). Delegation is implicit -- an agent with `allow_delegation=True` can spawn sub-tasks for other crew members. **Strengths**: intuitive role-based mental model, Flows system for multi-crew orchestration, model-agnostic. **Weaknesses**: hierarchical delegation has known bugs (schema validation failures, manager agents unable to delegate to workers -- GitHub issues #4783, #2606), error handling in delegation chains is fragile with no structured fallback hierarchy, and the prompt-driven delegation approach is inherently unreliable. CrewAI Flows (event-driven orchestration above individual crews) is their answer to the reliability problem -- essentially admitting that prompt-driven delegation alone is insufficient.

### AutoGen / Microsoft Agent Framework

AutoGen pioneered conversational multi-agent patterns where agents interact through multi-turn dialogue rather than predefined workflows. Now in maintenance mode, replaced by Microsoft Agent Framework 1.0 (shipped April 3, 2026). The new framework combines AutoGen's simple abstractions with Semantic Kernel's enterprise features (session-based state, type safety, middleware, telemetry) and adds graph-based workflows. Supports five orchestration patterns: sequential, concurrent, handoff, group chat, and Magentic-One. **Key lesson for Jarble**: Microsoft found that pure conversational delegation (AutoGen's approach) needed to be augmented with explicit graph-based orchestration for production reliability. The same tension exists in Jarble between freeform `jarble_delegate` and the structured flow engine.

### LangGraph

The most mature state-machine approach to agent orchestration, with 126K+ GitHub stars. Models agents as directed graphs where nodes are functions, edges are routing decisions, and state is immutable and checkpointed after every step. **Parallel execution** via "supersteps" (fan-out from single node to multiple destination nodes, all execute concurrently). **Map-reduce** via the Send API for dynamic runtime task creation. **Scatter-gather** distributes subtasks across agents and aggregates results. Supervisor pattern has a central agent coordinating specialized subgraphs. **Key strength**: explicit state management with reducers, checkpoint-based recovery from failures, and the graph structure makes the orchestration inspectable and debuggable. **Key lesson for Jarble**: LangGraph proves that explicit graph structure scales better than implicit prompt-driven delegation. Jarble's flow engine is already a DAG executor -- the gap is that delegation isn't modeled as graph edges but as prompt-parsed fenced blocks.

### Letta (MemGPT)

The definitive agent memory platform. Three-tier architecture: Core Memory (in-context, like RAM), Recall Memory (searchable conversation history, like cache), Archival Memory (long-term vector search, like cold storage). The breakthrough insight: agents self-edit their memory using tools (`memory_replace`, `memory_insert`, `memory_rethink`, `archival_memory_insert`, `archival_memory_search`). Letta V1 (2026) deprecates the MemGPT "heartbeat" pattern in favor of direct model generations, improving performance with GPT-5 and Claude 4.5 Sonnet. **Key lesson for Jarble**: Jarble's per-deployment memory (global/session/off) should evolve toward self-editing memory tools that the bot controls, rather than platform-injected context. The three-tier model maps to: core = system prompt + recent context, recall = session history, archival = deployment-scoped persistent memory.

### OpenAI Swarm / Agents SDK

Swarm introduced two elegant primitives: Agents (instructions + tools) and Handoffs (transferring the active conversation to another agent by returning an Agent from a function). Only the active agent's system prompt is loaded at any time -- chat history persists across handoffs. Now replaced by the OpenAI Agents SDK (production-ready), which adds Guardrails (input/output validation) and built-in Tracing. **Key lesson for Jarble**: the handoff pattern (swap system prompt, preserve history) is simpler and more reliable than Jarble's current approach (parse fenced blocks, exec into a separate pod, send the task as a new message). For intra-team delegation, a handoff-style approach where the coordinator's context seamlessly transfers to the specialist would reduce latency and improve coherence. However, Jarble's pod-isolation model (each deployment is its own K8s pod) means true handoffs require cross-pod communication, which is architecturally more complex.

### Relevance AI

Positions itself as "the home of the AI workforce" with a low-code platform for building and managing multi-agent systems. Over 400 pre-built agent templates in their marketplace. Named a "Luminary" by Everest Group alongside Google and Microsoft. **Key lesson for Jarble**: the marketplace with 400+ templates demonstrates the power of pre-built agent compositions. Jarble's marketplace should emphasize team templates (pre-configured multi-agent compositions), not just individual bot templates.

### Dust.tt

Enterprise agent platform using Temporal for workflow orchestration (handling cron scheduling, multi-step workflows, human-in-the-loop). SOC 2 Type II certified. Connects agents to Slack, Notion, GitHub with semi-real-time ingestion. **Key lesson for Jarble**: Dust's use of Temporal for durable execution is instructive -- it handles exactly the failure recovery scenarios that Jarble's flow engine needs (retries, timeouts, state persistence across restarts). However, adding Temporal is a significant infrastructure dependency. The more pragmatic lesson is that delegation workflows need durable state that survives pod restarts.

### Voice Platforms (Vapi, Bland.ai, Retell)

These platforms have solved delegation UX for voice: warm transfers (Retell), configurable escalation timing (Vapi), and dynamic mid-conversation data injection (Bland). **Key lesson for Jarble**: the voice agent pattern of structured handoff context (caller ID, qualification data, conversation summary) should inform how Jarble's delegation passes context between bots. Currently, context scope is "task" / "summary" / "full" -- voice platforms show that structured handoff metadata (not just conversation text) produces better results.

### Fixie.ai

Previously positioned as an agent marketplace/deployment platform but has pivoted. Less relevant to current Jarble architecture. The marketplace pattern they attempted (discover, deploy, compose agents) validates Jarble's direction but their execution challenges highlight the difficulty of multi-vendor agent composition.

---

## 3. Best Practices Grid

| Dimension | Industry Best Practice | Jarble Current State | Gap |
|-----------|----------------------|---------------------|-----|
| **Delegation Protocol** | Structured protocols (A2A JSON-RPC, OpenAI handoffs, LangGraph graph edges) with typed schemas | Fenced `jarble_delegate` markdown blocks parsed via regex | High -- regex parsing is fragile; typed protocol needed |
| **Parallel Execution** | Fan-out supersteps (LangGraph), scatter-gather (AWS), concurrent orchestration (Microsoft) | Serial only -- delegations execute one at a time | High -- massive latency penalty for multi-specialist tasks |
| **Error Handling** | Tiered fallback: retry with backoff, alternative agent, simpler model, human escalation queue; circuit breakers per agent | RunawayTraceError circuit breaker (span count + credit limit); DelegationDepthExceeded; DelegationCycleError; per-hop 90s timeout | Medium -- good safety rails but no fallback hierarchy or retry logic |
| **Observability** | OTel GenAI semantic conventions (experimental but standardized); Langfuse/LangSmith for LLM-native traces; per-span token/cost attribution | Langfuse traces with custom spans; agent_calls DB with OTel-compatible columns; W3C traceparent propagation in progress (JAR-51) | Low -- ahead of most platforms; main gap is GenAI semconv alignment |
| **Cost Control** | Per-trace hard caps (span count, credit ceiling, wallclock timeout, token budget); per-user hourly limits; approval gates for expensive operations | MAX_SPANS_PER_TRACE=50, MAX_CREDITS=$5 per trace; depth limit 4 | Medium -- missing per-user hourly limits, approval gates, and token-level budgets |
| **Memory Isolation** | Three-tier (Letta): core (in-context) / recall (conversation) / archival (long-term); self-editing via tools | Per-deployment scope (global/session/off); memory injected by platform | Medium -- functional but not agent-controlled; no archival tier |
| **Marketplace** | Pre-built team templates (Relevance AI 400+), credit-based billing with burn tables (Salesforce), 10-30% platform take rate | Component marketplace exists; team templates not yet exposed | Medium -- marketplace needs team composition templates |
| **State Management** | Checkpointed state after every step (LangGraph); durable execution (Dust/Temporal); immutable state with reducers | Flow engine has execution state; delegation has no intermediate state persistence | Medium -- delegation chain state is ephemeral |
| **Task Decomposition** | Supervisor pattern (explicit planner), map-reduce (dynamic runtime splitting), reflection loops (self-critique) | Coordinator bot uses prompt engineering to decide delegation targets | Medium -- works but not inspectable or overridable by users |
| **Result Synthesis** | Aggregation nodes (LangGraph reduce), structured output schemas, consensus mechanisms | Coordinator receives results and synthesizes via prompt | Low -- current approach is flexible; structured aggregation could help for specific use cases |

---

## 4. Recommended Improvements (Prioritized by Impact x Effort)

### Tier 1: High Impact, Moderate Effort

#### 4.1 Parallel Fan-Out Delegation
**Impact**: Very High | **Effort**: Medium | **Priority**: P0

Currently, when a coordinator emits multiple `jarble_delegate` blocks, they execute serially in `flowChat.ts`. Change to `Promise.allSettled()` for concurrent execution.

**Implementation**:
- In `flowDelegation.ts`, after `parseDelegationCalls()` returns multiple calls, execute them concurrently via `Promise.allSettled()` instead of the current sequential loop
- Add `trace.fanout` attribute to the parent span counting parallel children
- Cap concurrent delegations per coordinator at 5 (matching the observability plan's `trace.fanout` hard cap)
- In `flowChat.ts` and `tamboAgent.ts`, collect all results before calling the coordinator's synthesis turn
- SSE events for parallel delegations should interleave (not wait for all to finish) so the frontend shows real-time progress

**Risk**: Concurrent pod-to-pod calls increase load; mitigate with the existing circuit breaker + fanout cap.

#### 4.2 Typed Delegation Protocol (A2A-Aligned)
**Impact**: High | **Effort**: Medium | **Priority**: P1

Replace fenced `jarble_delegate` markdown blocks with a structured JSON-RPC protocol aligned with A2A conventions. This eliminates regex parsing fragility and positions for ecosystem interop.

**Implementation**:
- Define a `DelegationRequest` JSON schema: `{ jsonrpc: "2.0", method: "tasks/send", params: { to: string, task: { message: string, context?: string, artifacts?: any[] } } }`
- In `buildFlowSystemPrompt()`, instruct bots to emit delegation as a tool call (via MCP `jarble_delegate` tool) rather than a fenced block
- Add `jarble_delegate` as an MCP tool in `jarble-ui-server.js` -- the bot calls it like any other tool, the runtime intercepts and routes
- Keep the fenced block parser as a legacy fallback for 2 release cycles
- This aligns with A2A's `tasks/send` method and `Task` object model, making future A2A gateway integration straightforward

**Why MCP tool > fenced block**: MCP tool calls have structured input schemas validated by the model, eliminating the parsing fragility that plagues both Jarble and CrewAI's prompt-driven delegation.

#### 4.3 Approval Gates for Expensive Delegations
**Impact**: High | **Effort**: Small | **Priority**: P1

Add a user-confirmation step before delegations that would exceed a cost threshold.

**Implementation**:
- Add `approvalThreshold` field to flow node config (default: null = no gate)
- When a delegation's estimated cost (based on target model pricing) exceeds the threshold, emit a `jarble.flow.approval_required` SSE event with the delegation details
- Frontend renders an approval modal (similar to the existing HITL `waitForInput` pattern)
- Reuse the `flowExecution.ts` resume endpoint for approval responses
- This is essentially a specialized `waitForInput` node -- minimal new infrastructure needed

### Tier 2: High Impact, Higher Effort

#### 4.4 Delegation as Graph Edges (State Machine Upgrade)
**Impact**: Very High | **Effort**: Large | **Priority**: P2

Promote delegation from "prompt-parsed side effect" to "first-class graph edge in the flow engine." This is the architectural change that LangGraph, Microsoft Agent Framework, and CrewAI Flows all converged on: explicit orchestration graphs are more reliable than prompt-driven delegation.

**Implementation**:
- Extend `FlowNode` type to include `type: "delegation"` (alongside existing `deployment`, `transform`, `condition`, `output`, `waitForInput`, `subflow`)
- Delegation edges become explicit in the flow graph, visible and editable in the canvas UI
- The flow engine handles delegation routing, not the bot's prompt
- Bots can still request ad-hoc delegation via the MCP tool (4.2), but the preferred path is graph-defined
- This unifies the flow engine and delegation system, eliminating the current split where flows use `flowEngine.ts` DAG execution but delegation uses `flowDelegation.ts` prompt parsing

**Trade-off**: This reduces bot autonomy (the graph decides who to delegate to, not the bot). For structured workflows this is better; for creative/exploratory tasks, freeform delegation should remain available.

#### 4.5 Three-Tier Memory with Self-Editing Tools
**Impact**: High | **Effort**: Large | **Priority**: P2

Adopt Letta's three-tier model: core memory (in-context persona/facts), recall memory (searchable conversation history), archival memory (long-term knowledge base).

**Implementation**:
- Core memory: extend the existing per-deployment memory with structured blocks (persona block, user block, facts block) that the bot reads/writes via MCP tools
- Recall memory: expose conversation history search as an MCP tool (`memory_search_conversations`) backed by the existing `chat_sessions` / `chat_messages` tables
- Archival memory: add a vector store per deployment (Postgres pgvector extension on Neon) with `memory_archive_insert` and `memory_archive_search` MCP tools
- Key shift: bots manage their own memory via tools rather than having context injected by the platform

#### 4.6 Structured Handoff Context
**Impact**: Medium | **Effort**: Small | **Priority**: P1

Improve delegation context quality by passing structured metadata alongside the task text.

**Implementation**:
- Extend `DelegationResult` and the delegation wire format with a `handoffContext` object: `{ callerRole, callerGoal, conversationSummary, relevantArtifacts[], priorDelegationResults[] }`
- The coordinator bot populates this via the MCP tool call (4.2)
- The target bot receives it as a structured preamble, not interleaved with conversation history
- This mirrors voice platform patterns (Retell's structured handoff data) and improves specialist coherence

### Tier 3: Medium Impact, Variable Effort

#### 4.7 Fallback Hierarchy for Failed Delegations
**Impact**: Medium | **Effort**: Medium | **Priority**: P3

Add tiered fallback when a delegation fails: retry with backoff, try alternative specialist, fall back to coordinator handling it directly, escalate to human.

**Implementation**:
- Add `fallbackStrategy` to flow edge config: `{ retries: 3, backoffMs: [1000, 2000, 4000], alternateNodeId?: string, coordinatorFallback: boolean, humanEscalation: boolean }`
- Implement in `executeDelegation()` as a retry wrapper with exponential backoff + jitter
- Emit `jarble.delegation.retry` and `jarble.delegation.fallback` SSE events for observability
- Requires idempotency consideration: ensure retried delegations don't produce duplicate side effects (canvas cards, memory writes)

#### 4.8 Team Composition Templates in Marketplace
**Impact**: Medium | **Effort**: Small | **Priority**: P2

Expose pre-configured multi-agent team compositions as marketplace items.

**Implementation**:
- Add `type: "team_template"` to the marketplace schema
- A team template is a flow definition (nodes + edges + delegation config) with placeholder deployment slots
- Users "install" a template, assign their own deployments to each slot, and get a working team
- This is the Relevance AI "400+ templates" pattern applied to Jarble's flow-based team system

#### 4.9 OTel GenAI Semantic Convention Alignment
**Impact**: Medium | **Effort**: Small | **Priority**: P2

Align `agent_calls` span attributes with the OTel GenAI semantic conventions (currently experimental, expected stable in 2026).

**Implementation**:
- Map existing span names: `jarble.delegation.hop` aligns with `invoke_agent` convention
- Add `gen_ai.agent.name`, `gen_ai.agent.id`, `gen_ai.operation.name` attributes
- Set span kind to CLIENT for cross-pod delegations, INTERNAL for in-process operations
- This is mostly an attribute rename -- the underlying data model is already compatible

#### 4.10 Per-User Hourly Cost Limits
**Impact**: Medium | **Effort**: Small | **Priority**: P2

The observability plan specifies `trace.cost_usd_running` per user/hour at $50 hard cap, $25 soft warn. Currently only per-trace limits are enforced.

**Implementation**:
- Add a sliding window counter in Redis (or in-memory with TTL) tracking `SUM(creditsCharged)` per `userId` over 1-hour windows
- Check in `startAgentCall()` alongside the existing per-trace circuit breaker
- Emit `jarble.cost.user_hourly_warn` / `jarble.cost.user_hourly_limit` events
- Surface in the frontend as a subtle cost indicator during chat

---

## 5. Architecture Decision Records

### ADR-1: Should Jarble Adopt the A2A Protocol?

**Status**: Recommended for adoption (phased)

**Context**: Google's Agent-to-Agent (A2A) protocol reached v1.0 in early 2026 with 150+ supporting organizations, Linux Foundation governance, and production deployments across supply chain, financial services, and IT operations. Jarble currently uses fenced `jarble_delegate` markdown blocks parsed via regex -- a custom, fragile protocol with zero ecosystem interop.

**Decision Drivers**:
- A2A is now production-ready (v1.0) with enterprise adoption
- Both MCP and A2A are under the Linux Foundation's Agentic AI Foundation (AAIF) alongside Anthropic, OpenAI, Google, Microsoft, AWS
- Jarble already uses MCP for tool access; A2A is the natural complement for agent-to-agent communication
- The fenced block approach is fragile (regex parsing, LLM formatting errors, de-duplication hacks)
- Marketplace interop: A2A would let third-party agents integrate with Jarble teams without custom adapters

**Decision**: Adopt A2A concepts in phases:
1. **Phase 1 (now)**: Replace fenced blocks with an MCP `jarble_delegate` tool call whose input schema mirrors A2A's `Task` object (`message`, `artifacts`, `metadata`). This gives structured input validation without requiring a full A2A server implementation.
2. **Phase 2 (Q3 2026)**: Implement an A2A-compatible gateway endpoint per deployment that exposes the standard A2A discovery (`.well-known/agent.json`), task lifecycle (`tasks/send`, `tasks/get`, `tasks/cancel`), and streaming (`tasks/sendSubscribe`). This makes every Jarble deployment addressable by external A2A clients.
3. **Phase 3 (Q4 2026)**: Marketplace A2A federation -- external agents (not hosted on Jarble) can participate in Jarble team compositions via their A2A endpoints.

**Consequences**:
- Positive: ecosystem interop, structured protocol, marketplace extensibility
- Negative: implementation effort, maintaining backward compatibility with existing flows
- Risk: A2A is still evolving; the spec may change. Mitigated by implementing the conceptual model (structured tasks) before the wire protocol.

**Alternatives Rejected**:
- **Keep fenced blocks**: Fragile, no interop, custom to Jarble
- **Pure MCP for delegation**: MCP is designed for tool/resource access, not agent-to-agent task delegation. The MCP spec explicitly says "MCP is not designed for agent-to-agent communication"
- **Custom JSON-RPC**: Would work but reinvents A2A without the ecosystem benefits

---

### ADR-2: Should Delegation Be Modeled as Explicit Graph Edges or Remain Freeform?

**Status**: Recommended hybrid approach

**Context**: Jarble has two orchestration systems operating in parallel:
1. **Flow engine** (`flowEngine.ts`) -- explicit DAG with typed nodes, topological execution, cycle support, HITL. Reliable, inspectable, but rigid.
2. **Freeform delegation** (`flowDelegation.ts`) -- bots decide who to delegate to via prompt engineering, parsed from response text. Flexible, autonomous, but fragile and opaque.

The industry has converged on explicit graphs: LangGraph uses state machines, Microsoft Agent Framework added graph-based workflows on top of AutoGen's conversational approach, and CrewAI added Flows on top of crews. The common pattern: freeform delegation is useful for prototyping but explicit orchestration is needed for production.

**Decision**: Hybrid model with two delegation modes:

1. **Graph-defined delegation (default for teams)**: Delegation targets and routing are explicit edges in the flow graph. The flow engine handles execution, retry, and parallel fan-out. The bot receives results but does not decide who to delegate to. This is the reliable, inspectable path.

2. **Autonomous delegation (opt-in per node)**: A node with `autonomousDelegation: true` can use the MCP `jarble_delegate` tool to choose delegation targets at runtime. This preserves the current creative flexibility for exploratory tasks. The flow engine still enforces depth limits, cycle detection, and cost guards.

The key insight from LangGraph: "graphs are about maintaining and evolving a shared state over time." When delegation is an explicit edge, the flow engine can checkpoint state, retry on failure, and provide a visual representation of what happened.

**Consequences**:
- Positive: reliability of graph-defined delegation, flexibility of autonomous delegation, user choice
- Negative: two code paths to maintain; UX complexity of exposing both modes
- Risk: users may not understand the trade-off. Mitigate with defaults (graph-defined for teams) and clear documentation.

---

### ADR-3: Should Jarble Use a Message Queue for Inter-Pod Delegation?

**Status**: Not recommended at current scale; revisit at 100+ concurrent delegations

**Context**: Jarble's delegation transport is synchronous request-response: `chatViaExec` (kubectl exec into pod) or `chatViaGateway` (WebSocket to pod). This has three problems:
1. No buffering -- if the target pod is temporarily unavailable, the delegation fails immediately
2. No replay -- if the API pod restarts mid-delegation, the in-flight result is lost
3. Serial execution bottleneck -- only one delegation in flight per coordinator turn

Alternatives: NATS JetStream (3.2ms p99 latency, Kubernetes-native), Redis Streams (0.8ms p99, already available in-cluster), or Kafka (overkill for this scale).

**Decision**: Do NOT adopt a message queue now. Instead:

1. **Implement parallel fan-out** (4.1) using `Promise.allSettled()` on the existing transport. This solves the serial bottleneck without new infrastructure.
2. **Add retry with backoff** (4.7) in `executeDelegation()` for transient failures (pod not ready, network timeout).
3. **Persist delegation state** in `agent_calls` so in-flight delegations can be detected and recovered on API restart (the `status: "pending"` rows older than 10 min are already flagged for reaping).

Revisit message queues when:
- Concurrent delegation volume exceeds what `Promise.allSettled()` can handle (100+ parallel delegations)
- Cross-cluster delegation is needed (agents on different Hetzner clusters)
- Delegation needs to survive pod restarts (durable execution requirement)

At that point, NATS JetStream is the recommended choice: Kubernetes-native, lightweight (no ZooKeeper/Kafka complexity), and the latency/throughput characteristics fit agent orchestration well.

**Consequences**:
- Positive: no new infrastructure dependency, simpler ops, faster to ship
- Negative: no durability guarantees for in-flight delegations; no buffering for unavailable pods
- Risk: at high concurrency, `Promise.allSettled()` with kubectl exec may saturate the K8s API server. Monitor via the existing `/metrics` endpoint (once shipped in JAR-51 Phase 3).

---

## 6. Appendix: Comparison Matrix

| Feature | Jarble | CrewAI | LangGraph | AutoGen/MS AF | OpenAI Agents SDK | Letta | Relevance AI |
|---------|--------|--------|-----------|---------------|-------------------|-------|-------------|
| Delegation model | Fenced markdown blocks | Prompt-driven (allow_delegation) | Graph edges + supervisor | Conversational + graph (v1.0) | Function-return handoffs | N/A (memory-focused) | Low-code UI |
| Parallel delegation | No (serial) | No (sequential by default) | Yes (supersteps) | Yes (concurrent pattern) | No (single active agent) | N/A | Unknown |
| Recursion depth | 4 (configurable) | 1 (effectively) | Unlimited (graph cycles) | Configurable | 1 (single handoff chain) | N/A | Unknown |
| State persistence | agent_calls DB | In-memory | Checkpointed (Postgres/SQLite) | Session-based | In-memory | 3-tier memory | Platform-managed |
| Error handling | Circuit breaker + depth/cycle | Fragile (known bugs) | Checkpoint recovery | Middleware-based | Guardrails | N/A | Unknown |
| Observability | Langfuse + OTel + agent_calls | Basic logging | LangSmith integration | Telemetry middleware | Built-in tracing | N/A | Platform analytics |
| Cost control | MAX_SPANS=50, MAX_CREDITS=$5 | None built-in | None built-in | None built-in | None built-in | N/A | Platform-managed |
| Memory model | Per-deployment (global/session/off) | Short-term + long-term | Checkpointed state | Session-based | Conversation history | 3-tier (core/recall/archival) | Platform-managed |
| Marketplace | Components + services | Templates (limited) | None | None | None | None | 400+ agent templates |
| Protocol | Custom (fenced blocks) | Custom (internal) | Python API | .NET/Python API | Python API | REST/Python | REST API |

---

## 7. Sources

### Platform Documentation
- [CrewAI Official Site](https://crewai.com/)
- [CrewAI Open Source Framework](https://crewai.com/open-source)
- [AutoGen GitHub](https://github.com/microsoft/autogen)
- [Microsoft Agent Framework 1.0](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/)
- [LangGraph Official Site](https://www.langchain.com/langgraph)
- [Letta (MemGPT) Documentation](https://docs.letta.com/concepts/memgpt/)
- [Letta GitHub](https://github.com/letta-ai/letta)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents SDK - Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [OpenAI Agents SDK - Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Swarm GitHub](https://github.com/openai/swarm)
- [Relevance AI Workforce](https://relevanceai.com/workforce)
- [Relevance AI Marketplace](https://marketplace.relevanceai.com/)
- [Dust.tt Product](https://dust.tt/home/product)
- [Retell AI](https://www.retellai.com/)

### Protocols and Standards
- [A2A Protocol Official Site](https://a2a-protocol.org/latest/)
- [A2A Protocol Announcement - Google](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [A2A Protocol 150+ Organizations Milestone](https://www.prnewswire.com/news-releases/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year-302737641.html)
- [Google Developer's Guide to AI Agent Protocols](https://developers.googleblog.com/developers-guide-to-ai-agent-protocols/)
- [OTel GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OTel GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [OTel GenAI Client Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [OTel MCP Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/)
- [MCP vs A2A Complete Guide](https://dev.to/pockit_tools/mcp-vs-a2a-the-complete-guide-to-ai-agent-protocols-in-2026-30li)
- [MCP vs A2A vs ACP Comparison](https://bonjoy.com/articles/mcp-vs-a2a-vs-acp-agent-protocols-compared/)

### Industry Analysis
- [Best Multi-Agent Frameworks 2026](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [Multi-Agent Orchestration Guide](https://gurusup.com/blog/multi-agent-orchestration-guide)
- [Multi-Agent Orchestration Failure Playbook 2026](https://cogentinfo.com/resources/when-ai-agents-collide-multi-agent-orchestration-failure-playbook-for-2026)
- [GitHub Blog: Multi-agent workflows that don't fail](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/)
- [Why Multi-Agent Systems Fail - Galileo](https://galileo.ai/blog/why-multi-agent-systems-fail)
- [Deloitte: AI Agent Orchestration](https://www.deloitte.com/us/en/insights/industry/technology/technology-media-and-telecom-predictions/2026/ai-agent-orchestration.html)
- [Salesforce Agentforce Credits Guide](https://www.jitendrazaa.com/blog/salesforce/salesforce-agentforce-credits-cost-model-complete-guide-2026/)
- [AI Agent Pricing Models](https://www.ema.ai/additional-blogs/addition-blogs/ai-agents-pricing-strategies-models-guide)
- [Scaling LangGraph Agents: Parallelization and Map-Reduce](https://aipractitioner.substack.com/p/scaling-langgraph-agents-parallelization)
- [AWS: Parallelization and Scatter-Gather Patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/parallelization-and-scatter-gather-patterns.html)
- [LangGraph Multi-Agent Orchestration Analysis](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-orchestration-complete-framework-guide-architecture-analysis-2025)
- [Dust + Temporal Workflows](https://temporal.io/blog/how-dust-builds-agentic-ai-temporal)
- [Letta V1 Agent Architecture](https://www.letta.com/blog/letta-v1-agent)
- [Microsoft Agent Framework Convergence](https://cloudsummit.eu/blog/microsoft-agent-framework-production-ready-convergence-autogen-semantic-kernel)
