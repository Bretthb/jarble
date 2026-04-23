# Moveable Canvas Workspace — Implementation Plan

## Status: PLANNED (not started)
## Branch: k8-debug
## Date: 2026-02-24

---

## Vision

Replace the chat-scroll at `/d/[id]` with a **dynamic dashboard** — an infinite pannable/zoomable canvas. The user types messages to their bot, and the bot responds with rich UI components (charts, 3D visualizations, live widgets, tables, etc.) that appear as **draggable, resizable cards** on the canvas. Users arrange them however they want. Close what they don't need. The bot builds the user's dashboard through conversation.

Think Figma/Miro meets ChatGPT — but the AI generates live interactive widgets instead of just text.

---

## Architecture Decisions (locked in)

### Canvas Engine: Custom CSS Transforms, NOT React Flow
React Flow (`@xyflow/react`) is already in the project for the deployments graph, but it's wrong for this. React Flow is for connected node graphs with edges. This needs free-form drag-and-drop with resizing.

**Chosen approach:**
- **CSS `transform: translate() scale()`** on a container div for pan/zoom
- **`react-rnd`** (~15KB, wraps react-draggable + react-resizable) for card drag + resize
- Full control over z-index, minimize, close, iframe cleanup

### Chat History: Option C — Server-Side (OpenClaw manages it)
The frontend does NOT track conversation history. It sends individual messages to the bot, and OpenClaw manages conversation state internally on the PVC via its built-in session storage.

**Why:**
- Frontend stays lightweight — no growing message arrays in memory or sent over the wire
- The `sessionKey` (`jarble-web-{userId}`) already passed to OpenClaw tracks the conversation
- Future upgrade: better vector DB memory for bots will enhance this automatically
- No conversation data in localStorage (just card layout metadata)

### Tambo Role: Config Only
- Main chat goes directly to OpenClaw bot via existing SSE `/api/tambo-agent` endpoint
- Tambo becomes a toggleable config sidebar for: system prompt, platform management, LLM settings
- Essential controls (restart, stop, change API key) are always visible, Tambo-independent

### No Backend Changes
Same SSE protocol (`/api/tambo-agent`), same MCP tools, same event types. Pure frontend transformation.

---

## Memory Management Strategy

### Problem
A power user could accumulate 50+ cards and 100+ messages. Sandbox iframes run JS, charts hold data, DOM grows.

### Three layers:

**1. Visual Cards (DOM)**
- Closing a card = immediate DOM removal + memory freed
- Minimizing = unmounts component, shows only 32px title bar, preserves position in reducer
- Viewport culling (Phase 3): off-screen cards → lightweight placeholders, sandbox iframes destroyed
- Soft limit warning at ~15 sandbox cards

**2. Conversation History (network)**
- Frontend is stateless for history — just sends current message
- OpenClaw reads its own history from PVC session storage
- No growing arrays sent over the wire
- Future: vector DB memory upgrade makes this even better

**3. localStorage Canvas State**
- Persist card metadata only: position, size, component type, minimized state, title
- Small card props persisted (text, tables, key_value) — NOT sandbox props
- Max ~2MB per deployment, expire after 7 days inactivity
- On reload: small cards restore fully, sandboxes show as empty shells with component name

---

## Phase 1: Basic Infinite Dashboard

**Goal:** Replace scroll layout with pannable canvas. Bot responses render as draggable cards. Chat input stays fixed at bottom.

### Page Layout
```
┌─────────────────────────────────────────────────┐
│ Header: ← name  status  [restart] [stop] [key]  │
├─────────────────────────────────────────────────┤
│                                                  │
│    ┌──────────┐  ┌──────────────┐               │
│    │ Chart    ×│  │ 3D Cube     ×│               │
│    │          │  │              │               │
│    │  ~~bar~~ │  │   [iframe]   │               │
│    └──────────┘  └──────────────┘               │
│                                                  │
│         ┌──────────────────┐                     │
│         │ Stock Ticker    ×│                     │
│         │                  │                     │
│         │  [live chart]    │                     │
│         └──────────────────┘                     │
│                                                  │
├─────────────────────────────────────────────────┤
│ 💬 Type a message...                    [Send]   │
└─────────────────────────────────────────────────┘
```

