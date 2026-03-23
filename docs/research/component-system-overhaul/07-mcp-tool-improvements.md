# Report 7: MCP Tool Improvements & Alternatives

**Agent**: mcp-tool-researcher
**Status**: COMPLETE

## Current System
13 tools in jarble-ui-server.js:
- **UI (7)**: render_ui, update_ui, define_component, list_components, component_reference, save/load/list/delete_canvas_file
- **Memory (4)**: store_memory, recall_memory, list_memories, forget_memory

Architecture: MCP server returns fenced block text → bot echoes → backend parses → SSE events → frontend renders.

## Industry Research

### MCP Apps Standard (Jan 2026)
- Official `_meta.ui.resourceUri` pointing to `ui://` scheme
- Hosts render UI in sandboxed iframes with JSON-RPC postMessage
- Adopted by Claude Desktop, VS Code Insiders, ChatGPT

### Vercel AI SDK
- Each tool IS a component — tool name maps to React component
- Three states: input-available (loading), output-available (render), output-error
- Key insight: typed per-component tools give better LLM accuracy

### Anthropic Structured Outputs (Now GA)
- JSON schema enforcement via constrained decoding
- `strict: true` for tool inputs guarantees valid JSON
- Available on Claude Opus 4.6, Sonnet 4.6, Haiku 4.5

### MCP Best Practices
- 5-15 tools per server max
- Tool use examples improved accuracy from 72% to 90%
- Outcomes over operations, flatten arguments

## Proposed New Tools

### A. `create_dashboard` (HIGH priority)
Render multiple components in a layout with a single tool call. Emits layout component with children.

### B. `show_notification` (MEDIUM priority)
Toast/alert without full canvas card. New `jarble_ui_toast` fenced block type.

### C. `request_input` (LOW priority — essentially well-prompted form)
Inline form that "waits" for user response. Hard to implement (blocking MCP tool call).

### D. `get_canvas_state` (LOW priority)
Read what's on the canvas. Requires frontend→backend state sync. Simplest: include canvas state in chat request body (already partially done via [CANVAS_STATE]).

## Tool Schema Optimization

### A. Massive description strings (save ~400 tokens/turn)
`render_ui` lists all 56+ component names inline. Shorten to reference `component_reference` tool instead.

### B. No enum on component name
`component` field is `type: "string"` with no enum. LLM can hallucinate names. Add enum + `strict: true`.

### C. Props fully untyped
`props` is `type: "object", additionalProperties: true`. Add inline examples for top 5 components (72% → 90% accuracy improvement).

### D. Duplicate tool definitions
Pod-side and API-side define same schema independently. Single source of truth needed.

## Architecture Decisions

### Don't Adopt MCP Apps
Our React component approach is better:
1. Native React components integrate with canvas state (drag, split, merge) — iframes can't
2. Fenced-block approach is simpler and lower latency
3. Sandbox already uses iframes when needed

### Don't Make Every Component a Tool
24+ tools exceeds the 5-15 best practice. BUT consider hybrid: **top 5-8 as first-class typed tools** + `render_ui` as catch-all.

### Do Use Structured Outputs (future)
When we control the LLM call (server-side proxy), use `strict: true` for guaranteed valid JSON.

### Do Add MCP Prompts
Register reusable prompt templates: `render_dashboard`, `render_report`, `render_comparison`.

## Priority Summary

### HIGH
1. Optimize render_ui description (save ~400 tokens/turn)
2. Add enum constraint on component parameter
3. Add inline examples to top 5 component descriptions
4. Implement `create_dashboard`

### MEDIUM
5. Implement `show_notification`
6. Add canvas state to chat context
7. Register MCP prompts for common patterns
8. Single source of truth for schemas

### LOW
9. Structured outputs with strict: true
10. Hybrid per-component tools
11. get_canvas_state tool
