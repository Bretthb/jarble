# @jarble/openclaw-otel-bridge

OpenClaw plugin that bridges the pod-internal lifecycle events (LLM calls, tool calls, session start/end) to OTel spans rooted under the caller's W3C TRACEPARENT env var.

## Status

**DRAFT SCAFFOLD** (JAR-51 Phase 7). Not yet wired into the runtime Dockerfile. Ships as a working plugin source + manifest so the user can install + enable as a follow-up PR without re-reading the research audit.

## What it closes

Before this plugin, every chat span on the API side was a **leaf** in Langfuse — we could see "API delegated to pod X" but not what happened inside the pod. With this plugin, every LLM call, tool invocation, and subagent spawn inside the pod joins the **same Langfuse trace** as the API caller automatically.

## How it works

1. **Reads `TRACEPARENT` env var at session start.** `chatViaExec` (PR #79) and `chatViaHTTP` (PR #86) already inject this.
2. **Initializes the OTel SDK** using the same Langfuse exporter config as the API (`LANGFUSE_BASE_URL` + `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`).
3. **Registers openclaw lifecycle hooks:**
   - `session_start` — opens a root `jarble.pod.session` span rooted under the parsed `TRACEPARENT`
   - `llm_output` — emits a `gen_ai.<provider>.chat` span with OpenLLMetry semantic conventions (provider, model, input/output tokens, stop reason)
   - `before_tool_call` / `after_tool_call` — emits a `jarble.pod.tool.<toolName>` span per call
   - `session_end` — closes the root span

## Install steps (wiring work for the follow-up PR)

### 1. Runtime Dockerfile

Add this to `runtimes/openclaw/Dockerfile`:

```dockerfile
COPY runtimes/openclaw-otel-bridge /opt/openclaw-otel-bridge
RUN cd /opt/openclaw-otel-bridge && npm install --production
```

### 2. Enable in `openclaw.json` via `openclaw.ts:renderConfigs`

Add to the openclawConfig object:

```js
openclawConfig.plugins = {
  enabled: true,
  load: {
    paths: ["/opt/openclaw-otel-bridge/index.js"],
  },
  entries: {
    "jarble-otel-bridge": { enabled: true },
  },
};
```

### 3. Pass env vars into the pod Secret via `openclaw.ts:getSecretEntries`

Already shipped for the API side — just mirror to the pod Secret:

```js
entries["LANGFUSE_BASE_URL"] = process.env.LANGFUSE_BASE_URL || "";
entries["LANGFUSE_PUBLIC_KEY"] = process.env.LANGFUSE_PUBLIC_KEY || "";
entries["LANGFUSE_SECRET_KEY"] = process.env.LANGFUSE_SECRET_KEY || "";
entries["JARBLE_POD_NAME"] = `dep-${deployment.id}`;
entries["JARBLE_DEPLOYMENT_ID"] = deployment.id;
```

### 4. Rebuild the runtime image

Trigger `.github/workflows/deploy-runtimes.yml` via a push to `runtimes/**` or via `workflow_dispatch`.

### 5. Verify

After the runtime image rolls out, trigger a chat and check Langfuse — traces should now include `jarble.pod.session`, `gen_ai.<provider>.chat`, and `jarble.pod.tool.*` spans nested under the API's delegation span.

## Safety contract

- **Fail-open:** plugin init + every hook is wrapped in try/catch. Any OTel failure logs a warning and lets the openclaw path continue normally. Observability must NEVER break bot operation.
- **Lazy SDK init:** the OTel SDK is loaded at plugin register time, after the pod is already running. If the SDK fails to load (missing deps, bad config), the hooks become no-ops.
- **Bounded state:** `activeSessions` map holds one span per live chat session. `session_end` cleans up. Worst-case leak: a dead session's span stays open until the pod restarts, which is harmless.

## Open questions for the follow-up PR

1. **Which lifecycle hooks to enable?** The plugin registers 5 hooks today. OpenClaw exposes 23 (see `PLUGIN_HOOK_NAMES` in `plugin-sdk/plugins/types.d.ts`). `subagent_spawning` / `subagent_spawned` / `subagent_ended` would give us fractal visibility inside a single pod for multi-subagent chains.
2. **Prompt-injection hooks** (`before_prompt_build`, `before_agent_start`) could inject a Langfuse trace URL back into the bot's system prompt so the bot can self-cite its own trace.
3. **Do we want to capture LLM input messages?** Currently we capture only metadata (model, tokens, stop reason). Input/output text would be more useful but may contain PII. Add an opt-in config.
4. **Does `session_start` fire reliably?** Needs to be verified against the openclaw runtime. If not, may need to attach to `message_received` instead.

## Related

- Research audit: [`docs/audits/cross-pod-traceparent-consume-apr9.md`](../../docs/audits/cross-pod-traceparent-consume-apr9.md)
- Tonight's observability PRs: #77 (Langfuse exporter), #79 (chatViaExec span), #80 (chatViaGateway span), #82 (gen_ai spans), #86 (chatViaHTTP span)
