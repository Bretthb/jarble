# Design: Gap Fixes + Agent UI Components

**Date**: 2026-03-03
**Status**: Approved
**Scope**: Frontend (`Jarble-mvp/`) + Shared (`shared/component-manifest/`)

---

## Overview

Six items in a single batch:
1. **Gap #11** — Card accumulation limit (memory protection)
2. **Gap #8** — Silent state loss indicator (UX honesty)
3. **Gap #7** — LLM provider tracking in error context
4. **New component: `reasoning`** — Collapsible AI thinking blocks
5. **New component: `tool`** — Function call visualization
6. **New component: `sources`** — Citation/attribution display

Items 1-3 fix gaps identified in the component system gap analysis (#16). Items 4-6 are new canvas components inspired by [Vercel AI Elements](https://elements.ai-sdk.dev/) (47-component library built on shadcn/ui for AI-native UIs), adapted to Jarble's bot-driven grid rendering model. AI Elements' `Reasoning`, `Tool`, and `Sources` components are the reference designs — we adapt the visual patterns but use our own Zod schemas and `render_ui` MCP pipeline instead of AI SDK hooks.

---

## Gap #11: Card Accumulation Limit

### Problem
`canvasReducer` has no upper bound on cards. Long conversations can accumulate hundreds of cards, degrading performance and eventually crashing the tab.

### Design

**Hard cap**: `MAX_CANVAS_CARDS = 100` constant in `types.ts`.

**Eviction on `ADD_CARD`**: When adding a card would exceed the limit, evict the oldest unpinned card. "Oldest" = lowest index in the `cards` array (insertion order). If all cards are pinned and the limit is reached, reject the add (no eviction of pinned cards).

**Pin protection**: Add `pinned: boolean` field to `CanvasCard` type. Pinned cards are never evicted. Users can pin/unpin via a pin button in card controls (alongside existing remove/split/merge buttons).

**Notification**: When a card is evicted, dispatch a toast (sonner) saying "Oldest card removed to stay within limit". No modal, no blocking.

**Persistence**: The existing `useCanvasPersistence` hook already has a 2MB budget with size-based cutoffs. The 100-card cap provides an earlier, predictable ceiling that prevents the persistence layer from ever needing to make lossy decisions.

### Files to change
| File | Change |
|------|--------|
| `components/workspace/types.ts` | Add `pinned` to `CanvasCard`, add `PIN_CARD`/`UNPIN_CARD` actions, `MAX_CANVAS_CARDS` constant |
| `components/workspace/canvasReducer.ts` | `ADD_CARD`: eviction logic. New `PIN_CARD`/`UNPIN_CARD` cases |
| `components/workspace/SimpleCanvasGrid.tsx` | Pin button in card controls |
| `hooks/__tests__/canvasReducer.test.ts` (existing) | Tests for eviction + pin protection |

---

## Gap #8: Silent State Loss Indicator

### Problem
When canvas cards are restored from localStorage, large props (sandbox HTML, big data arrays) may have been dropped during persistence to stay within the 2MB budget. The user sees a broken or empty card with no explanation.

### Design

**Flag**: Add `propsLost: boolean` field to `CanvasCard` type (default `false`). Set to `true` during persistence restore when the card's original props were truncated or dropped.

**Visual indicator**: Cards with `propsLost === true` show a subtle amber banner at the top: "This component lost data when the page reloaded." with a "Regenerate" button.

**Regenerate action**: Clicking "Regenerate" reuses the existing "Fix Component" flow — sends a message to the bot asking it to re-render the component. The card's `propsLost` flag is cleared when new props arrive.

**Detection**: In `useCanvasPersistence`, when restoring cards, compare the serialized size of each card's props against a threshold. If a card was stored with `_truncated: true` marker (or props are missing/empty when they shouldn't be), set `propsLost = true`.

### Files to change
| File | Change |
|------|--------|
| `components/workspace/types.ts` | Add `propsLost` to `CanvasCard` |
| `hooks/useCanvasPersistence.ts` | Set `propsLost` flag on restore |
| `components/workspace/SimpleCanvasGrid.tsx` | Render amber banner + regenerate button for `propsLost` cards |
| `hooks/__tests__/useCanvasPersistence.test.ts` | Test propsLost detection |

---

## Gap #7: LLM Provider Tracking

### Problem
When a canvas component fails or a chat error occurs, error reports (Sentry) and analytics (PostHog) don't include which LLM provider/model generated the response. This makes it impossible to correlate component quality issues with specific providers.

### Design

**SSE pipeline**: Add `llmProvider` and `llmModel` fields to the `RUN_STARTED` SSE event emitted by `tamboAgent.ts`. The backend already has this data from the deployment record.

**Frontend storage**: Store `llmProvider` and `llmModel` on each `CanvasCard` when created from a bot response. These fields persist with the card.

**Error context**: When `CanvasRenderer` catches a component error or autoFixProps applies repairs:
- Add `llmProvider` and `llmModel` to the Sentry breadcrumb (already tracks fix rules)
- Add to PostHog events (component render failures)

