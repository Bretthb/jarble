---
name: perf_useCanvasChat_plan
description: useCanvasChat re-render optimization plan — rAF merge, React.memo, useReducer roadmap
type: project
---

## useCanvasChat Performance Optimization (2026-03-23)

### 13 useState calls causing cascading re-renders during streaming

**Group A (hot path, ~60fps):** isStreaming, streamingText, streamingReasoning, streamingCardIds, toolStatus, activeAgentCall, orchestrationSteps
**Group B (per-message):** messages, lastChatError, lastUserMessage, suggestions
**Group C (rare):** conversations, activeConversationId

### Optimization phases (ordered by risk/reward):

1. **Merge rAF loops** — IMPLEMENTING NOW. Single tick() for text+reasoning. ~50% reduction during overlap.
2. **React.memo canvas children** — IMPLEMENTING NOW. SimpleCanvasGrid, DashboardCanvas, ConversationHistoryPanel. ~80% reduction on canvas subtree.
3. **useReducer for Group A** — Future. Code clarity, enables memo. Medium risk, 2-3 hours.
4. **Split hook** — Future. Only if profiling shows need. High risk, 4-6 hours.

### Key insight from research:
React 18 already batches synchronous multi-setState calls. The real wins come from (a) merging the two independent rAF loops and (b) preventing canvas re-renders via memo.

**Why:** Reference for future performance work on the chat streaming pipeline.
**How to apply:** Phases 1-2 being implemented now. Phase 3 only if profiling shows need.
