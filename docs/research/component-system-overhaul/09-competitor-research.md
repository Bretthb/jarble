# Report 9: Competitor Platform Research

**Agent**: competitor-researcher (6 sub-agents)
**Status**: COMPLETE
**Date**: 2026-02-27

## Executive Summary

Researched 9 platforms across 3 categories: AI chat frameworks (Streamlit, Chainlit, Gradio, Vercel AI SDK), AI UI protocols (CopilotKit/AG-UI, LangGraph, MCP Apps, assistant-ui), and low-code platforms (Retool, Appsmith). Also analyzed Anthropic Artifacts and Open WebUI.

**Key conclusion**: Jarble occupies a unique position — no other platform combines AI-driven dynamic UI rendering (56+ components) with multi-platform bot deployment (WhatsApp, Discord, Slack, Telegram). The industry is converging on a "tool-as-component" pattern that Jarble already implements via `render_ui`. The biggest gaps to close are structured tool observability, agent-driven state sync, and component-to-bot callbacks.

---

## Platform-by-Platform Analysis

### 1. Streamlit (v1.52, Dec 2025)

**~80+ built-in elements** across 10 categories. Python-first, script-rerun model.

| Aspect | Streamlit | Jarble |
|--------|-----------|--------|
| Components | ~80+ (broad general-purpose) | 56+ (rich data visualization) |
| Update model | Full script rerun (+fragments) | SSE streaming (incremental) |
| State | `st.session_state` (dict) | Canvas reducer (typed actions) |
| Chat | `st.chat_message` (any element inside) | `StreamingBotMessage` + MCP blocks |
| Custom components | V1 (iframe) / V2 (shadow DOM, Oct 2025) | `CanvasSandbox` (iframe) + registry |
| Concurrency | Degrades at ~50 users | Per-pod K8s isolation |
| Theming | Extensive config (2025 overhaul) | No unified theming |

**Patterns to adopt**:
- `st.status` — mutable expander showing intermediate tool steps (collapsible "thinking" section)
- `st.metric` with sparklines + delta arrows → enhance Jarble's `statistic` component
- `st.toast` — non-blocking notifications without interrupting chat
- `st.dialog` — modal overlay for configuration forms
- Fragment-style `run_every` for auto-refreshing canvas cards

**Patterns to avoid**: The rerun model, single-threaded server, dict-based state.

### 2. Chainlit (v2.8.4)

**~11 built-in Elements**. Python-first, Socket.IO real-time.

| Aspect | Chainlit | Jarble |
|--------|----------|--------|
| Components | ~11 (basic: Image, Audio, Video, PDF, Plotly, Dataframe) | 56+ |
| Interactivity | Buttons only (`@cl.action_callback`) | Forms, sandbox, buttons |
| Streaming | `stream_token()` + Step hierarchy | SSE flat events |
| State | In-memory only (lost on restart) | DB + K8s + PVC |
| Custom components | Runtime JSX, limited imports (Jan 2025) | Build-time TypeScript, full React |
| Observability | Step types + CoT toggle | No structured steps |
| Embeddability | Copilot widget with JS bridge | Standalone pages only |

**Patterns to adopt**:
- **Chain-of-thought visibility toggle** (`full`/`tool_call`/`hidden`) — let users control intermediate step visibility
- **Typed Step system** (`tool`, `llm`, `run`, `retriever`) with nesting — structured execution traces
- **Copilot-style embeddable widget** with bidirectional JS bridge (`CopilotFunction` ↔ host page events)
- **TaskList** with `RUNNING`/`DONE`/`FAILED` states for multi-step progress
- **ElementSidebar** for pinning persistent context alongside chat

**Patterns to avoid**: In-memory-only sessions, runtime JSX without TypeScript, element accumulation bugs.

**Governance note**: Original Chainlit SAS team stepped back May 2025; now community-maintained.

### 3. Gradio (v5+)

**~45 built-in components**. Python-first, bidirectional I/O, Svelte frontend.

| Aspect | Gradio | Jarble |
|--------|--------|--------|
| Components | ~45 (bidirectional I/O) | 56+ (output-only) |
| Chat | `ChatInterface` with `ChatMessage` dataclass | SSE + MCP blocks |
| Events | `.click()`, `.change()`, `.submit()`, chaining | No event system |
| Streaming | `yield` pattern, diff-based | SSE text deltas + UI blocks |
| Custom components | Svelte frontend, Python backend, CLI tools | React + Zod schema |
| Live updates | `gr.Timer`, `every` param (polling) | SSE streams (push-based) |
| Multi-user | Session conflicts, no auth | Auth0, per-user K8s pods |

**Patterns to adopt**:
- **Structured ChatMessage metadata** — `title`, `status`, `duration`, `id`, `parent_id` for nested tool/thought display with collapsible accordions and spinners
- **Diff-based streaming** — send only changed portions of UI block updates
- **`gr.Timer` / `every` pattern** — simple `refreshInterval` prop on canvas cards for auto-updating metrics
- **Chat-specific events** — `.retry()`, `.undo()`, `.like()`, `.edit()` on messages
- **`gr.skip()` sentinel** — leave component values unchanged during partial updates

