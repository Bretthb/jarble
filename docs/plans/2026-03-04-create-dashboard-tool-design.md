# create_dashboard Tool Design

**Date**: 2026-03-04
**Branch**: UI-Tambo-ALL
**Status**: Approved

## Problem

The bot can render individual canvas components via `show_*` MCP tools, but has no way to emit a coherent multi-component dashboard in a single call. Users asking "show me a dashboard" get components one at a time with no visual grouping.

## Solution

New `create_dashboard` MCP tool that accepts a title + array of components, emits them as tagged `jarble_ui` blocks, and the frontend renders them inside a grouped wrapper with a shared title bar.

## Architecture

### MCP Tool (`jarble-ui-server.js`)

```
create_dashboard({
  title: "Q4 Performance",
  components: [
    { component: "stat_grid", props: { items: [...] } },
    { component: "chart", props: { type: "bar", data: [...] } },
    { component: "data_table", props: { columns: [...], rows: [...] } }
  ]
})
```

- Max 8 components per dashboard
- Validates each component name against builtin registry
- Validates each component's props against its JSON Schema
- Generates a shared `dashboardId` (nanoid)
- Emits multiple `jarble_ui` fenced blocks, each with `dashboardId` and `dashboardTitle` fields

Output:
```
```jarble_ui
{"component":"stat_grid","props":{...},"dashboardId":"abc123","dashboardTitle":"Q4 Performance"}
```
```jarble_ui
{"component":"chart","props":{...},"dashboardId":"abc123","dashboardTitle":"Q4 Performance"}
```
```jarble_ui
{"component":"data_table","props":{...},"dashboardId":"abc123","dashboardTitle":"Q4 Performance"}
```
```

### Backend Pipeline

**uiBlockParser.ts**: Pass `dashboardId` and `dashboardTitle` through from parsed JSON to `JarbleUIBlock` type.

**tamboAgent.ts**:
- `TOOL_CALL_START` events include `dashboardId` + `dashboardTitle` when present
- After emitting all blocks for a dashboard, emit:
  ```json
  { "type": "CUSTOM", "name": "jarble.dashboard.created", "value": { "dashboardId": "abc123", "title": "Q4 Performance", "cardIds": ["card-id1", "card-id2", "card-id3"] } }
  ```

**eventTypes.ts**: Add `CUSTOM_DASHBOARD_CREATED = "jarble.dashboard.created"`.

### Frontend

**useCanvasChat.ts**:
- On `TOOL_CALL_START` with `dashboardId`: create cards as usual, tag with dashboardId
- On `jarble.dashboard.created` CUSTOM event: dispatch `GROUP_CARDS` action

**canvasReducer.ts**:
- New `GROUP_CARDS` action: `{ type: "GROUP_CARDS", groupId: string, title: string, cardIds: string[] }`
- Adds a `groupId` field to matching `CanvasCard` entries
- Stores group metadata in `CanvasState.groups` map

**types.ts**:
- Add `groupId?: string` to `CanvasCard`
- Add `groups: Record<string, { title: string, cardIds: string[] }>` to `CanvasState`

**SimpleCanvasGrid.tsx**:
- Grouped cards render inside a wrapper div with shared title bar
- Title bar shows dashboard title + ungroup button
- Ungroup removes groupId from cards, deletes group entry
- Grouped cards use a sub-grid layout within the wrapper

## Files Modified

| File | Change |
|------|--------|
| `jarble-api-main/src/mcp/jarble-ui-server.js` | New `create_dashboard` tool |
| `jarble-api-main/src/utils/uiBlockParser.ts` | Pass dashboardId/dashboardTitle through |
| `jarble-api-main/src/routes/tamboAgent.ts` | Emit dashboard.created CUSTOM event |
| `jarble-api-main/src/utils/eventTypes.ts` | New CUSTOM_DASHBOARD_CREATED constant |
| `Jarble-mvp/hooks/useCanvasChat.ts` | Handle dashboard grouping events |
| `Jarble-mvp/components/workspace/canvasReducer.ts` | GROUP_CARDS action |
| `Jarble-mvp/components/workspace/types.ts` | groupId on cards, groups on state |
| `Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx` | Render grouped cards with title wrapper |

## Constraints

- Max 8 components per dashboard (prevents abuse)
- Each component individually validated against manifest schemas
- Dashboard grouping is visual only — cards can still be individually moved/closed/saved
- Ungroup scatters cards back to individual layout
