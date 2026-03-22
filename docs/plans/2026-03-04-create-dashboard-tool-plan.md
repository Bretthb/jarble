# create_dashboard Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `create_dashboard` MCP tool that emits multiple canvas components as a visually grouped dashboard.

**Architecture:** New MCP tool emits multiple `jarble_ui` blocks tagged with a shared `dashboardId`. Backend passes the field through and emits a `jarble.dashboard.created` CUSTOM event after all blocks. Frontend groups those cards visually with a shared title bar.

**Tech Stack:** MCP stdio server (JS), Express SSE, React canvas reducer, Tailwind

---

### Task 1: Add `dashboardId` passthrough to uiBlockParser

**Files:**
- Modify: `jarble-api-main/src/utils/uiBlockParser.ts:24-32` (JarbleUIBlock interface)
- Modify: `jarble-api-main/src/utils/uiBlockParser.ts:266-276` (extractUIBlocks push)

**Step 1: Add fields to JarbleUIBlock interface**

```typescript
// uiBlockParser.ts line 24
export interface JarbleUIBlock {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
  layoutHint?: LayoutHint;
  dashboardId?: string;
  dashboardTitle?: string;
}
```

**Step 2: Pass fields through in extractUIBlocks**

In the `uiBlocks.push(...)` block (~line 266), add after the layoutHint spread:

```typescript
...(typeof parsed.dashboardId === "string" ? { dashboardId: parsed.dashboardId } : {}),
...(typeof parsed.dashboardTitle === "string" ? { dashboardTitle: parsed.dashboardTitle } : {}),
```

**Step 3: Run existing tests to confirm no regression**

