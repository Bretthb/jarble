# Report 10: Error Resilience & Graceful Degradation

**Agent**: error-resilience-planner
**Status**: COMPLETE

## Current State: 7/10

Good component-level error boundaries but weak cross-layer resilience.

## Critical Gaps

### 1. Streaming corruption
No checksum/integrity check if SSE transmission cuts mid-JSON.

### 2. Silent block loss
Malformed blocks silently vanish, user sees nothing.

### 3. No self-correction
Bot can't see what broke, retries blindly.

### 4. Custom component validation
Resolved blocks not re-validated before SSE.

### 5. Pending block leaks
If START without END, block stays in memory forever.

## What Works Well
- Component error boundaries catch individual failures
- Zod validation at render time shows clear errors
- Graceful degradation (empty data → fallback UI)
- Good defensive programming in data table, chart components

## Error Stages Analysis

| Stage | Location | Current Handling | Gap |
|-------|----------|-----------------|-----|
| 1. LLM generates block | Pod | Good — MCP validates | Minor |
| 2. Backend parsing | uiBlockParser.ts | Good structure | Weak streaming detection |
| 3. Custom resolution | componentResolver.ts | Lenient | No re-validation |
| 4. SSE transmission | tamboAgent.ts | No integrity checks | Medium gap |
| 5. Frontend parse | useCanvasChat.ts | Missing event tracking | Medium gap |
| 6. CanvasRenderer | CanvasRenderer.tsx | Excellent error boundary | Good |
| 7. Individual components | Canvas*.tsx | Mostly defensive | Good |

## Quick Wins (2-3 hours, fixes 80%)

### Phase 1a: Backend validation before SSE
Add Zod validation in `tamboAgent.ts:emitGatewayResult()` before sending blocks. Reject invalid props, emit `UI_BLOCK_ERROR` instead.

### Phase 2a: Frontend timeout tracking
Track when blocks START, timeout after 5s if no END arrives. Prevents memory leaks from orphaned pending blocks.

### Phase 3a: Soul.md error recovery
Update soul.md with error recovery section so bot understands when components fail and can regenerate with correct data.

## Implementation Roadmap

- **Phase 1** (1-2 hours): Backend Zod validation before SSE
- **Phase 2** (1 hour): Frontend block timeout tracking + checksums
- **Phase 3** (30 min): Soul.md error recovery prompting
- **Phase 4** (future): Metrics/monitoring for block success rates
- **Phase 5** (future): Bot self-correction loop (send error back to LLM)

## Key Files
- `Jarble-mvp/components/canvas/CanvasRenderer.tsx` — error boundaries
- `Jarble-mvp/components/canvas/registry.ts` — Zod schemas
- `jarble-api-main/src/utils/uiBlockParser.ts` — block parsing
- `jarble-api-main/src/utils/componentResolver.ts` — component resolution
- `jarble-api-main/src/routes/tamboAgent.ts` — SSE emission
- `Jarble-mvp/components/tambo/StreamingBotMessage.tsx` — streaming error handling
