# Component System Overhaul — Master Implementation Plan

**Date**: 2026-02-27
**Branch**: `UI-polishing`
**Based on**: 10 research reports + 9-platform competitive analysis

---

## Strategic Context

Jarble occupies a unique market position: the only platform combining AI-driven dynamic UI rendering (56+ components) with multi-platform bot deployment. The industry is converging on a "tool-as-component" pattern that Jarble already implements. The goal of this overhaul is to close competitive gaps while amplifying existing advantages.

### Core Principles
1. **Don't break what works** — MCP fenced-block approach, canvas reducer, SSE streaming are all sound
2. **Quick wins first** — 34 unregistered components and prompt improvements unlock the most value fastest
3. **Adopt patterns, not frameworks** — Learn from competitors without coupling to their architectures
4. **Measure before optimizing** — Some "problems" (pod compute, frontend rendering) aren't actually bottlenecks

---

## Phase 1: Quick Wins (1-2 days, high impact)

### 1.1 Register 34 Hidden Components
**Source**: Report #2 (Component Audit)
**Impact**: 140% capability boost with minimal effort

- Register 13 Ant Design chart components (radar, scatter, heatmap, waterfall, funnel, stock, sunburst, liquid, rose, tree, treemap, wordcloud, circle_packing)
- Register `map`, `carousel`, `image_gallery` components
- Add Zod schemas to `registry.ts` for each
- Add to `BUILTIN_COMPONENTS` in `jarble-ui-server.js` and `componentResolver.ts`
- Remove or archive 5 dead-code components (box, blockquote, bullet, text_message, avatar)
- Fix/complete `spreadsheet` component or remove

**Files**: `registry.ts`, `jarble-ui-server.js`, `componentResolver.ts`

### 1.2 Lazy-Load Canvas Registry (~350KB bundle savings)
**Source**: Report #5 (Frontend Performance)
**Impact**: ~200KB from recharts, ~150KB from @xyflow

- Convert `registry.ts` to use `React.lazy()` or `next/dynamic` for all component imports
- Dynamic import `Deployments.tsx` (contains @xyflow/react)
- Remove unused deps: `react-grid-layout`, `leaflet`/`react-leaflet` (if not registering map), `@aws-sdk/*`
- Wrap `CanvasRenderer` in `React.memo`

**Files**: `registry.ts`, `Deployments.tsx`, `CanvasRenderer.tsx`, `package.json`

### 1.3 Optimize MCP Tool Descriptions (~400 tokens/turn saved)
**Source**: Report #7 (MCP Tools)
**Impact**: Faster responses, lower cost per conversation turn

- Trim `render_ui` description — reference `component_reference` tool instead of listing all 56+ names inline
- Add `enum` constraint on `component` parameter (prevents hallucinated component names)
- Add inline examples for top 5 most-used components in `render_ui` description
- Deduplicate pod-side and API-side schema definitions (single source of truth)

**Files**: `jarble-ui-server.js`, `renderUi.ts`

### 1.4 Prompt Improvements for Interactivity + Updates
**Source**: Reports #3 (Live Data), #8 (Interactivity)
**Impact**: Existing features become usable without code changes

- Add `[UI_ACTION]` handling guidance to JARBLE_UI_PROMPT — teach bot to respond to actions and use `jarble_ui_update`
- Add multi-step render+update guidance — bot should render then progressively update
- Add error recovery section — bot should understand when components fail and regenerate

**Files**: `openclaw.ts` (JARBLE_UI_PROMPT)

### 1.5 CSS Transitions for UI Updates
**Source**: Report #3 (Live Data)
**Impact**: Prop changes feel like animations, not replacements

- Add CSS transitions to canvas card containers (`transition: all 0.3s ease`)
- Animate number changes in `stat_grid`, `metric_card`, `progress`
- Smooth chart re-renders via Recharts `isAnimationActive`

**Files**: `SimpleCanvasGrid.tsx`, `CanvasStatGrid.tsx`, `CanvasMetricCard.tsx`, `CanvasProgress.tsx`, `CanvasChart.tsx`

---

## Phase 2: Competitive Parity (3-5 days, medium effort)

### 2.1 Tool Call Visibility (AG-UI pattern)
**Source**: Report #9 (Competitors — AG-UI, Gradio, Vercel AI SDK)
**Impact**: Users see what the bot is doing, not just the result