**Patterns to avoid**: Svelte lock-in, Python-only API, polling-based live updates, single-process scaling.

### 4. Vercel AI SDK (v6, Dec 2025)

**Tool-as-component pioneer**. React/Next.js, SSE streaming.

| Aspect | Vercel AI SDK | Jarble |
|--------|--------------|--------|
| Tool → UI | Manual switch on `message.parts` by tool name | Automatic via `registry.ts` + `CanvasRenderer` |
| Component library | AI Elements (50+ chat/code, NO viz) | 56+ including charts, tables, 3D |
| Streaming | Tool state machine: `input-streaming` → `output-available` | `UI_BLOCK_START` → `UI_BLOCK_END` |
| Schema validation | Zod on tool inputs | Zod on component props |
| State | `useChat` hook with `UIMessage.parts` | Canvas reducer |
| Progressive rendering | Tool states (loading → success → error) | Block assembly |

**Patterns to adopt**:
- **Tool state machine** (`input-streaming` → `input-available` → `output-available` → `output-error`) — proper loading/error states per canvas card
- **Human-in-the-loop approval** (v6 `needsApproval`) — confirm before expensive component renders
- **`useObject` / `streamObject`** — stream partial JSON progressively for large data tables/charts
- **Multi-step tool calling** (`stopWhen: stepCountIs(N)`) — bot renders chart, examines reaction, renders follow-up