**No UI change**: These fields are metadata only — not displayed to users.

### Files to change
| File | Change |
|------|--------|
| `jarble-api-main/src/routes/tamboAgent.ts` | Include `llmProvider`/`llmModel` in RUN_STARTED SSE event |
| `components/workspace/types.ts` | Add `llmProvider?` and `llmModel?` to `CanvasCard` |
| `app/d/[id]/page.tsx` or chat message handler | Store provider/model on card creation |
| `components/canvas/CanvasRenderer.tsx` | Add to Sentry breadcrumbs and PostHog events |

---

## New Component: `reasoning`

### Purpose
Display AI thinking/chain-of-thought in a collapsible block. Reference: [AI Elements Reasoning](https://elements.ai-sdk.dev/components/reasoning) — auto-opens during streaming, collapses when done. Also draws from [Chain of Thought](https://elements.ai-sdk.dev/components/chain-of-thought) which adds step-by-step visualization. Our version combines both patterns into a single component.

### Props Schema
```typescript
{
  title?: string;        // Default: "Thinking..."
  content: string;       // The reasoning text (markdown supported)
  collapsed?: boolean;   // Default: true (starts collapsed)
  duration?: number;     // Thinking duration in seconds (shown as badge)
  steps?: Array<{        // Optional step-by-step breakdown (ChainOfThought pattern)
    label: string;
    description?: string;
    status?: "complete" | "active" | "pending";
  }>;
}
```

### Rendering
- Collapsible section using shadcn `Collapsible` (already in the project)
- Header row: brain icon + title + optional duration badge (e.g. "2.3s") + chevron toggle
- Content: rendered as markdown text in a muted, slightly indented block
- Subtle left border (like a blockquote) to visually distinguish from regular content
- If `steps` provided: renders as a vertical stepper with status icons (check/spinner/circle)

### Layout
- `defaultSize: { w: 2, h: 1 }` — spans full width, compact height
- `layoutHint: "full-width"`
- Category: `display`

---

## New Component: `tool`

### Purpose
Visualize a function/tool call with its inputs, execution state, and outputs. Reference: [AI Elements Tool](https://elements.ai-sdk.dev/components/tool) — collapsible interface with status badges and JSON syntax highlighting. Our version simplifies the state model (AI Elements has 7 states; we use 3).

### Props Schema
```typescript
{
  name: string;              // Tool/function name
  description?: string;      // What this tool does
  status: "running" | "complete" | "error";
  inputs?: Record<string, unknown>;   // Input parameters
  output?: string | Record<string, unknown>;  // Result
  error?: string;            // Error message if status === "error"
  duration?: number;         // Execution time in seconds
}
```

### Rendering
- Card with tool name as header (wrench icon + monospace `name`)
- Status badge: spinning loader + "Running" (running), green check + "Complete" (complete), red X + "Error" (error)
- Collapsible "Inputs" section showing formatted JSON (syntax highlighted)
- Collapsible "Output" section showing result (or error message in destructive color)
- Duration badge if provided (e.g. "1.2s")
- Default: collapsed when complete, expanded when running/error

### Layout
- `defaultSize: { w: 2, h: 1 }`
- `layoutHint: "full-width"`
- Category: `display`

---

## New Component: `sources`

### Purpose
Display citations and references with expandable details. Reference: [AI Elements Sources](https://elements.ai-sdk.dev/components/sources) (collapsible source list with count trigger) and [Inline Citation](https://elements.ai-sdk.dev/components/inline-citation) (hover cards with favicon + carousel). Our version renders as a standalone canvas card rather than inline text annotations.

### Props Schema
```typescript
{
  items: Array<{
    title: string;           // Source title
    url?: string;            // Link to source
    snippet?: string;        // Relevant excerpt
    icon?: string;           // Favicon URL or emoji
    relevance?: number;      // 0-1 relevance score
  }>;
  title?: string;            // Section title, default: "Sources"
}
```

### Rendering
- Header: title + count badge (e.g. "Sources (5)")
- Numbered list of sources, each as a compact row
- Each row: number badge + favicon/icon + title (linked if URL provided) + optional relevance bar
- Click to expand: shows snippet text below the title row in a muted blockquote style
- External links open in new tab (`target="_blank" rel="noopener"`)

### Layout
- `defaultSize: { w: 1, h: 1 }`
- `layoutHint: "compact"`
- Category: `display`

---

## Component Registration (all 3 new components)

Follow the standard pattern:
1. Create component definition in `shared/component-manifest/components/{name}.ts`
2. Register in `shared/component-manifest/index.ts`
3. Create React component in `Jarble-mvp/components/canvas/components/Canvas{Name}.tsx`
4. Import in `components/canvas/registry.ts` (auto-imported from manifest)
5. Run `npm run check:manifest` to verify sync

---

## What We're NOT Doing

- No backend changes for the 3 new components (they render from bot output like all canvas components)
- No new MCP tools (bot uses existing `render_ui` with new component names)
- No persistence changes for the new components (standard card persistence applies)
- No prompt/soul.md changes in this batch (component reference auto-generates from manifest)
