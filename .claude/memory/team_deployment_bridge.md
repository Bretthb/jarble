---
name: Team-to-Deployment Bridge Architecture
description: Design for bridging Bot Teams (team orchestration) with individual deployment pages — persistent sessions, drill-down navigation, delegation feedback loop, FLOW CONTEXT optimization
type: project
---

## Goal
Users can chat with a team, then click into any team member to see that bot's individual session, canvas components, and delegation history. Team chat and individual chat share session state.

**Why:** Currently team chat and individual deployment chat are completely separate. Delegation sessions are ephemeral (no memory across delegations). The entry bot never sees delegation results. No way to inspect what a team member received/responded with.

**How to apply:** Implement in 5 phases, each independently shippable.

## Key Design Decisions

1. **Session Architecture**: Persistent team-member sessions scoped to flow conversation. Key: `flow-{flowId}-{nodeId}-{userId}-{convId}`. Each bot remembers prior delegations within a conversation.

2. **UI Drill-Down**: Inline expandable delegation cards in team chat + "View full session" link → `/d/[deploymentId]?flowId=X&convId=Y` showing team-scoped session with banner.

3. **FLOW CONTEXT**: Full context on first message, abbreviated reminder on subsequent. Saves 400-800 tokens per follow-up.

4. **Delegation Mechanism**: Keep JSON-in-response for now with improved feedback loop. Plan MCP tool migration as Phase 5.

5. **Feedback Loop**: After delegations complete, send results back to entry bot for synthesis (second chatViaExec call).

## Implementation Phases

### Phase 1: Feedback Loop + Persistent Sessions
- Change delegation session keys to persistent pattern
- Add synthesis step in flowChat.ts (send results back to entry bot)
- New tables: `flow_chat_sessions`, `flow_chat_messages`

### Phase 2: FLOW CONTEXT Optimization
- Track context injection per session (in-memory Set)
- Full context first message, abbreviated reminder after

### Phase 3: Team Chat Persistence + Conversation Sidebar
- New `useFlowChat` hook (mirrors useCanvasChat)
- localStorage layer for flow conversations
- tRPC procedures: listChatSessions, getChatMessages

### Phase 4: Drill-Down Navigation
- Delegation cards with "View session" links
- `/d/[id]?flowId=X&convId=Y` team session mode
- Banner: "Viewing team session from [Flow Name]"
- Back to team link

### Phase 5: MCP Tool Migration (future)
- Register delegation targets as real MCP tools in jarble-ui-server.js
- Bot sees delegation results as tool responses
- Requires MCP server callback mechanism

## Bot's Own Feedback (from deployed bot)
1. Delegation uses JSON blocks not real tools — instructions without plumbing
2. "Specialist" is too vague — needs capability descriptions (DONE: Phase 1-2 of cluster-of-clusters)
3. FLOW CONTEXT repeats every message — burns tokens (Phase 2 above)
4. No feedback loop from specialist (Phase 1 above)
5. No escalation/fallback path (future consideration)
