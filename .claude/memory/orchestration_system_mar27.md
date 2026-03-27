---
name: Orchestration System Build Session (2027-03-27)
description: Full orchestration system — WS events, configurable agents, team delegation, soul.md optimization, gateway timeout fixes
type: project
---

## What We Built (2026-03-27)

Every OpenClaw bot is now an orchestrator with a configurable agent pool. The system spans backend, frontend, and infrastructure.

### Phase 1-2: WebSocket Orchestration Channel
- **New `/ws/orchestration` endpoint** — real-time events when bot delegates to agents
- `agentCallEvents.ts` extended with `OrchestrationStepEvent` types + `emitOrchestrationStart/End` helpers
- `agentLlm.ts` emits events for both platform agents AND dynamic subagents
- `index.ts` wires the WS server (always active, no feature gate)
- Frontend `useOrchestration.ts` hook — Auth0 token, exponential backoff reconnection, auto-clear after 5s

### Phase 3: Configurable Platform Agents
- `source` column added to `deployment_subagents` table (`"custom" | "platform" | "delegation"`) — all 3 schema files
- `flow_deployment_memberships` join table for efficient deployment→flow lookups
- `platformAgents.ts` seeds Component/Data/Workflow agents on deployment creation
- `agentLlm.ts` unified DB-first lookup (respects enabled/disabled, custom prompts, model override)
- SubagentsPanel groups agents: Platform Agents (Cpu icon, orange badge, toggle+edit, no delete) / Custom / Team Members

### Phase 4: Team Delegation in Single-Bot Chat
- `flows.ts` syncs `flow_deployment_memberships` on create/update/duplicate
- `tamboAgent.ts` queries team context, injects `[TEAM CONTEXT]` with delegation tools
- `flowDelegation.ts` emits orchestration WS events with `sourceDeploymentId`
- Delegation round-trips handled in tamboAgent SSE stream

### Phase 5: Orchestration Steps UI
- `OrchestrationSteps.tsx` — new agent types: `subagent` (Bot/purple), `delegation` (ArrowRightLeft/teal), `platform` (Cpu/orange)
- Predictive steps show real agent names: "Planner", "Data Agent", "Component Agent", "QA Agent"
- WS events supersede predictive steps via merge logic in `page.tsx`

### Phase 6: Unified soul.md
- "Your Agent Pool" section with orchestration patterns (data-first pipeline, parallel dashboard, sequential multi-agent)
- Task-complexity heuristics (when to delegate vs do it directly)
- SANDBOX-FIRST RULE softened to allow delegation for complex tasks
- `delegation-tools.json` written to PVC for MCP tool registration

### Fixes
- **soul.md shrunk from 25K to 6K** — moved detailed component docs to MCP tool responses (component_reference, skill_reference). Was exceeding OpenClaw's 20K char limit.
- **Gateway timeouts**: chatViaGateway 120s→180s, chatViaHTTP infinite→180s. Opus needs room for thinking.
- **Auto-diagnose fix**: Shows "✅ Bot restarted successfully" instead of full health dump. Filters cosmetic OpenClaw Doctor warnings.
- **compose.ts**: Emits orchestration events for each parallel slot so Component Agent work shows in UI.
- **Legacy /component endpoint**: Now emits orchestration events matching the generalized endpoint.
- **Hetzner server slots**: Bumped from 2 to 17 (HETZNER_MAX_MANAGED_SERVERS env var on API pod).

### Production DB Migration
Ran manually on Neon PostgreSQL:
- `ALTER TABLE deployment_subagents ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'custom'`
- `CREATE TABLE flow_deployment_memberships (...)` with indexes
- Seeded platform agents for deployment `45c08kyb58ee`

## What We're Working Towards

### Vision: Every Bot is an Orchestrator
- Users configure their bot's agent pool (platform agents + custom subagents + team members)
- Complex tasks automatically delegate to multiple agents in parallel
- The orchestration UI shows real-time which agents are working and what they're doing
- Team delegation lets bots call other deployments linked via Bot Teams flow canvas

### Next Steps
1. **Real WS orchestration events replacing predictive steps** — when the bot actually calls `agent_component_agent` via MCP, the WS events will supersede the timer-based predictive steps
2. **Bot actually using agent pool** — the soul.md now has orchestration patterns, but the bot may still prefer `render_ui` directly. Monitor if Sonnet/Opus follow the delegation instructions.
3. **delegation-tools.json hot-reload in MCP server** — need to add file-watcher + tool registration in `jarble-ui-server.js` (same pattern as `subagent-tools.json`)
4. **Cancel delegation from UI** — the WS supports `{ type: "cancel", stepId }` messages from client but backend doesn't act on them yet
5. **Switch back to Opus** — currently on Sonnet 4.6 because Anthropic Opus was returning 529 "overloaded". Monitor and switch back when capacity frees up.

### Known Issues
- Anthropic `claude-opus-4-6` returning 529 "overloaded" errors intermittently
- OpenClaw Doctor cosmetic warnings (directory permissions, config file permissions) cause "degraded" health status — filtered in auto-diagnose but still shows in manual health checks
- configSync doesn't auto-trigger on API restart — requires a subagent toggle or explicit restart to push updated soul.md to existing pods