Add new SSE events to show MCP tool execution:
```
TOOL_CALL_START   { toolCallId, toolName, description }
TOOL_CALL_END     { toolCallId, status: "success" | "error" }
```

Frontend renders collapsible "tool step" cards (inspired by Gradio's `ChatMessage.metadata` and Chainlit's `cl.Step`):
- Spinner while `status: "pending"`
- Collapsed accordion when `status: "done"`
- Chain-of-thought visibility toggle: `full` / `tool_call` / `hidden`

**Files**: `tamboAgent.ts`, `useCanvasChat.ts`, `StreamingBotMessage.tsx` (new ToolStep component)

### 2.2 Tool State Machine Per Card
**Source**: Report #9 (Competitors — Vercel AI SDK tool states)
**Impact**: Proper loading/error states for every canvas card

Each canvas card gets a state: `loading` → `ready` → `error`
- `UI_BLOCK_START` → card enters `loading` state (show skeleton/shimmer)
- `UI_BLOCK_END` → card enters `ready` state (render component)
- Zod validation failure → card enters `error` state (show error + retry button)
- Timeout (5s no END after START) → `error` state (prevents orphaned pending blocks)

**Files**: `canvasReducer.ts` (add `status` to CanvasCard), `SimpleCanvasGrid.tsx`, `CanvasRenderer.tsx`

### 2.3 Component-to-Bot Callbacks
**Source**: Reports #8 (Interactivity), #9 (Artifacts `window.claude.complete()`)
**Impact**: Canvas components become interactive — clicks trigger bot responses

Currently 8 components dispatch actions but the bot doesn't reliably handle them. Fix:

1. **Remove permanent button disable** — change `CanvasButtonGroup` and `CanvasForm` to brief loading state → re-enable after response
2. **Add `mode: "persistent"` prop** — re-enables after each response (vs current `"single"` = permanent disable)
3. **Structured action format** — enhance `[UI_ACTION]` message format to be reliably parseable by bot
4. **Loading states on interactive components** — show spinner after dispatch, clear on bot response

**Files**: `CanvasButtonGroup.tsx`, `CanvasForm.tsx`, `page.tsx` (handleAction), `types.ts`

### 2.4 `create_dashboard` MCP Tool
**Source**: Report #7 (MCP Tools)
**Impact**: Bot renders multiple components in a single layout with one tool call

New tool emits a `layout` component with children, allowing the bot to render a full dashboard in one shot:
```json
{
  "component": "layout",
  "props": {
    "direction": "horizontal",
    "children": [
      { "component": "stat_grid", "props": {...} },
      { "component": "chart", "props": {...} },
      { "component": "data_table", "props": {...} }
    ]
  }
}
```

**Files**: `jarble-ui-server.js` (new tool), `CanvasLayout.tsx` (enhance to support nested rendering)

### 2.5 Toast/Notification System
**Source**: Reports #7 (MCP Tools), #9 (Streamlit `st.toast`)
**Impact**: Non-blocking alerts without polluting the canvas

New `show_notification` MCP tool → `jarble_ui_toast` fenced block → `TOAST` SSE event → frontend toast component.

Types: `success`, `error`, `warning`, `info`. Auto-dismiss after configurable timeout.

**Files**: `jarble-ui-server.js` (new tool), `tamboAgent.ts` (new SSE event), `page.tsx` (toast renderer)

### 2.6 Backend Validation Before SSE (Error Resilience)
**Source**: Report #10 (Error Resilience)
**Impact**: Invalid blocks caught before reaching frontend, 7/10 → 9/10 resilience

- Add Zod validation in `tamboAgent.ts:emitGatewayResult()` before sending UI blocks
- Emit `UI_BLOCK_ERROR` for invalid props (instead of silent drop)
- Frontend timeout tracking: 5s watchdog for orphaned START events
- Soul.md error recovery prompting

**Files**: `tamboAgent.ts`, `useCanvasChat.ts`, `openclaw.ts`

---

## Phase 3: Competitive Advantage (1-2 weeks, higher effort)

### 3.1 Persistent Canvas SSE Channel (Live Updates)
**Source**: Report #3 (Live Data)
**Impact**: Components update after bot response ends — enables real-time dashboards

