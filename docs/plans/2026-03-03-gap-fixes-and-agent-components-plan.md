# Gap Fixes + Agent UI Components Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 3 canvas system gaps (card accumulation limit, silent state loss indicator, LLM provider tracking) and add 3 new agent-oriented canvas components (reasoning, tool, sources) inspired by [Vercel AI Elements](https://elements.ai-sdk.dev/).

**Architecture:** All 6 items follow the established canvas component pipeline. Gaps 1-2 modify the canvas reducer and persistence hook. Gap 3 threads metadata through the SSE pipeline. New components follow the standard manifest + schema + React component registration pattern.

**Tech Stack:** React 19, TypeScript, Zod v4 (frontend), Tailwind v4, shadcn/ui Collapsible, Framer Motion, Vitest, Sentry, PostHog

---

## Task 1: Add `pinned` and `propsLost` fields to CanvasCard type

**Files:**
- Modify: `Jarble-mvp/components/workspace/types.ts`

**Step 1: Add new fields and constants to types.ts**

In `Jarble-mvp/components/workspace/types.ts`, add to the `CanvasCard` interface (after `layoutHint?` field, around line 43):

```typescript
  pinned?: boolean;
  propsLost?: boolean;
  llmProvider?: string;
  llmModel?: string;
```

Add the `MAX_CANVAS_CARDS` constant (after `FIX_ATTEMPT_WINDOW_MS`, around line 16):

```typescript
export const MAX_CANVAS_CARDS = 100;
```

Add new action types to the `CanvasAction` union (after existing actions):

```typescript
  | { type: "PIN_CARD"; id: string }
  | { type: "UNPIN_CARD"; id: string }
```

**Step 2: Verify types compile**

Run: `cd Jarble-mvp && npx tsc --noEmit --pretty`
Expected: No errors (new optional fields are backward-compatible)

**Step 3: Commit**

```bash
git add Jarble-mvp/components/workspace/types.ts
git commit -m "feat(canvas): add pinned, propsLost, llm fields to CanvasCard type"
```

---

## Task 2: Card accumulation limit + pin/unpin in reducer

**Files:**
- Modify: `Jarble-mvp/components/workspace/canvasReducer.ts`
- Test: `Jarble-mvp/components/workspace/__tests__/canvasReducer.test.ts`

**Step 1: Write failing tests for eviction and pinning**

Add to the existing test file `Jarble-mvp/components/workspace/__tests__/canvasReducer.test.ts`, inside the `describe("canvasReducer")` block. Import `MAX_CANVAS_CARDS` from `../types`.

