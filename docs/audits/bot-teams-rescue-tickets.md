# Bot Teams Rescue — Linear Tickets (ready to create)

Created 2026-04-07 as Phase 2B of the Bot Teams rescue mission. If the
Linear MCP OAuth flow has been completed, paste each section into a new
Linear ticket OR I'll create them via the API directly. Otherwise, run
each section through `/create-ticket` or paste manually.

**Team key**: `JAR`
**Source audit**: `docs/audits/qa-bot-teams-2026-04-07.md`
**Branch**: `develop` (commits already landing as the work progresses)
**Foundation commit**: `e44e059` — QA: Bot Teams agentic audit + Fix #6 + Workstream A CSI

---

## EPIC — Bot Teams rescue: wire the full tool-injection pipeline

**Title**: `Bot Teams rescue — wire the full tool-injection pipeline`
**Labels**: `infrastructure`, `feature`, `bug`
**Priority**: High
**Estimate**: 16-20 hours

### Scope

Agentic QA found that Bot Teams is broken end-to-end at every layer below
the API CRUD surface. Flows save, the canvas works, the API responds, but
**no delegation has ever actually run** in production. Four parallel
investigation agents (jarble-api-debugger, runtime-handler, mcp-server,
openclaw-diagnostics) ultrathink-investigated and produced a coordinated
fix plan documented in `docs/audits/qa-bot-teams-2026-04-07.md`.

### Headline findings

1. **`flow_deployment_memberships` is empty in production** — 29 flows, 0 rows. Silent try/catch was masking the failure for who-knows-how-long.
2. **OpenClaw has NO first-class MCP server support** — verified directly on the pod. The dist explicitly logs `"ignoring ${params.mcpServers.length} MCP servers"`. The `mcporter config add jarble-ui` command runs and writes a JSON file but no process consults it.
3. **`render_ui` works through a different path** — `canvasFiles.ts:218-231` exec node-e from the API directly into the pod. The bot is never involved. Across 15 session JSONL files, `grep -c tool_use` = 0 — the bot has never called any tool in its lifetime.
4. **`delegation-tools.json` writer is dead code** — broken condition AND dead consumer AND statically hardcoded `AGENT_TOOLS`. Three layers of dead-on-arrival.
5. **Bots actively reject `[FLOW CONTEXT]` in user turns** — Claude correctly pattern-matches "user claiming tools they don't have" and refuses. No prompt engineering will save the current approach.
6. **`tamboAgent.ts` has the same bug** — solo chat works only because users aren't using team context.
7. **Longhorn CSI gap on auto-workers** — `nodeManager.ts` taints with `jarble.ai/workload=agent:NoSchedule`, Longhorn DaemonSets don't tolerate it, CSINode never gets the driver, FailedAttachVolume blocks every new bot on auto-workers.
8. **Migration `0007_lyrical_callisto.sql` (`flow_chat_sessions`/`flow_chat_messages`) was never applied to production.**

### Acceptance criteria

