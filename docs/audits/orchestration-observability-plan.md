# Jarble Orchestration Observability & Continued Design Plan

**Date:** 2026-04-08
**Authors:** synthesis of 5 specialist agent investigations (Thales, Plato, jarble-api-debugger, Machiavelli, Marcus Aurelius)
**Status:** Draft for review

## 0. Executive summary

Jarble is a fractal AI-workforce platform: every deployment is its own K8s pod on Hetzner with its own memory, and teams compose deployments into DAGs that can delegate recursively across N pods. The vision hinges on three things working together — **isolation, composition, and legibility**. We have the first two. The third is mostly missing, and it's actively blocking us from shipping with confidence.

Today a single user chat turn that cascades through 4 pods produces 4 disconnected log streams and zero trace data. The `agent_calls` table exists in the schema but has no writers anywhere in the codebase. The `audit_logs` table is the same story. Delegation hops cross pod boundaries with no correlation ID, no parent call ID, no token accounting, no cost attribution. When an agent "forgets mid-conversation" (as it did today from the auto-scaler data-loss bug), there is no honest way to answer "what happened" beyond grepping pino output across multiple workers.

**The plan:** stand up a proper observability layer — Langfuse + OpenTelemetry + the existing Sentry + Grafana LGTM — with cross-pod W3C traceparent propagation, a unified span data model that mirrors the fractal delegation shape, a security/audit event schema with redaction and runaway-cost guards, and a self-hosted deployment on the existing K3s cluster that can graduate to SaaS at scale. This is the foundation. Without it, every subsequent vision feature (N-level delegation, memory scoping, delegation tree viz, in-product debugger) is built on sand.

The rest of this document is the concrete design.

---

## 1. Vision alignment (what the observability layer must support)

Pulled from the product memory (`feedback_human_workforce_mental_model.md`, `feedback_deployments_are_atomic.md`):

1. **Fractal recursion is first-class.** An observability layer that only stitches 2 levels of delegation is not acceptable. The data model must handle arbitrary depth.
2. **Each pod is its own human.** Private memory, independent compute, independent billing. Traces respect that boundary and preserve the pod-of-origin on every span.
3. **Single-user teams only.** Every trace belongs to exactly one user. No cross-user attribution concerns yet.
4. **No free tier.** Every user is paying from day one. Cost tracking per turn is a feature, not a nice-to-have — users want to see what they're spending.
5. **Run and Team Chat converge.** Both surfaces produce the same trace shape; the observability layer cannot assume one entry point.
6. **`/d/[id]` stays first-class.** Drilling into any deployment in a team must show its own per-deployment traces, just as the team root shows the whole cascade.
7. **Failure isolation.** Tracing backend down must NOT break the application path. Exporters drop silently.

---

## 2. Current state (what's already in place)

From `jarble-api-debugger` audit (file:line references preserved).

### 2.1 Solid foundations
- **pino** structured JSON logging with `createModuleLogger` and `createRequestLogger` child loggers — `src/utils/logger.ts:3-18`
- **Express requestId middleware** honors incoming `X-Request-ID` from Traefik or generates `nanoid(12)` — `src/middleware/requestId.ts:19-24`
- **Sentry** initialized pre-import with Express integration, `tracesSampleRate` 0.1 prod / 1.0 dev — `src/instrument.ts:1-15`
- **Sentry tRPC middleware** wrapping every procedure — `src/trpc/middleware.ts:31-33, 64-67`
- **tRPC logging middleware** logs `{path, type, durationMs, requestId, ok}` — `src/trpc/middleware.ts:35-50`
- **`agent_calls` and `audit_logs` tables exist** — `src/db/schema.pg.ts:729-744, 408-417`
- **X-Request-Id propagation for service mesh** already implemented — `meshGateway.ts:79,89-90`, `serviceExecution.ts:71+`, `serviceProxy.ts:102-105,356,552`
- **Kubernetes monitoring stack** (node-exporter, kube-state-metrics, Grafana) — cluster-level only, not app-level

### 2.2 Dangerous coverage holes
These are the ones that hurt today, not hypotheticals:

