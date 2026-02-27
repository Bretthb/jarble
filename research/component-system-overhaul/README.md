# Component System Overhaul — Research Phase

**Date**: 2026-02-27
**Branch**: `UI-polishing`
**Status**: 9/10 research tasks complete, 1 in progress

## Context

Comprehensive research to overhaul Jarble's component system. Goals:
1. Soul.md affects ALL platforms — need to separate web-specific UI instructions
2. Components need to be diverse, interactive, and truly live (progress bars that track real progress, etc.)
3. Canvas rendering must be flawless — proper layout, error handling, interactivity
4. Performance optimization — pods have limited compute, frontend must not lag
5. Research new tools and approaches for efficiency

## Research Team (10 agents)

| # | Agent | Status | Report File |
|---|-------|--------|-------------|
| 1 | soul-md-strategist | COMPLETE | `01-soul-md-platform-separation.md` |
| 2 | component-auditor | COMPLETE | `02-component-audit.md` |
| 3 | live-data-researcher | COMPLETE | `03-live-realtime-patterns.md` |
| 4 | canvas-renderer-auditor | COMPLETE | `04-canvas-grid-rendering.md` |
| 5 | frontend-perf-analyzer | COMPLETE | `05-frontend-performance.md` |
| 6 | pod-perf-analyzer | COMPLETE | `06-pod-compute-constraints.md` |
| 7 | mcp-tool-researcher | COMPLETE | `07-mcp-tool-improvements.md` |
| 8 | interactivity-architect | COMPLETE | `08-bidirectional-interactivity.md` |
| 9 | competitor-researcher | **IN PROGRESS** | `09-competitor-research.md` (status notes only) |
| 10 | error-resilience-planner | COMPLETE | `10-error-resilience.md` |

## Key Findings Summary

### Biggest Discoveries
- **34 components built but not registered** — instant capability boost by adding Zod schemas + registry entries
- **Action relay pipeline already works end-to-end** — 8 components dispatch actions, just needs prompt guidance
- **`update_ui` works end-to-end** — live updates possible NOW with prompt changes + CSS transitions
- **~350KB bundle savings** from lazy-loading canvas registry + @xyflow/react
- **83% of soul.md is UI-specific** — wasteful on Telegram/Discord/WhatsApp/Slack
- **Pod compute is fine** (2 cores, 3GB) — bottleneck is I/O caching, not CPU
- **Error resilience is 7/10** — needs streaming corruption + silent block loss fixes
- **MCP tooling is solid** — add `create_dashboard`, `show_notification`, optimize token usage (~400 tokens/turn savings)

### Architecture Decisions Emerging
1. **Don't adopt MCP Apps** — our React component approach is better for our use case
2. **Keep fenced-block approach** — simpler and lower latency than alternatives
3. **3-tier live updates**: Quick wins (prompt+CSS) → Persistent SSE channel → WebSocket (future)
4. **Hybrid tool approach**: Top 5-8 components as first-class typed tools, `render_ui` as catch-all
5. **Platform separation**: Extend `[CANVAS_STATE]` with platform field, make UI prompt conditional

## Next Steps (When Resuming)
1. **Finish competitor research** (Task #9) — agent was deep into researching Streamlit, Chainlit, Vercel AI SDK, Gradio, Open WebUI, Anthropic Artifacts, Retool
2. **Synthesize all 10 reports into a master implementation plan**
3. **Create implementation tasks** organized by phase (quick wins → medium → long-term)
4. **Spawn implementation team** to execute the plan

## How to Resume
Tell Claude: "Continue the component system overhaul research. Read the research folder at `research/component-system-overhaul/` for full context. The competitor research (report #9) was still in progress — finish it first, then synthesize all 10 reports into a master plan."