**Patterns to avoid**: Manual switch statements for component rendering (Jarble's registry is better), rapid breaking changes across versions.

**Critical note**: AI SDK RSC (`streamUI`, `createStreamableUI`) development is **paused** — they recommend client-side hooks instead.

### 5. Anthropic Artifacts (Claude.ai)

**~5 content types** (React, HTML, SVG, Mermaid, code). Sandboxed on `claudeusercontent.com`.

| Aspect | Artifacts | Jarble |
|--------|-----------|--------|
| Content types | ~5 (React, HTML, SVG, Mermaid, code) | 56+ structured components |
| Sandbox | Domain-isolated iframe + CSP + DOMPurify | iframe `sandbox` attrs |
| Interactivity | `window.claude.complete()` — call back to LLM! | No reverse LLM channel |
| Libraries | React, Tailwind, shadcn, Recharts, Lucide (fixed set) | Full npm ecosystem |
| Persistence | 20MB per artifact | PVC `/data/` unlimited |

**Patterns to adopt**:
- **Domain-level sandbox isolation** — host sandbox content on `sandbox.jarble.ai` instead of relying on iframe attrs alone
- **`window.claude.complete()` equivalent** — let canvas components call back to the bot/LLM (e.g., click chart segment → ask bot for analysis)
- **DOMPurify content sanitization** in sandbox renderer
- **Publishable/shareable artifacts** — let users share individual canvas outputs

### 6. Open WebUI

**Basic rich content** (Markdown, LaTeX, code, SVG, Mermaid). No structured component system.

| Aspect | Open WebUI | Jarble |
|--------|-----------|--------|
| Component system | None (text rendering only) | 56+ with Zod validation |
| Tool rendering | Plain text output | Structured JSON → React components |
| Artifacts | Community add-ons (~80% success) | First-class canvas grid |
| Extensibility | Tools + Functions + Pipelines (deep platform) | MCP tools + component registry |
| Multi-platform | None (self-hosted chat only) | WhatsApp, Discord, Slack, Telegram |

**Key insight**: Open WebUI's extensibility is deeper at the *platform* level (model providers, message filters). Jarble's is deeper at the *component rendering* level. Not a direct competitor — different audiences.

### 7. Retool (129 components) / Appsmith (~60 widgets)

Low-code platforms with human-designed (not AI-generated) layouts.

| Aspect | Retool/Appsmith | Jarble |
|--------|----------------|--------|
| Components | 129 / ~60 | 56+ |
| Data binding | `{{ component.property }}` reactive | None (isolated cards) |
| Event system | Full (click → trigger query → update) | None (chat-only) |
| AI role | AI assists app building | AI IS the runtime |
| Component methods | `table1.selectRow(3)`, `modal1.open()` | None |

**Patterns to adopt**:
- **Cross-component data binding** — canvas cards referencing each other's data for linked views (chart ↔ table drill-down)
- **Component methods** — bot can programmatically interact with rendered components (highlight row, expand accordion)
- **Debounce/throttle** for component-to-bot communication
- **Conditional rendering with expressions** — `{{ value > 100 ? 'green' : 'red' }}` for dynamic styling

### 8. CopilotKit / AG-UI Protocol

**17 SSE event types**. The emerging standard for agent ↔ UI communication.

| Aspect | AG-UI | Jarble SSE |
|--------|-------|-----------|
| Event types | 17 (lifecycle, text, tool call, state, custom) | 7 (text + UI blocks) |
| State sync | `STATE_SNAPSHOT` + `STATE_DELTA` (JSON Patch) | Client-only reducer |
| Tool visibility | `ToolCallStart/Args/End/Result` | Hidden (no tool call events) |
| Generative UI | 3 patterns: static, declarative, open-ended | Declarative (registry) |
| Human-in-loop | `renderAndWait` pauses agent | Not supported |

**Patterns to adopt**:
- **Tool call visibility events** — show users what MCP tools the bot is calling
- **STATE_DELTA (JSON Patch)** — agent-driven canvas state updates from backend
- **`renderAndWait`** — pause bot execution and wait for user interaction with a rendered component
- **Activity events** (draft) — fine-grained progress between messages

### 9. LangGraph UI + Emerging Standards

**Generative UI via `ui.push()`**. Components loaded dynamically in shadow DOM.

**Key industry convergence** (The 2026 Protocol Stack):

| Layer | Protocol | Purpose |
|-------|----------|---------|
| Runtime channel | AG-UI | Agent ↔ UI bidirectional |
| Tool execution | MCP | Agent ↔ tool protocol |
| Agent-to-agent | A2A (Google) | Multi-agent orchestration |
| UI payload | A2UI / Open-JSON-UI / MCP Apps | What UI gets rendered |

**Structured Outputs for UI** — constrained decoding now production-grade (OpenAI, Anthropic `strict: true`). Open-JSON-UI designed to align with structured outputs. Agents can be *forced* to produce valid UI JSON every time.

---

## Cross-Platform Competitive Matrix

| Feature | Jarble | Streamlit | Chainlit | Gradio | Vercel SDK | CopilotKit | Retool |
|---------|--------|-----------|----------|--------|------------|------------|--------|
| Component count | 56+ | 80+ | 11 | 45 | 50+ (no viz) | N/A (bring own) | 129 |
| AI generates UI | Yes | No | Partial | No | Yes | Yes | No |
| Multi-platform deploy | Yes | No | No | No | No | No | No |
| Structured tool rendering | Yes (MCP) | No | Basic | Yes (metadata) | Yes (tool parts) | Yes (AG-UI) | N/A |
| Canvas/workspace | Grid + drag/split/merge | No | Sidebar only | No | No | No | Full builder |
| Real-time updates | SSE (push) | Script rerun | Socket.IO | Polling | SSE | SSE/WS | Queries + WS |
| Component interactivity | Limited (8 dispatch) | Full (rerun) | Buttons only | Full (events) | Tool states | Full (renderAndWait) | Full (events) |
| State sync agent→UI | No | N/A | No | No | No | Yes (STATE_DELTA) | N/A |
| Sandbox for code | Yes (iframe) | V2 (shadow DOM) | JSX (limited) | No | No | Iframe (MCP Apps) | Iframe |
| Auth/multi-tenant | Auth0 + K8s | Limited | Basic | None | N/A | N/A | Full RBAC |

---

## What Would Set Jarble Apart

### Already Unique
1. **MCP-driven component rendering** with 56+ Zod-validated components — no other platform has this breadth with automatic registry resolution
2. **Multi-platform bot deployment** (WhatsApp, Discord, Slack, Telegram + web) from a single configuration
3. **User-interactive canvas** with drag-to-reorder, split, merge — unique spatial layout for AI-rendered content
4. **Per-user K8s pod isolation** — true multi-tenant security

### Gaps to Close (by priority)

**P0 — Must have (competitive table stakes)**:
1. Structured tool call visibility (what AG-UI, Gradio, Vercel all do)
2. Component-to-bot callback (`window.claude.complete()` pattern)
3. Tool state machine per card (loading → success → error)

**P1 — Should have (competitive advantage)**:
4. Agent-driven state sync (STATE_DELTA → canvas reducer)
5. Chain-of-thought visibility toggle
6. Auto-refreshing canvas cards (`refreshInterval` prop)
7. Embeddable copilot widget

**P2 — Nice to have (future differentiation)**:
8. Cross-component data binding
9. Structured outputs with constrained decoding for guaranteed valid UI JSON
10. Domain-level sandbox isolation
11. Publishable/shareable canvas artifacts

---

## Sources

Full source lists available in individual agent research outputs. Key references:
- [AG-UI Protocol](https://docs.ag-ui.com), [CopilotKit Docs](https://docs.copilotkit.ai)
- [Vercel AI SDK v6](https://ai-sdk.dev), [AI Elements](https://elements.ai-sdk.dev)
- [Streamlit API Reference](https://docs.streamlit.io/develop/api-reference)
- [Chainlit Docs](https://docs.chainlit.io), [Gradio Docs](https://www.gradio.app/docs)
- [MCP Apps Spec](https://modelcontextprotocol.io/docs/extensions/apps)
- [Google A2UI](https://developers.googleblog.com/introducing-a2ui)
- [Open-JSON-UI](https://docs.copilotkit.ai/generative-ui/specs/open-json-ui)
- [Retool Components](https://docs.retool.com/apps/reference/components/)
- [assistant-ui](https://www.assistant-ui.com)
- [LangGraph Generative UI](https://docs.langchain.com/langsmith/generative-ui-react)
