---
name: Control UI integration plan
description: How Jarble features (subagents, RAG, files, sessions, teams) complement OpenClaw's embedded Control UI
type: project
---

## Control UI Integration — How Jarble + OpenClaw Features Complement Each Other

### Current State (2026-04-13)

OpenClaw's Control UI is embedded as an iframe in the deployment workspace via a Monitor icon toggle. It provides: Chat, Config editor, Channels, Sessions, Usage, Cron Jobs, Agents, Skills, Nodes, Appearance, Communications. Jarble still has: Subagents panel, Files panel, Knowledge panel, Conversation History, Agent Teams, Canvas + Chat, EssentialControls.

### Security Audit Summary

All acceptable. No platform secrets exposed. Gateway token redacted by default. Users only see their own pod data. One medium concern: "Update Now" button could trigger OpenClaw version update on the pod.

### Integration Design: How Features Complement Each Other

**Subagents (Jarble SubagentsPanel + OpenClaw Agents page):**
- Jarble SubagentsPanel = CRUD interface for subagent DB records (create, edit, delete, reorder, system prompt, model, tools)
- OpenClaw Agents page = read-only viewer of the REGISTERED native agents (what's actually running on the pod)
- Workflow: user creates/edits subagents in Jarble panel -> configSync writes agents.list to openclaw.json -> OpenClaw Agents page reflects the running state
- The Agents page is the "truth viewer" — shows what the pod actually sees, including workspace paths, model, skills filter
- **Why:** Don't skip a step. If subagent CRUD happens in the Control UI directly, it would bypass Jarble's DB and billing. Jarble panel is the write path, Control UI is the verification path.

**RAG/Knowledge (Jarble KnowledgePanel + OpenClaw Agents > Files tab):**
- Jarble KnowledgePanel = upload .txt/.md/.json/.csv documents for RAG indexing
- OpenClaw Agents > Files tab = browse the agent's workspace files (SOUL.md, AGENTS.md, etc.)
- These are complementary, not overlapping. Knowledge docs go to /data/knowledge/ (Jarble's RAG system). Agent workspace files go to /data/.openclaw/workspace/ (OpenClaw's native file system).
- **Future:** Could surface RAG docs in the Files tab by symlinking or mounting the knowledge dir into the agent workspace.

**File System (Jarble FilePanel + OpenClaw Agents > Files tab):**
- Jarble FilePanel = full pod filesystem browser with drag-drop upload, mkdir, delete, rename, download
- OpenClaw Files tab = agent workspace files only (SOUL.md, etc.), more limited
- **Why both:** FilePanel is the power-user tool for the full PVC. OpenClaw Files tab is scoped to the agent workspace. Keep both — they serve different scopes.

**Sessions (Jarble ConversationHistoryPanel + OpenClaw Sessions page):**
- Jarble ConversationHistoryPanel = localStorage-based, client-side only, manages conversationId -> sessionKey mapping
- OpenClaw Sessions page = server-side sessions with token counts, model/thinking overrides, last updated timestamps
- **Integration opportunity:** The Jarble panel creates sessions (generates sessionKeys). The OpenClaw page shows server-side state (tokens used, active status). Together they give the full picture: Jarble manages session lifecycle, OpenClaw shows runtime stats.
- **Future:** Could add a "View in Control Panel" link from each conversation that deep-links to the OpenClaw Sessions page filtered to that session.

**Agent Teams (Jarble Bot Teams canvas + OpenClaw has nothing):**
- Agent Teams / Flow orchestration is 100% Jarble-specific. OpenClaw has no concept of cross-pod multi-agent flows.
- The flow canvas, delegation protocol (jarble_delegate / a2a_delegate), and flow execution engine are all Jarble code.
- The Control UI's Chat could be used for testing delegation behavior by chatting directly with the entry bot.
- **No overlap.** Keep Bot Teams entirely in Jarble UI.

**Cron Jobs (OpenClaw only):**
- OpenClaw's Cron Jobs page is the only UI for scheduled tasks. Jarble has this planned but not built.
- **Decision:** Use OpenClaw's cron system for per-pod scheduling. If Jarble needs platform-level scheduling (across deployments), build that separately.

**Config (OpenClaw Config page replaces old ConfigPanel):**
- OpenClaw Config page has schema-validated form + raw JSON editor. Far superior to the old ConfigPanel (model dropdown + system prompt textarea).
- Jarble's EssentialControls (start/stop/restart) stay in the header for quick access in both modes.
- **Decision:** Config editing lives entirely in the Control UI now. No need for Jarble-side config forms.

### Panels to KEEP in Jarble Workspace Mode

| Panel | Reason |
|-------|--------|
| Chat + Canvas | Core differentiator (22+ React components, streaming, typewriter) |
| SubagentsPanel | Write path for subagent DB records -> generates native agents |
| FilePanel | Full PVC filesystem (broader scope than OpenClaw Files tab) |
| KnowledgePanel | RAG document management (different system from OpenClaw files) |
| ConversationHistoryPanel | Client-side session management + conversation switching |
| Agent Teams tab | Flow orchestration (100% Jarble-specific) |
| EssentialControls | Quick lifecycle buttons in header |

### Panels/Features to USE via Control UI

| Feature | OpenClaw Panel |
|---------|---------------|
| Channel health (WhatsApp QR, Telegram, Discord) | Channels |
| Config editing (model, system prompt, all settings) | Config |
| Session stats (token counts, overrides) | Sessions |
| Cron job scheduling | Cron Jobs |
| Skills enable/disable | Skills |
| Native agent verification | Agents |
| Gateway health | Overview |
| Exec approvals | Nodes |

### Remaining Technical Issues

1. **Auto-confirm dialog** — polling approach deployed, needs live verification after next API redeploy
2. **Update Now button** — could destabilize pods. Consider hiding it via CSS injection in a future iteration.
3. **allowAgents config key** — was invalid in OpenClaw 2026.3.13/4.11. Already removed from the develop branch's native subagent implementation.
