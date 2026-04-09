# Bot Teams Rescue — Linear Tickets Draft

> **Why this file exists instead of Linear tickets**: Linear OAuth did not
> complete during the Bot Teams rescue session (2026-04-07). These tickets were
> drafted but never filed. File them manually or via the `create-ticket` skill
> when Linear auth is available.
>
> **Wave absorption status**: Waves 1-3delta shipped delegation feedback loop
> (Fix #6 below), session picker UX, stuck-deployment monitoring, and flow
> healing. The remaining child tickets (Fix #1 soul.md, Fix #2 MCP server,
> Fix #3 delegation-tools loader, Fix #4 delegation-tools.json write, Longhorn
> CSI on auto-workers, flow chat session read path) are still open and need to
> be filed in Linear.

Draft prepared before Phase 1 agent results arrive. Fill in plan details from
agent reports when they land, then create via `create-ticket` skill.

## Parent epic

**Title**: Bot Teams rescue — wire the full tool-injection pipeline
**Labels**: `infrastructure`, `feature`
**Priority**: High

### Scope
Agentic QA found that Bot Teams delegation is completely non-functional in
production. The API-side code runs, the canvas UI exists, and flows save
cleanly — but nothing below the API layer actually works:

- The `jarble-ui` MCP server is not registered with any running bot
- `delegation-tools.json` is never written (broken condition)
- Even if it were written, nothing on the pod reads it
- The entry bot receives delegation instructions as a user message, which
  Claude actively rejects as "user claiming to have a tool they don't"
- `soul.md` — the only authoritative channel to the bot — has zero references
  to delegation
- `chatViaExec` passes phantom CLI flags (`--thinking`, `--json`) that OpenClaw
  ignores
- Autoscaled Hetzner workers lack the Longhorn CSI driver, blocking any new
  deployment onto an auto-worker

Full audit: `docs/audits/qa-bot-teams-2026-04-07.md`

### Acceptance Criteria
- [ ] A deployment in a team can successfully delegate a task to a team member
- [ ] The team member's response is visible in the entry bot's chat
- [ ] The `jarble-ui` MCP server is registered and the bot can list its tools
- [ ] Stuck deployments `t2`, `dep-b30a0mdprxbd`, `dep-s2fds1k29cb6` are recovered
- [ ] Future autoscaled workers have the Longhorn CSI driver installed
- [ ] Silent delegation failures emit diagnostic SSE events (Fix #6 — already done)
- [ ] Regression tests cover the delegation-skip heuristic (already done)

---

## Child tickets

### JAR-XX — [done in this PR] Fix #6: surface silent delegation failures

**Status**: implemented in this PR, open ticket as completed
**Priority**: High
**Files**:
- `jarble-api-main/src/routes/flowChat.ts` — emit `jarble.flow.delegation.skipped` event + log warning
- `jarble-api-main/src/routes/tamboAgent.ts` — same for non-flow chat with team context
- `jarble-api-main/src/services/flowDelegation.test.ts` — 13 regression tests
- `Jarble-mvp/views/Deployments.tsx` — render amber warning banner when bot claims to delegate without emitting a tool call

### JAR-XX — Fix #2: register jarble-ui MCP server with the running bot

**Status**: blocked on mcp-server agent Phase 1 plan
**Priority**: Urgent (unblocks everything else MCP-related)
**Scope**:
- Find why the baked `/opt/jarble/mcp/jarble-ui-server.js` isn't being registered by mcporter
- Reconcile the baked vs configSync path mismatch (or delete the dead `syncMcpServerToAllRunning` writer)
- Verify: bot returns `render_ui` in its tools list
- Detailed plan: (fill in from agent report)

### JAR-XX — Fix #1: soul.md augmentation for flow context

**Status**: blocked on runtime-handler agent Phase 1 plan
**Priority**: Urgent
**Scope**:
- When a deployment is part of a flow (per `flow_deployment_memberships` join table), append a delegation section to soul.md
- Detect the team role, list team members, describe how delegation will work
- Update trigger chain: flow canvas edit → configSync → pod restart
- Detailed plan: (fill in from agent report)

### JAR-XX — Fix #4: write delegation-tools.json whenever deployment is in a flow

**Status**: blocked on runtime-handler agent Phase 1 plan
**Priority**: High
**Files**: `jarble-api-main/src/runtimes/handlers/openclaw.ts:516-538`
**Scope**:
- Current condition `deployment.teamMembers.length > 0` never fires in practice
- Switch to checking `flow_deployment_memberships` join table
- Detailed plan: (fill in from agent report)

### JAR-XX — Fix #3: wire delegation-tools loader in jarble-ui-server.js

**Status**: depends on JAR-XX (Fix #2) landing first
**Priority**: High
**Scope**:
- Add `loadDelegationTools()` function to `runtimes/openclaw/jarble-ui-server.js` that reads `/data/config/delegation-tools.json`
- Register each entry as an MCP tool
- Tool handler POSTs to new API endpoint `POST /api/pod/delegate` with `CONFIG_WEBHOOK_SECRET` auth
- New Express route in `jarble-api-main/src/routes/podDelegate.ts` that wraps `executeDelegation()`
- Hot-reload via `fs.watch` on the JSON file
- Detailed plan: (fill in from agent report)

### JAR-XX — Autoscaler: install Longhorn CSI on new workers

**Status**: blocked on k8s-pod-lifecycle-debugger + terraform-infra Phase 1 plans
**Priority**: High (blocks all new deployments onto auto-workers)
**Scope**:
- Root cause: `nodeManager.ts` cloud-init doesn't install Longhorn CSI prerequisites
- Either install in cloud-init OR add tolerations to Longhorn DaemonSet
- Recover stuck deployments: `t2` (vvscxl4e3grc), dep-b30a0mdprxbd, dep-s2fds1k29cb6
- Detailed plan: (fill in from agent reports)

### JAR-XX — Cleanup: remove phantom CLI flags from chatViaExec

**Status**: follow-up, needs live verification
**Priority**: Medium
**Files**: `jarble-api-main/src/services/openclawGateway.ts:593-600`
**Scope**:
- `--thinking medium` and `--json` are not valid OpenClaw 2026.3.13 flags
- Verify removal doesn't break JSON parsing at `openclawGateway.ts:623`
- If removal breaks it, either: leave as-is (unknown flags are no-ops) OR switch parsing logic to handle plain-text output

### JAR-XX — Follow-up: fix flow_chat_sessions read path (P1 from original audit)

**Status**: separate from delegation fix
**Priority**: High
**Scope**:
- Commit `62b2230` added persistence tables `flow_chat_sessions`, `flow_chat_messages`
- Only write path implemented — reload drops all history even though it's in Postgres
- Add `flows.getChatSessions` and `flows.getChatMessages` tRPC procedures
- Wire Deployments.tsx `flowChatMessages` state to initialize from the query

### JAR-XX — Follow-up: empty tRPC error validation UX

**Status**: nice-to-have
**Priority**: Low
**Files**: `jarble-api-main/src/trpc/routers/flows.ts:97-100`
**Scope**:
- `FlowDefinitionSchema` allows empty nodes array — intentional (frontend creates empty flows via `handleNewFlow`)
- Chat endpoint gracefully catches this with "Flow has no nodes" at `flowChat.ts:219-224`
- Consider adding a "draft vs ready" distinction so users can't chat with an incomplete flow

### JAR-XX — Follow-up: t2 Longhorn CSI recovery needs monitoring

**Status**: ops
**Priority**: Medium
**Scope**:
- 3 pods stuck for 45+ min with no alert
- Add monitoring on `status: creating` duration — anything over 5 min should page ops
- Add monitoring on `FailedAttachVolume` events in the jarble namespace

---

## QA findings — 2026-04-07 Bot Teams retest (qa-explorer-ui agent)

The following 4 tickets were found and filed in the same session. Each is cross-referenced with the parallel agent that is actively fixing it.

### JAR-XX — P2: Session picker row missing message-count badge

**Status**: open (being fixed in parallel by agent `fix-session-picker-badge`)
**Priority**: P2
**Labels**: `bug`, `bot-teams`

#### Scope
`Jarble-mvp/views/Deployments.tsx` — the session picker row renders each session's `lastActivity` timestamp and label, but never renders the `messageCount` field that Wave 3 delta added to the backend response. The badge column is absent from the row JSX.

#### Context
Wave 3 delta (`62b2230`) added `messageCount` to the `flow_chat_sessions` backend response and the `ChatSession` TypeScript type. The frontend was not updated to display it. Every session therefore shows no indication of how active it is, making it impossible for a coordinator to pick the right specialist session at a glance.

#### Acceptance Criteria
- [ ] Each session picker row displays a badge showing the message count (e.g., "14 msgs")
- [ ] The badge renders 0 correctly without crashing
- [ ] The badge is visually distinct from the timestamp (different color or weight)
- [ ] Existing session picker snapshot tests pass or are updated

#### References
- `Jarble-mvp/views/Deployments.tsx` — session picker row component
- `jarble-api-main/src/trpc/routers/flows.ts` — `listChatSessions` procedure (returns `messageCount`)
- Parallel fix agent: `fix-session-picker-badge`

#### Dependencies
- None (self-contained frontend change)

---

### JAR-XX — P3: Casual delegation prompts bypass specialist routing

**Status**: open (being fixed in parallel by agent `fix-bot-teams-prompts`)
**Priority**: P3
**Labels**: `bug`, `bot-teams`

#### Scope
`jarble-api-main/src/routes/flowChat.ts` — the coordinator delegation heuristic only triggers when the user uses strong language ("MUST delegate", "YOU MUST"). Casual prompts such as "have your specialist handle this" cause the coordinator to answer directly, silently skipping delegation.

#### Context
The delegation skip heuristic was introduced in Wave 3 to avoid unnecessary round-trips. It over-fires: it treats any user message without explicit "MUST" wording as a direct-answer candidate, regardless of the coordinator's role. This breaks the core Bot Teams contract for users who phrase requests naturally.

#### Acceptance Criteria
- [ ] Coordinator routes to a specialist when the user says "have your specialist handle X" (no "MUST" required)
- [ ] Coordinator only answers directly when the task is clearly within its own scope (no specialist needed)
- [ ] The delegation skip heuristic is narrowed to apply only when the user's topic matches the coordinator's own knowledge domain
- [ ] A regression test covers the "casual delegation prompt" case

#### References
- `jarble-api-main/src/routes/flowChat.ts` — coordinator prompt and delegation heuristic
- `jarble-api-main/src/services/flowDelegation.test.ts` — existing regression tests
- Parallel fix agent: `fix-bot-teams-prompts`

#### Dependencies
- None (prompt engineering change in flowChat.ts)

---

### JAR-XX — P3: Coordinator wrap-up falsely claims specialist response was truncated

**Status**: open (being fixed in parallel by agent `fix-bot-teams-prompts`)
**Priority**: P3
**Labels**: `bug`, `bot-teams`

#### Scope
`jarble-api-main/src/routes/flowChat.ts` — after a successful delegation round-trip, the coordinator's wrap-up message includes the phrase "the result was truncated" even when the specialist returned a complete, untruncated response.

#### Context
The re-summarization template in `flowChat.ts` was written to handle the case where the specialist response exceeds a token limit. The truncation phrase is emitted unconditionally from the template rather than conditionally based on whether the response was actually cut. Users see this as a hallucination and lose trust in the coordinator's accuracy.

#### Acceptance Criteria
- [ ] The wrap-up message omits any mention of truncation when the specialist response was not truncated
- [ ] When the specialist response IS truncated (over the limit), the wrap-up correctly says so
- [ ] A regression test distinguishes the two cases

#### References
- `jarble-api-main/src/routes/flowChat.ts` — re-summarization template
- Parallel fix agent: `fix-bot-teams-prompts`

#### Dependencies
- Shares the same file as JAR-XX (casual delegation fix above) — coordinate to avoid merge conflicts

---

### JAR-XX — P3: Tool name inconsistency between docs and runtime

**Status**: open (being fixed in parallel by agent `fix-bot-teams-prompts`)
**Priority**: P3
**Labels**: `bug`, `bot-teams`, `docs`

#### Scope
Two places describe the delegation tool name differently:

- Docs and internal comments say `jarble_delegate` (generic, single tool)
- The runtime (`jarble-ui-server.js`) registers per-specialist tools as `delegate_to_<name>` (one tool per team member)

This inconsistency causes confusion when reading logs, writing tests, or writing the coordinator system prompt, because neither name matches what developers expect to see.

#### Context
Per-specialist tool naming (`delegate_to_<name>`) was chosen so the coordinator LLM can see explicit targets in its tool list rather than having to pass a `target` argument. The generic name `jarble_delegate` was used in earlier design docs and was never updated. Both names appear in different places in the codebase and docs, creating drift.

#### Acceptance Criteria
- [ ] A single canonical tool-name convention is chosen and documented in `CLAUDE.md` under the Bot Teams / Flow section
- [ ] All references in docs, comments, and the coordinator system prompt use the canonical name
- [ ] The MCP server registration in `jarble-ui-server.js` matches the canonical name
- [ ] A note in `docs/audits/bot-teams-rescue-tickets-draft.md` records the decision

#### References
- `runtimes/openclaw/jarble-ui-server.js` — per-specialist tool registration
- `jarble-api-main/src/routes/flowChat.ts` — coordinator system prompt mentions tool name
- `CLAUDE.md` — any existing mention of `jarble_delegate`
- Parallel fix agent: `fix-bot-teams-prompts`

#### Dependencies
- Should land after the casual delegation fix (same file) to avoid conflicts