### Steps

**1.1 — Canvas State Types** (Small)
- CREATE: `Jarble-mvp/components/workspace/types.ts`
- `CanvasCard`: id, component, props, position {x,y}, size {width,height}, zIndex, minimized, editable, fileId, saveMethod, createdAt, sourceMessageId
- `CanvasState`: cards[], viewportOffset {x,y}, zoom, nextZIndex

**1.2 — Canvas Reducer** (Small)
- CREATE: `Jarble-mvp/components/workspace/canvasReducer.ts`
- Actions: ADD_CARD, REMOVE_CARD, MOVE_CARD, RESIZE_CARD, MINIMIZE_CARD, RESTORE_CARD, BRING_TO_FRONT, SET_VIEWPORT, SET_ZOOM, RESTORE_STATE

**1.3 — Infinite Canvas Container** (Medium)
- CREATE: `Jarble-mvp/components/workspace/InfiniteCanvas.tsx`
- Outer div fills available space, captures wheel (zoom) and pointer events (pan)
- Inner div: `transform: translate(${offsetX}px, ${offsetY}px) scale(${zoom})` with `transform-origin: 0 0`
- Pan: pointerdown on background (not card) → track pointermove delta → update viewportOffset
- Zoom: wheel → adjust zoom (clamped 0.25–2.0), zoom toward cursor position
- Background: subtle dot grid pattern via CSS

**1.4 — Canvas Card Wrapper** (Medium)
- CREATE: `Jarble-mvp/components/workspace/CanvasCardWrapper.tsx`
- Uses `react-rnd` for drag + resize with controlled position/size
- Title bar: component icon + title/name, minimize button (−), close button (×)
- Close: dispatches REMOVE_CARD (sandbox iframes get srcdoc blanked first)
- Minimize: dispatches MINIMIZE_CARD, collapses to title bar only (~32px)
- Click-to-focus: pointerdown dispatches BRING_TO_FRONT
- Content area: renders existing `EditableCanvas` or `CanvasRenderer` unchanged

**1.5 — useCanvasChat Hook** (Medium)
- CREATE: `Jarble-mvp/hooks/useCanvasChat.ts`
- Evolution of `useDirectChat` — same SSE consumption but dispatches ADD_CARD to canvas reducer instead of appending to message array
- Text-only responses → card with component `"text_message"`
- UI blocks → card with their declared component type
- Auto-positioning: new cards placed at viewport center, grid/spiral outward to avoid overlap
- Does NOT maintain conversation history array (Option C — bot handles it)
- Returns: `{ sendMessage, isStreaming }`

**1.6 — Text Message Component** (Small)
- CREATE: `Jarble-mvp/components/canvas/components/CanvasTextMessage.tsx`
- Simple markdown card for text-only responses
- Shows user's original message (smaller, dimmed) above bot response
- Uses existing `MarkdownMessage` component

**1.7 — Rewrite /d/[id] Page** (Large)
- MODIFY: `Jarble-mvp/app/d/[id]/page.tsx`
- Replace all scroll layout code (TamboChat, DirectChat, message bubbles, ContentBlock)
- New structure:
  ```
  <Header />
  <InfiniteCanvas state dispatch>
    {cards.map(card => <CanvasCardWrapper><CardContent /></CanvasCardWrapper>)}
  </InfiniteCanvas>
  <ChatInputBar />
  ```
- Chat input: fixed bottom bar, always sends to bot directly (no Tambo toggle)
- Remove: ChatInterface, TamboChat, DirectChat, TamboMessageBubble, DirectMessageBubble, ContentBlock

**1.8 — Install react-rnd** (Small)
- MODIFY: `Jarble-mvp/package.json`
- Add `react-rnd` (ships with TypeScript declarations)

---

## Phase 2: Config Panel + Essential Controls