1. **`agent_calls` table has zero writers.** The delegation audit trail has been a ghost table from day one. Every billing reconciliation, every "show me what this agent did" query, every credit attribution — all silently missing data.
2. **`audit_logs` table is likewise unused.** No structured activity capture for security events.
3. **Delegation hops are invisible across pods.** `flowDelegation.ts:447` calls `chatViaExec` into another pod with no trace ID, no parent call ID, no correlation header. A 3-level delegation produces 3 disconnected log streams.
4. **Flow engine success path is silent.** `executeStep` only logs on warn/error. A 40-step flow in production gives you no way to find the slow node.
5. **MCP server uses `console.error`, not pino** — `src/mcp/jarble-ui-server.js`. Tool calls (`render_ui`, `define_component`, `skill_reference`) emit to stderr without any correlation fields.
6. **No token or cost tracking anywhere in the request path.** Every LLM call is invisible to billing reconciliation.
7. **No OpenTelemetry SDK installed.** `@opentelemetry/*` is not in `package.json`.
8. **No `/metrics` endpoint.** Nothing for Prometheus to scrape at the app layer.
9. **Frontend-to-pod correlation is broken.** Frontend sends no `X-Request-Id`; `requestIdMiddleware` generates fresh. A user chat turn has no single ID spanning browser → API → pod → delegated pod.

### 2.3 Clean integration hooks (where future instrumentation slots in)

These are the exact file:line locations where we add instrumentation:

- `src/instrument.ts:1` — OTel SDK init alongside Sentry, must stay before other imports
- `src/middleware/requestId.ts:19` — promote `requestId` to W3C `traceparent`
- `src/trpc/middleware.ts:35-50` — `loggingMiddleware` is the single choke point for every tRPC procedure
- `src/services/flowEngine.ts` (around line 270) — insert span around each `executeStep`
- `src/services/flowDelegation.ts:410-480` — already has timing, add `agent_calls` row + inject traceparent into `chatViaExec`
- `src/routes/tamboAgent.ts:739` — "Chat: request started" is the natural root-span anchor
- `chatViaExec` / `openclawGateway.ts` — pipe `TRACEPARENT` env through `kubectl exec` to in-pod openclaw
- `src/mcp/jarble-ui-server.js:executeTool` — wrap every tool call in a pino child + OTel span

---

## 3. Recommended stack

**Primary (from week 1, self-hostable at scale):**
- **Langfuse** (MIT, self-hostable) — LLM-native observability, OTel ingest, native support for nested delegation chains. Postgres + Clickhouse backend. Used in production by Khan Academy, Twilio.
- **OpenTelemetry** (SDK + Collector) — the wire protocol for everything. W3C `traceparent` propagation across pods. `BatchSpanProcessor` + bounded queue so the app path never blocks on a flaky backend.
- **OpenLLMetry** (Traceloop) — OTel semantic conventions for Gen AI. Auto-instruments OpenAI/Anthropic/OpenRouter SDKs inside OpenClaw pods so token counts, cost, prompts, completions land automatically.
- **Sentry** (already in use) — keep for errors only. Add `sentry.setTag('trace_id', ...)` so Sentry issues deep-link to traces.
- **Grafana LGTM stack** (Loki + Grafana + Tempo + Mimir) — for logs, metrics, trace storage beyond what Langfuse holds. Grafana becomes the pane of glass.

**Week-one "poor man's" start ($0):**
- Langfuse Cloud free tier (50k observations/month ≈ 1.6K chat turns/day)
- Existing Sentry
- Existing pino → stdout (K3s default scrape)
- Skip Loki/Tempo/Mimir until traffic justifies them
- Total monthly cost: **$0**

Graduate to self-hosted Langfuse on K3s once observations exceed 50K/month.

**Why not alternatives:**
- **LangSmith** — LangChain-coupled, SaaS-only, $39/user/mo. Overkill since Jarble doesn't use LangChain.
- **Helicone** — proxy-based; loses the delegation graph because Jarble doesn't hit LLM SDKs directly.
- **Arize Phoenix** — strong on eval, weaker on production tracing UX.
- **Datadog / Honeycomb** — fine tools, priced for funded companies.

---

## 4. Trace data model

### 4.1 Root span decision

