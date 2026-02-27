# Report 9: Competitor Platform Research

**Agent**: competitor-researcher
**Status**: IN PROGRESS (agent was deep into research when session ended)

## What Was Being Researched

The agent was conducting extensive web research across 7+ platforms:

1. **Streamlit** (streamlit.io) — Component library, st.progress/st.spinner live updates, callbacks, performance
2. **Chainlit** (chainlit.io) — Tool result rendering, component types, action callbacks, streaming
3. **Vercel AI SDK** (sdk.vercel.ai) — React Server Components for AI UI, createStreamableUI, tool-based rendering
4. **Gradio** (gradio.app) — Component library, event system, live/streaming support
5. **Open Interpreter / Open WebUI** — Code execution rendering, rich content types
6. **Anthropic Artifacts** — React/HTML/SVG rendering, sandboxing, component types
7. **Retool / Appsmith** — Component interactivity model, data binding, event system

## Partial Findings (from other agents' cross-references)

Several other agents referenced competitors in their reports:

### From live-data-researcher:
- **Streamlit**: Re-runs Python script on server, diffs component tree, pushes via WebSocket. st.progress uses Python loop pattern. st.fragment for partial reruns.
- **Vercel AI SDK**: streamUI streams RSC from tool calls. createStreamableUI for multi-update values. Updates within single streaming response only.
- **Chainlit**: Socket.IO persistent bidirectional WebSocket. ChainlitEmitter pushes updates. Elements updateable in-place by ID.

### From interactivity-architect:
- **Streamlit**: Script re-run on every widget change, full session_state sync
- **Chainlit**: @cl.action_callback decorators, manual cl.user_session state
- **CopilotKit AG-UI**: Typed SSE events with STATE_DELTA
- **Vercel AI SDK**: Tool calling + onToolCall callbacks, RSC re-render

### From mcp-tool-researcher:
- **Vercel AI SDK**: Each tool IS a component. Three states: input-available, output-available, output-error.
- **MCP Apps Standard**: Official _meta.ui.resourceUri for tool UI rendering
- **Shopify MCP UI**: Intent-based message system with adaptive CSS

## TO DO When Resuming
- Complete full research on all 7 platforms
- Synthesize: What is the BEST possible component system for an AI bot platform?
- What would set Jarble apart from competitors?
- Specific features/patterns to adopt from each platform
- Document limitations of each that Jarble can improve on