**Goal:** Tambo-independent essential controls + toggleable config sidebar.

**2.1 — Essential Controls Toolbar** (Medium)
- CREATE: `Jarble-mvp/components/workspace/EssentialControls.tsx`
- Compact toolbar in header, works WITHOUT Tambo:
  - Status indicator (colored dot + text, reuses StatusBadge)
  - Restart button → `trpc.deployment.restart.mutate()`
  - Start/Stop toggle → based on current status
  - API Key change → small modal/popover → `trpc.deployment.updateLlmApiKey.mutate()`

**2.2 — Config Panel (Tambo Sidebar)** (Medium)
- CREATE: `Jarble-mvp/components/workspace/ConfigPanel.tsx`
- Slide-out left panel, toggled by gear icon in header
- Contains existing Tambo chat interface, wrapped in `DeploymentTamboProvider`
- Tambo instructions repurposed for config-only: system prompt, platforms, LLM settings, logs
- Uses `react-resizable-panels` (already installed) for divider

**2.3 — Update Tambo Agent Instructions** (Small)
- MODIFY: `Jarble-mvp/components/DeploymentTamboProvider.tsx`
- Remove StreamingBotMessage instruction (no longer forwarding chat to bot)
- Add config-specific instructions: system prompt changes, platform management, LLM settings, lifecycle ops

**2.4 — Integrate Config Panel into Page** (Small)
- MODIFY: `Jarble-mvp/app/d/[id]/page.tsx`
- Add config panel toggle state
- Header gets: back, name, status, essential controls, gear toggle, profile dropdown
- Layout: `{configOpen && <ConfigPanel />} <InfiniteCanvas />`

---

## Phase 3: Polish & Performance

**Goal:** Smart layout, keyboard shortcuts, performance optimizations.

**3.1 — Auto-Layout Algorithm** (Small-Medium)
- CREATE: `Jarble-mvp/components/workspace/autoLayout.ts`
- Pure function: (existingCards, viewport, newCardSize) → position
- Start at viewport center, spiral outward, find first non-overlapping spot
- Default sizes per component: sandbox=600×500, chart/table=500×400, card/text=400×300

**3.2 — Z-Index Normalization** (Small)
- MODIFY: `canvasReducer.ts`
- When nextZIndex > 1000, re-rank all cards starting from 1 in current relative order

**3.3 — Keyboard Shortcuts + Viewport Culling** (Medium)
- MODIFY: `InfiniteCanvas.tsx`
- Space+drag = pan, Ctrl+0 = reset zoom, Ctrl±= zoom, Delete = close focused card, Escape = deselect
- Viewport culling: cards outside visible area + 200px buffer → render as lightweight placeholder rectangles
- Sandbox iframes specifically: destroy when off-screen, rebuild when scrolled back

**3.4 — Sandbox Cleanup on Close** (Small)
- MODIFY: `CanvasCardWrapper.tsx`
- For sandbox cards: blank iframe srcdoc before React unmount to force immediate JS teardown

**3.5 — localStorage Persistence** (Small)
- MODIFY: `canvasReducer.ts`
- Debounced (300ms) write to `localStorage` key `jarble-canvas-{deploymentId}`
- On mount: dispatch RESTORE_STATE from localStorage
- Persist: card positions, sizes, minimized state, component type, title, small props
- Do NOT persist: sandbox props, large data arrays
- Max 2MB per deployment, expire after 7 days

---

## Phase 4: Advanced Features

**4.1 — Mini-Map** (Medium)
- CREATE: `Jarble-mvp/components/workspace/MiniMap.tsx`
- 200×150px overview in bottom-right corner
- Shows all cards as colored rectangles, viewport as semi-transparent rect
- Click/drag to pan main canvas
- Rendered via `<canvas>` element for performance

**4.2 — Streaming Indicator** (Small)
- MODIFY: `CanvasCardWrapper.tsx`
- Pulsing border/glow while card's UI block is still streaming