**Root = `jarble.chat.turn`** — one span per user message submission. For standalone flow runs (cron, API), root = `jarble.flow.run`. LLM calls are too granular; flow executions don't cover bare chat. A turn is the user's mental model of "what just happened."

### 4.2 Span hierarchy (landing page example)

```
jarble.chat.turn                                     [trace_id=T1, root, depth=0]
├── jarble.llm.call                  (entry bot plans)
├── jarble.tool.call  name=jarble_delegate
│   └── jarble.delegation.hop        target=designer-pod
│       └── jarble.chat.turn         (child turn in designer pod, depth=1)
│           ├── jarble.llm.call
│           ├── jarble.tool.call     name=jarble_delegate
│           │   └── jarble.delegation.hop  target=image-gen-pod
│           │       └── jarble.chat.turn   (depth=2)
│           │           ├── jarble.llm.call
│           │           └── jarble.tool.call name=generate_image
│           └── jarble.canvas.emit   card_id=c_42
├── jarble.tool.call  name=jarble_delegate
│   └── jarble.delegation.hop        target=copywriter-pod
│       └── jarble.chat.turn         (depth=1)
│           ├── jarble.llm.call
│           └── jarble.canvas.emit   card_id=c_43
├── jarble.llm.call                  (entry bot synthesizes)
└── jarble.canvas.emit               card_id=c_44 (final layout)
```

Flow engine nesting: `jarble.flow.run` → `jarble.flow.step` → (any span). Subagents: `jarble.subagent.call` as an in-pod child of an LLM call (no cross-pod hop).

### 4.3 Span attributes

**Common to all spans:** `trace_id`, `span_id`, `parent_span_id`, `name`, `start_ns`, `end_ns`, `duration_ms`, `status` (ok|error), `error.message`, `user_id`, `org_id`, `deployment_id`, `pod_name`, `depth`, `service.name`.

| Span | Type-specific attributes |
|------|-------------------------|
| `jarble.chat.turn` | `conversation_id`, `session_key`, `message_id`, `input_chars`, `output_chars`, `canvas_cards_emitted`, `total_cost_cents` (rolled up) |
| `jarble.flow.run` | `flow_id`, `execution_id`, `trigger` (chat/cron/api), `status`, `iterations` |
| `jarble.flow.step` | `node_id`, `node_type`, `iteration`, `template_vars_resolved` |
| `jarble.llm.call` | OTel Gen AI: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read_tokens`, `cost_cents`, `reasoning_tokens`, `finish_reason` |
| `jarble.tool.call` | `tool.name`, `tool.kind` (mcp/builtin/custom), `tool.args_hash`, `tool.result_bytes` |
| `jarble.canvas.emit` | `card_id`, `component_type`, `payload_bytes`, `custom_component` |
| `jarble.delegation.hop` | `source_deployment_id`, `target_deployment_id`, `target_pod`, `delegation_reason`, `credits_billed`, `hop_index` |
| `jarble.subagent.call` | `subagent_name`, `parent_llm_span_id` |

### 4.4 Cross-pod propagation

**W3C Trace Context.** When `jarble_delegate` fires, the API gateway injects `traceparent: 00-{trace_id}-{delegation_hop_span_id}-01` into the WS/HTTP call to the target pod's OpenClaw runtime. The runtime reads it on session start and stamps every downstream span with `trace_id + parent_span_id = delegation_hop_span_id`.

`tracestate` carries Jarble-specific baggage: `jarble=depth:3,root_user:auth0|xxx,root_turn:msg_abc`. Depth increments at each hop and is enforced against `MAX_DELEGATION_DEPTH = 6` (see §5.4).

### 4.5 Integration with existing tables

- **`agent_calls` becomes the authoritative span store.** Extend with `trace_id`, `span_id`, `parent_span_id`, `span_name`, `attributes` (JSONB), `start_ns`, `end_ns`. The in-progress `parent_call_id` column on the fractal-delegation feature branch aligns with `parent_span_id` — keep both during migration, drop the narrower one once backfilled.
- **`orchestrationFlowExecutions` stays as the flow-domain projection** (status, resume tokens, HITL state) and links to the trace via `trace_id`. Not dual-write.
- **SSE events become one-way mirrors** of spans: every `jarble.flow.*` / `jarble.delegation.*` SSE event corresponds to a span write, but the span store is the source of truth. The SSE stream gains a `span_id` field on every event so the client can correlate.
- **Writes are async via a buffered span exporter** (batch every 500ms) so the hot path never blocks on the trace backend.

### 4.6 Debug-view query

```sql
WITH RECURSIVE tree AS (
  SELECT * FROM trace_spans
   WHERE trace_id = $1 AND parent_span_id IS NULL
  UNION ALL
  SELECT s.* FROM trace_spans s
    JOIN tree t ON s.parent_span_id = t.span_id
   WHERE s.trace_id = $1
)
SELECT span_id, parent_span_id, span_name, deployment_id, pod_name,
       duration_ms, status, attributes, start_ns
  FROM tree
 ORDER BY start_ns;