```typescript
import { MAX_CANVAS_CARDS } from "../types";

// ... inside describe("canvasReducer") ...

  // ── PIN_CARD / UNPIN_CARD ─────────────────────────────────────────────────
  describe("PIN_CARD", () => {
    it("sets pinned to true on the target card", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "PIN_CARD", id: "a" });
      expect(result.cards[0].pinned).toBe(true);
    });

    it("does nothing if card not found", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "PIN_CARD", id: "nope" });
      expect(result.cards[0].pinned).toBeUndefined();
    });
  });

  describe("UNPIN_CARD", () => {
    it("sets pinned to false on the target card", () => {
      const state = stateWith([makeCard({ id: "a", pinned: true })]);
      const result = canvasReducer(state, { type: "UNPIN_CARD", id: "a" });
      expect(result.cards[0].pinned).toBe(false);
    });
  });

  // ── ADD_CARD eviction ─────────────────────────────────────────────────────
  describe("ADD_CARD eviction", () => {
    it("evicts oldest unpinned card when at limit", () => {
      const cards = Array.from({ length: MAX_CANVAS_CARDS }, (_, i) =>
        makeCard({ id: `card-${i}`, createdAt: 1000 + i })
      );
      const state = stateWith(cards, { nextZIndex: MAX_CANVAS_CARDS + 1 });
      const newCard = makeCard({ id: "overflow" });
      const result = canvasReducer(state, { type: "ADD_CARD", card: newCard });

      expect(result.cards).toHaveLength(MAX_CANVAS_CARDS);
      // Oldest card (card-0) was evicted
      expect(result.cards.find((c) => c.id === "card-0")).toBeUndefined();
      // New card was added
      expect(result.cards.find((c) => c.id === "overflow")).toBeDefined();
    });

    it("evicts oldest unpinned card, skipping pinned cards", () => {
      const cards = Array.from({ length: MAX_CANVAS_CARDS }, (_, i) =>
        makeCard({
          id: `card-${i}`,
          createdAt: 1000 + i,
          pinned: i === 0, // Pin the oldest card
        })
      );
      const state = stateWith(cards, { nextZIndex: MAX_CANVAS_CARDS + 1 });
      const newCard = makeCard({ id: "overflow" });
      const result = canvasReducer(state, { type: "ADD_CARD", card: newCard });

      expect(result.cards).toHaveLength(MAX_CANVAS_CARDS);
      // Pinned card-0 survives, card-1 (next oldest unpinned) was evicted
      expect(result.cards.find((c) => c.id === "card-0")).toBeDefined();
      expect(result.cards.find((c) => c.id === "card-1")).toBeUndefined();
    });

    it("rejects add when all cards are pinned and at limit", () => {
      const cards = Array.from({ length: MAX_CANVAS_CARDS }, (_, i) =>
        makeCard({ id: `card-${i}`, pinned: true })
      );
      const state = stateWith(cards, { nextZIndex: MAX_CANVAS_CARDS + 1 });
      const newCard = makeCard({ id: "overflow" });
      const result = canvasReducer(state, { type: "ADD_CARD", card: newCard });

      expect(result.cards).toHaveLength(MAX_CANVAS_CARDS);
      expect(result.cards.find((c) => c.id === "overflow")).toBeUndefined();
    });

    it("does not evict when under the limit", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "ADD_CARD", card: makeCard({ id: "b" }) });
      expect(result.cards).toHaveLength(2);
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `cd Jarble-mvp && npx vitest run components/workspace/__tests__/canvasReducer.test.ts`
Expected: FAIL — PIN_CARD/UNPIN_CARD are unhandled, eviction logic doesn't exist

**Step 3: Implement eviction in ADD_CARD and add PIN/UNPIN cases**

In `Jarble-mvp/components/workspace/canvasReducer.ts`:

Import `MAX_CANVAS_CARDS` from `./types`:

```typescript
import { MAX_CANVAS_CARDS } from "./types";
```

Replace the `ADD_CARD` case (around lines 13-21) with eviction logic:

```typescript
    case "ADD_CARD": {
      let cards = state.cards;

      // Evict oldest unpinned card if at limit
      if (cards.length >= MAX_CANVAS_CARDS) {
        const oldestUnpinnedIdx = cards.findIndex((c) => !c.pinned);
        if (oldestUnpinnedIdx === -1) {
          // All cards pinned — reject the add
          return state;
        }
        cards = cards.filter((_, i) => i !== oldestUnpinnedIdx);
      }

      return {
        ...state,
        cards: [...cards, { ...action.card, zIndex: state.nextZIndex }],
        nextZIndex: state.nextZIndex + 1,
      };
    }
```

Add PIN_CARD and UNPIN_CARD cases (before the default case):

```typescript
    case "PIN_CARD":
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, pinned: true } : c
        ),
      };

    case "UNPIN_CARD":
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.id ? { ...c, pinned: false } : c
        ),
      };
