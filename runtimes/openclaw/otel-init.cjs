// ─────────────────────────────────────────────────────────────────────────
// OpenTelemetry + OpenLLMetry preload — OpenClaw Runtime (JAR-51 Phase 2)
// ─────────────────────────────────────────────────────────────────────────
//
// Loaded via NODE_OPTIONS="--require /opt/openclaw/otel-init.cjs" so every
// Node.js process in the container gets OTel auto-instrumentation and
// OpenLLMetry LLM call tracing.
//
// Failure isolation contract (non-negotiable — matches jarble-api instrument.ts):
//   - SDK init failures MUST NOT crash the runtime
//   - Span exporter failures MUST NOT block request handling
//   - Backend down MUST result in dropped spans, not errors
//
// TRACEPARENT stitching:
//   The Jarble API injects `TRACEPARENT` (and optionally `TRACESTATE`) as
//   env vars into each kubectl exec call (see openclawGateway.ts:chatViaExec).
//   We extract these at process startup and set them as the active parent
//   context so in-pod spans attach to the API's trace tree.
//
// Exporter selection (same priority as the API):
//   1. OTEL_EXPORTER_OTLP_ENDPOINT set  -> ship spans there
//   2. LANGFUSE_PUBLIC_KEY + SECRET_KEY  -> ship to Langfuse Cloud OTLP
//   3. Neither set                       -> skip init entirely (zero overhead)
// ─────────────────────────────────────────────────────────────────────────

"use strict";

// Early bail-out: if no observability backend is configured, do nothing.
// This ensures zero overhead for pods that don't have tracing enabled.
const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
const langfuseEnabled = Boolean(langfusePublicKey && langfuseSecretKey);

if (!otelEndpoint && !langfuseEnabled) {
  // No backend configured — skip init entirely.
  return;
}

