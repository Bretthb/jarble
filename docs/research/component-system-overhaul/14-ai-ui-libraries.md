# Report 14: AI UI Component Library Comparison

**Agent**: ai-ui-library-researcher
**Status**: COMPLETE
**Date**: 2026-02-27

## Executive Summary

Evaluated 5 categories of libraries for Jarble's AI chat + canvas architecture: assistant-ui, Vercel AI Elements, shadcn/ui chat patterns, chart libraries (Recharts vs Ant Design vs Plotly), and grid/layout libraries.

**Top recommendation**: Adopt `@assistant-ui/react` as the chat layer via `ExternalStoreRuntime`. This eliminates ~400 lines of custom SSE code in `StreamingBotMessage.tsx` while adding message editing, branching, accessibility, and professional streaming rendering for free.

**Second recommendation**: Delete all 21 orphaned @ant-design/plots files and consolidate to Recharts only.

---

## 1. assistant-ui (`@assistant-ui/react`)

**Stars**: 8,600+ | **Downloads**: ~50K+/month | **License**: MIT | **React 19**: Supported

### Core Architecture

Three-layer architecture:
1. **Primitives** (headless, composable): `ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, `ActionBarPrimitive`, `BranchPicker`, `ContentPart`
2. **Styled Components** (shadcn CLI): `Thread`, `ThreadList`, `AssistantModal`, `Composer`, `Message`, `AssistantSidebar`
3. **Runtime Adapters**: Vercel AI SDK, LangGraph, LangChain, Mastra, **ExternalStoreRuntime**, Assistant Cloud

### `makeAssistantToolUI` API

Register custom UI for specific tool calls — maps directly to Jarble's `render_ui` → component rendering:

```tsx
const WeatherToolUI = makeAssistantToolUI({
  toolName: "getWeather",
  render: ({ args, result, status, addResult }) => {
    if (status.type === "running") return <Spinner />;
    if (status.type === "requires-action") {
      return <ApprovalForm onApprove={() => addResult({ approved: true })} />;
    }
    return <WeatherCard data={result} />;
  },
});
```

Status types: `"running"`, `"complete"`, `"incomplete"`, `"requires-action"` (human-in-the-loop).

### ExternalStoreRuntime — Perfect Fit for Jarble

| Jarble Current | assistant-ui Equivalent |
|----------------|------------------------|
| `StreamingBotMessage.tsx` (400 lines custom SSE) | `Thread` + `Message` with streaming built in |
| Custom `consumeSSE()` parser | ExternalStoreRuntime `onNew()` |
| `UIBlock` + `CanvasRenderer` | `makeAssistantToolUI` for `render_ui` tool |
| Custom thinking indicator | Built-in `MessagePrimitive.Status` |
| Manual scroll management | Built-in auto-scroll via `ThreadPrimitive.Viewport` |
| No message editing/branching | Built-in edit, regenerate, branch picker |

### Migration Path

1. Create `ExternalStoreRuntime` adapter wrapping existing `useCanvasChat` hook
2. Map `UIBlock` events to `ToolCallMessagePart` with `toolName: "render_ui"`
3. Register each canvas component type via `makeAssistantToolUI`
4. Replace `StreamingBotMessage.tsx` with `Thread` component
5. Keep canvas grid as separate panel

### What Jarble Gains

- Message editing and regeneration (free)
- Branch picker for conversation history (free)
- Copy message to clipboard (free)
- Accessibility (ARIA roles, keyboard nav)
- Auto-scroll with edge detection
- Attachment support
- ~400 lines of custom SSE code eliminated

### What Jarble Keeps Custom

- Canvas grid (`SimpleCanvasGrid`/`DashboardCanvas`)
- All 56+ canvas components
- SSE backend endpoint (`/api/tambo-agent`)
- `canvasReducer` state management

**Recommendation: YES — adopt for chat layer**

---

## 2. Vercel AI Elements

**Stars**: 1,700+ | **Downloads**: ~15.6K/week | **License**: MIT | **Published**: Jan 2026

### Component Inventory

- **Chatbot**: Attachments, Chain of Thought, Checkpoint, Confirmation, Conversation, Inline Citation, Message, Model Selector, Plan, Prompt Input, Queue, Reasoning, Shimmer, Sources, Suggestion, Task, Tool
- **Code**: Agent, Artifact, Code Block, Commit, File Tree, JSX Preview, Package Info, Sandbox, Terminal, Test Results, Web Preview
- **Voice**: Audio Player, Speech Input, Transcription, Voice Selector
- **Workflow**: Canvas, Connection, Controls, Edge, Node, Panel, Toolbar

### Analysis

Useful components for Jarble: `Reasoning`/`Chain of Thought`, `Sources`/`Inline Citation`, `Tool`, `Prompt Input`, `Code Block`.

**Why NOT adopt wholesale**: Tightly coupled to Vercel AI SDK (`useChat`, `streamText`). No `ExternalStoreRuntime` equivalent. Many components are IDE-focused (Agent, Terminal, File Tree) not relevant to bot chat.

**Recommendation: MAYBE — cherry-pick `Reasoning`, `Sources`, `Prompt Input` if needed**

---

## 3. shadcn/ui Chat Patterns

shadcn/ui does **not** ship dedicated chat components in core. The ecosystem pattern:
1. Use shadcn/ui primitives as building blocks
2. Compose into chat layouts
3. Add AI-specific layer via assistant-ui or AI Elements

Jarble already uses shadcn/ui extensively. The chat gap is best filled by assistant-ui, which is built on shadcn/ui.

**Recommendation: NO additional adoption needed — use assistant-ui on top of existing shadcn**

---

## 4. Chart Library Analysis

### Current State

| Library | Registered | Orphaned Files | In Registry |
|---------|-----------|----------------|-------------|
| **Recharts** | `CanvasChart.tsx` (bar/line/pie/area) | 0 | YES |
| **@ant-design/plots** | 0 | **21 files** | NO |

### Comparison

| Metric | Recharts | @ant-design/plots | Plotly.js |
|--------|----------|-------------------|-----------|
| npm Downloads/week | ~16M | ~148K | ~300K |
| Bundle (gzipped) | ~45KB | ~500KB+ (G2 engine) | **~1MB+** |
| Tree-shaking | Good | Poor (monolithic G2) | Very poor |
| shadcn/ui integration | Excellent (native) | None | None |
| AI-generated JSON | Simple schema | Complex config | Complex traces |
| React 19 | Supported | Partial | Supported |

### 21 Orphaned @ant-design/plots Files

`CanvasBox`, `CanvasBullet`, `CanvasCalendarHeatmap`, `CanvasCirclePacking`, `CanvasDualAxes`, `CanvasFunnel`, `CanvasGauge`, `CanvasHeatmap`, `CanvasHistogram`, `CanvasLiquid`, `CanvasRadar`, `CanvasRadialBar`, `CanvasRose`, `CanvasSankey`, `CanvasScatter`, `CanvasStock`, `CanvasSunburst`, `CanvasTree`, `CanvasTreemap`, `CanvasVenn`, `CanvasWaterfall`, `CanvasWordCloud`

None are registered in `registry.ts`. Dead code.

### Recommendation

**Delete all 21 orphaned files. Remove `@ant-design/plots`, `antd`, `@ant-design/cssinjs` from package.json.** For specialized charts (sankey, treemap, heatmap), use `CanvasSandbox` + D3.js or Nivo (@nivo/* packages, tree-shakeable).

---

## 5. Grid/Layout Libraries

### Current State

`SimpleCanvasGrid.tsx` = freeform absolute-positioned canvas. `react-grid-layout` is in package.json but NOT used.

### Industry Standard

| Tool | Grid Library |
|------|-------------|
| **Grafana** | react-grid-layout (forked) |
| **Metabase** | react-grid-layout |
| **Apache Superset** | react-grid-layout |
| **Monday.com** | react-grid-layout |

### Freeform Canvas vs Dashboard Grid

| Freeform Canvas | Dashboard Grid |
|----------------|----------------|
| Absolute positioning | Slot-based |
| Pixel-level control | Column/row units |
| Overlapping allowed | No overlapping |
| Better for 5-15 items | Better for 10-50 items |

### Recommendation

**Dual-mode canvas**:
1. **Dashboard Mode** (default): `react-grid-layout` with auto-arrangement, responsive breakpoints. Already in package.json, `DashboardCanvas.tsx` already exists.
2. **Freeform Mode** (toggle): Keep current absolute positioning for spatial freedom.

For virtualization at 20+ cards: simple viewport culling via `useMemo` filter is sufficient — no library needed.

**Recommendation: MAYBE — add react-grid-layout dashboard mode alongside existing freeform**

---

## Decision Matrix

| Library | Recommendation | Rationale |
|---------|---------------|-----------|
| **assistant-ui** | **YES** | Replace StreamingBotMessage, eliminate ~400 lines SSE code, gain editing/branching/a11y free. ExternalStoreRuntime fits perfectly. |
| **AI Elements** | **MAYBE** | Cherry-pick Reasoning, Sources, Prompt Input if needed. Too coupled to Vercel SDK. |
| **shadcn/ui Chat** | **NO** (already using) | Already the foundation. Use assistant-ui on top. |
| **Recharts** (keep) | **YES** | Keep as sole chart library. Delete orphaned Ant Design files. |
| **@ant-design/plots** | **REMOVE** | 21 orphaned files, non-tree-shakeable, ~500KB+, dead code. |
| **Plotly.js** | **NO** | 2MB+ bundle, non-starter. |
| **react-grid-layout** | **MAYBE** | Already a dep. Use for dashboard mode. Industry standard. |
| **Virtualization lib** | **NO** | <30 cards, viewport culling sufficient. |

## Priority Actions

1. **High**: Adopt `@assistant-ui/react` with `ExternalStoreRuntime` for chat layer
2. **High**: Delete 21 orphaned `@ant-design/plots` files + remove dependencies
3. **Medium**: Wire up `react-grid-layout` as dashboard mode option
4. **Low**: Cherry-pick specific AI Elements components if needed
