/**
 * OpenClaw OTel Bridge — preloaded via NODE_OPTIONS=--require
 *
 * JAR-51 Phase 2: Reads the W3C TRACEPARENT env var injected by the Jarble
 * API's chatViaExec (openclawGateway.ts) and initializes a minimal OTel SDK
 * so HTTP-level auto-instrumentation captures the LLM calls that OpenClaw
 * makes to providers (Anthropic, OpenRouter, OpenAI, etc.) as child spans
 * of the API caller's trace.
 *
 * This script runs in two contexts:
 *   1. One-shot `openclaw agent` processes (kubectl exec from chatViaExec)
 *      → TRACEPARENT is set, spans attach under the API's delegation span
 *   2. Long-lived `openclaw gateway` process (started by entrypoint.sh)
 *      → TRACEPARENT is NOT set, but HTTP calls still get auto-instrumented
 *        under fresh traces (useful for standalone debugging)
 *
 * Failure isolation (non-negotiable):
 *   - Init failures MUST NOT crash the bot
 *   - Exporter failures MUST NOT block LLM calls
 *   - Backend down MUST result in dropped spans, not errors
 *
 * This is a CommonJS file (.cjs) because NODE_OPTIONS=--require only works
 * with CJS modules. OpenClaw itself is ESM, but the preload runs before
 * OpenClaw's module system initializes.
 */
"use strict";

try {
  const { NodeSDK } = require("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
  const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-node");
  const { resourceFromAttributes } = require("@opentelemetry/resources");
  const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");

  // ── Exporter selection ──────────────────────────────────────────────
  // Same priority as the API's instrument.ts:
  //   1. Explicit OTEL_EXPORTER_OTLP_ENDPOINT wins
  //   2. LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY → Langfuse Cloud OTLP
  //   3. No exporter → spans created but never shipped (zero overhead)

  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
  const langfuseHost = (
    process.env.LANGFUSE_BASE_URL ||
    process.env.LANGFUSE_HOST ||
    "https://cloud.langfuse.com"
  ).replace(/\/+$/, "");

  let traceExporter;
  if (otelEndpoint) {
    traceExporter = new OTLPTraceExporter({
      url: `${otelEndpoint.replace(/\/+$/, "")}/v1/traces`,
      timeoutMillis: 5000,
    });
  } else if (langfusePublicKey && langfuseSecretKey) {
    const basicAuth = Buffer.from(`${langfusePublicKey}:${langfuseSecretKey}`).toString("base64");
    traceExporter = new OTLPTraceExporter({
      url: `${langfuseHost}/api/public/otel/v1/traces`,
      headers: { Authorization: `Basic ${basicAuth}` },
      timeoutMillis: 5000,
    });
  }
  // else: no exporter — SDK runs in no-op mode

  if (!traceExporter) {
    // No exporter configured — skip SDK init entirely for zero overhead.
    return;
  }

  const deploymentId = process.env.DEPLOYMENT_ID || "unknown";
  const podName = process.env.HOSTNAME || "unknown";

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": "openclaw-runtime",
      "service.version": process.env.OPENCLAW_VERSION || "unknown",
      "deployment.environment.name": process.env.NODE_ENV || "production",
      "jarble.deployment.id": deploymentId,
      "jarble.pod.name": podName,
    }),
    spanProcessors: [
      new BatchSpanProcessor(traceExporter, {
        maxExportBatchSize: 128,
        maxQueueSize: 1024,
        scheduledDelayMillis: 2000,
        exportTimeoutMillis: 5000,
      }),
    ],
    // Only instrument HTTP/fetch — we don't need fs, dns, net in bot pods.
    // This keeps the overhead minimal while capturing every LLM API call
    // that OpenClaw makes via Node.js HTTP primitives.
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Best-effort shutdown on process exit so in-flight spans get flushed.
  const shutdown = () => {
    sdk.shutdown().catch(() => {});
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  // For one-shot `openclaw agent` processes, 'beforeExit' fires when the
  // event loop drains. This gives the BatchSpanProcessor a chance to flush.
  process.on("beforeExit", shutdown);

} catch (err) {
  // OTel bridge init must NEVER crash the bot. Swallow and continue.
  process.stderr.write(
    `[otel-bridge] init failed (continuing without OTel): ${
      err instanceof Error ? err.message : String(err)
    }\n`
  );
}