```

**Step 4: Run tests to verify they pass**

Run: `cd Jarble-mvp && npx vitest run components/workspace/__tests__/canvasReducer.test.ts`
Expected: All tests pass including new eviction and pin tests

**Step 5: Commit**

```bash
git add Jarble-mvp/components/workspace/canvasReducer.ts Jarble-mvp/components/workspace/__tests__/canvasReducer.test.ts
git commit -m "feat(canvas): card accumulation limit with eviction + pin/unpin support"
```

---

## Task 3: Pin button in card controls

**Files:**
- Modify: `Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx`

**Step 1: Add pin button to card controls**

In `SimpleCanvasGrid.tsx`, import the `Pin` icon from lucide-react (alongside existing icon imports). Also import `toast` from `sonner` for eviction notification.

In the card controls section (around lines 428-484), add a pin/unpin button before the remove button:

```tsx
{/* Pin / Unpin */}
<button
  className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-accent text-muted-foreground-subtle hover:text-foreground"
  onClick={(e) => {
    e.stopPropagation();
    dispatch({
      type: card.pinned ? "UNPIN_CARD" : "PIN_CARD",
      id: card.id,
    });
  }}
  title={card.pinned ? "Unpin card" : "Pin card"}
  aria-label={card.pinned ? "Unpin card" : "Pin card"}
>
  <Pin className={cn("w-4 h-4", card.pinned && "fill-current")} />
</button>
```

The `fill-current` class fills the pin icon when pinned, providing a clear visual distinction.

Also add a toast notification when eviction happens. In the `useCanvasChat.ts` hook's `addCardToCanvas` function (or wherever `ADD_CARD` is dispatched for streaming cards), check if the card count was at the limit before dispatching and show a toast:

```typescript
import { toast } from "sonner";
// Before dispatching ADD_CARD, if at limit:
if (state.cards.length >= MAX_CANVAS_CARDS) {
  toast("Oldest card removed to stay within limit", { duration: 3000 });
}
```

**Step 2: Verify types compile**

Run: `cd Jarble-mvp && npx tsc --noEmit --pretty`
Expected: No errors

**Step 3: Commit**

```bash
git add Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx Jarble-mvp/hooks/useCanvasChat.ts
git commit -m "feat(canvas): pin button in card controls + eviction toast"
```

---

## Task 4: Silent state loss indicator

**Files:**
- Modify: `Jarble-mvp/hooks/useCanvasPersistence.ts`
- Modify: `Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx`

**Step 1: Write failing test for propsLost detection**

Create or extend `Jarble-mvp/hooks/__tests__/useCanvasPersistence.test.ts` with:

```typescript
describe("propsLost detection", () => {
  it("sets propsLost=true on cards with _truncated marker", () => {
    // ... test that when restored card has _truncated: true in props,
    // the card gets propsLost: true
  });

  it("sets propsLost=true on cards from SKIP_PROPS_COMPONENTS with no props", () => {
    // Cards like "sandbox" that had props stripped during save
    // should get propsLost: true on restore
  });

  it("does not set propsLost on cards with full props", () => {
    // Normal cards restored with intact props
  });
});
```

**Step 2: Set propsLost flag in persistence restore**

In `Jarble-mvp/hooks/useCanvasPersistence.ts`, in the `loadCanvasState()` function where `PersistedCard` objects are mapped back to `CanvasCard` objects, add propsLost detection:

```typescript
// When restoring a card, detect if props were lost during persistence
const propsLost =
  // Explicit truncation marker
  (card.props as any)?._truncated === true ||
  // Card type that should have props but they were stripped
  (SKIP_PROPS_COMPONENTS.has(card.component) && !card.props);
