# Report 13: Component Interactivity Architecture Deep Dive

**Agent**: interactivity-architect
**Status**: COMPLETE
**Date**: 2026-02-27

## Executive Summary

Full architecture design for bidirectional component interactivity in Jarble. Covers CopilotKit `renderAndWait` pattern, Retool/Appsmith event systems, cross-component communication (Grafana/Metabase patterns), structured action protocol, form interactivity, chart interactivity, and a complete canvas event bus proposal.

**Key deliverables**: Structured action envelope protocol, pending action tracker with timeouts, button re-enablement modes, optimistic updates, canvas event bus for cross-component linking, and multi-step form architecture.

---

## 1. CopilotKit `renderAndWait` Analysis

### How It Works

CopilotKit implements a **pause/resume lifecycle** for agent execution:

1. Agent encounters a step requiring user input
2. Agent emits `RUN_FINISHED` with `outcome: "interrupt"` + `interrupt.payload`
3. Frontend renders the specified UI component
4. User interacts (approves, edits, fills form)
5. Frontend sends `resume` with user's response
6. Agent resumes execution

### Adaptation for Jarble

Jarble's current `RUN_FINISHED` is terminal. To support render-and-wait:

```typescript
// New SSE event type
interface SSEInterruptEvent {
  type: "RUN_INTERRUPTED";
  runId: string;
  threadId: string;
  interruptId: string;
  reason: "awaiting_interaction" | "awaiting_form" | "awaiting_confirmation";
  targetCardId: string;
  timeoutMs?: number;
}

// Resume via POST /api/tambo-agent
interface ResumePayload {
  deploymentId: string;
  threadId: string;
  resume: {
    interruptId: string;
    cardId: string;
    action: string;
    payload: Record<string, unknown>;
  };
}
```

**Note**: This requires OpenClaw gateway changes — medium-term enhancement. The structured action format (below) is the practical near-term improvement.

---

## 2. Retool/Appsmith Event System

### Key Patterns

- Multiple event handlers per component execute **in parallel**
- Sequential chaining via query success/failure handlers
- **Debounce**: Delays until N ms after last trigger
- **Throttle**: Max once per N ms
- **Conditional execution**: "Only run when" expressions
- **Reactive bindings**: `{{ component.property }}` (NOT suitable for Jarble's bot-mediated model)

### Action Classification for Jarble

```typescript
/** Bot-routed actions (need LLM response) */
const BOT_ROUTED_ACTIONS = new Set([
  "click", "submit", "row_click", "point_click",
  "slice_click", "item_click", "stat_click",
  "sandbox_action", "sandbox_error", "component_error",
]);

/** Local-only actions (no bot round trip) */
const LOCAL_ACTIONS = new Set([
  "tab_change", "accordion_toggle",
  "page_change", "sort_change",
]);

/** Debounce settings per action type (ms) */
const ACTION_DEBOUNCE: Record<string, number> = {
  brush_select: 500,
  zoom_change: 300,
  filter_change: 400,
  selection_change: 200,
};
```

---

## 3. Cross-Component Communication Patterns

### Pattern Comparison

| Pattern | Pros | Cons | Best For |
|---------|------|------|----------|
| Event Bus | Decoupled, any-to-any | Can get chaotic | Canvas cross-component events |
| React Context | Native React | All consumers re-render | Global state like "selected card" |
| Zustand | Selective subscriptions, simple | Another dependency | Complex shared state |

### How Grafana/Metabase Do It

- **Grafana**: Dashboard variables + URL query params. Clicking Panel A sets `?var-host=server1`, all panels using `$host` re-query.
- **Metabase**: Cross-filtering via shared dashboard filter parameters. Navigation question → filter → all wired cards refresh.

Both use a **shared variable store that panels subscribe to**.

### Recommendation for Jarble

Typed event bus (see Section 7). Components emit events, other components subscribe. Bot remains the intermediary for data-driven updates.

---

## 4. Action Handling Architecture

### 4a. Structured Action Format

**Current** (plain text, fragile):
```
[UI_ACTION] cardId=card-abc component=button_group action=click
{"buttonId":"approve"}
```

**Proposed** (fenced code block, reliably parseable):

```typescript
// lib/actionProtocol.ts
export interface JarbleActionEnvelope {
  _v: 1;
  _type: "ui_action";
  actionId: string;
  cardId: string;
  component: string;
  action: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export function formatActionMessage(envelope: JarbleActionEnvelope): string {
  return `\`\`\`jarble_action\n${JSON.stringify(envelope, null, 2)}\n\`\`\``;
}
```

Backend parsing in `uiBlockParser.ts`:
```typescript
const JARBLE_ACTION_FENCE = /```jarble_action\s*\n([\s\S]*?)```/g;

