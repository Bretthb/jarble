/**
 * @jarble/openclaw-otel-bridge — JAR-51 Phase 7
 *
 * OpenClaw plugin that bridges the pod-internal lifecycle events (LLM
 * calls, tool calls, session start/end, subagent spawns) to OTel spans
 * rooted under the caller's W3C TRACEPARENT env var.
 *
 * Closes the cross-pod observability gap: before this plugin, every
 * chat span on the API side was a leaf — we could see "API delegated
 * to pod X" but NOT what happened inside the pod. With this plugin,
 * every LLM call, tool invocation, and subagent spawn inside the pod
 * joins the same Langfuse trace as the API caller automatically.
 *
 * ## Wiring
 *
 * 1. Install in the runtime Docker image:
 *
 *    ```Dockerfile
 *    COPY runtimes/openclaw-otel-bridge /opt/openclaw-otel-bridge
 *    RUN cd /opt/openclaw-otel-bridge && npm install --production
 *    ```
 *
 * 2. Enable in openclaw.json (done via openclaw.ts:renderConfigs):
 *
 *    ```json
 *    {
 *      "plugins": {
 *        "enabled": true,
 *        "load": {
 *          "paths": ["/opt/openclaw-otel-bridge/index.js"]
 *        },
 *        "entries": {
 *          "jarble-otel-bridge": { "enabled": true }
 *        }
 *      }
 *    }
 *    ```
 *
 * 3. Pass env vars into the pod Secret via openclaw.ts:getSecretEntries:
 *    - `LANGFUSE_BASE_URL` (already shipped as part of the API secret)
 *    - `LANGFUSE_PUBLIC_KEY`
 *    - `LANGFUSE_SECRET_KEY`
 *    - `JARBLE_POD_NAME` (the pod's own name, for resource attributes)
 *
 * 4. `chatViaExec` / `chatViaGateway` / `chatViaHTTP` already inject
 *    `TRACEPARENT` via env / header — this plugin picks that up at
 *    session_start and uses it as the parent context.
 *
 * ## Status
 *
 * DRAFT SCAFFOLD. Not yet wired into the runtime Dockerfile. Ships
 * the plugin source + manifest + package.json so the user can install
 * + enable as a follow-up PR without re-reading the research audit.
 */

// Lazily require OTel so the plugin doesn't crash on pod startup if
// the OTel deps aren't installed yet. Plugin registration still succeeds;
// telemetry just no-ops.
let tracer = null;
let otelContext = null;
let trace = null;
let propagation = null;
let SpanStatusCode = null;
let sdkInitialized = false;