```

Set `propsLost` on the restored card object.

**Step 3: Add amber banner to SimpleCanvasGrid**

In `SimpleCanvasGrid.tsx`, inside the card rendering section, add a banner for propsLost cards (before the card content, after the header):

```tsx
{card.propsLost && (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
    <span>Data lost on reload</span>
    <button
      className="ml-auto text-xs underline hover:no-underline"
      onClick={(e) => {
        e.stopPropagation();
        onAction?.({
          action: "component_error",
          cardId: card.id,
          component: card.component,
          error: "Component data was lost during page reload. Please regenerate.",
        });
      }}
    >
      Regenerate
    </button>
  </div>
)}
```

**Step 4: Run tests**

Run: `cd Jarble-mvp && npx vitest run hooks/__tests__/useCanvasPersistence.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add Jarble-mvp/hooks/useCanvasPersistence.ts Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx Jarble-mvp/hooks/__tests__/useCanvasPersistence.test.ts
git commit -m "feat(canvas): silent state loss indicator with regenerate button"
```

---

## Task 5: LLM provider tracking through SSE pipeline

**Files:**
- Modify: `jarble-api-main/src/routes/tamboAgent.ts` (backend SSE)
- Modify: `Jarble-mvp/hooks/useCanvasChat.ts` (frontend SSE consumer)
- Modify: `Jarble-mvp/components/canvas/CanvasRenderer.tsx` (Sentry/PostHog context)

**Step 1: Add llmProvider/llmModel to RUN_STARTED SSE event (backend)**

In `jarble-api-main/src/routes/tamboAgent.ts`, find the main `RUN_STARTED` event (around line 245) that fires before streaming begins. The deployment record is already loaded at this point. Add the fields:

```typescript
sendEvent(res, {
  type: "RUN_STARTED",
  runId,
  threadId,
  llmProvider: deployment.llmProvider,
  llmModel: deployment.llmModel,
});
```

**Step 2: Capture llmProvider/llmModel in useCanvasChat.ts (frontend)**

In `Jarble-mvp/hooks/useCanvasChat.ts`, add state to track the current run's LLM info:

```typescript
const [currentLlm, setCurrentLlm] = useState<{ provider?: string; model?: string }>({});
```

In the SSE event processing loop, handle the new fields on RUN_STARTED:

```typescript
if (event.type === "RUN_STARTED") {
  if (event.llmProvider || event.llmModel) {
    setCurrentLlm({ provider: event.llmProvider, model: event.llmModel });
  }
}
```

In `addCardToCanvas()`, pass the LLM info onto the card:

```typescript
const card: CanvasCard = {
  // ... existing fields ...
  llmProvider: currentLlm.provider,
  llmModel: currentLlm.model,
};
```

**Step 3: Add to Sentry breadcrumbs and PostHog in CanvasRenderer.tsx**

In `Jarble-mvp/components/canvas/CanvasRenderer.tsx`, the autofix Sentry breadcrumb (around line 230) already includes `component` and `rule`. Add the card's LLM info:

```typescript
Sentry.addBreadcrumb({
  category: "autofix",
  message: `AutoFix: ${repair.rule} on ${component}`,
  data: {
    component,
    rule: repair.rule,
    field: repair.field,
    from: repair.from,
    to: repair.to,
    llmProvider: card?.llmProvider,
    llmModel: card?.llmModel,
  },
});
```

The `card` object needs to be passed through to the renderer. Add `llmProvider?: string` and `llmModel?: string` as optional props on the CanvasRenderer component, threaded from the parent that holds the card data.

**Step 4: Verify types compile**

Run: `cd jarble-api-main && npm run typecheck && cd ../Jarble-mvp && npx tsc --noEmit --pretty`
Expected: No errors

**Step 5: Commit**

```bash
git add jarble-api-main/src/routes/tamboAgent.ts Jarble-mvp/hooks/useCanvasChat.ts Jarble-mvp/components/canvas/CanvasRenderer.tsx
git commit -m "feat(canvas): thread LLM provider/model through SSE to Sentry breadcrumbs"
```

---

## Task 6: `reasoning` component — manifest + schema

**Files:**
- Create: `shared/component-manifest/components/reasoning.ts`
- Modify: `shared/component-manifest/schemas/index.ts`
- Modify: `shared/component-manifest/index.ts`

**Step 1: Create manifest entry**

Create `shared/component-manifest/components/reasoning.ts`:

```typescript
import type { ComponentManifestEntry } from "../types.js";