export function extractActions(text: string): {
  cleanText: string;
  actions: JarbleActionEnvelope[];
} { /* ... */ }
```

### 4b. Action Response Routing

Add `actionId` correlation to update blocks:
```json
{
  "card_id": "card-abc",
  "props": { "buttons": [{ "id": "approve", "label": "Approved", "disabled": true }] },
  "action_response": {
    "actionId": "act-m4k2-x9f1",
    "status": "success"
  }
}
```

### 4c. Loading/Pending States

```typescript
// hooks/usePendingActions.ts
export function usePendingActions() {
  // Tracks pending actions per card
  // 30s timeout → auto-timeout status
  // Returns: addPending, resolvePending, isCardPending, getCardPendingAction
}
```

**ActionLoadingOverlay** component:
```typescript
// Shows translucent overlay with spinner when card has pending action
<div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
  <Loader2 className="animate-spin" />
  <span>Processing...</span>
</div>
```

### 4d. Button Re-enablement Modes

**Current problem**: `CanvasButtonGroup` permanently disables all buttons after first click.

**Proposed**: Add `mode` prop:
- `"single"` — disable all after first click (current default)
- `"persistent"` — buttons re-enable after bot response
- `"toggle"` — clicked button stays highlighted, others remain clickable

```typescript
export interface CanvasButtonGroupProps {
  buttons: ButtonDef[];
  mode?: "single" | "persistent" | "toggle";
}
```

### 4e. Optimistic Updates

```typescript
// lib/optimisticUpdates.ts
const OPTIMISTIC_UPDATERS: Record<string, OptimisticUpdater> = {
  "button_group:click": (props, payload) => ({
    buttons: props.buttons.map(btn => ({
      ...btn, variant: btn.id === payload.buttonId ? "default" : "outline"
    })),
  }),
  "data_table:row_click": (_props, payload) => ({
    _selectedRowIndex: payload.rowIndex,
  }),
  "form:submit": (props) => ({ ...props, _submitted: true }),
};
```

---

## 5. Form Interactivity

### Multi-Step Forms

Bot orchestrates by sending `jarble_ui_update` to the same card after each submission:

```typescript
export interface CanvasFormProps {
  title?: string;
  fields: FormField[];
  submitLabel?: string;
  step?: number;           // Current step (1-indexed)
  totalSteps?: number;     // Shows progress indicator
  mode?: "single" | "multi_step";
  validation?: Record<string, ValidationRule>;
}
```

**Flow**: Bot renders step 1 → user submits → bot validates → sends update with step 2 fields → repeat.

### Client-Side Validation

```typescript
interface ValidationRule {
  pattern?: string;   // Regex
  min?: number;       // Min value/length
  max?: number;       // Max value/length
  message?: string;   // Error message
}
```

### Dynamic Form Fields

Bot controls visibility by setting `visible: false`. For `mode: "multi_step"`, field changes are debounced and dispatched so bot can show/hide dependent fields.

---

## 6. Chart Interactivity

### Click (Already Implemented)

`CanvasChart.tsx` dispatches `point_click` and `slice_click` with `{ dataKey, value, label, entry }`.

### Brush Selection (New)

```typescript
const handleBrushChange = useCallback((brushData) => {
  // 500ms debounce
  dispatch({
    action: "brush_select",
    payload: {
      startIndex, endIndex, startLabel, endLabel,
      summary: { count, dataKeys: [{ key, min, max, avg }] },
    },
  });
}, [dispatch, data, xKey, dataKeys]);
```

Sends summary stats (not raw data) to avoid huge payloads.

---

## 7. Canvas Event Bus

### Architecture

Typed event bus for cross-component UI state synchronization without routing through the bot. For **instant** highlighting/filtering — not data-driven changes.

```typescript
// lib/canvasEventBus.ts
export type CanvasEvent =
  | { type: "POINT_SELECTED"; sourceCardId: string; payload: { dataKey, value, label, index } }
  | { type: "ROW_SELECTED"; sourceCardId: string; payload: { rowIndex, rowData, columns } }
  | { type: "ITEM_SELECTED"; sourceCardId: string; payload: { index, text, data? } }
  | { type: "FILTER_CHANGED"; sourceCardId: string; payload: { field, value, operator } }
  | { type: "RANGE_SELECTED"; sourceCardId: string; payload: { startIndex, endIndex, ... } }
  | { type: "VALUE_CHANGED"; sourceCardId: string; payload: { field, value } }
  | { type: "CARD_FOCUSED"; sourceCardId: string; payload: {} };