- [ ] Delegation actually runs end-to-end on dev. A bot in a team can be told "delegate this to the Specialist" and the specialist actually responds.
- [ ] `jarble.flow.delegation.start` and `jarble.flow.delegation.end` SSE events fire on the live chat stream.
- [ ] When delegation silently fails, `jarble.flow.delegation.skipped` event fires with a reason code (✓ done in Fix #6).
- [ ] `flow_deployment_memberships` has rows for every flow that has team members.
- [ ] All 3 stuck pods (`vvscxl4e3grc/t2`, `dep-b30a0mdprxbd`, `dep-s2fds1k29cb6`) are recovered.
- [ ] Future autoscaled workers have the Longhorn CSI driver registered automatically.
- [ ] `jarble-ui-server.js` write loop (file-watcher.sh spam) is fixed.
- [ ] Migration 0007 is applied to production Neon DB.
- [ ] No regressions in solo (non-team) bot chat.

### Children
- JAR-?? (this list — link the children below)

---

## Child #1 — DONE: Fix #6 — surface silent delegation failures

**Title**: `Surface silent delegation failures with jarble.flow.delegation.skipped event (Fix #6)`
**Labels**: `bug`, `improvement`
**Priority**: High
**Status**: DONE — committed in `e44e059`
**Estimate**: 1 hour (actual)

### Scope

When the entry bot in a Bot Team responds without emitting a valid tool_call
JSON block, the prior code silently fell through to "direct answer" mode.
Users would see the bot say *"I delegated this to the Specialist, I'll share
their answer momentarily"* and then nothing — no specialist run, no error,
just a hung conversation.

### What changed

1. **`jarble-api-main/src/routes/flowChat.ts`** — added a 50-line else branch that emits a `jarble.flow.delegation.skipped` SSE event with one of three reason codes (`no_tools_available`, `tool_call_not_emitted`, `mentioned_but_not_emitted`) + `log.warn` for the silent-failure case
2. **`jarble-api-main/src/routes/tamboAgent.ts`** — same fix for the team-context branch in the regular chat path (line ~1193)
3. **`Jarble-mvp/views/Deployments.tsx`** — added the SSE handler and an amber warning banner that surfaces "Delegation didn't actually run. The entry bot claimed to delegate but never emitted a valid tool call."
4. **`jarble-api-main/src/services/flowDelegation.test.ts`** — 13 new regression tests (parseDelegationCalls strict behavior + skipReason heuristic). All passing.

### Verification

- API typecheck: clean
- Vitest: 13/13 tests pass
- Frontend type check: blocked on pre-existing API build:types errors (unrelated)

### Files
- `jarble-api-main/src/routes/flowChat.ts` (+53 -2)
- `jarble-api-main/src/routes/tamboAgent.ts` (+33 -1)
- `jarble-api-main/src/services/flowDelegation.test.ts` (NEW, 156 lines)
- `Jarble-mvp/views/Deployments.tsx` (+39 -0)

---

## Child #2 — Workstream A — Permanent Longhorn CSI fix (Terraform)

**Title**: `Patch Longhorn DaemonSets to tolerate jarble auto-worker taint (Terraform + live hotfix)`
**Labels**: `infrastructure`, `bug`
**Priority**: Urgent
**Status**: code committed in `e44e059`, live hotfix in flight
**Estimate**: 30 min (actual)

### Scope

Autoscaled Hetzner workers can't mount Longhorn volumes. Three pods are
currently stuck with `FailedAttachVolume`. Root cause: `nodeManager.ts`
taints workers with `jarble.ai/workload=agent:NoSchedule`, and Longhorn
v1.6.0 DaemonSets only tolerate built-in noisy-node taints. So Longhorn
never schedules onto auto-workers, CSINode never gets `driver.longhorn.io`,
PVC mounts fail.

### What changed

1. **`infrastructure/terraform/main.tf:196`** — added a 13-line block between the storageclass patch and cert-manager install that waits for the Longhorn DaemonSets to exist, then `kubectl patch` adds the toleration `{key: "jarble.ai/workload", value: "agent", effect: "NoSchedule"}` to both `longhorn-manager` and `longhorn-csi-plugin`.
2. **Live cluster hotfix** — same `kubectl patch` commands run via SSH to master. Zero-downtime, reversible. Once patched, Longhorn pods scheduled onto stuck workers within ~30 sec. Stuck bot pods deleted to force reattach via the controller.

### Verification

- `kubectl get csinodes <jarble-auto-NAME> -o yaml | grep longhorn` — should now show `driver.longhorn.io`
- `kubectl -n jarble get pods` — t2 + 2 other stuck pods should be Running
- Future: provision a new auto-worker via `nodeManager.ts`, verify Longhorn pods land on it

### Files
- `infrastructure/terraform/main.tf` (+13 lines)

### Plan
- `docs/audits/autoscaler-csi-fix-plan.md`

---

## Child #3 — Workstream B — soul.md augmentation + teamContext + sync trigger chain

**Title**: `Inject team context into soul.md + wire syncConfigsToPvc trigger from flow mutations`
**Labels**: `feature`, `bug`
**Priority**: Urgent
**Status**: in flight (runtime-handler agent in worktree)
**Estimate**: 8 hours

### Scope

Bots in a Bot Team have NO awareness they're in a team. Their `soul.md`
(the only Jarble-authored artifact that actually reaches the running pod
and is treated as authoritative) doesn't mention team members, delegation
tools, or `delegate_to_*` anywhere. The current attempt to inject team
context via a `[FLOW CONTEXT]` user-turn prefix is actively rejected by
Claude as "user claiming tools they don't have" — verified by live probe.

The fix is to put the team context into soul.md itself, regenerate soul.md
when a flow is edited, and propagate the new soul.md to the pod via
`syncConfigsToPvc` (which is currently never called from any flow router).

### What changes

1. **`jarble-api-main/src/runtimes/types.ts`** — extend `DeploymentFields` with a new `teamContext` field: `{ flowId, flowName, selfRole, isEntryPoint, teammates: Array<{ slug, role, name, deploymentId }> }`. Keep `teamMembers` as a deprecated back-compat shim for one commit.
2. **`jarble-api-main/src/services/configSync.ts:~298-365`** — replace the existing membership-fetch block to populate `teamContext`. Pull from `flow_deployment_memberships` join table, then fetch the flow row, then fetch all other deployments in the same flow.
3. **`jarble-api-main/src/runtimes/handlers/openclaw.ts`**:
   - DELETE the in-Agent-Pool "Team Members" block at lines 266-275 (it was nested under the wrong section and ineffective anyway)
   - DELETE the dead `delegation-tools.json` writer at lines 516-538 (broken condition, no consumer, three layers of dead code)
   - DELETE the `delegation-tools.json` entry from the `configFiles` spec at line ~182
   - INSERT a new top-level `## Team Context` section at line ~236, gated on `deployment.teamContext` being defined. Wrapped in HTML-comment delimiters `<!-- BEGIN JARBLE_FLOW_CONTEXT v1 -->` / `<!-- END JARBLE_FLOW_CONTEXT v1 -->` for clean removal when the deployment leaves a flow. Authoritative tone. Lists teammates by slug+role+name. Teaches the `jarble_delegate` fenced-block format with a one-shot example. Hard rule: "Never claim you delegated unless you actually emitted a `jarble_delegate` block in this response."
4. **`jarble-api-main/src/trpc/routers/flows.ts`** — wire `syncConfigsToPvc` into `create`, `update`, `delete`, `duplicate` mutations. CRITICAL: snapshot OLD memberships BEFORE `syncFlowMemberships` runs so leaving bots also get re-synced. Compute union of OLD ∪ NEW deployment IDs → fire-and-forget `void syncConfigsToPvc(deploymentId)` for each. Upgrade the silent `logger.warn` catch in `syncFlowMemberships` to `logger.error` with the full deployment ID list so we can finally diagnose the production-empty-table issue.
5. **Investigate the empty-table root cause** — likely FK failures on stale deployment IDs in flow definitions (production data corruption). Document the hypothesis. Fix the silent catch, retry, see what errors land in logs, then write a follow-up backfill ticket if needed.

### Verification

- API typecheck clean
- New unit test for `buildDeploymentFields` teamContext population
- New unit test for the openclaw.ts soul.md augmentation rendering
- Manual: edit a flow on dev, verify `soul.md` on the pod gets updated within ~5 sec
- Manual: chat with a bot in a flow, verify the bot acknowledges its team in its first response

### Files
- `jarble-api-main/src/runtimes/types.ts`
- `jarble-api-main/src/services/configSync.ts` (lines ~298-365)
- `jarble-api-main/src/runtimes/handlers/openclaw.ts`
- `jarble-api-main/src/trpc/routers/flows.ts`

### Plan
- `docs/audits/bot-teams-fix1-plan.md`

### Pod restart not required
Verified via OpenClaw 2026.2.25 dist (`workspace-jH04VzX-.js:421-441`):
`readFileWithCache` is mtime-aware → re-reads soul.md from disk on change.
NEW conversations after a flow edit see the updated context automatically.
Ongoing conversations see cached context until next message turn (acceptable).

---

## Child #4 — Workstream C — `jarble_delegate` parser + MCP gaslighting cleanup

**Title**: `Replace JSON delegation format with jarble_delegate fenced block + delete dead mcporter wiring`
**Labels**: `bug`, `cleanup`
**Priority**: Urgent
**Status**: in flight (mcp-server agent in worktree)
**Estimate**: 4-5 hours

### Scope

The current delegation parser at `flowDelegation.ts:165-193` requires the
LLM to emit a strict ` ```json { "tool": "delegate_to_X", ... } ``` ` block.
Claude rarely complies because the instructions are buried in a user turn
(see Workstream B for the soul.md fix). The parser also has no fallback
and no retry, so silent skips happen constantly.

Separately, the entire `mcporter config add jarble-ui` scaffolding is dead
code: OpenClaw doesn't support user-configured MCP servers, the entrypoint
runs the command for nothing, and `file-watcher.sh` rewrites `jarble-ui-server.js`
in a recurring loop because `syncMcpServerToAllRunning` is on a 5-min schedule.
None of it produces any benefit.

### What changes

1. **`jarble-api-main/src/services/flowDelegation.ts:165-193`** — rewrite `parseDelegationCalls` to parse ` ```jarble_delegate ... ``` ` blocks. Format: `{ "to": "specialist_slug", "task": "...", "context": "..." }`. The parser converts `to` → `toolName` (prefix `delegate_to_`) so downstream code is unchanged. Keep the legacy ` ```json ``` ` parser as a deprecated fallback during rollout.
2. **`jarble-api-main/src/services/flowDelegation.ts:116-149`** — rewrite `buildFlowSystemPrompt` to instruct the bot to use the `jarble_delegate` format with a one-shot example and the same hard rule from Workstream B.
3. **`jarble-api-main/src/routes/flowChat.ts:370-373`** — change the prefix from `[FLOW CONTEXT]` to `[FLOW SYSTEM INSTRUCTIONS — AUTHORITATIVE]`. Band-aid until B1b lands a real system-prompt channel.
4. **`jarble-api-main/src/services/configSync.ts:55-86`** — DELETE the entire `reRegisterMcpServer` function (it's a no-op against OpenClaw which has no MCP server support). Find and delete its call sites at lines 621-623 and 1184-1185. Add a top-of-file comment explaining the canvasFiles proxy is the actual route.
5. **`jarble-api-main/src/services/statusReconciler.ts:230-239`** — bump `mcpSyncIntervalMs` from 5 minutes to 15 minutes. Add a top-level hash gate so the per-pod loop is skipped entirely when the API hash hasn't changed since last sync.
6. **`runtimes/openclaw/entrypoint.sh:37-46, 166-179`** — DELETE the `JARBLE_MCP_PVC` vs `JARBLE_MCP_BAKED` selection. DELETE the `mcporter config add jarble-ui` command. Replace with a comment block explaining the canvasFiles proxy path (`POST /api/deployments/:id/mcp/invoke` → kubectl exec → node -e require...).
7. **`runtimes/openclaw/file-watcher.sh:31`** — add `/data/config/mcp/` and `.version` to the inotifywait `--exclude` regex to stop the recurring write loop.

### Verification

- API typecheck clean
- New tests in `flowDelegation.test.ts` covering `jarble_delegate` parser (single block, broadcast, missing fields, legacy fallback)
- Manual: tail logs on a pod for 1 minute — should be ZERO `MODIFY /data/config/mcp/jarble-ui-server.js` events
- Manual: send a chat to a flow bot, verify delegation now actually fires (specialist runs, response comes back, synthesis happens)

### Files
- `jarble-api-main/src/services/flowDelegation.ts`
- `jarble-api-main/src/services/configSync.ts` (lines 55-86, 621-623, 1184-1185)
- `jarble-api-main/src/services/statusReconciler.ts` (lines 230-239)
- `jarble-api-main/src/routes/flowChat.ts` (lines 370-373 only — Fix #6 stays untouched)
- `runtimes/openclaw/entrypoint.sh`
- `runtimes/openclaw/file-watcher.sh`

### Plan
- `C:\Users\brett\AppData\Local\Temp\qa-teams\mcp-fix-plan.md`

---

## Child #5 — Apply migration 0007 to production Neon

**Title**: `Apply flow_chat_sessions / flow_chat_messages migration to production`
**Labels**: `infrastructure`, `bug`
**Priority**: High
**Estimate**: 30 min

### Scope

Migration `0007_lyrical_callisto.sql` (commit `62b2230`) creates the
`flow_chat_sessions` and `flow_chat_messages` tables. runtime-handler
verified directly via Neon: **the migration has not been applied to
production.** So the persistence write path that ships in commit `62b2230`
is currently failing on every team chat against prod (silently — caught by
the fire-and-forget try/catch).

### What to do

1. Get the prod Neon connection string from Kubero env vars
2. Run `npm run db:push` against the prod connection
3. Verify the tables exist via `psql` or Drizzle Studio
4. Test on dev first (the dev DB might also be missing this migration — verify)
5. Spot-check that team chat messages start landing in `flow_chat_messages`
6. Document the prod migration procedure in `docs/RUNBOOK.md` since this gap exists

### Acceptance criteria
- [ ] Both tables exist in production
- [ ] Both tables exist in dev
- [ ] A team chat session writes a row to `flow_chat_sessions` and N rows to `flow_chat_messages`
- [ ] Procedure documented in RUNBOOK.md

### Risk
- **Additive migration** — only creates new tables, no risk of data loss
- **No code changes needed** — write path already exists in `flowChat.ts:680-748`

---

## Child #6 — Add tRPC read path for flow_chat_sessions / flow_chat_messages

**Title**: `Add flows.getChatSessions and flows.getChatMessages tRPC procedures`
**Labels**: `bug`, `feature`
**Priority**: High
**Estimate**: 2 hours
**Blocked by**: Child #5 (migration must be applied first)

### Scope

The persistence tables get written to but there's no tRPC procedure to read
them back. Frontend `Deployments.tsx:flowChatMessages` is currently a local
useState — reload drops everything even though it's in Postgres.

### What to do

1. Add `flows.getChatSessions(flowId)` tRPC procedure — list sessions ordered by `updatedAt` desc, with ownership check
2. Add `flows.getChatMessages(sessionId)` tRPC procedure — fetch messages ordered by `createdAt` asc, with ownership check via join on `flow_chat_sessions.userId`
3. Wire the frontend `flowChatMessages` state to initialize from a tRPC query when a flow is opened
4. Write Vitest coverage for both procedures (auth enforcement, ownership, ordering)

---

## Child #7 — Add `.github/workflows/deploy-runtimes.yml`

**Title**: `Add missing runtime image build CI workflow`
**Labels**: `infrastructure`
**Priority**: Medium
**Estimate**: 1 hour

### Scope

`CLAUDE.md` references `.github/workflows/deploy-runtimes.yml` as part of
the CI/CD setup, but the file doesn't exist. Runtime images
(`ghcr.io/jarble-ai/openclaw:latest`) are presumably built manually. Before
Workstream C ships changes to `runtimes/openclaw/entrypoint.sh` and
`file-watcher.sh`, the runtime image needs to be rebuildable in CI.

### What to do

1. Create `.github/workflows/deploy-runtimes.yml` matching the pattern of `deploy-api.yml` and `deploy-frontend.yml`
2. Trigger on pushes to main that touch `runtimes/openclaw/**` or `runtimes/zeroclaw/**`
3. Build + push to GHCR, tag `:latest` and `:sha-XXX`
4. Before docker build, copy `jarble-api-main/src/mcp/jarble-ui-server.js` to `runtimes/openclaw/jarble-ui-server.js` so the runtime image picks up the canonical copy
5. Delete the stale baked `runtimes/openclaw/jarble-ui-server.js` from the repo (it's ~56 KB, way out of date vs the 330 KB canonical)
6. Document the rebuild procedure in CONTRIBUTING.md

---

## Child #8 — Production data cleanup: stale deployment IDs in flow definitions

**Title**: `Audit and clean stale deployment IDs in flow definitions`
**Labels**: `bug`, `infrastructure`
**Priority**: Medium
**Estimate**: 1-2 hours

### Scope

runtime-handler found via direct Neon query that several flow definitions
contain references to deployment IDs that don't exist in the `deployments`
table: `lnhat9nut3ek`, `8vtgevemz6ft`, `ifvqafgds4qd`, `b24qltf1zoo1`, and
others. These are likely cascade-deleted or never persisted. They prevent
`syncFlowMemberships` from inserting rows into `flow_deployment_memberships`
because of FK constraints.

### What to do

1. Write a one-off script that scans all `orchestration_flows` rows, parses the JSON `definition`, and lists every deployment ID referenced
2. Cross-check against the live `deployments` table
3. For each stale reference: update the flow definition to remove the broken node OR mark the flow as `archived` so the user can see it failed
4. Add a foreign key constraint on `flow_deployment_memberships.deployment_id` referencing `deployments.id` ON DELETE CASCADE if not already present
5. Add a runtime validation in `flows.create` and `flows.update` that rejects nodes with non-existent `deploymentId`
6. Notify affected users (or just let the canvas show "deployment not found" — UX call)

---

## Child #9 — Investigate `flow_deployment_memberships` empty-table root cause

**Title**: `Diagnose why syncFlowMemberships silently fails in production`
**Labels**: `bug`
**Priority**: High
**Estimate**: 1 hour
**Blocked by**: Child #3 (Workstream B upgrades the silent catch to logged error first)

### Scope

After Workstream B lands, the `logger.error` upgrade in `syncFlowMemberships`
should produce diagnostic output. Watch the logs for one full day, identify
the actual error pattern, and write the followup fix.

Expected: FK errors on stale deployment IDs (see Child #8). But could also be:
- Drizzle ORM type mismatch on insert
- Transaction conflict
- Schema drift between dev and prod

### Acceptance criteria
- [ ] Root cause identified with log evidence
- [ ] Fix landed
- [ ] `flow_deployment_memberships` has rows for all valid flows in prod within 24 hours of fix

---

## Child #10 — Investigate proper `--system-prompt` channel for `chatViaExec` (B1b)

**Title**: `Add real system prompt channel to chatViaExec instead of user-turn injection`
**Labels**: `feature`, `improvement`
**Priority**: Medium
**Estimate**: 3 hours
**Blocked by**: Workstream C (band-aid lands first)

### Scope

Workstream C ships a band-aid: prefix the augmented prompt with
`[FLOW SYSTEM INSTRUCTIONS — AUTHORITATIVE]` so the bot treats it more
seriously. The proper fix is to extend OpenClaw's `agent` CLI (or use the
`/v1/chat/completions` endpoint with `role: "system"`) so the augmented
prompt goes through a real system channel.

### What to investigate

1. Does `openclaw agent` support `--system-prompt` or stdin-system in any version newer than 2026.2.25? Check `npm pack openclaw@latest`
2. Does the gateway's `/v1/chat/completions` endpoint at port 18789 honor `messages[0].role: "system"` end-to-end? (Live probe showed it parses the field but the persona dominates — investigate WHY)
3. Could we write a transient `soul.override.md` to `/data/config/` that OpenClaw merges with the base soul.md? Check `readFileWithCache` for any include directive support
4. Worst case: fork OpenClaw or upstream a PR adding `--system-prompt`

### Acceptance criteria
- [ ] System prompt augmentation is authoritative — bot reliably emits `jarble_delegate` blocks when instructed (verified via probe)
- [ ] No more `mentioned_but_not_emitted` events in logs over a 24h window after deploy

---

## Child #11 — Stuck deployment monitoring + alerting

**Title**: `Add monitoring for deployments stuck in 'creating' status > 5 min`
**Labels**: `infrastructure`, `improvement`
**Priority**: Medium
**Estimate**: 1 hour

### Scope

Three pods were stuck in `creating` for 45+ minutes during this audit with
no alert to ops. Add monitoring on:
1. Deployment `status: creating` duration (alert at 5 min)
2. `FailedAttachVolume` events in the `jarble` namespace
3. `FailedMount` events in the `jarble` namespace

### What to do
- Add Sentry alert rules for the FailedAttach/FailedMount events
- Add a dashboard panel in Grafana (if available) for stuck-deployments-by-duration
- Or: cron a check that pages on Slack/PagerDuty when threshold is breached
- Document in `docs/RUNBOOK.md`
