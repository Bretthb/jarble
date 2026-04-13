---
name: Bot Teams documentation
description: Key facts about the Bot Teams / orchestration system documented in docs/BOT-TEAMS.md
type: project
---

Created docs/BOT-TEAMS.md on April 9, 2026.

**Why:** User requested a comprehensive investor/developer-quality reference for the entire Bot Teams and orchestration system.

**How to apply:** When updating API-ENDPOINTS.md or DEVELOPER-GUIDE.md with delegation-related changes, refer to BOT-TEAMS.md as the canonical source for the full system description.

## Key constants (env-overridable)
- `JARBLE_MAX_DELEGATION_DEPTH` — default 4
- `JARBLE_MAX_SPANS_PER_TRACE` — default 50
- `JARBLE_MAX_CREDITS_PER_TRACE_CENTS` — default 500 ($5.00)
- `MAX_CONCURRENT_DELEGATIONS` — default 5 (tamboAgent.ts)
- `MAX_FLOW_CHAT_SSE_PER_USER` — 3 (flowChat.ts)

## Key SSE events (flow chat)
jarble.flow.delegation.start/end/heartbeat/uiblock/skipped
jarble.flow.synthesis.start/end
jarble.flow.compose.available
jarble.flow.chat.trace
jarble.orchestration.step.start/end

## Key source files
- flowDelegation.ts — delegation engine
- flowChat.ts — flow chat SSE endpoint
- tamboAgent.ts — individual chat with parallel delegation
- agentCallsWriter.ts — OTel audit writer + circuit breaker
- a2aGateway.ts — A2A protocol endpoints

## Known limitations to preserve in docs
- TOCTOU budget race (parallel fan-out can briefly exceed maxBudgetCents)
- Think tag edge cases in synthesis (non-standard tag variants pass through)
- System prompt injection via user turn (not a real system prompt channel)
- "mentioned but not emitted" silent failure mode for delegation
- No shared team memory across specialists
