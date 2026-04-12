# Cross-pod traceparent consume — research (2026-04-09)

**Author:** overnight session
**Status:** research complete, no code changes
**Scope:** Can the API side's OTel traceparent (shipped via env var in `chatViaExec` since PR #79, and via HTTP header in `chatViaHTTP` since #86) actually be consumed by the openclaw runtime inside the pod so LLM calls + internal spans roll up under the caller's trace?

## TL;DR

**No, not today.** OpenClaw 2026.2.x has zero mentions of `traceparent`, `TRACEPARENT`, OpenLLMetry, or OTel context propagation in its bundled JS. The env var / HTTP header are being sent correctly but are dropped on the floor at the pod boundary.

However, OpenClaw **does** have a first-class diagnostic event system (`@openclaw/plugin-sdk` `diagnostics-otel`) that surfaces everything we want — model provider, model id, token usage, cost, session key, duration — as typed events. A plugin running inside the pod can bridge these to OTel spans with the caller's traceparent as the parent.

## What we verified

### 1. No traceparent handling in the runtime
```
kubectl -n jarble exec <pod> -- grep -rlE "traceparent|TRACEPARENT" \
  /opt/openclaw/node_modules/openclaw/dist/
# → (empty)
```
Zero matches across the entire compiled `dist/` tree.

### 2. No OpenLLMetry / gen_ai instrumentation
```
grep -rlE "gen_ai|OpenLLMetry|openllmetry" \
  /opt/openclaw/node_modules/openclaw/dist/
# → (empty)
```

### 3. OpenClaw exposes a typed diagnostic event API
Found at `plugin-sdk/infra/diagnostic-events.d.ts`. The union type includes:

- `model.usage` — provider, model, input/output/cacheRead/cacheWrite tokens, `costUsd`, `durationMs`, sessionKey, sessionId, channel
- `webhook.received` / `webhook.processed` / `webhook.error`
- `message.queued`
- (and more — see full file on any running agent pod at `/opt/openclaw/node_modules/openclaw/dist/plugin-sdk/infra/diagnostic-events.d.ts`)

The plugin SDK exports `emitDiagnosticEvent` / `onDiagnosticEvent`, meaning plugins can both publish and subscribe to events.

## Implications

What we ship on the API side is forward-compatible but not fully load-bearing:

- ✅ `TRACEPARENT` env var (PR #79) — injected via `env` prefix on `chatViaExec` calls
- ✅ `JARBLE_CURRENT_SESSION_ID` env var (PR #81) — same
- ✅ `traceparent` HTTP header (PR #86) — injected on `chatViaHTTP` calls
- ❌ openclaw ignores all three

The delegation spans (`jarble.delegation.exec`, `jarble.delegation.gateway`, `jarble.delegation.http`) correctly capture API-side visibility. But once control crosses into the pod, we lose the thread: the pod's LLM calls, internal tool executions, and QMD memory ops are invisible to our trace.

## Recommended follow-up work

### Option A — OpenClaw plugin bridge (preferred, ~1 day of work)

Write a Jarble-owned openclaw plugin (`@jarble/openclaw-otel-bridge`) that:

1. Reads `process.env.TRACEPARENT` and `JARBLE_CURRENT_SESSION_ID` at startup.
2. Initializes a minimal OTel SDK inside the pod with the same Langfuse exporter config the API uses.
3. Registers `onDiagnosticEvent` and translates each event into an OTel span:
   - `model.usage` → `gen_ai.<provider>.chat` with `gen_ai.*` attributes following OpenLLMetry semantic conventions (exactly matching the spans PR #82 emits on the API side).
   - `webhook.received` / `webhook.processed` → HTTP-like spans with the `webhook.*` attributes.
   - `message.queued` → custom `jarble.pod.message_queued` span.
4. Roots every emitted span under the parent traceparent read from env, so all pod-side spans join the caller's trace automatically.
5. Ships as a plugin installed via `openclaw.plugins.entries` in the generated `openclaw.json`.

Plugin loading is already supported by openclaw — see `plugin-sdk/config/types.plugins.d.ts`. We'd need to:

- Add the plugin package to the runtime Docker image (`runtimes/openclaw/Dockerfile`) so it ships pre-installed.
- Add `plugins.entries.@jarble/openclaw-otel-bridge: { enabled: true }` to the rendered `openclaw.json` in `openclaw.ts:renderConfigs`.
- Pass `OTEL_EXPORTER_OTLP_ENDPOINT` / Langfuse keys into the pod's env (already shipped via Secret for the API).

### Option B — Diagnostic event tailing from the API (quick hack, ~half a day)

Write a background service on the API side that, for each running pod:

1. Every few seconds, `kubectl exec` runs a small node one-liner on the pod that calls `onDiagnosticEvent` and buffers events to stdout.
2. Streams the stdout back, parses each event, and emits matching OTel spans on the API side using the caller's trace context (re-looked-up by sessionKey).

Downsides vs Option A: adds kubectl exec pressure to the API, can't capture events in sub-second granularity, and reliability is poor when pods restart mid-tail.

### Option C — Ignore cross-pod and rely on API-side coverage only

Ship what we have and accept that pod-internal activity is invisible. The delegation spans, agent_calls rows, and Langfuse traces still cover:

- Every HTTP request to the API
- Every delegation hop at the API boundary (http / gateway / exec)
- Every LLM call made from the API itself via `streamLlmCompletion` (PR #82 gen_ai spans)
- Every DB query
- Every Express middleware / tRPC procedure

This is still dramatically better than where we were 24 hours ago.

## Decision

**Ship Option A as a follow-up PR** (scheduled, not blocking). Needs:

1. A new package under `runtimes/openclaw-otel-bridge/` OR inline in `runtimes/openclaw/plugins/`.
2. Update `runtimes/openclaw/Dockerfile` to install the plugin.
3. Update `jarble-api-main/src/runtimes/handlers/openclaw.ts:renderConfigs` to enable the plugin via `openclaw.json`.
4. Update `docs/audits/orchestration-observability-plan.md` to reflect actual cross-pod semantics.

For tonight's overnight session, ship Option C (what we already have) and document the gap. Cross-pod stitching is a 1-2 day project that deserves its own focused session.