export function emitCanvasEvent(event: CanvasEvent): void { /* ... */ }
export function subscribeCanvasEvent<T>(cardId, eventType, handler): () => void { /* ... */ }
```

### React Hook

```typescript
// hooks/useCanvasEvents.ts
export function useCanvasEvents() {
  const { blockId } = useCanvasAction();

  const emit = useCallback(<T>(type: T, payload) => {
    emitCanvasEvent({ type, sourceCardId: blockId, payload });
  }, [blockId]);

  function useOn<T>(eventType: T, handler): void {
    // Subscribe with auto-cleanup on unmount
  }

  return { emit, useOn, cardId: blockId };
}
```

### Example: Chart-Table Linking

```
User clicks bar in Chart (card-chart-1)
  ├→ dispatch() → bot receives action → may respond with analysis
  └→ emit("POINT_SELECTED", { label: "Q1", value: 42000 })
       ├→ Table subscribes → highlights row matching "Q1"
       ├→ StatGrid subscribes → highlights stat with label "Q1"
       └→ List subscribes → highlights item with text "Q1"
```

Components self-filter: `if (sub.cardId === event.sourceCardId) continue;`

---

## New Files to Create

| File | Purpose |
|------|---------|
| `lib/actionProtocol.ts` | Structured action envelope format |
| `lib/canvasEventBus.ts` | Cross-component event bus |
| `lib/optimisticUpdates.ts` | Optimistic update registry |
| `hooks/useCanvasEvents.ts` | React hook for event bus |
| `hooks/usePendingActions.ts` | Pending action tracker with timeout |
| `components/canvas/ActionLoadingOverlay.tsx` | Loading overlay |

## Files to Modify

| File | Changes |
|------|---------|
| `CanvasActionContext.tsx` | Action classification, debounce config |
| `CanvasButtonGroup.tsx` | `mode` prop, loading state, re-enablement |
| `CanvasForm.tsx` | Multi-step, validation, dynamic fields |
| `CanvasChart.tsx` | Brush selection, event bus emit |
| `CanvasDataTable.tsx` | Event bus subscribe/emit, row highlighting |
| `page.tsx` | Structured action envelope, pending tracking, optimistic updates |
| `useCanvasChat.ts` | `action_response` handling, resolve pending |
| `uiBlockParser.ts` | `extractActions()` for structured parsing |

## Implementation Priority

1. **Structured action format** — immediate, backward compatible
2. **Loading/pending states** — biggest UX improvement
3. **Re-enablement modes** — simple, high-value
4. **Canvas event bus** — enables cross-component linking
5. **Optimistic updates** — polish
6. **Multi-step forms** — feature expansion
7. **Chart brush selection** — feature expansion
8. **Render-and-wait protocol** — requires OpenClaw changes, medium-term