Run: `cd jarble-api-main && npx vitest run src/utils`
Expected: All pass (no tests reference dashboardId yet — it's additive)

**Step 4: Commit**

```
feat(api): add dashboardId/dashboardTitle passthrough to uiBlockParser
```

---

### Task 2: Add `CUSTOM_DASHBOARD_CREATED` event constant

**Files:**
- Modify: `jarble-api-main/src/utils/eventTypes.ts:37-39`

**Step 1: Add constant**

After `CUSTOM_CHAT_ERROR`, add:

```typescript
export const CUSTOM_DASHBOARD_CREATED = "jarble.dashboard.created";
```

**Step 2: Commit**

```
feat(api): add CUSTOM_DASHBOARD_CREATED event constant
```

---

### Task 3: Emit dashboard metadata in tamboAgent.ts

**Files:**
- Modify: `jarble-api-main/src/routes/tamboAgent.ts:37-45` (imports)
- Modify: `jarble-api-main/src/routes/tamboAgent.ts` (emitGatewayResult — resolved blocks loop)

**Step 1: Import new constant**

Add `CUSTOM_DASHBOARD_CREATED` to the import from `eventTypes.js`.

**Step 2: Pass dashboardId through TOOL_CALL_START**

In `emitGatewayResult`, in the `for (const block of resolvedBlocks)` loop, add to the TOOL_CALL_START event:

```typescript
sendEvent(res, {
  type: TOOL_CALL_START,
  toolCallId,
  toolCallName: `show_${block.component}`,
  parentMessageId: messageId,
  ...(block.editable ? { editable: true } : {}),
  ...(block.fileId ? { fileId: block.fileId } : {}),
  ...(block.saveMethod ? { saveMethod: block.saveMethod } : {}),
  ...(block.layoutHint ? { layoutHint: block.layoutHint } : {}),
  ...(block.dashboardId ? { dashboardId: block.dashboardId } : {}),
  ...(block.dashboardTitle ? { dashboardTitle: block.dashboardTitle } : {}),
});
```

Do the same for the streaming callback's TOOL_CALL_START (the `async (block) =>` callback in chatViaGateway).

**Step 3: Emit dashboard.created after all blocks**

After the resolved blocks loop in `emitGatewayResult`, add:

```typescript
// Emit dashboard grouping events
const dashboardGroups = new Map<string, { title: string; cardIds: string[] }>();
for (const block of resolvedBlocks) {
  if (block.dashboardId) {
    const group = dashboardGroups.get(block.dashboardId) || { title: block.dashboardTitle || "Dashboard", cardIds: [] };
    group.cardIds.push(`card-${block.id}`);
    dashboardGroups.set(block.dashboardId, group);
  }
}
for (const [dashboardId, group] of dashboardGroups) {
  sendEvent(res, {
    type: CUSTOM,
    name: CUSTOM_DASHBOARD_CREATED,
    value: { dashboardId, title: group.title, cardIds: group.cardIds },
  });
}
```

**Step 4: Run tests**

Run: `cd jarble-api-main && npx vitest run`
Expected: All 469 pass

**Step 5: Commit**

```
feat(api): emit dashboard grouping metadata in TOOL_CALL events
```

---

### Task 4: Add `create_dashboard` MCP tool

**Files:**
- Modify: `jarble-api-main/src/mcp/jarble-ui-server.js` (tool definition + execution)

**Step 1: Add tool definition**

In the TOOLS array (before the closing `]`), add:

```javascript
{
  name: "create_dashboard",
  description: "Render a multi-component dashboard. Emits multiple UI components as a visual group with a shared title. Use when the user asks for a dashboard, overview, or summary with multiple data views. Max 8 components.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Dashboard title displayed above the grouped components" },
      components: {
        type: "array",
        description: "Array of components to render in the dashboard",
        items: {
          type: "object",
          properties: {
            component: { type: "string", description: "Component name (e.g. 'chart', 'stat_grid', 'data_table')" },
            props: { type: "object", description: "Props for the component" },
          },
          required: ["component", "props"],
        },
        minItems: 1,
        maxItems: 8,
      },
    },
    required: ["title", "components"],
  },
},
```

**Step 2: Add execution function**

After `executeRenderUi`, add:

```javascript
function executeCreateDashboard(args) {
  const { title, components } = args;
  if (!title || !Array.isArray(components) || components.length === 0) {
    return { isError: true, text: "Missing 'title' or 'components' array." };
  }
  if (components.length > 8) {
    return { isError: true, text: "Maximum 8 components per dashboard." };
  }

  const dashboardId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const blocks = [];
  const errors = [];

  for (let i = 0; i < components.length; i++) {
    const { component, props } = components[i];
    if (!component) {
      errors.push(`Component ${i + 1}: missing 'component' name.`);
      continue;
    }

    // Validate builtin components against schema
    if (BUILTIN_COMPONENTS.includes(component)) {
      const schema = BUILTIN_SCHEMAS[component];
      if (schema && props && typeof props === "object") {
        const result = validateJsonSchema(props, schema, "props");
        if (!result.valid) {
          errors.push(`Component ${i + 1} ("${component}"): ${result.errors[0]}`);
          continue;
        }
      }
      blocks.push(JSON.stringify({
        component,
        props: props || {},
        dashboardId,
        dashboardTitle: title,
      }));
    } else {
      // Custom component — resolve from PVC
      const def = readComponent(component);
      if (!def) {
        errors.push(`Component ${i + 1}: "${component}" not found.`);
        continue;
      }
      const children = resolveCustom(def, props || {});
      blocks.push(JSON.stringify({
        component: "layout",
        props: { title: def.description || undefined, children },
        dashboardId,
        dashboardTitle: title,
      }));
    }
  }

  if (blocks.length === 0) {
    return { isError: true, text: "All components failed validation:\n" + errors.join("\n") };
  }

  let output = blocks.map(b => "```jarble_ui\n" + b + "\n```").join("\n\n");
  if (errors.length > 0) {
    output += "\n\nNote: " + errors.length + " component(s) skipped due to errors:\n" + errors.join("\n");
  }

  console.error(`[MCP] create_dashboard: "${title}" with ${blocks.length} components (dashboardId=${dashboardId})`);
  return { isError: false, text: output };
}
```

**Step 3: Wire up in the switch statement**

In the `executeToolCall` function, add before the `default:` case:

```javascript
case "create_dashboard": return executeCreateDashboard(args || {});
```

**Step 4: Run tests**

Run: `cd jarble-api-main && npx vitest run`
Expected: All pass

**Step 5: Commit**

```
feat(mcp): add create_dashboard tool for multi-component dashboards
```

---

### Task 5: Add dashboard group to frontend types + reducer

**Files:**
- Modify: `Jarble-mvp/components/workspace/types.ts:21-55` (CanvasCard)
- Modify: `Jarble-mvp/components/workspace/types.ts:57-66` (CanvasState)
- Modify: `Jarble-mvp/components/workspace/types.ts:70-100` (CanvasAction)
- Modify: `Jarble-mvp/components/workspace/canvasReducer.ts`

**Step 1: Add groupId to CanvasCard**

In `CanvasCard` interface, after `llmModel`, add:

```typescript
/** Dashboard group this card belongs to */
groupId?: string;
```

**Step 2: Add groups map to CanvasState**

In `CanvasState` interface, after `fixAttempts`, add:

```typescript
/** Dashboard groups: groupId -> metadata */
dashboardGroups: Record<string, { title: string; cardIds: string[] }>;
```

Update `INITIAL_CANVAS_STATE` to include:

```typescript
dashboardGroups: {},
```

**Step 3: Add CREATE_DASHBOARD_GROUP action**

In `CanvasAction` union, add:

```typescript
| { type: "CREATE_DASHBOARD_GROUP"; groupId: string; title: string; cardIds: string[] }
| { type: "UNGROUP_DASHBOARD"; groupId: string }
```

**Step 4: Implement reducer cases**

In `canvasReducer.ts`, add before the `default:` case:

```typescript
case "CREATE_DASHBOARD_GROUP": {
  const { groupId, title, cardIds } = action;
  // Tag matching cards with groupId
  const newCards = state.cards.map((c) =>
    cardIds.includes(c.id) ? { ...c, groupId } : c
  );
  return {
    ...state,
    cards: newCards,
    dashboardGroups: {
      ...state.dashboardGroups,
      [groupId]: { title, cardIds },
    },
  };
}

case "UNGROUP_DASHBOARD": {
  const { groupId } = action;
  const newCards = state.cards.map((c) =>
    c.groupId === groupId ? { ...c, groupId: undefined } : c
  );
  const { [groupId]: _, ...remainingGroups } = state.dashboardGroups;
  return {
    ...state,
    cards: newCards,
    dashboardGroups: remainingGroups,
  };
}
```

**Step 5: Run tests**

Run: `cd Jarble-mvp && npx vitest run`
Expected: May need to update canvasReducer tests for new INITIAL_CANVAS_STATE field. If tests fail because of missing `dashboardGroups`, add `dashboardGroups: {}` to test fixtures.

**Step 6: Commit**

```
feat(frontend): add dashboard group support to canvas types + reducer
```

---

### Task 6: Handle dashboard events in useCanvasChat.ts

**Files:**
- Modify: `Jarble-mvp/hooks/useCanvasChat.ts` (TOOL_CALL_START handler + CUSTOM handler)

**Step 1: Pass dashboardId through in TOOL_CALL_START handler**

In the `TOOL_CALL_START` handler, add `dashboardId` to the pending block:

```typescript
if (event.type === "TOOL_CALL_START" && event.toolCallName?.startsWith("show_")) {
  const component = event.toolCallName.slice(5);
  const blockId = event.toolCallId;
  pendingBlocks.set(blockId, {
    id: blockId,
    component,
    props: {},
    ...(event.editable ? { editable: true } : {}),
    ...(event.fileId ? { fileId: event.fileId } : {}),
    ...(event.saveMethod ? { saveMethod: event.saveMethod } : {}),
    ...(event.layoutHint ? { layoutHint: event.layoutHint } : {}),
    ...(event.dashboardId ? { dashboardId: event.dashboardId } : {}),
    ...(event.dashboardTitle ? { dashboardTitle: event.dashboardTitle } : {}),
  });
  setStreamingCardIds((prev) => new Set(prev).add(`card-${blockId}`));
}
```

**Step 2: Add dashboardId to UIBlockPending interface**

Add to the `UIBlockPending` interface at top of hook:

```typescript
dashboardId?: string;
dashboardTitle?: string;
```

**Step 3: Tag card with groupId in addComponentCard**

In the `addComponentCard` helper, pass `groupId` through to the card:

```typescript
const card: CanvasCard = {
  ...existing fields...,
  groupId: block.dashboardId ? block.dashboardId : undefined,
};
```

**Step 4: Handle jarble.dashboard.created CUSTOM event**

In the CUSTOM event handler block, add:

```typescript
if (event.name === "jarble.dashboard.created" && event.value) {
  const { dashboardId, title, cardIds } = event.value;
  isDev && console.log(`[Jarble:Chat] Dashboard created: "${title}" (${cardIds.length} cards)`);
  dispatch({
    type: "CREATE_DASHBOARD_GROUP",
    groupId: dashboardId,
    title,
    cardIds,
  });
}
```

**Step 5: Run tests**

Run: `cd Jarble-mvp && npx vitest run`
Expected: All pass

**Step 6: Commit**

```
feat(frontend): handle dashboard grouping events in useCanvasChat
```

---

### Task 7: Render dashboard groups in SimpleCanvasGrid

**Files:**
- Modify: `Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx`

**Step 1: Read the current SimpleCanvasGrid implementation**

Read the file to understand the existing card rendering loop.

**Step 2: Group cards by dashboardGroups**

Before rendering, partition cards into grouped and ungrouped:

```typescript
const { dashboardGroups } = state;
const groupedCardIds = new Set(
  Object.values(dashboardGroups).flatMap(g => g.cardIds)
);
const ungroupedCards = cards.filter(c => !groupedCardIds.has(c.id));
const groups = Object.entries(dashboardGroups).map(([groupId, meta]) => ({
  groupId,
  title: meta.title,
  cards: meta.cardIds
    .map(id => cards.find(c => c.id === id))
    .filter((c): c is CanvasCard => !!c),
})).filter(g => g.cards.length > 0);
```

**Step 3: Render dashboard groups**

Each group renders as a wrapper div with title bar + grid of cards inside:

```tsx
{groups.map(group => (
  <div key={group.groupId} role="gridcell" className="col-span-full">
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/30">
        <span className="text-sm font-medium text-foreground/80">{group.title}</span>
        <button
          onClick={() => dispatch({ type: "UNGROUP_DASHBOARD", groupId: group.groupId })}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Ungroup
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 p-3">
        {group.cards.map(card => (
          /* render each card using existing card renderer */
        ))}
      </div>
    </div>
  </div>
))}
```

**Step 4: Render ungrouped cards as before**

Ungrouped cards continue with the existing rendering logic — no change.

**Step 5: Test manually**

Chat with bot, ask for a dashboard — verify grouped rendering.

**Step 6: Run tests**

Run: `cd Jarble-mvp && npx vitest run`
Expected: All pass

**Step 7: Commit**

```
feat(frontend): render dashboard groups with title bar in SimpleCanvasGrid
```

---

### Task 8: Run full test suite + push

**Step 1: Run all tests**

```bash
cd jarble-api-main && npx vitest run
cd ../Jarble-mvp && npx vitest run
```

Expected: 469+ backend, 234+ frontend — all pass.

**Step 2: Commit any test fixes**

**Step 3: Push**

```bash
git push origin UI-Tambo-ALL
```