async function initOtelSdk(logger, pluginConfig) {
  if (sdkInitialized) return true;
  try {
    const api = await import("@opentelemetry/api");
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-http"
    );
    const { BatchSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-node"
    );
    const { resourceFromAttributes } = await import(
      "@opentelemetry/resources"
    );

    trace = api.trace;
    otelContext = api.context;
    propagation = api.propagation;
    SpanStatusCode = api.SpanStatusCode;

    const langfuseBaseUrl =
      pluginConfig?.endpoint ||
      process.env.LANGFUSE_BASE_URL ||
      process.env.LANGFUSE_HOST ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    if (!langfuseBaseUrl) {
      logger.warn(
        "[jarble-otel-bridge] No OTLP endpoint configured (LANGFUSE_BASE_URL / OTEL_EXPORTER_OTLP_ENDPOINT) — telemetry will be suppressed",
      );
      return false;
    }

    const langfusePk = process.env.LANGFUSE_PUBLIC_KEY;
    const langfuseSk = process.env.LANGFUSE_SECRET_KEY;
    const langfuseAuth = langfusePk && langfuseSk
      ? {
          Authorization: `Basic ${Buffer.from(`${langfusePk}:${langfuseSk}`).toString("base64")}`,
        }
      : undefined;

    const url = langfuseBaseUrl.startsWith("http") &&
      langfuseBaseUrl.includes("langfuse")
      ? `${langfuseBaseUrl.replace(/\/+$/, "")}/api/public/otel/v1/traces`
      : `${langfuseBaseUrl.replace(/\/+$/, "")}/v1/traces`;

    const exporter = new OTLPTraceExporter({
      url,
      headers: langfuseAuth,
      timeoutMillis: 5_000,
    });

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": pluginConfig?.serviceName || "jarble-openclaw-runtime",
        "service.version": process.env.OPENCLAW_VERSION || "unknown",
        "deployment.environment.name": process.env.NODE_ENV || "production",
        "jarble.pod.name": process.env.JARBLE_POD_NAME || "unknown",
        "jarble.deployment.id": process.env.JARBLE_DEPLOYMENT_ID || "unknown",
      }),
      spanProcessors: [
        new BatchSpanProcessor(exporter, {
          maxExportBatchSize: 128,
          maxQueueSize: 1024,
          scheduledDelayMillis: 1_000,
          exportTimeoutMillis: 5_000,
        }),
      ],
    });

    sdk.start();
    tracer = trace.getTracer("jarble-openclaw-otel-bridge");
    sdkInitialized = true;

    const shutdown = () => {
      sdk
        .shutdown()
        .catch(() => {
          /* best-effort */
        });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    logger.info(
      `[jarble-otel-bridge] OTel SDK initialized (endpoint=${url})`,
    );
    return true;
  } catch (err) {
    logger.warn(
      `[jarble-otel-bridge] OTel SDK init failed (continuing without telemetry): ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Decode a W3C traceparent header string (`00-<trace-id>-<span-id>-<flags>`)
 * into an OTel SpanContext that subsequent spans can inherit.
 */
function parseTraceparent(tp) {
  if (typeof tp !== "string") return null;
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(
    tp.trim(),
  );
  if (!m) return null;
  return {
    traceId: m[2],
    spanId: m[3],
    traceFlags: parseInt(m[4], 16),
    isRemote: true,
  };
}

// Map of sessionKey → active root span. Lets us nest child tool/LLM
// spans under the session's root span, so every pod-side event for
// a single chat turn lives in one OTel trace branch.
const activeSessions = new Map();

const plugin = {
  id: "jarble-otel-bridge",
  name: "Jarble OTel Bridge",
  description:
    "Bridges openclaw lifecycle events to OTel spans rooted under the caller's TRACEPARENT",
  version: "0.1.0",

  async register(api) {
    const logger = api.logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const ok = await initOtelSdk(logger, api.pluginConfig);
    if (!ok) {
      logger.warn(
        "[jarble-otel-bridge] telemetry disabled — lifecycle hooks will no-op",
      );
      return;
    }

    // session_start — open a root span for this chat turn, rooted under
    // the TRACEPARENT env var if present.
    api.on("session_start", async (ctx) => {
      try {
        const sessionKey = ctx.sessionKey || ctx.sessionId || "anonymous";
        const tpEnv = process.env.TRACEPARENT;
        const parentCtx = tpEnv ? parseTraceparent(tpEnv) : null;

        let parent = otelContext.active();
        if (parentCtx) {
          parent = trace.setSpanContext(parent, parentCtx);
        }

        const span = tracer.startSpan(
          "jarble.pod.session",
          {
            attributes: {
              "jarble.session.key": sessionKey,
              "jarble.agent.id": ctx.agentId || "",
              "jarble.runtime": "openclaw",
            },
          },
          parent,
        );
        activeSessions.set(sessionKey, span);
      } catch (err) {
        logger.warn(
          `[jarble-otel-bridge] session_start hook failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    // llm_output — every LLM call produces a gen_ai.* span matching
    // the OpenLLMetry conventions.
    api.on("llm_output", async (ctx) => {
      try {
        const sessionKey = ctx.sessionKey || ctx.sessionId || "anonymous";
        const parent = activeSessions.get(sessionKey);
        const parentCtx = parent
          ? trace.setSpan(otelContext.active(), parent)
          : otelContext.active();

        const provider = ctx.provider || "unknown";
        const span = tracer.startSpan(
          `gen_ai.${provider}.chat`,
          {
            attributes: {
              "gen_ai.system": provider,
              "gen_ai.operation.name": "chat",
              "gen_ai.request.model": ctx.model || "",
              "gen_ai.usage.input_tokens": ctx.usage?.input || 0,
              "gen_ai.usage.output_tokens": ctx.usage?.output || 0,
              "gen_ai.response.finish_reasons": ctx.stopReason || "",
              "jarble.session.key": sessionKey,
            },
          },
          parentCtx,
        );
        span.end();
      } catch (err) {
        logger.warn(
          `[jarble-otel-bridge] llm_output hook failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    // before_tool_call / after_tool_call — produce a tool span per call.
    const pendingToolSpans = new Map();
    api.on("before_tool_call", async (ctx) => {
      try {
        const sessionKey = ctx.sessionKey || ctx.sessionId || "anonymous";
        const parent = activeSessions.get(sessionKey);
        const parentCtx = parent
          ? trace.setSpan(otelContext.active(), parent)
          : otelContext.active();
        const span = tracer.startSpan(
          `jarble.pod.tool.${ctx.toolName || "unknown"}`,
          {
            attributes: {
              "jarble.tool.name": ctx.toolName || "",
              "jarble.session.key": sessionKey,
            },
          },
          parentCtx,
        );
        pendingToolSpans.set(`${sessionKey}:${ctx.callId || ""}`, span);
      } catch (err) {
        logger.warn(
          `[jarble-otel-bridge] before_tool_call hook failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
    api.on("after_tool_call", async (ctx) => {
      try {
        const sessionKey = ctx.sessionKey || ctx.sessionId || "anonymous";
        const key = `${sessionKey}:${ctx.callId || ""}`;
        const span = pendingToolSpans.get(key);
        if (!span) return;
        if (ctx.error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(ctx.error),
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.end();
        pendingToolSpans.delete(key);
      } catch (err) {
        logger.warn(
          `[jarble-otel-bridge] after_tool_call hook failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    // session_end — close the root span.
    api.on("session_end", async (ctx) => {
      try {
        const sessionKey = ctx.sessionKey || ctx.sessionId || "anonymous";
        const span = activeSessions.get(sessionKey);
        if (span) {
          span.end();
          activeSessions.delete(sessionKey);
        }
      } catch (err) {
        logger.warn(
          `[jarble-otel-bridge] session_end hook failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    logger.info(
      "[jarble-otel-bridge] registered lifecycle hooks (session_start, llm_output, before/after_tool_call, session_end)",
    );
  },
};

export default plugin;