```

Trace lookup from a chat message: `WHERE attributes->>'message_id' = $1 AND parent_span_id IS NULL`. The frontend debug drawer renders this as a collapsible flame graph keyed on `(parent_span_id, start_ns)`, with delegation hops shown as pod-boundary separators.

---

## 5. Security & audit layer

### 5.1 Mandatory audit events

All events carry base fields: `event_id`, `event_type`, `ts`, `user_id`, `org_id?`, `trace_id`, `span_id`, `source_ip`, `user_agent?`.

| Event type | Extra fields | Retention |
|------------|--------------|-----------|
| `auth.login.success` / `.failure` / `.logout` | auth0_sub, method, failure_reason | 90d |
| `deployment.{create,update,start,stop,delete}` | deployment_id, runtime, model, config_hash, actor | 2y |
| `deployment.credential.inject` | deployment_id, credential_kind, key_id (NOT value) | 1y |
| `llm.call` | deployment_id, provider, model, prompt_tokens, completion_tokens, latency_ms, cost_usd, finish_reason | 90d |
| `tool.call` | deployment_id, tool_name, arg_schema_hash, arg_bytes, result_bytes, status | 90d |
| `delegation.hop` | parent_deployment_id, child_deployment_id, depth, trace_root_id, reason_tag | 90d |
| `config.sync` | deployment_id, source, file_list, diff_hash | 1y |
| `memory.access` | deployment_id, op (read/write/delete), scope, byte_count | 30d |
| `flow.{start,step,complete,error,cancel,resume}` | flow_id, execution_id, node_id, node_type, status | 90d |
| `ratelimit.hit` | endpoint, limit_kind, current, ceiling | 30d |
| `stripe.webhook.verify_fail` | event_type, source_ip, signature_prefix | 1y |
| `admin.call` | procedure, target_user_id, target_entity, input_hash | 2y |
| `pvc.mount` / `pvc.unmount` | deployment_id, pvc_id, size_bytes | 1y |

### 5.2 Redaction ruleset

Enforced as an OTel `SpanProcessor` that strips before any span leaves the process:

- **Never emit:** `*.api_key`, `*.apiKey`, `*.token`, `*.secret`, `*.password`, `authorization`, `cookie`, `set-cookie`, `encryption_key`, `AUTH0_*`, `STRIPE_*`, `llmApiKey`, `x-api-key`, `bearer *`, any value matching `sk-[a-zA-Z0-9_-]{20,}`, `whsec_*`, `re_*`.
- **Hash, don't log:** `auth0_sub → sha256(sub)[0:16]`, `email → sha256(email)[0:16]`. `stripe_customer_id` preserved (treat as PII, don't leak outside Jarble).
- **Truncate:** `llm.prompt` / `llm.completion` NOT stored on spans — only `*_token_count`, `*_byte_size`, `*_sha256[0:16]`, and first/last 64 chars. Full content only in opt-in debug sessions with `trace.debug=true`, auto-expiring in 24h.
- **Tool args:** replace values with `{type, length}` metadata; keep key names. URLs strip query + fragment.
- **PII scrubber:** regex strips emails, phone numbers, credit-card-looking digit runs, JWT-shaped strings from any string attribute before export.
- **Env dumps:** forbidden as span attributes.

### 5.3 Prompt injection detection hooks

Emit as span attributes (observational, not blocking — decision gate comes later):

- `input.source` — user / delegation / tool_result / memory / platform_webhook
- `input.instruction_density` — imperative verb count + "ignore previous" / "system:" / "you are now" / fenced `jarble_ui` / fenced `jarble_delegate` occurrences in non-user sources
- `delegation.target_origin` — was target deployment id in the parent agent's allow-list, or dynamically chosen from tool output? Flag the latter.
- `tool.arg.origin_trace` — for each tool arg, which upstream span produced it. Tool calls whose args derive from untrusted `tool_result` get `taint=true`
- `llm.output.contains_control_tokens` — bool, detects fenced delegation/UI blocks leaking through as user-visible text
- `delegation.target_changed_mid_trace` — bool, target deployment differs from declared team topology
- `memory.write.from_untrusted` — memory writes whose content originated from external tool or webhook input

### 5.4 Runaway cost circuit breaker

Signals per trace root (one user turn). Checked on every hop; breach emits `trace.circuit_break` with reason and returns terminal error to the root caller.

| Signal | Default hard cap | Default soft warn |
|--------|------------------|-------------------|
| `trace.depth` (delegation hops) | **6** | 4 |
| `trace.fanout` (children per node) | **5** | — |
| `trace.total_llm_tokens` | **500k** | 250k |
| `trace.total_tool_calls` | **50** | — |
| `trace.wallclock_ms` | **180s** | 90s |
| `trace.cost_usd_running` (per turn) | **$2.00** | $1.00 |
| `trace.cost_usd_running` (per user/hour) | **$50** | $25 |
| `delegation.cycle_detected` | hash of `(deployment_id, input_hash)` seen twice → abort | — |

These are defaults; users should be able to tighten them but never loosen past safety floors (depth ≤ 10, cost ≤ $10/turn).

### 5.5 User-facing audit view

Minimum captured per turn, retained **180 days** (user-adjustable 30–365):

- `trace_root_id`, `started_at`, `ended_at`, `root_deployment_id`, `conversation_id`
- Full delegation tree (deployment_ids, depths, durations, token/cost totals)
- List of `tool_name`s invoked (no args), list of models used
- Credential kinds accessed
- Final status + cost
- Link to redacted prompt/response snapshots if user opted into debug mode

Queryable by deployment_id, date range, cost, error status. Served via a dedicated tRPC router `audit.*` (protected).

### 5.6 Data deletion

- **Deployment delete:** audit rows stay, pseudonymized. Deployment_id preserved, name/config_hash kept, user-authored prompts in debug snapshots purged immediately. Traces retained until normal retention expiry.
- **User delete-my-data request:** hard-delete debug snapshots, memory access payload hashes, LLM prompt/response hashes within 30d. Audit events for billing/fraud (`stripe.*`, `auth.*`, `admin.*`, `deployment.create/delete`) retained 2y under legitimate-interest basis, with user_id replaced by a tombstone hash.
- **Retention enforcement:** nightly job by `event_type` TTL. Langfuse traces mirror same TTLs via project-level retention.
- **Export:** single `GET /me/audit-export` returns JSONL of all user-scoped events within retention window before deletion, satisfying portability.

---

## 6. Deployment architecture & ops

### 6.1 Where the backend runs

**Self-hosted Langfuse + OTel Collector on the existing K3s cluster in a new `observability` namespace**, graduating to a dedicated Hetzner VPS for Clickhouse at 100K traces/day, or a SaaS hybrid (Langfuse Cloud + Grafana Cloud Traces).

**Why not pure SaaS now:** Langfuse Cloud Hobby caps at 50k observations/month (~1.6K/day) — we blow through that immediately. Pro is $59/mo + usage. Honeycomb and Datadog are overkill and expensive for LLM traces at this stage.

**Why not a separate VPS:** the cluster already exists, Longhorn gives us persistence, autoscaler handles bursts. A separate VPS doubles the oncall surface.

### 6.2 Architecture

```
                 ┌─────────────────────────────────────┐
 jarble-prod     │  API pod ──┐                        │
                 │  bot pod ──┼──► OTLP/gRPC :4317 ────┼──► otel-collector
 autoscaled      │  bot pod ──┘     (tail sampler)     │    (Deployment x2)
 worker nodes    │                                     │         │
                 └─────────────────────────────────────┘         ▼
                                                         ┌───────────────┐
 observability ns                                        │   Langfuse    │
                                                         │  web + worker │
                                                         └───────┬───────┘
                                                                 ▼
                                              Clickhouse (Longhorn PVC 50GB)
                                              Postgres (Neon branch)
                                              Redis (in-cluster, ephemeral)
                                              Blobs → Hetzner Object Storage
