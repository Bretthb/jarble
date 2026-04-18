---
name: project_overnight_2026_03_18
description: Overnight autonomous work session — sandbox-first pivot, agent orchestration, dependency cleanup, test fixes, MCP tool redirects
type: project
---

## Overnight Session Summary (2026-03-18)

### Phase 1: Sandbox-First Pivot (COMPLETED)
- System prompt (JARBLE_UI_PROMPT) rewritten with SANDBOX-FIRST RULE as first design principle
- Component Chooser table flipped: sandbox first for dashboards/charts/data viz
- Component manifest promptGuidance updated: sandbox, metric_card, stat_grid, chart all redirect to sandbox for dashboards
- TOP_10_NAMES reordered: sandbox first, chart/data_table/spreadsheet removed
- Sandbox default size increased: 700x600 → 800x650
- MCP server `component_reference` tool: sandbox redirect for chart/data_table/metric_card/stat_grid/spreadsheet queries
- MCP server `list_components` tool: sandbox listed first with PREFERRED tag + dashboard warning banner
- Concrete sandbox dashboard example added to system prompt

### Phase 2: Agent Orchestration UX (COMPLETED)
- Event types: CUSTOM_AGENT_CALL_START/END added
- Event bridge: agentCallEvents.ts EventEmitter connecting agent-hub route ↔ SSE stream
- Agent hub route: emits start/end events on call_agent requests
- tamboAgent SSE handler: subscribes to agent events, forwards as CUSTOM SSE events
- Frontend useCanvasChat: handles agent call events, tracks activeAgentCall state
- AssistantUIChat: inline "Delegating to X Agent..." indicator with Zap icon + spinner
- Credits badge: compact balance display next to Coins icon in header

### Dependency Cleanup (COMPLETED)
- Removed 8 unused frontend deps: @fortune-sheet/react, cookie, copy-anything, is-what, react-grid-layout, react-player, regexparam, streamdown
- Removed 3 unused frontend devDeps: @types/google.maps, @types/react-grid-layout, tw-animate-css
- Removed 1 unused API dep: @types/archiver
- Removed 2 dead frontend scripts: db:push, db:seed (no drizzle-kit dep)
- Lockfiles regenerated

### Test Fixes (COMPLETED)
- Fixed openclaw.test.ts: agent.model → agents.defaults.model.primary path
- Fixed openclawGateway.test.ts: added missing containerName + timeout params
- Fixed promptText.test.ts: updated "more components available" → "more typed components available"
- Fixed manifest.test.ts: added confirmation + page to CANONICAL_COMPONENTS, updated top10 assertions
- Fixed page.ts: renderOrder 0 → 1 (must be 1-10)
- Net result: 3 fewer failing test files (11→8), 3 more passing tests

### Remaining Known Issues
- 8 API test files fail due to SQLite schema missing recent columns (local.db needs delete + restart)
- 6 frontend test files fail with pre-existing UI text mismatches in simpleCanvasGrid, sandbox CSP, registry tests
- Sandbox-first not yet verified with live bot (user tested 3x with typed components before MCP tool redirects were added)

**How to apply:** Next session should: (1) test sandbox-first with restarted pod, (2) delete local.db + restart API to fix SQLite test failures, (3) review agent reports for further cleanup opportunities.
