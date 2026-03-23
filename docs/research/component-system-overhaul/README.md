# Component System Overhaul — Research Phase

**Date**: 2026-02-27
**Branch**: `UI-polishing`
**Status**: 10/10 initial + 9 deep-dive reports COMPLETE (2 stopped — covered elsewhere) + Gap Analysis

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
| 9 | competitor-researcher | COMPLETE | `09-competitor-research.md` |
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

## Master Implementation Plan

See **`MASTER-PLAN.md`** for the full synthesized plan with 4 phases:

| Phase | Scope | Effort | Key Items |
|-------|-------|--------|-----------|
| **Phase 1** | Quick Wins | 1-2 days | Register 34 components, lazy-load registry (~350KB savings), optimize MCP descriptions (~400 tokens/turn), prompt improvements, CSS transitions |
| **Phase 2** | Competitive Parity | 3-5 days | Tool call visibility, tool state machine per card, component-to-bot callbacks, `create_dashboard` tool, toast system, backend validation |
| **Phase 3** | Competitive Advantage | 1-2 weeks | Persistent canvas SSE, auto-refresh cards, platform-aware soul.md, size hints + grid span, pod-side caching |
| **Phase 4** | Future Differentiation | 2-4 weeks | Agent-driven state sync (AG-UI pattern), embeddable copilot widget, cross-component data binding, structured outputs, domain sandbox isolation |

## Competitor Research Summary (Report #9)

9 platforms analyzed across 3 categories:
- **AI Chat Frameworks**: Streamlit (80+ components, rerun model), Chainlit (11 elements, Socket.IO), Gradio (45 components, bidirectional I/O), Vercel AI SDK (tool-as-component pioneer)
- **AI UI Protocols**: CopilotKit/AG-UI (17 event types, state sync), LangGraph (generative UI), MCP Apps, assistant-ui
- **Low-Code**: Retool (129 components, data binding), Appsmith (60 widgets)
- **Also**: Anthropic Artifacts (`window.claude.complete()`), Open WebUI (basic)

**Jarble's unique position**: Only platform combining AI-driven UI rendering (56+ components) with multi-platform bot deployment. No competitor does both.

## Deep Dive Research (Round 2)

10 specialized agents launched for implementation-level research:

