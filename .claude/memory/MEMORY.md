# Memory

## Feedback & Fixes
- [tRPC splitLink for mutations](feedback_splitlink.md) — Never batch mutations with queries

## Current Work — Bot-Side Skills System IMPLEMENTED (Mar 6, 2026)

### Bot-Side Skills — 4-Step Implementation Complete
1. **Quick win (Step 1)** — Added ~300 tokens anti-pattern prevention to `JARBLE_UI_PROMPT`:
   - Chart data format (recharts vs Chart.js)
   - Field name cheat sheet (body/message/label/items/events/tabs etc.)
   - data_table rows format (arrays not objects)
   - Valid enum values (variant/size/chart type)
   - CDN allowlist for sandbox
2. **Skill files (Step 2)** — Created 5 skills in `shared/component-manifest/skills/`:
   - `component-rendering.ts` — Selection matrix, props examples, design principles
   - `sandbox-mastery.ts` — CDN allowlist, bridge API, theme, heartbeat, common mistakes
   - `generative-ui-patterns.ts` — When to render UI vs text, harmony, orchestration
   - `platform-awareness.ts` — Canvas system, MCP tools, multi-platform
   - `dashboard-composition.ts` — Ordering, layout strategy, data consistency
3. **MCP tool (Step 3)** — Added `skill_reference` tool to `jarble-ui-server.js`:
   - Lists all 5 skills or returns full content for a specific skill
   - Skills embedded as string constants in the MCP server (deployed with pod)
   - Dispatch case added to `executeTool` switch
4. **Slim core prompt (Step 4)** — Reduced JARBLE_UI_PROMPT from ~2,900 to ~1,800 tokens:
   - Compressed design principles, rendering order, sandbox tips
   - Removed redundant Browser Tool / Long-Term Memory sections (tools self-document)
   - Added `embed` to Component Chooser table
   - Added pointer to `skill_reference` MCP tool for detailed guides

### Key Files Modified
- `jarble-api-main/src/runtimes/handlers/openclaw.ts` — Slimmed JARBLE_UI_PROMPT + anti-pattern content
- `jarble-api-main/src/mcp/jarble-ui-server.js` — Added `skill_reference` tool + BOT_SKILLS content
- `shared/component-manifest/skills/` — 5 new skill files + index.ts
- `shared/component-manifest/index.ts` — Re-exports `BOT_SKILLS`

### Research Reports (20 total in `research/skills/` + `research/shadcn-v4/`)
- shadcn v4 features, AI component evaluation, Tambo skill, components vs pages architecture
- Bot knowledge gap analysis, autoFixProps audit, skill drafts for all 5 skills
- 97 Claude Code skills installed from 11 sources

---

## Previous Work — Component Resolver + ConfigSync Research (Mar 5, 2026)

### Component Resolver Discovery Pipeline
- Dual-path: K8s Layer (kubectl exec) + MCP Server (in-pod fs)
- Discovery: Built-in (37) → Custom from `/data/components/*.json` → Fallback
- ConfigSync: 3-tier sync (file-only → restart → pod restart)

### AG-UI Protocol Alignment — COMPLETE (uncommitted on UI-Polishing-v2)
- `agui-events.ts`, `tamboAgent.ts`, `useCanvasChat.ts`, `useDirectChat.ts`
- reasoning, tool, sources components implemented

---

## OpenClaw Thinking Blocks (Mar 19, 2026)
- OpenClaw 2026.2.25 strips native thinking from `--json` output and WS protocol
- Fix: System prompt now instructs bot to emit `<think>` tags + `--thinking medium` flag for quality
- `hasNativeThinking` guard removed — `<think>` tags work for all models including Opus 4.6
- External reasoning (GPT-4o-mini) still available as supplement when OPENROUTER_API_KEY is set

## Bug Audit & Playwright Testing (Mar 20, 2026)
- [Proactive bug audit](project_bug_audit_mar20.md) — 134 bugs found, 21 fixed and committed (fed8bb9), 12 high-priority remaining
- [Page routing & sandbox issues](project_page_routing.md) — Sandbox tabs broken (bot forgets onclick), page component needs runtime routing

## Upcoming Features
- [Canvas Vision](project_canvas_vision.md) — Bot sees its own canvas via html2canvas screenshots + multimodal LLM
- [OpenClaw CLI slash commands](project_openclaw_slash_commands.md) — Wire pod CLI commands into chat slash menu

## Key Architecture
- **Chat flow:** User message -> POST /api/tambo-agent -> WS to OpenClaw gateway -> AG-UI SSE events -> frontend renders
- **UI blocks:** Bot emits `jarble_ui` fenced blocks -> backend parses -> TOOL_CALL events -> SSE -> frontend
- **Component resolution:** Built-in (37 + 1 alias) -> custom from PVC -> fallback
- **Bot skills:** Core prompt (~1,800 tokens always) + on-demand skills via `skill_reference` MCP tool (~5,000 tokens available)

## Key Patterns
- Frontend tRPC type errors are pre-existing — caused by missing `jarble-api` module resolution. Not real bugs.
- SQLite dev mode: `export USE_SQLITE=true && npx tsx watch src/index.ts`
- `MSYS_NO_PATHCONV=1` prefix for kubectl exec with absolute paths
- **stdin redirect does NOT work** with Windows Git Bash + kubectl exec. Use base64+node.
- **ConfigSync quirk**: API server must be running NEW code when configSync runs

## Branch Info
- **Active branch**: `UI-Tambo-ALL` (current work)
- **Previous branch**: `UI-Polishing-v2` (pushed Mar 4)
- **Main branch**: `main` (PR #6 merged)

## Test Counts
- **Backend**: 934 tests across 32 files
- **Frontend**: 319 tests across 12 files
- **Total**: 1,253 tests

## Competitive Research & Infrastructure
- [Blink.new comparison & improvement roadmap](project_blink_comparison.md) — Page-level UI, RAG, agent templates, Components+Pages architecture proposal
- [Agent marketplace infrastructure research](project_agent_marketplace_infra.md) — gVisor/Kata/Firecracker, Marketplace Hub pattern, A2A protocol, credit billing

# currentDate
Today's date is 2026-03-20.