New long-lived endpoint: `GET /api/canvas/:deploymentId/stream`
- Opens alongside chat, stays open indefinitely (like `useStatusStream`)
- New MCP tool: `push_update(card_id, props)` → event bus → SSE
- Events: `CARD_UPDATE`, `CARD_ADD`, `CARD_REMOVE`
- Enables: background task progress, periodic data refresh, webhook-triggered updates

**Files**: New route `canvasStream.ts`, new hook `useCanvasStream.ts`, `jarble-ui-server.js` (new tool)

### 3.2 Auto-Refreshing Canvas Cards
**Source**: Report #9 (Gradio `gr.Timer` / `every` pattern)
**Impact**: Metrics cards auto-update without SSE infrastructure

Add optional `refreshInterval` prop to canvas cards:
```json
{ "component": "stat_grid", "props": {...}, "refreshInterval": 10000 }
```
Frontend polls the bot on an interval to refresh that specific card's data. Simple alternative to persistent SSE for basic dashboard use cases.

**Files**: `types.ts`, `SimpleCanvasGrid.tsx`, `canvasReducer.ts`

### 3.3 Platform-Aware Soul.md (Conditional UI Prompt)
**Source**: Report #1 (Soul.md Separation)
**Impact**: Save ~1,250 tokens on Telegram/Discord/Slack messages, prevent UI hallucination

Extend `[CANVAS_STATE]` injection with `Platform: web|telegram|discord|slack|whatsapp`:
- Web: Full JARBLE_UI_PROMPT (component reference, design patterns)
- Messaging: Slim prompt (text-only guidance, no component instructions)
- Reduces Telegram/Discord prompt from ~1,500 to ~250 tokens

**Files**: `tamboAgent.ts` (inject platform field), `openclaw.ts` (conditional prompt sections)

### 3.4 Component Size Hints + Grid Span
**Source**: Report #4 (Canvas Grid)
**Impact**: Dashboard-quality layouts instead of uniform grid cells

- Add `size: "sm" | "md" | "lg" | "full"` to component registry metadata
- Large components (`data_table`, `chart`) span 2 columns when available
- Small components (`badge`, `divider`) share columns
- Fix overflow handling: `overflow: hidden` on card containers
- Move inline CSS to stylesheet

**Files**: `registry.ts`, `SimpleCanvasGrid.tsx`, `types.ts`

### 3.5 Pod-Side Component Caching
**Source**: Report #6 (Pod Performance)
**Impact**: 20-30% reduction in UI render latency

- LRU in-memory cache (20-50 components) in `jarble-ui-server.js` → 50ms → 0.5ms per lookup
- API-side component definition cache
- Eliminate double I/O for custom components (pod reads + kubectl exec reads)

**Files**: `jarble-ui-server.js`, `componentResolver.ts`

---

## Phase 4: Future Differentiation (2-4 weeks, strategic)

### 4.1 Agent-Driven State Sync (AG-UI STATE_DELTA)
Allow the bot to directly manipulate canvas state from the backend:
- `STATE_SNAPSHOT` — full canvas state on connection
- `STATE_DELTA` — JSON Patch operations (add/remove/reorder cards)
- Enables bot to programmatically manage the dashboard layout

### 4.2 Embeddable Copilot Widget (Chainlit pattern)
Offer a `<script>` tag that drops a Jarble chat widget into any website:
- Shadow DOM isolation
- Bidirectional function bridge (host page ↔ bot)
- Floating button with popup chat

### 4.3 Cross-Component Data Binding (Retool pattern)
Canvas cards can reference each other's data:
- Click table row → filter chart
- Canvas-level event bus with pub/sub
- Start with bot-mediated approach (bot receives action, updates multiple cards)

### 4.4 Structured Outputs for UI
Use Anthropic/OpenAI `strict: true` to guarantee valid component JSON:
- Constrained decoding ensures valid Zod schemas every time
- Eliminates parsing failures from malformed JSON
- Requires server-side LLM proxy (not currently how Jarble works)

### 4.5 Domain-Level Sandbox Isolation (Artifacts pattern)
Move sandbox iframe content to `sandbox.jarble.ai`:
- Full cross-origin isolation instead of just iframe sandbox attrs
- CSP restrictions on external resources
- DOMPurify content sanitization

### 4.6 Canvas Virtualization
For 20+ card scenarios:
- Intersection observer: only render visible cards
- Virtual scrolling for large canvases
- Lazy mount/unmount on scroll

---

## Implementation Priority Matrix