export const reasoningEntry: ComponentManifestEntry = {
  name: "reasoning",
  description: "Collapsible AI thinking/chain-of-thought block with optional step-by-step breakdown",
  reference: "`{title?, content, collapsed?, duration?, steps?: [{label, description?, status?}]}`",
  category: "display",
  layout: { defaultHint: "full-width", defaultSize: { w: 600, h: 120 } },
  loading: "static",
  expensive: false,
  aliases: ["thinking", "chain_of_thought", "cot"],
  tags: ["ai", "reasoning", "thinking", "chain-of-thought"],
  builtin: true,
  renderOrder: 1,
  promptGuidance: "Use to show AI reasoning or thinking process. Content supports markdown. Steps show a stepper with complete/active/pending states.",
};
```

**Step 2: Add Zod schema**

In `shared/component-manifest/schemas/index.ts`, add the schema (before the `COMPONENT_SCHEMAS` object):

```typescript
export const reasoningSchema = z.object({
  title: z.string().optional(),
  content: z.string(),
  collapsed: z.boolean().optional(),
  duration: z.number().optional(),
  steps: z.array(z.object({
    label: z.string(),
    description: z.string().optional(),
    status: z.enum(["complete", "active", "pending"]).optional(),
  })).optional(),
});
```

Add to the `COMPONENT_SCHEMAS` record:

```typescript
  reasoning: reasoningSchema,
```

**Step 3: Register in manifest index**

In `shared/component-manifest/index.ts`:

Import:
```typescript
import { reasoningEntry } from "./components/reasoning.js";
```

Add to `COMPONENT_MANIFEST`:
```typescript
  reasoning: reasoningEntry,
```

Export the schema in the schemas re-export section.

**Step 4: Verify types compile**

Run: `cd Jarble-mvp && npx tsc --noEmit --pretty`
Expected: No errors

**Step 5: Commit**

```bash
git add shared/component-manifest/components/reasoning.ts shared/component-manifest/schemas/index.ts shared/component-manifest/index.ts
git commit -m "feat(manifest): add reasoning component entry + schema"
```

---

## Task 7: `reasoning` component — React implementation

**Files:**
- Create: `Jarble-mvp/components/canvas/components/CanvasReasoning.tsx`
- Modify: `Jarble-mvp/components/canvas/registry.ts`

**Step 1: Create the React component**

Create `Jarble-mvp/components/canvas/components/CanvasReasoning.tsx`:

```tsx
"use client";