| # | Agent | Status | Report File |
|---|-------|--------|-------------|
| 11 | bundle-perf-analyzer | COMPLETE | `11-bundle-performance.md` |
| 12 | sandbox-security-researcher | COMPLETE | `12-sandbox-security.md` |
| 13 | interactivity-architect | COMPLETE | `13-component-interactivity.md` |
| 14 | ai-ui-library-researcher | COMPLETE | `14-ai-ui-libraries.md` |
| 15 | multi-platform-ux-researcher | COMPLETE | `15-multi-platform-ux.md` |
| 16 | error-resilience-deep-dive | COMPLETE | (results in previous context — TypeScript for orphaned block recovery, heartbeat timeouts, Zod pre-validation, streaming metrics) |
| 17 | realtime-dashboard-architect | COMPLETE | (results in previous context — hybrid polling+push SSE, useCanvasStream/useCardRefresh hooks, MCP tool signatures) |
| 18 | agui-protocol-guide | COMPLETE | (results in previous context — full event type mapping, migration path from Jarble's 7 events, JarbleSSEEvent TypeScript interfaces) |
| 19 | mcp-apps-spec-analyzer | STOPPED | MCP Apps + A2UI + Open-JSON-UI (covered in reports #9, #14) |
| 20 | bot-prompt-engineer | STOPPED | Prompt engineering (covered in reports #15, #13) |

### Key Deep Dive Findings

**Bundle Performance (#11)**:
- ~350-500KB savings from deleting 21 orphaned @ant-design/plots files
- ~250KB savings from lazy-loading heavy components in registry.ts via `next/dynamic`
- Zero React.memo usage in canvas pipeline — major re-render reduction possible
- Tiered lazy loading: lightweight (eager) → medium (lazy) → heavy (lazy, ssr:false)

**Sandbox Security (#12)**:
- **Critical**: CSP is `default-src * unsafe-*` — essentially no CSP. Single biggest vulnerability.
- 8 vulnerabilities identified, CSP fix closes the top 2 (data exfiltration, unrestricted network)
- Claude Artifacts uses domain isolation (`claudeusercontent.com`), ChatGPT uses `oaiusercontent.com`
- Jarble should tighten CSP immediately, plan domain isolation (`sandbox.jarble.ai`) for medium-term

**Component Interactivity (#13)**:
- CopilotKit `renderAndWait` pattern: pause/resume agent lifecycle — medium-term for Jarble
- Structured action envelope protocol (fenced `jarble_action` blocks) replaces fragile `[UI_ACTION]` text
- Canvas event bus: typed events for cross-component linking (chart click → table highlight)
- Button re-enablement: `mode: "persistent"` keeps buttons clickable after bot response
- Pending action tracker with 30s timeout + loading overlay

**AI UI Libraries (#14)**:
- **assistant-ui** — Strong YES for chat layer. `ExternalStoreRuntime` maps perfectly to Jarble's architecture. Eliminates ~400 lines custom SSE code, adds editing/branching/a11y for free
- Recharts wins over @ant-design/plots and Plotly for AI-generated charts (simple schema, shadcn native, small bundle)
- react-grid-layout is the industry standard for dashboards (Grafana, Metabase, Superset)

**Multi-Platform UX (#15)**:
- 56+ components break into 4 degradation tiers: 10 text-direct, 12 approximated, 20+ image-rendered, 4 web-only
- Telegram Mini Apps = highest-ROI bridge (full canvas in-app, existing React components)
- Platform-conditional prompts save ~1,250 tokens on non-web platforms
- Composable `buildPlatformPrompt()` replaces monolithic JARBLE_UI_PROMPT

## Jarble UI System Evaluation (Report #17)

4-agent parallel research into whether the `jarble_ui` fenced-block system is the best approach. Evaluated competitors (ChatGPT, Claude Artifacts, v0, Gemini A2UI, Perplexity), alternative architectures (tool calls, MCP Apps, RSC, WebComponents, CopilotKit), open-source libraries (assistant-ui, Vercel AI SDK, CopilotKit, LangGraph, Mastra), and performed a critical system audit.

**Verdict**: Jarble's approach is ahead of the curve. Improve it, don't replace it. No framework replicates the canvas grid + Zod validation + error self-healing combo. Main investments: single component manifest (marketplace), sandbox CSP tightening, `llm-ui` for streaming, trim token bloat.

**Marketplace readiness**: `jarble_ui_define` is a proto-marketplace. Needs single manifest format, double-iframe sandbox for user components, metadata (author/version/pricing).

**Standards to watch**: A2UI (Google), AG-UI (CopilotKit), MCP Apps (Anthropic).

Full details: `17-jarble-ui-system-evaluation.md`

## Gap Analysis (Report #16)

Codebase-wide audit after all research completed. Found 14 blind spots not covered by prior reports.

| # | Gap | Severity | Effort | ROI |
|---|-----|----------|--------|-----|
| 1 | **No production monitoring** (Sentry, log aggregation, tracing) | Critical | 1 day | Highest |
| 2 | **Auth check on /d/[id]** — verify backend user-scopes getById | Critical | 30 min | Highest |
| 3 | **No product analytics** (PostHog/Mixpanel) | High | Half day | Very High |
| 4 | **Accessibility** — missing roles, aria, keyboard nav on key components | High | 1 day | High |
| 5 | **Core logic untested** — canvasReducer, uiBlockParser, persistence, no CI | High | 2-3 days | High |
| 6 | **Mobile broken** — no touch, no responsive layout, pointer-only drag | High | 1-2 weeks | High |
| 7 | **Card accumulation** — no maxCards limit, unbounded memory | Low-Med | 2 hours | High |
| 8 | **Silent state loss** — restored cards lose props with no warning | Medium | Half day | Medium |
| 9 | **LLM provider quality** — no per-provider Zod failure tracking | Medium | 1-2 days | Medium |
| 10 | **PII in canvas** — sensitive data unmasked in localStorage | Medium | 1-3 days | Medium |
| 11 | **Custom component limits** — no versioning, no recursive composition | Medium | 1 day | Medium |
| 12 | **Theming/branding** — no per-deployment customization | Medium | 1-2 weeks | Low-Med |
| 13 | **i18n/RTL** — zero framework, hardcoded English | Low | 2-3 weeks | Low |
| 14 | **SEO/sharing** — no public share, no embed mode | Low | 1-2 weeks | Low |

Full details: `16-gap-analysis.md`

## Roadmap Planning (Reports #18-21)

5-agent team researched and planned execution of the improvement roadmap. Each agent produced a detailed implementation plan.

| # | Agent | Status | Report File |
|---|-------|--------|-------------|
| 17b | marketplace-architect | COMPLETE | `17-marketplace-architecture.md` |
| 18 | manifest-architect | COMPLETE | `18-manifest-design.md` |
| 19 | security-hardener | COMPLETE | `19-security-hardening.md` |
| 20 | streaming-researcher | COMPLETE | `20-streaming-evaluation.md` |
| 21 | prompt-optimizer | COMPLETE | `21-prompt-autofix.md` |

### Key Decisions

1. **Single Component Manifest**: TypeScript shared package (`shared/component-manifest/`). All 5 consumer systems derive from it. Adding a component goes from 5-8 files → 2 files.
2. **llm-ui: NO-GO** — Architectural mismatch (inline rendering vs canvas grid). Instead: incremental block extraction on backend (4 days, 0 dependencies).
3. **CSP already partially hardened** — Remaining gaps: `connect-src *`, `img-src *`, `font-src *`. Fix: CDN allowlist only.
4. **Prompt trim: 25% reduction** — Keep top 10 components inline, remove 26. Saves ~878 tokens/msg.
5. **AutoFix: 20 repair rules** — New `autoFixProps.ts` runs before Zod validation. Catches type coercion, enum aliases, structural fixes.

### Execution Plan

See **`EXECUTION-PLAN.md`** for the full synthesized plan with 4 phases:

| Phase | Scope | Effort | Key Items |
|-------|-------|--------|-----------|
| **Phase 1** | Quick Wins | 2-3 days | CSP tightening, prompt optimization, security headers |
| **Phase 2** | Core Infrastructure | 1-2 weeks | Single manifest, AutoFix, incremental streaming |
| **Phase 3** | Marketplace Foundation | 2-4 weeks | Package format, double-iframe, API, bot integration |
| **Phase 4** | Polish & Scale | Ongoing | CI checks, monitoring, server-side URL validation |
