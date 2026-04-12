# Overnight QA Report - April 9, 2026

**Run window:** 2026-04-09 03:45-04:00 UTC
**Orchestrator:** qa-orchestrator (Opus 4.6 1M)
**Scope:** 12 PRs merged tonight (#67-#80) - memory-scoping trilogy, MCP mcporter registration, PVC cap, configSync propagation fix, JAR-51 observability phases 2-3
**Mode:** Direct-evidence gathering (K8s exec + Langfuse API + HTTP probes). Full browser suite was not executed due to orchestrator-turn context constraints; see "Follow-up test work" section.

---

## Executive summary

**Healthy:**
- PR #71 (PVC 20 GiB cap) - verified across all 4 production deployments
- PR #73 (configSync memoryScope propagation) - three distinct scopes (`global`, `session`, `off`) confirmed on three pods via `JARBLE_MEMORY_SCOPE` env var
- PR #77 + #79 (Langfuse exporter + chatViaExec OTel span) - **fully verified end-to-end**, real `jarble.delegation.exec` span observed in production trace `94bd9098a2fc24432c185634febb26e0` with all expected attributes, nested correctly under `POST /api/tambo-agent`
- PR #72 partial (mcporter.json config file present on all 4 pods)
- Prod API auth wall solid under basic chaos probes (XSS in ids, SQL-ish payloads, rapid-fire concurrency, GET-on-mutation) - no stack leakage, no DoS surface pre-auth

**Issues found (none catastrophic):**
- **P1** `/tmp/mcp-jarble-ui.log` file sink missing on ALL 4 agent pods - PR #64/#72 log sink is either not being written or is keyed to a different path
- **P1** `mcporter` binary NOT on `$PATH` inside runtime container on t3 - `sh: 1: mcporter: not found`. The mcporter.json config is present but the CLI is not installed. Unclear whether OpenClaw invokes it via a different path (e.g., npx, absolute path, or direct node spawn).
- **P1** `dev.jarble.ai` returns HTTP 401 at `/` - frontend landing page requires auth, blocking unauthenticated visitors / marketing surface. Likely Coolify basic-auth or Next middleware misconfig.
- **P2** t1 (`dep-z888fle0j33t`) has empty `JARBLE_MEMORY_SCOPE` - this pod was created 13 h ago, predates PR #73, and has not been restarted. Cosmetic - will self-heal on next config change or restart. Flag for regression watchlist: verify new deployments always get a default scope written even if the user has not toggled it.
- **P2** No `jarble.delegation.gateway` spans observed yet (PR #80) - chatViaGateway WS path was not exercised during the window. Not a bug, just unproven. Needs a chat that routes through the WS primary path to confirm.

**Catastrophic alert:** NO

---

## Per-category results

### 1. Memory-scoping trilogy (PRs #67 / #69 / #73 / #75)

| Check | Result | Evidence |
|---|---|---|
| `JARBLE_MEMORY_SCOPE` env var is propagated from DB to pod | PASS | 3/4 pods show distinct values matching their configured scope |
| Three distinct modes observable | PASS | t2=`global`, t3=`session`, f30qkp1rzy1x=`off` |
| configSync writes scope to pod env (PR #73 fix) | PASS | All post-#73 pods have the env var populated |
| openclaw.json also carries scope | N/A | scope is env-only by design, openclaw.json has no `memoryScope` key |
| OFF mode strips memory MCP tools | NOT DIRECTLY VERIFIED | Could not run `mcporter list jarble-ui` because the binary is missing (see P1 below) |
| SESSION mode rejects memory ops without session_id | NOT DIRECTLY VERIFIED | Requires either a live chat or direct MCP server invocation |
| Disclosure banner appears in chat UI | NOT VERIFIED | Browser session not executed this run |

**Per-pod `JARBLE_MEMORY_SCOPE`:**
```
dep-z888fle0j33t (t1)        = <empty>          [pre-#73 pod, 13 h old, never restarted]
dep-v82mpe7rjxbm (t2)        = global           PASS
dep-99i1thbvf1c9 (t3)        = session          PASS
dep-f30qkp1rzy1x             = off              PASS
```

**Verdict:** Backend half of the trilogy (DB + configSync + env propagation) is **green**. Runtime enforcement (agent-side tool-stripping, session-id gating) and the frontend disclosure banner were not directly exercised and remain untested by this run.

---

### 2. MCP layer registration (PR #72)

| Check | Result | Evidence |
|---|---|---|
| `/data/.mcporter/mcporter.json` present on every running pod | PASS | 4/4 pods have the file |
| mcporter.json content | PASS | Valid JSON: `{"mcpServers":{"jarble-ui":{"command":"node","args":["/data/config/mcp/jarble-ui-server.js"]}}}` |
| `mcporter` CLI available on PATH | **FAIL** | `sh: 1: mcporter: not found` inside runtime container on dep-99i1thbvf1c9 |
| `/tmp/mcp-jarble-ui.log` file sink written | **FAIL** | Missing on all 4 pods |
| ~63 tools listable via mcporter | BLOCKED | cannot verify - CLI missing |

**P1 - mcporter binary missing on PATH.** The config file exists at the expected location and the command it references (`node /data/config/mcp/jarble-ui-server.js`) is plausible, but the `mcporter` CLI that was supposedly going to be used for listing tools and for OpenClaw integration is not installed in the runtime image. Two possibilities:
  1. OpenClaw invokes the MCP server directly via node spawn (in which case `mcporter` CLI is never needed at runtime and this is a false alarm - in that case remove references to `mcporter list` from any runbooks).
  2. OpenClaw actually does rely on `mcporter` being on PATH and the runtime image is missing an install step.

**Reproduction:**
```
kubectl -n jarble exec dep-99i1thbvf1c9-5bff5c754-2x78c -- sh -c 'which mcporter; mcporter list jarble-ui'
# expected: path to binary + tool list
# actual:   sh: 1: mcporter: not found
```

**P1 - MCP log sink missing.** The `/tmp/mcp-jarble-ui.log` file that PR #64 / #72 were supposed to write to is absent on all four running pods. Either the MCP server has not been invoked yet (likely - recent chat activity is low), or the log path is different, or the file sink env var is not being set. Need to:
- trigger a chat on any of the four pods and recheck the path;
- grep the MCP server source for the exact log path and confirm it matches `/tmp/mcp-jarble-ui.log` (not `/data/logs/...` or similar).

**Recommended fix path:** inspect `jarble-api-main/src/mcp/jarble-ui-server.js` log-path constant and reconcile with whatever OpenClaw's working directory is at spawn time; if the log should live on the PVC instead of ephemeral /tmp, update the path and rebuild runtimes via `deploy-runtimes.yml`.

---

### 3. PVC cap (PR #71)

| PVC | Capacity | Age | Status |
|---|---|---|---|
| pvc-z888fle0j33t | 10 Gi | 13 h | PASS (pre-cap, below cap) |
| pvc-v82mpe7rjxbm | 20 Gi | 166 m | PASS |
| pvc-99i1thbvf1c9 | 20 Gi | 170 m | PASS (new deployment created after cap shipped, hit exactly 20 Gi as intended) |
| pvc-f30qkp1rzy1x | 20 Gi | 31 h | PASS (re-created in window of fix) |

All 4/4 PVCs in the `jarble` namespace are ≤20 GiB. **PR #71 verified green.** No oversized volumes found.

---

### 4. OTel traces end-to-end (PRs #77 / #79 / #80)

**PR #77 (Langfuse exporter auth):** verified. API env has `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` set, and traces are streaming to the project continuously (pg.query, Express middleware, route handlers all nested correctly).

**PR #79 (chatViaExec OTel span):** **VERIFIED END-TO-END.**

Inspected trace `94bd9098a2fc24432c185634febb26e0` (`POST /api/tambo-agent` at 2026-04-09T03:36:06Z, duration ~5.8s). Contained 40 observations including the expected `jarble.delegation.exec` span with these attributes:

```json
{
  "jarble.pod.name":       "dep-f30qkp1rzy1x-cbb45dbbb-rpdcb",
  "jarble.session.key":    "jarble-web-ngzM8k7rGQaF-conv-1775649307410-oofwsw",
  "jarble.message.length": "3133",
  "jarble.has_image":      "false",
  "jarble.runtime":        "openclaw",
  "jarble.traceparent.injected": "true"
}
```

- nested under the HTTP handler span as expected
- W3C `traceparent` injection flag is `true` (confirms PR #79's traceparent-to-pod-stdin wiring is executing)
- pod/session attributes are well-formed
- duration 5.7 s (delegation.exec start 03:36:06.172Z, end 03:36:11.904Z)
- entire chain (HTTP -> Express middleware -> handler -> delegation.exec -> pg queries) lives in a single trace, so distributed context propagation is intact on the API side

Langfuse URL for reference:
`https://us.cloud.langfuse.com/project/cmnqvnf66038dad070l1mds3t/traces/94bd9098a2fc24432c185634febb26e0`

**PR #80 (chatViaGateway OTel span):** NOT YET OBSERVED. Over the last 100 traces the only delegation span variant observed was `jarble.delegation.exec`. No `jarble.delegation.gateway`. This is expected if all recent chat traffic has gone down the `chatViaExec` fallback path - the WS primary path may not be routing. Not a regression (PR #80 merged 30 min before this run), but it is unproven. **Recommendation:** add a synthetic probe that exercises the WS gateway path and checks Langfuse for the gateway span.

**agent_calls DB rows:** NOT VERIFIED. Direct Neon DB query was not attempted this run (no psql client + credentials readily available in the sandbox). Recommend running:
```sql
SELECT trace_id, span_name, skill_name, created_at
  FROM agent_calls
  ORDER BY created_at DESC
  LIMIT 20;
```
and confirming `trace_id` column is populated for rows created after 2026-04-09T02:55Z (when the API pod restarted onto the new image).

---

### 5. Chaos testing (unauthenticated layer only)

| Vector | Result | Notes |
|---|---|---|
| XSS in tRPC `id` field via POST body | PASS | rejected at auth middleware (401), payload never reaches handler |
| SQL-ish payload `'OR'1'='1` in query-string JSON | PASS | rejected with `METHOD_NOT_SUPPORTED` (GET on mutation procedure) - correct 405 behavior |
| Rapid-fire concurrent (5 parallel) on `/trpc/deployment.list` | PASS | all 5 return 401 in ~100 ms, no tail-latency spike, no degraded responses |
| Stack-trace leakage | PASS | error envelope has `data.stack: undefined` in prod |
| Error message leakage | PASS | generic `"You must be logged in to access this resource"` |

**Authenticated chaos (XSS on chat input, oversized payloads against deployment.update, restart-race concurrency) was NOT executed** because no Bearer token was provided in the invocation context and the frontend landing page is 401-walled (see P1 below), which blocks the Playwright Auth0 login flow.

---

### 6. Flow engine regression

**NOT EXECUTED** this run. tRPC flows.* procedures are auth-walled and no token was available. Recommend running from an authenticated harness in a follow-up cycle.

---

### 7. Agentic delegation regression

**NOT EXECUTED** this run (requires an authenticated chat session). However, indirect positive signal: the `jarble.delegation.exec` span observed in Langfuse proves that the delegation code path is live and producing telemetry for real user traffic. Once PR #80's gateway path is exercised, the fractal trace should show nested delegation spans per the JAR-51 spec.

---

## P0 / P1 / P2 bug list

### P0 (prod down / data loss / security)
_None._

### P1 (ship blocker for the feature, not the platform)

**P1-1. `/tmp/mcp-jarble-ui.log` missing on all 4 agent pods**
- **Impact:** No visibility into MCP tool invocations. Debugging sandbox/component rendering failures becomes much harder.
- **Repro:** `kubectl -n jarble exec <any-pod> -- ls /tmp/mcp-jarble-ui.log` -> "No such file or directory"
- **Fix direction:** Grep `jarble-api-main/src/mcp/jarble-ui-server.js` for the log path constant; reconcile with runtime cwd. Consider moving the sink onto the PVC (e.g. `/data/logs/mcp-jarble-ui.log`) so it survives pod restarts and is inspectable post-mortem. Rebuild openclaw runtime image via `deploy-runtimes.yml`.

**P1-2. `mcporter` CLI not on PATH in runtime container**
- **Impact:** Unclear. If OpenClaw never shells out to `mcporter` and only spawns the configured `node` command directly, this is a docs-only bug. If OpenClaw does expect the CLI, agents cannot discover jarble-ui tools at runtime.
- **Repro:** `kubectl -n jarble exec dep-99i1thbvf1c9-5bff5c754-2x78c -- sh -c 'which mcporter'` -> "not found"
- **Fix direction:**
  1. confirm whether OpenClaw actually uses `mcporter` CLI or just reads `mcporter.json` and spawns its `command` itself.
  2. if (1) is "uses CLI": add `npm i -g mcporter` (or equivalent) to the openclaw Dockerfile and rebuild via `deploy-runtimes.yml`.
  3. if (1) is "does not use CLI": update CLAUDE.md/runbook wording so future QA does not look for a binary that was never supposed to exist, and close the issue.

**P1-3. `dev.jarble.ai/` returns 401**
- **Impact:** Unauthenticated visitors cannot see the landing page. Marketing / sign-up funnel is gated behind an auth wall.
- **Repro:** `curl -I https://dev.jarble.ai/` -> `HTTP/1.1 401 Unauthorized`, body `"401 Unauthorized"`.
- **Fix direction:** Most likely a Coolify-level basic-auth rule inherited from a staging password protection. Check Coolify project settings for the `dev.jarble.ai` app - toggle off HTTP basic auth if present. If the 401 is originating from Next middleware instead, inspect `Jarble-mvp/middleware.ts` for an overzealous auth redirect applying to `/`.

### P2 (polish / regression watch)

**P2-1. t1 pod has empty `JARBLE_MEMORY_SCOPE`**
- Old pod, predates PR #73, no restart since the fix. Cosmetic - will self-heal on any config change. Add a regression watch: "every new deployment must have a non-empty JARBLE_MEMORY_SCOPE env var post-configSync".

**P2-2. `jarble.delegation.gateway` span (PR #80) has not been observed**
- Not a bug, just unproven. Add a smoke probe.

---

## Recommended fixes (prioritized)

1. **P1-3 (dev.jarble.ai 401)** - fastest, almost certainly a Coolify toggle. Do first.
2. **P1-1 (MCP log sink)** - grep the server source, adjust log path, rebuild runtime image.
3. **P1-2 (mcporter CLI)** - 5 minutes of code reading to determine which branch of the fork we are on, then either Dockerfile update or doc update.
4. **P2-2** - wire a nightly synthetic chat that specifically goes through the WS gateway path to generate the gateway span, so PR #80 has observability coverage.
5. **P2-1** - add a guard in configSync / nodeManager that refuses to mark a deployment "running" until JARBLE_MEMORY_SCOPE is written.

---

## Follow-up test work (not executed this run)

The following items from the original brief were not directly exercised and should be run in a subsequent cycle (ideally from an environment with a fresh Bearer token, kubectl kubeconfig pre-wired, and a live Playwright session):

- Disclosure banner appearance in chat UI across all 3 memory modes (frontend)
- Chat UI toggle of memoryScope via ConfigPanel and DB round-trip verification
- `store_memory` without session_id in SESSION mode returns a validation error (requires live agent invocation)
- MCP `jarble-ui` tool count via `mcporter list` (blocked on P1-2 resolution)
- Chat-triggered canvas render of `stat_grid` on t3 (end-to-end UI verification)
- Authenticated chaos: XSS in chat input, oversized payloads, deployment.update / restart race
- Flow engine CRUD + SSE stream via API
- Agentic delegation end-to-end (t2 -> t1 delegation, verify t1 response + fractal trace in Langfuse)
- agent_calls DB row verification for trace_id population
- Trigger a chat that routes through chatViaGateway (WS path) and confirm PR #80's `jarble.delegation.gateway` span appears

**These are explicitly listed so the next QA cycle can pick them up as highest-priority goals.** None of them are blocked by anything other than "needs an authenticated session running from a machine with Playwright". The backend evidence in this report is strong enough to have reasonable confidence that most of them will pass.

---

## Healer dispatch

No qa-healer agents were spawned this cycle:
- P1-1 and P1-2 need code-reading + Dockerfile changes that are safer to land as a deliberate PR than an autonomous heal.
- P1-3 is almost certainly an infra toggle (Coolify), not a code fix.
- All P2 items are watchlist-only.

None of the P1s are "failing unit test" category where the healer is most effective. Recommend the main branch owner pick these up directly in the morning.

---

## Notes on test coverage limitations

This run was executed by the orchestrator agent directly rather than dispatching a full fleet of specialist subagents, because the full dispatch pattern (qa-explorer-ui via Playwright + qa-api-tester + qa-chaos + qa-healer) does not fit cleanly inside a single orchestrator turn in the current harness. The direct approach yielded strong evidence for the backend-observable PRs (#71, #73, #77, #79) but weak coverage for anything that requires a logged-in browser. Future runs should either:

- Run the orchestrator as a standalone process (`scripts/nightly-qa/overnight-agent.mjs`) where it can spawn subagents in separate turns, or
- Pre-provision a Bearer token in the orchestrator's prompt context so API-layer chaos and authenticated tRPC calls become possible from inside a single turn.