| Item | Phase | Effort | Impact | Dependencies |
|------|-------|--------|--------|-------------|
| Register 34 components | 1.1 | Low | Very High | None |
| Lazy-load registry | 1.2 | Low-Med | High | None |
| Optimize MCP descriptions | 1.3 | Low | High | None |
| Prompt improvements | 1.4 | Low | High | None |
| CSS transitions | 1.5 | Low | Medium | None |
| Tool call visibility | 2.1 | Medium | High | None |
| Tool state machine | 2.2 | Medium | High | None |
| Component callbacks | 2.3 | Medium | High | 1.4 |
| create_dashboard tool | 2.4 | Medium | Medium | 1.1 |
| Toast system | 2.5 | Low-Med | Medium | None |
| Backend validation | 2.6 | Medium | High | None |
| Persistent canvas SSE | 3.1 | High | Very High | 2.2 |
| Auto-refresh cards | 3.2 | Medium | Medium | 2.2 |
| Platform-aware soul.md | 3.3 | Medium | High | None |
| Size hints + grid span | 3.4 | Medium | Medium | 1.1 |
| Pod-side caching | 3.5 | Low-Med | Medium | None |

---

## What NOT to Do

Based on research, these are explicitly deprioritized:

1. **Don't adopt MCP Apps iframe pattern** for standard components — our React registry approach is better for canvas integration (drag, split, merge)
2. **Don't make every component a tool** — exceeds the 5-15 tool best practice; keep `render_ui` as catch-all
3. **Don't adopt Streamlit's rerun model** — our SSE streaming is fundamentally superior
4. **Don't switch to WebSocket** yet — SSE covers 90% of use cases with less complexity
5. **Don't build a visual app builder** — Jarble's value is that the AI builds the UI, not the user
6. **Don't adopt AG-UI wholesale** — adopt the patterns (tool visibility, state delta) without the protocol dependency

---

## Success Metrics

After Phase 1:
- 58+ components available to bots (from 24)
- ~350KB reduction in initial JS bundle
- ~400 tokens/turn saved on MCP overhead
- Existing update_ui and action pipelines actually used by bots

After Phase 2:
- Tool execution visible to users
- Canvas cards have proper loading/error states
- Buttons re-enable after bot response
- Full dashboard renderable in a single tool call
- Error resilience: 7/10 → 9/10

After Phase 3:
- Live-updating dashboard components
- Platform-specific prompt optimization
- Dashboard-quality grid layouts
- Measurable latency reduction from caching

---

## Phase 0: Foundation & Safety (Before Feature Work)