**4.3 — Card Context Menu** (Small)
- MODIFY: `CanvasCardWrapper.tsx`
- Right-click: Close, Minimize/Restore, Bring to Front/Send to Back, Duplicate, Reset Size, Copy Props as JSON
- Uses Radix `@radix-ui/react-context-menu` (already installed)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Iframe memory (many sandboxes) | Close button prominent, viewport culling kills off-screen iframes, soft limit warning at ~15 |
| Pan vs drag conflict | Check `e.target` — background clicks pan, card clicks handled by react-rnd |
| Text-only responses | Become `CanvasTextMessage` cards, auto-layout handles both types |
| EditableCanvas save flow | Reused unchanged inside card wrappers — MCP write_file still works |
| localStorage overflow | Max 2MB budget, prune oldest, don't persist sandbox props |
| OpenClaw session loss | Sessions stored on PVC, survive pod restarts. Future: vector DB backup |

---

## File Change Summary

### Phase 1 — 8 changes (5 new, 2 modify, 1 install)
```
CREATE  Jarble-mvp/components/workspace/types.ts
CREATE  Jarble-mvp/components/workspace/canvasReducer.ts
CREATE  Jarble-mvp/components/workspace/InfiniteCanvas.tsx
CREATE  Jarble-mvp/components/workspace/CanvasCardWrapper.tsx
CREATE  Jarble-mvp/hooks/useCanvasChat.ts
CREATE  Jarble-mvp/components/canvas/components/CanvasTextMessage.tsx
MODIFY  Jarble-mvp/app/d/[id]/page.tsx (major rewrite)
MODIFY  Jarble-mvp/package.json (add react-rnd)
```

### Phase 2 — 4 changes (2 new, 2 modify)
```
CREATE  Jarble-mvp/components/workspace/EssentialControls.tsx
CREATE  Jarble-mvp/components/workspace/ConfigPanel.tsx
MODIFY  Jarble-mvp/components/DeploymentTamboProvider.tsx
MODIFY  Jarble-mvp/app/d/[id]/page.tsx
```

### Phase 3 — 4 changes (1 new, 3 modify)
```
CREATE  Jarble-mvp/components/workspace/autoLayout.ts
MODIFY  Jarble-mvp/components/workspace/canvasReducer.ts
MODIFY  Jarble-mvp/components/workspace/InfiniteCanvas.tsx
MODIFY  Jarble-mvp/components/workspace/CanvasCardWrapper.tsx
```

### Phase 4 — 2 changes (1 new, 1 modify)
```
CREATE  Jarble-mvp/components/workspace/MiniMap.tsx
MODIFY  Jarble-mvp/components/workspace/CanvasCardWrapper.tsx
```

---

## Session Context (2026-02-24)

### What was done this session:
1. Committed and pushed all pending canvas/Tambo/MCP changes (commit `412083a`)
2. Cleaned up 18 stale docs/specs files from pre-K8s era (commit `3be1c27`)
3. Updated CLAUDE.md with full canvas/chat architecture documentation (commit `49fd03b`)
4. Updated memory files to reflect current canvas/streaming focus
5. Planned this moveable canvas workspace feature

### Current state of the codebase:
- 56+ canvas components in registry (charts, media, sandbox, spreadsheet, etc.)
- `CanvasSandbox` renders arbitrary HTML/CSS/JS in secure iframe with CDN library loading
- `StreamingBotMessage` streams bot responses via SSE with inline UI blocks
- MCP UI server (`jarble-ui-server.js`) with render_ui, define_component, component_reference tools
- Chat endpoint (`/api/tambo-agent`) proxies to pod via WS/exec, streams SSE events
- The sandbox component was tested and working — user asked for 3D rotating cube and live stock chart, bot delivered both

### What to do next session:
Start Phase 1 implementation. Begin with steps 1.1 (types) + 1.2 (reducer) + 1.8 (install react-rnd) as they have no dependencies, then 1.3 (InfiniteCanvas) + 1.4 (CanvasCardWrapper), then 1.5 (useCanvasChat) + 1.6 (TextMessage), and finally 1.7 (page rewrite).
