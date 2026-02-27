# Report 3: Live/Real-Time Component Patterns

**Agent**: live-data-researcher
**Status**: COMPLETE

## Current State

### jarble_ui_update — Already Works End-to-End!

The codebase has a **complete update pathway** but designed for one-shot updates within a single response:

1. **MCP tool**: `update_ui` in jarble-ui-server.js:261
2. **Parser**: `extractUIUpdates()` in uiBlockParser.ts:133
3. **Gateway**: openclawGateway.ts:269 returns `uiUpdates` alongside `uiBlocks`
4. **SSE**: tamboAgent.ts:323-334 emits `UI_BLOCK_UPDATE` events
5. **Frontend**: useCanvasChat.ts:340-349 and useDirectChat.ts:187-209 handle updates
6. **Reducer**: canvasReducer.ts:248-261 `UPDATE_CARD_PROPS` action

**Limitation**: Only works within a single bot response. No mechanism for updates after `RUN_FINISHED`.

### Existing Persistent SSE Precedent
`useStatusStream.ts` demonstrates long-lived EventSource for pod status — native EventSource API, reconnect with exponential backoff, snapshot + delta pattern.

## Competitor Analysis

| Platform | Live Update Mechanism |
|----------|----------------------|
| Streamlit | Re-runs script on server, diffs component tree, pushes via WebSocket |
| Vercel AI SDK | streamUI yields React nodes progressively within one response |
| Chainlit | Socket.IO persistent bidirectional WebSocket |

## Proposed Architecture — 3 Tiers

### Option 1 — Enhanced Single Response (Simplest, covers 60%)
- Improve existing `update_ui` flow with multi-step render+update
- Add CSS transitions so prop changes animate smoothly
- Just prompt + frontend polish, no new infrastructure
- **Limitation**: Updates stop when response stream ends

### Option 2 — Persistent Canvas SSE Channel (Recommended, covers 90%)
- New long-lived endpoint: `GET /api/canvas/:deploymentId/stream`
- Opens alongside chat, stays open indefinitely (like useStatusStream)
- Bot's pod can POST updates via internal API
- Events: `CARD_UPDATE`, `CARD_APPEND`, `CARD_REMOVE`, `CARD_ADD`
- Enables: background task progress, periodic refresh, webhook-triggered updates
- New MCP tool: `push_update(card_id, props)` writes to shared event bus

### Option 3 — WebSocket Upgrade (Most capable, covers 100%)
- Replace chat SSE with persistent WebSocket
- Carries both chat messages AND canvas updates bidirectionally
- Most complex — skip unless needs grow beyond SSE

## New SSE Events Needed (Option 2)
```
UI_CARD_UPDATE    { cardId, props, merge }
UI_CARD_APPEND    { cardId, key, items }
UI_CARD_ADD       { card }
UI_CARD_REMOVE    { cardId }
CANVAS_SNAPSHOT   { cards: [...] }
```

## New MCP Tools Needed (Option 2)
```
push_update(card_id, props, merge?)
schedule_update(card_id, interval_ms, data_source)
start_task(task_id, description, card_id?)
update_task_progress(task_id, percent, status_text?)
```

## Key Insight
The gap is NOT in the plumbing — it's in:
1. **Prompting** — bot doesn't know it should use update_ui for progressive rendering
2. **CSS transitions** — static prop changes feel like replacements not animations
3. **Persistence** — no channel for updates after RUN_FINISHED

## Implementation Priority
1. Quick Win (2-3 hours): CSS transitions + prompt guidance for multi-step updates
2. Medium-term (2-3 days): Persistent canvas SSE endpoint + push_update MCP tool
3. Long-term: schedule_update, start_task/update_task_progress
