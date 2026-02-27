# Report 8: Bidirectional Component Interactivity

**Agent**: interactivity-architect
**Status**: COMPLETE

## Critical Discovery: Action Pipeline Already Works!

The system already has a working action relay:

```
Component (e.g. CanvasButtonGroup)
  → useCanvasAction().dispatch({ action: "click", payload: { buttonId } })
    → CanvasActionProvider adds blockId + component name
      → onAction callback in CardContent (page.tsx:703)
        → Formats as "[UI_ACTION] cardId=X component=Y action=Z\n{JSON}"
          → sendMessage(actionMsg, displayText)
            → POST /api/tambo-agent (SSE)
              → WS/exec to OpenClaw pod
                → Bot receives as user message text
```

### Components That Already Dispatch Actions (8)
- `CanvasButtonGroup` — click
- `CanvasForm` — submit
- `CanvasDataTable` — row_click
- `CanvasTabs` — tab_change
- `CanvasSandbox` — jarble.send() (most flexible)
- `CanvasList` — item_click
- `CanvasStatGrid` — stat_click
- `CanvasChart` — point_click, bar_click

### Critical Gaps
1. Bot has NO structured way to know "this is a UI action" vs "normal message"
2. Actions are one-shot — buttons disable permanently, no re-enable
3. No progress tracking mechanism
4. No component-to-component communication
5. Bot can't query canvas state proactively

## Architecture Proposals

### A. Action Handling (Minimal changes, max impact)

**Step 1 — Prompt guidance**: Add to soul.md how to handle `[UI_ACTION]` messages. Bot should respond to actions, use `jarble_ui_update` to update originating component.

**Step 2 — Component state updates**: Already wired! `UPDATE_CARD_PROPS` in canvasReducer + `UI_BLOCK_UPDATE` handler in useCanvasChat. Bot just needs to emit `jarble_ui_update` blocks.

**Step 3 — Remove permanent disable**: Change CanvasButtonGroup/CanvasForm from permanent disable to:
- Brief loading state after dispatch
- Bot re-enables via `jarble_ui_update`
- Add `mode: "single"` (current) vs `"persistent"` (re-enable after response)

### B. Canvas State Sync
Keep `[CANVAS_STATE]` approach. Enhance with:
1. Card state summaries for selected/referenced cards
2. Future: `query_canvas` MCP tool (requires bidirectional MCP)

### C. Progress Tracking

**Approach 1 (Short term)**: Bot outputs multiple `jarble_ui_update` blocks in single response. Backend streams them as parsed. Need incremental fenced-block parsing (not just final text).

**Approach 2 (Medium term)**: Dedicated `PROGRESS_UPDATE` SSE event via MCP tool `update_progress(card_id, value, label)`. Decouples from text generation.

### D. Component-to-Component Communication

Canvas-level event bus with pub/sub:
```
DataTable (row_click) → Canvas Event Bus → Chart (highlight)
```

Low priority — start with bot-mediated approach (bot receives action, updates multiple cards).

## Competitor Comparison

| Platform | Action Model | State Sync | Progress |
|----------|-------------|------------|----------|
| Streamlit | Script re-run | Full session_state | st.progress + st.spinner |
| Chainlit | @cl.action_callback | Manual cl.user_session | cl.Step streaming |
| CopilotKit AG-UI | Typed SSE events | STATE_SNAPSHOT + DELTA | Built into events |
| Vercel AI SDK | Tool calling + onToolCall | RSC re-render | streamUI loading states |
| **Jarble (current)** | Action relay as chat | [CANVAS_STATE] | Not supported |
| **Jarble (proposed)** | Structured relay + prompts | Enhanced [CANVAS_STATE] | Incremental updates |

## Implementation Priority

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | Action handling guidance in soul.md | Low | High |
| 2 | mode: "persistent" for ButtonGroup/Form | Low | High |
| 3 | Incremental fenced-block parsing | Medium | High |
| 4 | Loading/pending states for interactive components | Low | Medium |
| 5 | Canvas event bus | Medium-High | Medium |
| 6 | query_canvas MCP tool | Medium | Low-Medium |

## Key Files
- `Jarble-mvp/components/canvas/CanvasActionContext.tsx` — action dispatch context
- `Jarble-mvp/app/d/[id]/page.tsx:703-758` — handleAction relay
- `Jarble-mvp/app/d/[id]/page.tsx:48-103` — formatActionDisplay
- `Jarble-mvp/hooks/useCanvasChat.ts:340-349` — UI_BLOCK_UPDATE handler
- `Jarble-mvp/components/canvas/components/CanvasButtonGroup.tsx:31-34` — permanent disable
- `Jarble-mvp/components/workspace/canvasReducer.ts:248-261` — UPDATE_CARD_PROPS