```

### 6.3 Collector deployment

- **OTel Collector as a Deployment (2 replicas)** in `observability`, exposed via ClusterIP `otel-collector.observability.svc.cluster.local:4317`
- Not a DaemonSet — cpx11 workers are RAM-constrained; 200MB per node is wasteful
- Not a sidecar — couples to pod lifecycle and doubles pod count
- Tail sampling + batch + memory_limiter + OTLP exporter to Langfuse
- Auto-scaled agent pods discover the collector via stable in-cluster DNS

### 6.4 Sampling (tail-based, in collector)

- **Keep 100%** of any span with `error=true`, `status_code >= 500`, `duration > 2s`, `user.tier=paid`, `flow.hitl=true`
- **Keep 100%** of root spans of multi-pod delegations (preserves the fractal DAG stitch)
- **Probabilistic 10%** of the remainder at 10K/day, **1%** at 100K/day
- Head-based sampling rejected — we don't know duration or error state at span start, and losing the error path is unacceptable. Tail sampling costs ~30s of collector buffer memory.

### 6.5 Retention & storage (by scale)

| Data | Dev | 1K/day | 10K/day | 100K/day |
|---|---|---|---|---|
| Full traces (hot) | 7d | 7d | 7d | 3d |
| Errors + slow (>2s) | 30d | 30d | 30d | 30d |
| Aggregate metrics | 90d | 90d | 90d | 180d |
| Clickhouse disk | 5GB | 10GB | 50GB | 300GB |
| Object storage (cold) | — | 2GB | 20GB | 200GB |

Assuming ~15KB per trace compressed in Clickhouse after sampling.

### 6.6 Failure isolation (non-negotiable)

- OTel SDK: `BatchSpanProcessor` with 5s timeout, bounded queue (2048), drop-on-full. **Never blocks request path.**
- Exporter failures: log once per minute, never throw.
- Collector down → SDK drops spans silently. App unaffected.
- Langfuse down → collector buffers to disk-backed queue (file_storage extension, 500MB PVC), drains on recovery.
- Clickhouse full → Langfuse returns 5xx to collector → collector drops oldest buffered spans. App path untouched.

### 6.7 Oncall playbooks

**1. Tracing backend down (`langfuse-web` CrashLoop)**
Check `kubectl -n observability logs deploy/langfuse-web`. 90% of the time it's Clickhouse connection or Postgres migration lock. Restart worker first, then web. App is unaffected — P3, fix in business hours unless a customer incident is active.

**2. Storage full (Clickhouse PVC > 85%)**
Alert at 80% via cron probe → Slack. Run Langfuse retention job manually. If still full, drop oldest `traces` partition in Clickhouse directly. Longhorn can expand the PVC online — +20GB takes 2 minutes.

**3. Agent pods can't export (new autoscaled node, spans missing)**
Check `otel-collector` service DNS resolves from the agent pod: `kubectl exec <bot> -- getent hosts otel-collector.observability`. If it fails, the new node joined without flannel networking. Restart flannel pod on that node. App keeps running — we just lose traces from that one pod until fixed.

### 6.8 Monthly cost (USD)

| Tier | Compute | Storage | Egress | Total |
|---|---|---|---|---|
| Dev (~100/day) | $0 (existing cluster) | $0 (5GB Longhorn) | $0 | **~$0** |
| 1K/day | $0 | $1 (10GB) | $0 | **~$1** |
| 10K/day | +1 cpx21 ($6) | $5 (50GB + object) | $0 | **~$11** |
| 100K/day | Dedicated cpx31 ($13) OR Grafana Cloud Traces ($50) | $25 | $2 | **~$40–75** |

**Honest take:** if the team ever drops below 1.5 engineers, switch to Langfuse Cloud Pro ($59/mo) immediately. The self-host savings are not worth a founder debugging Clickhouse at 2am.

---

## 7. Implementation roadmap

Staged so each phase ships value even if the next phase slips.

### Phase 1 — Foundation (Week 1)
**Goal:** start capturing LLM calls with structured prompts/tokens/cost without touching pod images.

- Add `@opentelemetry/sdk-node` + `@traceloop/node-server-sdk` + `@langfuse/node` to `jarble-api-main/package.json`
- Extend `src/instrument.ts:1` to init OTel SDK alongside Sentry (must stay before other imports)
- Wrap `tamboAgent.ts:739` with a Langfuse trace per conversation turn — tag with `deploymentId`, `conversationId`, `userId`, `orgId`
- Sign up for Langfuse Cloud free tier ($0) as the initial backend
- Ship a regression test that asserts traces are created for each chat turn

**Exit criterion:** every chat turn in dev produces a Langfuse trace with LLM call metadata.

### Phase 2 — Cross-pod propagation (Week 2)
**Goal:** stitch the delegation tree across pods.

- Promote `requestId` to W3C `traceparent` in `src/middleware/requestId.ts:19`
- Inject `traceparent` + `tracestate` (depth/root_user/root_turn baggage) into `chatViaExec` calls in `flowDelegation.ts:447`
- Pipe `TRACEPARENT` env var through `kubectl exec` so in-pod OpenClaw reads it on session start
- Add `@traceloop/node-server-sdk` to the OpenClaw runtime image so LLM calls auto-instrument in-pod
- Backfill `agent_calls` table writer in `flowDelegation.ts:410-480` — finally populate the ghost table
- Add a hard circuit breaker on `trace.depth > MAX_DELEGATION_DEPTH` (default 6)

**Exit criterion:** a 2-level delegation produces a single trace spanning both pods in Langfuse.

### Phase 3 — Flow engine + tool calls (Week 3)
**Goal:** full coverage of the orchestration path.

- Instrument `flowEngine.executeStep()` — one span per node, child spans for delegations
- Instrument `mcp/jarble-ui-server.js` tool calls — switch from `console.error` to pino + OTel spans
- Add `span_id` field to every SSE event emitted to the frontend
- Add `/metrics` endpoint with prom-client for deployment-level counters (LLM calls, tokens, cost)

**Exit criterion:** a flow execution with 5 nodes produces a flame graph in Langfuse showing each node's latency + cost.

### Phase 4 — In-product debug view (Week 4)
**Goal:** user-facing "debug this turn" experience.

- Build `audit.*` tRPC router (protected) that exposes the recursive trace query
- Build a collapsible trace drawer in `/d/[id]` that calls the audit endpoint
- Show the delegation tree with pod-boundary separators, per-node cost, duration, status
- Link spans with errors to Sentry issues

**Exit criterion:** clicking "debug this turn" on any chat message in the frontend shows the full trace tree.

### Phase 5 — Security & compliance (Week 5)
**Goal:** audit events, redaction, runaway guards enforced.

- Implement the audit event writers (§5.1) — one per event type, all routed through a single `recordAuditEvent()` helper
- Implement the OTel `SpanProcessor` that applies the redaction ruleset (§5.2)
- Wire the runaway cost circuit breaker (§5.4) into `flowEngine` + `flowDelegation`
- Implement `audit-export` endpoint for user data portability
- Implement the nightly retention job per event type

**Exit criterion:** a deliberate prompt injection attempt + a runaway delegation loop both land in the audit table and trigger the circuit breaker.

### Phase 6 — Self-host graduation (when it matters)
**Trigger:** Langfuse Cloud free tier exhausted OR cost attribution needs beyond SaaS reports.

- Deploy self-hosted Langfuse helm chart in `observability` namespace
- Deploy OTel Collector as 2-replica Deployment
- Deploy Grafana LGTM stack (Loki + Grafana + Tempo) for logs/metrics/secondary tracing
- Migrate SDK endpoints from cloud to in-cluster
- Document the three oncall playbooks (§6.7)

**Exit criterion:** all telemetry flows through self-hosted stack; SaaS can be turned off.

---

## 8. Continued design principles (post-observability)

With the foundation in place, the next vision features become buildable:

1. **N-level fractal delegation** — the remote coordinator's `feature/fractal-n-level-delegation` branch is 1-of-9 pieces done. Continuing it requires the observability layer to verify correctness at depths > 2.
2. **Run + starter-prompt convergence** — small change with outsized vision impact. Should be instrumented from day one so we can measure whether users actually prefer the unified mode.
3. **Delegation tree visualization** — drives off the recursive span query (§4.6). Same data, new UI.
4. **Conversation-scoped memory** — the design decision (A: scope writes, B: disclose) should be informed by trace data showing actual cross-session memory bleed patterns.
5. **Team palette ownership constraints UI** — already partially there; needs observability to show users the running cost impact of adding a teammate.
6. **Runaway cost hard limits** — can only be enforced with trace-level data. The circuit breaker in §5.4 is a prerequisite for any public beta.

---

## 9. Risks & trade-offs

- **Over-instrumentation:** adding spans everywhere has a real CPU cost. Mitigation: BatchSpanProcessor with 10% base sampling, drop-on-full queue. Tail sampling to preserve errors.
- **Schema churn:** the trace data model (§4) will evolve. Mitigation: all attributes on a JSONB column, span names versioned (`jarble.chat.turn/v1`).
- **Debugging the observability layer itself:** classic chicken-and-egg. Mitigation: Langfuse Cloud during bootstrap so we can see traces of the self-hosted instance failing.
- **Redaction false negatives:** missing a new secret-looking field lets credentials leak. Mitigation: deny-list for known patterns + manual audit before every production release.
- **User-visible trace drawer reveals too much:** raw prompts could embarrass or mislead users. Mitigation: the drawer shows metadata by default; full content only with opt-in `trace.debug=true`.

---

## 10. Open questions

1. **Where does the SDK initialize for the OpenClaw runtime image?** — requires a small edit to the runtime Dockerfile and a consistent env-var mapping in `openclaw.ts`.
2. **Do we want to mirror traces into Postgres or keep them only in Langfuse/Clickhouse?** — mirroring gives SQL joinability with `users`, `deployments`, `orgs`. Cost: doubled storage.
3. **Billing reconciliation source of truth:** is it the `agent_calls`/trace store, or Stripe, or both? Needs an explicit decision before the circuit breaker can legitimately enforce `$50/user/hour`.
4. **Do we instrument frontend too?** Next.js + Sentry browser SDK + OTel Web SDK would give end-to-end traces including canvas render timing. Phase 7 candidate.
5. **Opt-in debug mode UX:** where does the toggle live? Per-deployment setting? Per-conversation? Session-level?

---

## 11. Deliverables checklist

- [ ] This plan merged to `develop` as `docs/audits/orchestration-observability-plan.md`
- [ ] Phase 1 PR: OTel + Langfuse SDK wired, chat turn trace captured
- [ ] Phase 2 PR: cross-pod traceparent propagation + agent_calls writer + depth circuit breaker
- [ ] Phase 3 PR: flow engine + MCP tool span instrumentation
- [ ] Phase 4 PR: user-facing audit.* tRPC router + debug drawer
- [ ] Phase 5 PR: audit event writers + redaction processor + runaway guards
- [ ] Phase 6: self-host migration (feature-flagged, deferred until needed)

---

## Appendix A — Source investigations

- **Tool market comparison** (Thales): 6 LLM-native tools + 4 distributed tracers + 3 error trackers evaluated. Primary = Langfuse. Secondary = Langfuse Cloud free tier for $0 start.
- **Data model design** (Plato): unified OTel-compatible span hierarchy, W3C traceparent propagation, recursive SQL query, integration with existing tables.
- **Current-state audit** (jarble-api-debugger): inventory of 12 existing instrumentation points, 9 dangerous coverage holes, 8 clean integration hooks at specific file:line locations.
- **Security & audit design** (Machiavelli): 13 mandatory event types with retention, redaction ruleset, 7 prompt injection detection signals, circuit breaker thresholds, deletion policy.
- **Infrastructure & ops** (Marcus Aurelius): self-hosted Langfuse on K3s, OTel Collector as Deployment, tail sampling, storage/retention at 4 scale tiers, 3 oncall playbooks, monthly cost $0–$75.