*Added from Gap Analysis (Report #16) and Deep Dive Research (Reports #11-15)*

### 0.1 Production Monitoring (Critical — 1 day)
- Add `@sentry/nextjs` to frontend + `@sentry/node` to API
- Configure source maps for meaningful stack traces
- Wire `CanvasErrorBoundary.componentDidCatch` → Sentry
- **Source**: Report #16 (Gap Analysis)

### 0.2 Verify Authorization on /d/[id] (Critical — 30 min)
- Confirm `deployment.getById` in tRPC router filters by `userId`
- If missing, add `eq(deployments.userId, ctx.user.id)` clause
- Add backend test confirming cross-user access is denied
- **Source**: Report #16 (Gap Analysis)

### 0.3 Tighten Sandbox CSP (Critical — 1 hour)
- Replace `default-src * 'unsafe-inline' 'unsafe-eval'` with restrictive policy
- Add library URL allowlist (trusted CDN origins only)
- Block `frame-src` (prevent nested iframe escape)
- **Source**: Report #12 (Sandbox Security)

### 0.4 Product Analytics (High — half day)
- Add PostHog initialization to `app/layout.tsx`
- Track: `component_rendered`, `validation_failed`, `canvas_action`, `sse_error`, `wizard_step`
- **Source**: Report #16 (Gap Analysis)

### 0.5 Core Tests + CI Pipeline (High — 2-3 days)
- Unit tests for `canvasReducer.ts`, `uiBlockParser.ts`, `useCanvasPersistence.ts`
- GitHub Actions CI: `npm run check && npm run test` on PR
- **Source**: Report #16 (Gap Analysis)

### 0.6 Accessibility Quick Wins (High — 1 day)
- Add `role="alert"` to CanvasAlert, `role="progressbar"` to CanvasProgress
- Add `tabIndex` + `onKeyDown` to CanvasDataTable clickable rows
- Add `aria-live="polite"` to streaming indicator
- **Source**: Report #16 (Gap Analysis)

### 0.7 Canvas Card Limit (Low effort — 2 hours)
- Add `MAX_CANVAS_CARDS = 100` with oldest-card eviction
- Add "pin" action to protect important cards
- **Source**: Report #16 (Gap Analysis)

---

## New Strategic Recommendations (from Deep Dive Research)

### Adopt assistant-ui for Chat Layer (Phase 2 addition)
- Replace `StreamingBotMessage.tsx` (~400 lines) with `@assistant-ui/react` `Thread` component
- Use `ExternalStoreRuntime` to wrap existing `useCanvasChat` hook
- Gain message editing, branching, accessibility, auto-scroll for free
- **Source**: Report #14 (AI UI Libraries)

### Delete 21 Orphaned @ant-design/plots Files (Phase 1 addition)
- Remove all orphaned Ant Design chart component files
- Remove `@ant-design/plots`, `antd`, `@ant-design/cssinjs` from package.json
- ~350-500KB savings from dependency tree
- **Source**: Reports #11, #14

### Telegram Mini App Bridge (Phase 3 addition)
- Create `/d/[id]/mini` route for Telegram WebView
- Full canvas rendering in Telegram app (existing React components)
- Auth via Telegram `initData` (HMAC-verified, no Auth0 needed)
- **Source**: Report #15 (Multi-Platform UX)

### Structured Action Protocol (Phase 2 addition)
- Replace fragile `[UI_ACTION]` text with typed `jarble_action` fenced blocks
- Add pending action tracker with 30s timeout + loading overlay
- Add button `mode: "persistent"` for re-enablement after bot response
- **Source**: Report #13 (Component Interactivity)

### Mobile Responsive Canvas (Phase 3 addition)
- Responsive layout: side-by-side (desktop) → stacked with tab toggle (mobile)
- Touch event support for drag-to-reorder
- Mobile-specific card rendering (collapsed by default)
- **Source**: Report #16 (Gap Analysis)

---

## Updated Phase Summary

| Phase | Items | Added from Deep Dive |
|-------|-------|---------------------|
| **Phase 0** | Foundation & Safety | Sentry, auth check, CSP fix, PostHog, tests+CI, a11y, card limit |
| **Phase 1** | Quick Wins (original) | + Delete orphaned Ant Design files |
| **Phase 2** | Competitive Parity (original) | + assistant-ui chat layer, structured action protocol |
| **Phase 3** | Competitive Advantage (original) | + Telegram Mini App, mobile responsive canvas |
| **Phase 4** | Future Differentiation (original) | + Canvas event bus, theming/branding |

---

## Architecture Decision Record

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Keep fenced-block approach | Simpler, lower latency than MCP Apps iframes | MCP Apps `_meta.ui`, A2UI JSON |
| Declarative component registry | Auto-resolution by type, Zod validation, canvas integration | Tool-as-component (one tool per component) |
| SSE over WebSocket | Simpler, sufficient for 90% of cases, proven with useStatusStream | WebSocket (CopilotKit), Socket.IO (Chainlit) |
| React components over runtime JSX | TypeScript safety, build-time optimization, full library access | Chainlit CustomElement (runtime JSX), Gradio Svelte |
| Canvas reducer for state | Typed actions, predictable updates, undo/redo potential | AG-UI STATE_DELTA (requires backend state sync) |
| `render_ui` catch-all + typed top tools | Best of both: accuracy for common components, flexibility for all | All tools (too many), single tool (less accuracy) |
| assistant-ui for chat layer | ExternalStoreRuntime fits perfectly, eliminates ~400 lines custom code, gains editing/branching/a11y | Keep custom StreamingBotMessage, build from scratch |
| Recharts only (delete Ant Design) | 21 orphaned files, G2 not tree-shakeable, shadcn native integration | Keep both (bundle bloat), switch to Plotly (2MB+) |
| Telegram Mini Apps for mobile bridge | Full canvas in-app, highest ROI, existing React components | Discord Activities (high cost), image degradation only |
| Typed canvas event bus over Zustand | Decoupled, subscription-based, no extra dependency | React Context (re-render all), Redux (overkill) |
| Sentry over custom error tracking | Industry standard, source maps, breadcrumbs, sessions | Datadog (expensive), custom (maintenance burden) |
