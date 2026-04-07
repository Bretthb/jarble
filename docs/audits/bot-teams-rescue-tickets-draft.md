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