import React, { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Brain, Check, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasReasoningProps {
  title?: string;
  content: string;
  collapsed?: boolean;
  duration?: number;
  steps?: Array<{
    label: string;
    description?: string;
    status?: "complete" | "active" | "pending";
  }>;
}

const STATUS_ICON = {
  complete: <Check className="w-3.5 h-3.5 text-emerald-500" />,
  active: <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />,
  pending: <Circle className="w-3.5 h-3.5 text-muted-foreground-subtle" />,
} as const;

function CanvasReasoningInner({
  title = "Thinking...",
  content,
  collapsed = true,
  duration,
  steps,
}: CanvasReasoningProps) {
  const [open, setOpen] = useState(!collapsed);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="p-3 h-full"
    >
      {/* Header / trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left group"
        aria-expanded={open}
      >
        <Brain className="w-4 h-4 text-muted-foreground-subtle shrink-0" />
        <span className="text-sm font-medium text-foreground/80">{title}</span>
        {duration != null && (
          <span className="text-xs text-muted-foreground-subtle tabular-nums">
            {duration.toFixed(1)}s
          </span>
        )}
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 ml-auto text-muted-foreground-subtle transition-transform",
            open && "rotate-90"
          )}
        />
      </button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 pl-6 border-l-2 border-muted text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {content}
            </div>

            {/* Optional steps */}
            {steps && steps.length > 0 && (
              <div className="mt-3 pl-6 space-y-1.5">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">
                      {STATUS_ICON[step.status || "pending"]}
                    </span>
                    <div>
                      <span className="text-sm font-medium text-foreground/80">
                        {step.label}
                      </span>
                      {step.description && (
                        <p className="text-xs text-muted-foreground-subtle">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default memo(CanvasReasoningInner);
```

**Step 2: Register in registry.ts**

In `Jarble-mvp/components/canvas/registry.ts`:

Add schema import (in the import block from `@jarble/component-manifest`):
```typescript
  reasoningSchema,
```

Add re-export:
```typescript
  reasoningSchema,
```

Add static import (in the static imports section):
```typescript
import CanvasReasoning from "./components/CanvasReasoning";
```

Add to `CANVAS_COMPONENTS` record:
```typescript
  reasoning: { component: CanvasReasoning, propsSchema: reasoningSchema },
```

**Step 3: Run manifest check**

Run: `cd Jarble-mvp && npm run check:manifest`
Expected: Pass

**Step 4: Verify types compile**

Run: `cd Jarble-mvp && npx tsc --noEmit --pretty`
Expected: No errors

**Step 5: Commit**

```bash
git add Jarble-mvp/components/canvas/components/CanvasReasoning.tsx Jarble-mvp/components/canvas/registry.ts
git commit -m "feat(canvas): add reasoning component (AI thinking/chain-of-thought)"
```

---

## Task 8: `tool` component — manifest + schema

**Files:**
- Create: `shared/component-manifest/components/tool.ts`
- Modify: `shared/component-manifest/schemas/index.ts`
- Modify: `shared/component-manifest/index.ts`

**Step 1: Create manifest entry**

Create `shared/component-manifest/components/tool.ts`:

```typescript
import type { ComponentManifestEntry } from "../types.js";

export const toolEntry: ComponentManifestEntry = {
  name: "tool",
  description: "Function/tool call visualization with inputs, status, and outputs",
  reference: "`{name, status: \"running\"|\"complete\"|\"error\", description?, inputs?, output?, error?, duration?}`",
  category: "display",
  layout: { defaultHint: "full-width", defaultSize: { w: 600, h: 140 } },
  loading: "static",
  expensive: false,
  aliases: ["function_call", "tool_call", "tool_use"],
  tags: ["ai", "tool", "function", "api"],
  builtin: true,
  renderOrder: 2,
  promptGuidance: "Use to show tool/function calls and their results. Inputs and outputs render as formatted JSON.",
};
```

**Step 2: Add Zod schema**

In `shared/component-manifest/schemas/index.ts`:

```typescript
export const toolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(["running", "complete", "error"]),
  inputs: z.record(z.unknown()).optional(),
  output: z.union([z.string(), z.record(z.unknown())]).optional(),
  error: z.string().optional(),
  duration: z.number().optional(),
});
```

Add to `COMPONENT_SCHEMAS`:
```typescript
  tool: toolSchema,
```

**Step 3: Register in manifest index**

In `shared/component-manifest/index.ts`:

```typescript
import { toolEntry } from "./components/tool.js";
// Add to COMPONENT_MANIFEST:
  tool: toolEntry,
```

**Step 4: Verify types compile**

Run: `cd Jarble-mvp && npx tsc --noEmit --pretty`
Expected: No errors

**Step 5: Commit**

```bash
git add shared/component-manifest/components/tool.ts shared/component-manifest/schemas/index.ts shared/component-manifest/index.ts
git commit -m "feat(manifest): add tool component entry + schema"
```

---

## Task 9: `tool` component — React implementation

**Files:**
- Create: `Jarble-mvp/components/canvas/components/CanvasTool.tsx`
- Modify: `Jarble-mvp/components/canvas/registry.ts`

**Step 1: Create the React component**

Create `Jarble-mvp/components/canvas/components/CanvasTool.tsx`:

```tsx
"use client";

import React, { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Wrench, Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasToolProps {
  name: string;
  description?: string;
  status: "running" | "complete" | "error";
  inputs?: Record<string, unknown>;
  output?: string | Record<string, unknown>;
  error?: string;
  duration?: number;
}

const STATUS_CONFIG = {
  running: { icon: Loader2, label: "Running", color: "text-blue-500", bg: "bg-blue-500/10", spin: true },
  complete: { icon: Check, label: "Complete", color: "text-emerald-500", bg: "bg-emerald-500/10", spin: false },
  error: { icon: X, label: "Error", color: "text-red-500", bg: "bg-red-500/10", spin: false },
} as const;

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="text-xs bg-muted/50 rounded-md p-2 overflow-x-auto max-h-48 font-mono text-foreground/80">
      {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
    </pre>
  );
}

function Section({ title, open: defaultOpen, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground-subtle hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
        {title}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CanvasToolInner({ name, description, status, inputs, output, error, duration }: CanvasToolProps) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.running;
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="p-3 h-full space-y-2"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wrench className="w-4 h-4 text-muted-foreground-subtle shrink-0" />
        <code className="text-sm font-medium font-mono text-foreground/90">{name}</code>
        <span className={cn("inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full", cfg.bg, cfg.color)}>
          <Icon className={cn("w-3 h-3", cfg.spin && "animate-spin")} />
          {cfg.label}
        </span>
        {duration != null && (
          <span className="text-xs text-muted-foreground-subtle tabular-nums ml-auto">
            {duration.toFixed(1)}s
          </span>
        )}
      </div>

      {description && (
        <p className="text-xs text-muted-foreground-subtle pl-6">{description}</p>
      )}

      {/* Inputs */}
      {inputs && Object.keys(inputs).length > 0 && (
        <div className="pl-6">
          <Section title="Inputs" open={status === "running"}>
            <JsonBlock data={inputs} />
          </Section>
        </div>
      )}

      {/* Output or Error */}
      {status === "error" && error && (
        <div className="pl-6">
          <Section title="Error" open>
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          </Section>
        </div>
      )}

      {status === "complete" && output != null && (
        <div className="pl-6">
          <Section title="Output" open={false}>
            <JsonBlock data={output} />
          </Section>
        </div>
      )}
    </motion.div>
  );
}

export default memo(CanvasToolInner);
```

**Step 2: Register in registry.ts**

Same pattern as Task 7 — add `toolSchema` import, re-export, static import of `CanvasTool`, and registry entry.

**Step 3: Run manifest check + typecheck**

Run: `cd Jarble-mvp && npm run check:manifest && npx tsc --noEmit --pretty`
Expected: Both pass

**Step 4: Commit**

```bash
git add Jarble-mvp/components/canvas/components/CanvasTool.tsx Jarble-mvp/components/canvas/registry.ts
git commit -m "feat(canvas): add tool component (function call visualization)"
```

---

## Task 10: `sources` component — manifest + schema

**Files:**
- Create: `shared/component-manifest/components/sources.ts`
- Modify: `shared/component-manifest/schemas/index.ts`
- Modify: `shared/component-manifest/index.ts`

**Step 1: Create manifest entry**

Create `shared/component-manifest/components/sources.ts`:

```typescript
import type { ComponentManifestEntry } from "../types.js";

export const sourcesEntry: ComponentManifestEntry = {
  name: "sources",
  description: "Citation and reference list with expandable snippets",
  reference: "`{items: [{title, url?, snippet?, icon?, relevance?}], title?}`",
  category: "display",
  layout: { defaultHint: "compact", defaultSize: { w: 320, h: 180 } },
  loading: "static",
  expensive: false,
  aliases: ["citations", "references"],
  tags: ["ai", "sources", "citations", "references"],
  builtin: true,
  renderOrder: 9,
  promptGuidance: "Use to show sources, citations, or references. Each item has a title and optional URL, snippet, icon.",
};
```

**Step 2: Add Zod schema**

In `shared/component-manifest/schemas/index.ts`:

```typescript
export const sourcesSchema = z.object({
  items: z.array(z.object({
    title: z.string(),
    url: z.string().optional(),
    snippet: z.string().optional(),
    icon: z.string().optional(),
    relevance: z.number().min(0).max(1).optional(),
  })),
  title: z.string().optional(),
});
```

Add to `COMPONENT_SCHEMAS`:
```typescript
  sources: sourcesSchema,
```

**Step 3: Register in manifest index**

Same pattern — import `sourcesEntry`, add to `COMPONENT_MANIFEST`.

**Step 4: Verify types compile**

Run: `cd Jarble-mvp && npx tsc --noEmit --pretty`
Expected: No errors

**Step 5: Commit**

```bash
git add shared/component-manifest/components/sources.ts shared/component-manifest/schemas/index.ts shared/component-manifest/index.ts
git commit -m "feat(manifest): add sources component entry + schema"
```

---

## Task 11: `sources` component — React implementation

**Files:**
- Create: `Jarble-mvp/components/canvas/components/CanvasSources.tsx`
- Modify: `Jarble-mvp/components/canvas/registry.ts`

**Step 1: Create the React component**

Create `Jarble-mvp/components/canvas/components/CanvasSources.tsx`:

```tsx
"use client";

import React, { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasSourcesProps {
  items: Array<{
    title: string;
    url?: string;
    snippet?: string;
    icon?: string;
    relevance?: number;
  }>;
  title?: string;
}

function SourceRow({ item, index }: { item: CanvasSourcesProps["items"][number]; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group">
      <button
        onClick={() => item.snippet && setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 w-full text-left py-1.5 px-1 rounded-md transition-colors",
          item.snippet && "hover:bg-muted/50 cursor-pointer",
          !item.snippet && "cursor-default"
        )}
      >
        {/* Number badge */}
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-muted text-xs font-medium text-muted-foreground shrink-0">
          {index + 1}
        </span>

        {/* Icon */}
        {item.icon && (
          <span className="text-sm shrink-0">{item.icon}</span>
        )}

        {/* Title */}
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sm text-foreground/90 hover:underline truncate flex-1"
          >
            {item.title}
          </a>
        ) : (
          <span className="text-sm text-foreground/90 truncate flex-1">{item.title}</span>
        )}

        {/* Relevance bar */}
        {item.relevance != null && (
          <div className="w-12 h-1.5 bg-muted rounded-full shrink-0 overflow-hidden">
            <div
              className="h-full bg-foreground/30 rounded-full"
              style={{ width: `${Math.round(item.relevance * 100)}%` }}
            />
          </div>
        )}

        {/* External link icon */}
        {item.url && (
          <ExternalLink className="w-3 h-3 text-muted-foreground-subtle opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        )}

        {/* Expand chevron */}
        {item.snippet && (
          <ChevronRight className={cn("w-3 h-3 text-muted-foreground-subtle transition-transform shrink-0", expanded && "rotate-90")} />
        )}
      </button>

      {/* Expandable snippet */}
      <AnimatePresence initial={false}>
        {expanded && item.snippet && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <p className="text-xs text-muted-foreground leading-relaxed pl-7 pr-2 pb-1.5 border-l-2 border-muted ml-3">
              {item.snippet}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CanvasSourcesInner({ items, title = "Sources" }: CanvasSourcesProps) {
  return (
    <motion.div
      role="list"
      aria-label={title}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="p-3 h-full"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-foreground/80">{title}</span>
        <span className="text-xs text-muted-foreground-subtle">({items.length})</span>
      </div>

      {/* Source list */}
      <div className="space-y-0.5">
        {items.map((item, i) => (
          <SourceRow key={i} item={item} index={i} />
        ))}
      </div>
    </motion.div>
  );
}

export default memo(CanvasSourcesInner);
```

**Step 2: Register in registry.ts**

Same pattern — add `sourcesSchema` import/re-export, static import of `CanvasSources`, and registry entry.

**Step 3: Run manifest check + typecheck**

Run: `cd Jarble-mvp && npm run check:manifest && npx tsc --noEmit --pretty`
Expected: Both pass

**Step 4: Commit**

```bash
git add Jarble-mvp/components/canvas/components/CanvasSources.tsx Jarble-mvp/components/canvas/registry.ts
git commit -m "feat(canvas): add sources component (citations/references)"
```

---

## Task 12: Final verification

**Step 1: Run all frontend tests**

Run: `cd Jarble-mvp && npm test`
Expected: 227+ tests pass (existing + new reducer tests)

**Step 2: Run all backend tests**

Run: `cd jarble-api-main && npm test`
Expected: 453+ tests pass

**Step 3: Run manifest sync check**

Run: `cd Jarble-mvp && npm run check:manifest`
Expected: Pass — 40 components in manifest match 40 in registry

**Step 4: TypeCheck both packages**

Run: `cd Jarble-mvp && npx tsc --noEmit --pretty && cd ../jarble-api-main && npm run typecheck`
Expected: No errors

**Step 5: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "chore: final verification — all tests pass, types clean"
```
