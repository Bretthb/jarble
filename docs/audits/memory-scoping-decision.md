# Memory Scoping Decision

**Date:** 2026-04-09
**Status:** Implemented
**PR:** feature/memory-scoping

## Problem

QA Scenario 10 (`docs/audits/deep-bot-teams-qa.md`) discovered that bot long-term memory leaks across what the UI presents as isolated sessions:

1. User told bot t2 in a new Team Chat session "my favorite color is blue"
2. The bot recalled "blue" in an **older conversation** in the same team
3. The bot recalled "blue" in t2's **individual chat** at `/d/[id]`

Root cause: the Jarble MCP memory tools (`store_memory`, `recall_memory`, `list_memories`, `forget_memory`) store all memories in a single `/data/memory/store.json` file on the pod PVC. There is no per-session partitioning. The UI presents conversations as isolated (separate history, separate canvas cards), but the bot's long-term memory is globally shared.

## Memory Layers

| Layer | Storage | Scope Before Fix |
|-------|---------|------------------|
| OpenClaw native session history | OpenClaw workspace, keyed by `sessionKey` | Per session (already isolated) |
| Jarble MCP `store_memory`/`recall_memory` | `/data/memory/store.json` | Per pod (leaks across sessions) |

## Options Considered

### Option A: Scope memory per conversation by default

Change the default behavior so memories are partitioned by `conversationId`/`sessionKey`. Each conversation would have its own memory namespace.

**Pros:**
- Immediately fixes the privacy concern
- Matches user mental model of isolated sessions

**Cons:**
- **Breaking change** for existing deployments that rely on cross-session memory (personal assistants, CRM bots)
- Bot Teams need shared context across sessions by design (specialists should know the user)
- Incomplete fix: OpenClaw's native `memory_search` tool (closed-source runtime) cannot be scoped by us, so memories stored by that tool would still leak

### Option B: Disclose user-scoped memory + per-deployment opt-in scoping toggle

Keep the default behavior (`global`) but:
1. Add an **unmissable disclosure banner** at the top of every chat session
2. Add a **per-deployment memory scope toggle** (global / session / off) in the config panel
3. When set to `session`, partition memory by session key in the MCP server

**Pros:**
- Non-breaking: existing deployments work as before
- Respects that cross-session memory is the correct default for most agent use cases
- Gives deployment owners explicit control
- Honest about the limitation (OpenClaw native memory can't be scoped)

**Cons:**
- Privacy concern remains for the default (global) mode, mitigated by disclosure

## Decision: Option B

**Rationale:**

1. **Cross-session memory is the more useful default.** Personal assistants, CRM bots, customer support agents all benefit from remembering user context across sessions. Changing the default would degrade the product for the majority of use cases.

2. **Incomplete scoping is worse than honest disclosure.** Even with Option A, OpenClaw's native `memory_search` would still leak per-pod. Better to disclose honestly than give a false sense of privacy.

3. **Bot Teams need cross-session context.** Specialists in a team need to know the user across sessions to provide coherent service.

4. **Lower implementation risk.** Additive changes (new column, new UI) rather than changing defaults.

## Implementation

### Backend

- **DB:** `memoryScope` column on `deployments` table (varchar(20), default "global")
- **Utility:** `jarble-api-main/src/utils/memoryScope.ts` with scope helpers and prompt rendering
- **Runtime handler:** `openclaw.ts` injects memory scope section into `soul.md` and sets `JARBLE_MEMORY_SCOPE` env var
- **MCP server:** `jarble-ui-server.js` reads `JARBLE_MEMORY_SCOPE` and `JARBLE_CURRENT_SESSION_ID`, filters memory operations by session ID in "session" mode, disables tools in "off" mode
- **Session ID injection:** `chatViaExec` passes `JARBLE_CURRENT_SESSION_ID` env var per-call
- **Router:** `deployment.update` accepts `memoryScope` enum field

### Frontend

- **MemoryBanner:** Disclosure banner at top of chat panel (amber for global, green for session, hidden for off)
- **ConfigPanel:** Memory scope dropdown with explanatory text

### Three Modes

| Mode | Behavior | Banner |
|------|----------|--------|
| `global` (default) | Memory shared across all sessions and platforms | Amber: "This bot remembers information across all your conversations and platforms." |
| `session` | Memory partitioned per `sessionKey` in MCP layer | Green: "Memory is scoped to this conversation only." |
| `off` | Memory tools disabled entirely (removed from tool list, return error at runtime) | Hidden |

### Known Limitations

- **OpenClaw native `memory_search`:** The closed-source OpenClaw runtime has its own memory system that cannot be scoped by us. In `session` mode, only the Jarble MCP memory tools are scoped. The bot is instructed via `soul.md` to prefer Jarble memory tools over native ones.
- **WS/HTTP chat paths:** The `JARBLE_CURRENT_SESSION_ID` env var is only injected in the `chatViaExec` path. For WS and HTTP paths, the bot must pass `session_id` explicitly as a tool argument (instructed via `soul.md`).

## Files Changed

| File | Change |
|------|--------|
| `jarble-api-main/src/db/schema.pg.ts` | Added `memoryScope` column |
| `jarble-api-main/src/__tests__/helpers/testSchema.sqlite.ts` | Mirror column for tests |
| `jarble-api-main/src/runtimes/types.ts` | Added `memoryScope` to `DeploymentFields` |
| `jarble-api-main/src/services/configSync.ts` | Pass `memoryScope` in `buildDeploymentFields` |
| `jarble-api-main/src/utils/memoryScope.ts` | New utility module |
| `jarble-api-main/src/runtimes/handlers/openclaw.ts` | Memory scope in soul.md + env var |
| `jarble-api-main/src/services/openclawGateway.ts` | Session ID env var in chatViaExec |
| `jarble-api-main/src/mcp/jarble-ui-server.js` | Session filtering + scope enforcement |
| `jarble-api-main/src/trpc/routers/deployment.ts` | `memoryScope` in update schema |
| `Jarble-mvp/components/workspace/MemoryBanner.tsx` | New disclosure banner |
| `Jarble-mvp/components/workspace/ConfigPanel.tsx` | Memory scope toggle |
| `Jarble-mvp/app/d/[id]/page.tsx` | Wire banner into chat page |
