---
name: orchestration_architecture
description: Flow orchestration system architecture — Phase 1 built, Phase 2 priorities from CrewAI/LangGraph comparison
type: project
---

## Orchestration System (2026-03-23)

### Phase 1 — Complete
- DAG execution engine (topological sort, parallel execution, template vars)
- SSE streaming (step events, reconnection, snapshot)
- tRPC CRUD router (7 procedures)
- ReactFlow canvas (custom nodes/edges, toolbar, execution animation)
- Credit billing via existing executeAgentCall()

### Phase 2 Priorities (from CrewAI/LangGraph research)

**Must-Have (production readiness):**
1. **Intermediate checkpointing** — persist step results after each step, not just at end. Server crash = lost state currently.
2. **Cycle/loop support** — convert from pure DAG to state machine. "Retry until success" is a core agent pattern.
3. **Human-in-the-loop** — `waitForInput` node type that pauses, checkpoints, resumes on API call.

**Should-Have (competitive parity):**
4. **Nested flows/subgraphs** — flows calling other flows. Key for marketplace composability.
5. **Shared context** — beyond template vars, a mutable state object all steps read/write.
6. **Dynamic routing** — manager/router nodes that decide downstream nodes at runtime.
7. **Inner-step streaming** — expose LLM text/tool calls within deployment steps.

**Jarble's Differentiators vs CrewAI/LangGraph:**
- Visual-first no-code (vs code-first Python)
- Marketplace with fork/publish (neither competitor has this)
- Built-in credit billing per step (monetizable flows)
- Native web SSE streaming (vs LangGraph Studio desktop app)

**Why:** Reference for Phase 2 planning and feature prioritization.
**How to apply:** Checkpointing first (safety), then cycles (patterns), then nested flows (marketplace), then HITL (enterprise).