try {
  const { NodeSDK } = require("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
  const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-node");
  const { resourceFromAttributes } = require("@opentelemetry/resources");
  const {
    ATTR_SERVICE_NAME,
  } = require("@opentelemetry/semantic-conventions/incubating");
  const otelApi = require("@opentelemetry/api");

  // ── Build resource attributes ──────────────────────────────────────
  const resourceAttrs = {
    [ATTR_SERVICE_NAME]: "openclaw-runtime",
  };
  if (process.env.DEPLOYMENT_ID) {
    resourceAttrs["jarble.deployment.id"] = process.env.DEPLOYMENT_ID;
  }
  if (process.env.HOSTNAME) {
    resourceAttrs["jarble.pod.name"] = process.env.HOSTNAME;
  }

  // ── Build trace exporter ───────────────────────────────────────────
  let traceExporter;
  if (otelEndpoint) {
    // Explicit OTLP endpoint wins over Langfuse
    traceExporter = new OTLPTraceExporter({
      url: `${otelEndpoint.replace(/\/+$/, "")}/v1/traces`,
      timeoutMillis: 5000,
    });
  } else if (langfuseEnabled) {
    // Langfuse Cloud accepts OTLP/HTTP at /api/public/otel/v1/traces
    // with Basic auth (user = public key, password = secret key).
    const langfuseHost = (
      process.env.LANGFUSE_BASE_URL ||
      process.env.LANGFUSE_HOST ||
      "https://cloud.langfuse.com"
    ).replace(/\/+$/, "");

    const basicAuth = Buffer.from(
      `${langfusePublicKey}:${langfuseSecretKey}`
    ).toString("base64");

    traceExporter = new OTLPTraceExporter({
      url: `${langfuseHost}/api/public/otel/v1/traces`,
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
      timeoutMillis: 5000,
    });
  }

  // ── Initialize the SDK ─────────────────────────────────────────────
  const sdk = new NodeSDK({
    resource: resourceFromAttributes(resourceAttrs),
    // BatchSpanProcessor with bounded queue and drop-on-full semantics.
    // A wedged exporter MUST NOT back-pressure into the runtime.
    // maxQueueSize: 1024 (per spec), exportTimeout: 5s.
    spanProcessors: traceExporter
      ? [
          new BatchSpanProcessor(traceExporter, {
            maxExportBatchSize: 256,
            maxQueueSize: 1024,
            scheduledDelayMillis: 1000,
            exportTimeoutMillis: 5000,
          }),
        ]
      : undefined,
    // No auto-instrumentations for the runtime — we rely on OpenLLMetry
    // for LLM call instrumentation. The runtime doesn't run Express/pg/etc.
    instrumentations: [],
  });

  sdk.start();

  // ── TRACEPARENT context stitching ──────────────────────────────────
  // The API injects TRACEPARENT and optionally TRACESTATE env vars into
  // kubectl exec calls. We extract them and set as the active parent
  // context so all spans in this process attach to the API's trace tree.
  const traceparent = process.env.TRACEPARENT;
  if (traceparent) {
    const { propagation, ROOT_CONTEXT } = otelApi;
    const carrier = { traceparent };
    if (process.env.TRACESTATE) {
      carrier.tracestate = process.env.TRACESTATE;
    }

    // Use W3CTraceContextPropagator (registered by default in NodeSDK)
    // to extract the parent context from the carrier.
    const parentContext = propagation.extract(ROOT_CONTEXT, carrier);

    // Set this as the active context for all subsequent code in this process.
    // NodeSDK.start() already registered an AsyncLocalStorageContextManager
    // as the global context manager. We reach into its internal ALS to
    // enterWith the parent context so all spans created in this process
    // (including OpenLLMetry auto-instrumented spans) attach to the API's
    // trace tree.
    const contextManager = otelApi.context["_getContextManager"]();
    if (contextManager && contextManager._asyncLocalStorage) {
      contextManager._asyncLocalStorage.enterWith(parentContext);
    } else {
      // Fallback: propagation.extract succeeded, so any span created with
      // an explicit parent will still stitch correctly. Auto-context-
      // propagation just won't work without ALS enterWith.
      process.stderr.write(
        "[otel] Warning: could not enterWith parent context (ALS unavailable)\n"
      );
    }
  }

  // ── OpenLLMetry (automatic LLM call instrumentation) ──────────────
  // @traceloop/node-server-sdk auto-instruments calls to OpenAI, Anthropic,
  // Google, and other LLM providers. It hooks into the HTTP layer to detect
  // LLM API calls and create spans with model, tokens, cost attributes.
  // Wrapped in try/catch since it's an optional enhancement — if the package
  // isn't available or fails to init, OTel still works for manual spans.
  try {
    const traceloop = require("@traceloop/node-server-sdk");
    traceloop.initialize({
      // Disable Traceloop's own exporter — we already have our own
      // BatchSpanProcessor configured above. OpenLLMetry will create
      // spans that flow through our existing exporter pipeline.
      disableBatch: true,
      // Resource attributes are already set on the SDK resource above.
      appName: "openclaw-runtime",
    });
  } catch (llmetryErr) {
    // Non-fatal: OpenLLMetry is a nice-to-have for auto LLM instrumentation.
    // OTel core still works without it.
    process.stderr.write(
      `[otel] OpenLLMetry init skipped: ${
        llmetryErr instanceof Error ? llmetryErr.message : String(llmetryErr)
      }\n`
    );
  }

  // ── Graceful shutdown ──────────────────────────────────────────────
  // Best-effort flush of in-flight spans on process exit. Wrapped in catch
  // so a wedged shutdown can't hang the SIGTERM grace period.
  const shutdown = () => {
    sdk.shutdown().catch((err) => {
      process.stderr.write(
        `[otel] shutdown failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`
      );
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  process.stderr.write(
    `[otel] OpenClaw runtime instrumentation active (exporter: ${
      otelEndpoint ? "otlp" : "langfuse"
    })\n`
  );
} catch (err) {
  // OTel init must NEVER crash the runtime. Log and continue.
  process.stderr.write(
    `[otel] SDK init failed (continuing without OTel): ${
      err instanceof Error ? err.message : String(err)
    }\n`
  );
}
